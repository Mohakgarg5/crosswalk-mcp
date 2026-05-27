import type { Browser, BrowserPreview, FormField, FillField, BrowserFillResult } from './types.ts';
import { BrowserNotInstalledError } from './types.ts';

type PlaywrightContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

type PlaywrightModule = {
  chromium: {
    launch(opts?: { headless?: boolean }): Promise<{
      newContext(): Promise<PlaywrightContext>;
      close(): Promise<void>;
    }>;
    launchPersistentContext(userDataDir: string, opts?: { headless?: boolean }): Promise<PlaywrightContext>;
  };
};

type PlaywrightLocator = {
  fill?(value: string): Promise<void>;
  setInputFiles?(files: string | string[]): Promise<void>;
  click?(): Promise<void>;
};

type PlaywrightPage = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  url(): string;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  evaluate<T>(fn: () => T): Promise<T>;
  $(selector: string): Promise<PlaywrightLocator | null>;
  close(): Promise<void>;
};

export type LazyPlaywrightBrowserOpts = {
  importPlaywright?: () => Promise<PlaywrightModule>;
  /** Persistent user-data-dir. When set, sessions/logins persist across runs
   *  (the unlock for login-walled ATSes). Defaults to CROSSWALK_BROWSER_PROFILE. */
  profileDir?: string;
  /** Run a visible browser. Defaults to CROSSWALK_BROWSER_HEADED=1. */
  headed?: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Browser automation that lazy-imports Playwright. In the default (ephemeral)
 * mode it launches a shared Chromium and uses a fresh context per call. When a
 * profileDir is configured it uses a persistent context, so the user logs in
 * once and those sessions are reused on later runs.
 */
export class LazyPlaywrightBrowser implements Browser {
  private importPlaywright: () => Promise<PlaywrightModule>;
  private launchedBrowser: Awaited<ReturnType<PlaywrightModule['chromium']['launch']>> | null = null;
  private persistentContext: PlaywrightContext | null = null;
  private readonly profileDir?: string;
  private readonly headed: boolean;

  constructor(opts: LazyPlaywrightBrowserOpts = {}) {
    this.importPlaywright = opts.importPlaywright ?? (async () => {
      // @ts-expect-error - playwright is an optional peer dep; resolved at runtime
      return (await import('playwright')) as unknown as PlaywrightModule;
    });
    this.profileDir = opts.profileDir ?? process.env.CROSSWALK_BROWSER_PROFILE;
    this.headed = opts.headed ?? process.env.CROSSWALK_BROWSER_HEADED === '1';
  }

  /** Acquire a page (persistent profile when configured, else a fresh context)
   *  and guarantee cleanup of the per-call resource. */
  private async runWithPage<T>(fn: (page: PlaywrightPage) => Promise<T>): Promise<T> {
    let pw: PlaywrightModule;
    try {
      pw = await this.importPlaywright();
    } catch (e) {
      throw new BrowserNotInstalledError(`playwright is not installed: ${(e as Error).message}`);
    }

    if (this.profileDir) {
      if (!this.persistentContext) {
        this.persistentContext = await pw.chromium.launchPersistentContext(this.profileDir, { headless: !this.headed });
      }
      const page = await this.persistentContext.newPage();
      try {
        return await fn(page);
      } finally {
        try { await page.close(); } catch { /* ignore cleanup errors */ }
      }
    }

    if (!this.launchedBrowser) {
      this.launchedBrowser = await pw.chromium.launch({ headless: !this.headed });
    }
    const ctx = await this.launchedBrowser.newContext();
    try {
      const page = await ctx.newPage();
      return await fn(page);
    } finally {
      try { await ctx.close(); } catch { /* ignore cleanup errors */ }
    }
  }

  async preview(url: string): Promise<BrowserPreview> {
    return this.runWithPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      const title = await page.title();
      const resolvedUrl = page.url();
      const screenshotPng = await page.screenshot({ fullPage: false });
      const formFields = await page.evaluate(extractFormFieldsScript);
      return { screenshotPng, resolvedUrl, title, formFields };
    });
  }

  async fillForm(url: string, fields: FillField[], opts: { ats?: string; clickSubmit?: boolean; maxSteps?: number } = {}): Promise<BrowserFillResult> {
    return this.runWithPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      const maxSteps = Math.max(1, opts.maxSteps ?? 1);
      const labelOf = (f: FillField) => (f.kind === 'text_by_name' ? `text_by_name:${f.name}` : f.kind);
      const filledLabels = new Set<string>();
      let stepsAdvanced = 0;

      // Multi-step wizards: fill the current page, advance via Next/Continue,
      // repeat. A field skipped on one page may be filled on a later one.
      for (let step = 1; step <= maxSteps; step++) {
        for (const field of fields) {
          const label = labelOf(field);
          if (filledLabels.has(label)) continue;
          if (await tryFillField(page, field, opts.ats)) filledLabels.add(label);
        }
        if (step < maxSteps) {
          const advanced = await clickFirst(page, NEXT_SELECTORS);
          if (!advanced) break; // no Next button → this is the last page
          stepsAdvanced++;
          await new Promise(resolve => setTimeout(resolve, 1500)); // let the next page render
        }
      }

      const filled = fields.map(labelOf).filter(l => filledLabels.has(l));
      const skipped = fields.map(labelOf).filter(l => !filledLabels.has(l));

      const resolvedUrl = page.url();
      const title = await page.title();

      let submitClicked: boolean | undefined;
      let postSubmitUrl: string | undefined;
      let postSubmitTitle: string | undefined;
      if (opts.clickSubmit) {
        submitClicked = await clickFirst(page, SUBMIT_SELECTORS);
        if (submitClicked) {
          try {
            // Best-effort wait for navigation to settle
            await new Promise(resolve => setTimeout(resolve, 2000));
            postSubmitUrl = page.url();
            postSubmitTitle = await page.title();
          } catch {
            // Page might be in transient state; leave URL/title undefined
          }
        }
      }

      const screenshotPng = await page.screenshot({ fullPage: false });
      return { resolvedUrl, title, screenshotPng, filled, skipped, submitClicked, postSubmitUrl, postSubmitTitle, stepsAdvanced };
    });
  }

  async close(): Promise<void> {
    if (this.persistentContext) {
      await this.persistentContext.close();
      this.persistentContext = null;
    }
    if (this.launchedBrowser) {
      await this.launchedBrowser.close();
      this.launchedBrowser = null;
    }
  }
}

const SUBMIT_SELECTORS: string[] = [
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="submit"]',
  'button[id*="submit" i]',
  'button[name*="submit" i]',
  'button[data-automation-id*="submit" i]',
  'button[data-automation-id="bottom-navigation-next-button"]'
];

/** Buttons that advance a multi-page wizard (tried before deciding a page is the last). */
const NEXT_SELECTORS: string[] = [
  'button[data-automation-id="bottom-navigation-next-button"]', // Workday
  'button[data-automation-id="pageFooterNextButton"]',
  'button:has-text("Save and Continue")',
  'button:has-text("Save & Continue")',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'a:has-text("Continue")',
  'button[aria-label*="continue" i]',
  'button[aria-label*="next" i]'
];

/** Click the first matching, clickable selector. Returns whether one was clicked. */
async function clickFirst(page: PlaywrightPage, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const btn = await page.$(selector);
    if (!btn || typeof btn.click !== 'function') continue;
    try {
      await btn.click();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Fill a single field on the current page. Returns whether it matched a selector. */
async function tryFillField(page: PlaywrightPage, field: FillField, ats: string | undefined): Promise<boolean> {
  if (field.kind === 'text_by_name') {
    if (!isSafeFieldName(field.name)) return false;
    const candidates = [
      `textarea[name="${field.name}"]`,
      `textarea[id="${field.name}"]`,
      `input[name="${field.name}"]`,
      `input[id="${field.name}"]`
    ];
    for (const selector of candidates) {
      const el = await page.$(selector);
      if (!el || typeof el.fill !== 'function') continue;
      try { await el.fill(field.value); return true; } catch { continue; }
    }
    return false;
  }

  const candidates = selectorsForKind(field.kind, ats);
  for (const selector of candidates) {
    const el = await page.$(selector);
    if (!el) continue;
    try {
      if (field.kind === 'resume_file' || field.kind === 'cover_letter_file') {
        if (typeof el.setInputFiles !== 'function') continue;
        await el.setInputFiles([field.path]);
      } else {
        if (typeof el.fill !== 'function') continue;
        await el.fill(field.value);
      }
    } catch {
      continue;
    }
    return true;
  }
  return false;
}

/** Selector candidates, in priority order. First match wins. */
const SELECTORS: Record<Exclude<FillField['kind'], 'text_by_name'>, string[]> = {
  email: [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="job_application[email]"]',
    'input[autocomplete="email"]',
    'input[name*="email" i]'
  ],
  first_name: [
    'input[name="first_name"]',
    'input[name="job_application[first_name]"]',
    'input[autocomplete="given-name"]'
  ],
  last_name: [
    'input[name="last_name"]',
    'input[name="job_application[last_name]"]',
    'input[autocomplete="family-name"]'
  ],
  full_name: [
    'input[name="name"]',
    'input[name="full_name"]',
    'input[autocomplete="name"]'
  ],
  phone: [
    'input[type="tel"]',
    'input[name="phone"]',
    'input[name="job_application[phone]"]',
    'input[autocomplete="tel"]',
    'input[name*="phone" i]'
  ],
  linkedin: [
    'input[name="urls[LinkedIn]"]',
    'input[name="linkedin"]',
    'input[name*="linkedin" i]'
  ],
  website: [
    'input[name="urls[Website]"]',
    'input[name="website"]',
    'input[type="url"]'
  ],
  cover_letter_text: [
    'textarea[name="cover_letter"]',
    'textarea[name="job_application[cover_letter]"]',
    'textarea[id="cover_letter"]',
    'textarea[name*="cover" i]',
    'textarea[id*="cover" i]'
  ],
  cover_letter_file: [
    'input[type="file"][name*="cover" i]',
    'input[type="file"][name*="letter" i]',
    'input[type="file"][id*="cover" i]'
  ],
  resume_file: [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][name*="cv" i]',
    'input[type="file"]'
  ]
};

type StaticKind = Exclude<FillField['kind'], 'text_by_name'>;

/** ATS-specific selector overlays. Tried BEFORE generic candidates. */
const ATS_SELECTORS: Record<string, Partial<Record<StaticKind, string[]>>> = {
  workable: {
    first_name: ['input[name="firstName"]'],
    last_name: ['input[name="lastName"]'],
    phone: ['input[name="phoneNumber"]'],
    resume_file: ['input[name="resumeFile"]', 'input[name="cv"]']
  },
  ashby: {
    email: ['input[data-testid*="email" i]'],
    phone: ['input[data-testid*="phone" i]'],
    resume_file: ['input[data-testid*="resume" i]']
  },
  workday: {
    email: ['input[data-automation-id="email"]'],
    first_name: [
      'input[data-automation-id="legalNameSection_firstName"]',
      'input[data-automation-id="firstName"]'
    ],
    last_name: [
      'input[data-automation-id="legalNameSection_lastName"]',
      'input[data-automation-id="lastName"]'
    ],
    phone: ['input[data-automation-id="phone-number"]', 'input[data-automation-id="phoneNumber"]'],
    resume_file: ['input[data-automation-id="file-upload-input-ref"]']
  },
  greenhouse: {},
  lever: {},
  smartrecruiters: {
    first_name: ['input[name="firstName"]'],
    last_name: ['input[name="lastName"]'],
    phone: ['input[name="phoneNumber"]'],
    resume_file: ['input[name="cv"]', 'input[name="resume"]']
  },
  bamboohr: {
    first_name: ['input[name="fname"]', 'input[name="firstName"]'],
    last_name: ['input[name="lname"]', 'input[name="lastName"]'],
    resume_file: ['input[name="resume_file"]', 'input[name="resume"]']
  },
  recruitee: {
    email: ['input[name="candidate[email]"]'],
    first_name: ['input[name="candidate[first_name]"]'],
    last_name: ['input[name="candidate[last_name]"]'],
    phone: ['input[name="candidate[phone]"]'],
    resume_file: ['input[name="candidate[cv]"]', 'input[name="candidate[resume]"]']
  },
  personio: {
    email: ['input[name="job_application[email_address]"]'],
    first_name: ['input[name="job_application[first_name]"]'],
    last_name: ['input[name="job_application[last_name]"]'],
    phone: ['input[name="job_application[phone]"]'],
    resume_file: ['input[name="job_application[cv]"]', 'input[name="job_application[recent_professional_experience]"]']
  },
  icims: {
    email: ['input[id*="email" i]', 'input[data-test-id*="email" i]'],
    first_name: ['input[id*="firstName" i]', 'input[id*="first_name" i]'],
    last_name: ['input[id*="lastName" i]', 'input[id*="last_name" i]'],
    phone: ['input[id*="phone" i]', 'input[data-test-id*="phone" i]'],
    resume_file: ['input[id*="resume" i]', 'input[data-test-id*="resume" i]']
  }
};

function selectorsForKind(kind: StaticKind, ats: string | undefined): string[] {
  const overlay = ats ? ATS_SELECTORS[ats]?.[kind] : undefined;
  return overlay && overlay.length > 0
    ? [...overlay, ...SELECTORS[kind]]
    : SELECTORS[kind];
}

const SAFE_FIELD_NAME_RE = /^[A-Za-z0-9_-]+$/;
function isSafeFieldName(name: string): boolean {
  return SAFE_FIELD_NAME_RE.test(name);
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
