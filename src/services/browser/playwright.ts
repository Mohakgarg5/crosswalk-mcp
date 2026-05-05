import type { Browser, BrowserPreview, FormField } from './types.ts';
import { BrowserNotInstalledError } from './types.ts';

type PlaywrightModule = {
  chromium: {
    launch(opts?: { headless?: boolean }): Promise<{
      newContext(): Promise<{
        newPage(): Promise<PlaywrightPage>;
        close(): Promise<void>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

type PlaywrightPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  evaluate<T>(fn: () => T): Promise<T>;
  close(): Promise<void>;
};

export type LazyPlaywrightBrowserOpts = {
  importPlaywright?: () => Promise<PlaywrightModule>;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Browser-based preview that lazy-imports Playwright. Single shared
 * Chromium instance; one fresh context per preview call.
 */
export class LazyPlaywrightBrowser implements Browser {
  private importPlaywright: () => Promise<PlaywrightModule>;
  private launchedBrowser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | null = null;

  constructor(opts: LazyPlaywrightBrowserOpts = {}) {
    this.importPlaywright = opts.importPlaywright ?? (async () => {
      // @ts-expect-error - playwright is an optional peer dep; resolved at runtime
      return (await import('playwright')) as unknown as PlaywrightModule;
    });
  }

  private async loadBrowser() {
    if (this.launchedBrowser) return this.launchedBrowser;
    let pw: PlaywrightModule;
    try {
      pw = await this.importPlaywright();
    } catch (e) {
      throw new BrowserNotInstalledError(
        `playwright is not installed: ${(e as Error).message}`
      );
    }
    this.launchedBrowser = await pw.chromium.launch({ headless: true });
    return this.launchedBrowser;
  }

  async preview(url: string): Promise<BrowserPreview> {
    const browser = await this.loadBrowser();
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      const title = await page.title();
      const resolvedUrl = page.url();
      const screenshotPng = await page.screenshot({ fullPage: false });
      const formFields = await page.evaluate(extractFormFieldsScript);
      return { screenshotPng, resolvedUrl, title, formFields };
    } finally {
      await ctx.close();
    }
  }

  async close(): Promise<void> {
    if (this.launchedBrowser) {
      await this.launchedBrowser.close();
      this.launchedBrowser = null;
    }
  }
}

/* Runs in the browser page context (Playwright's page.evaluate).
 * DOM globals are not visible to the Node TS compiler, so we type
 * everything as `any` inside this function. The runtime semantics
 * are standard DOM. */
const extractFormFieldsScript = (): FormField[] => {
  const fields: FormField[] = [];
  const doc = (globalThis as unknown as { document: any }).document;
  const inputs = Array.from(doc.querySelectorAll('input, textarea, select')) as any[];
  for (const e of inputs) {
    const tag = String(e.tagName).toLowerCase();
    if (e.type === 'hidden') continue;
    if (e.disabled) continue;
    const rect = e.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const name = e.name || e.id || '(unnamed)';
    const type = tag === 'input' ? (e.type || 'text') : tag;
    let label: string | undefined;
    if (e.id) {
      const lbl = doc.querySelector(`label[for="${e.id}"]`);
      if (lbl) label = String(lbl.textContent ?? '').trim();
    }
    if (!label) {
      const parent = e.closest('label');
      if (parent) label = String(parent.textContent ?? '').trim();
    }
    fields.push({
      name,
      type,
      label,
      required: Boolean(e.required),
      value: typeof e.value === 'string' && e.value.length > 0 ? e.value : undefined
    });
  }
  return fields;
};
