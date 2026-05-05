# Crosswalk M8 Implementation Plan — Browser preview (preview_application)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `preview_application` — a new MCP tool that opens an application's `deepLink` in a headless browser, returns a screenshot of the rendered page plus a manifest of visible form fields. Playwright is shipped as an *optional* peer dep so the base install stays light. Ship v0.7.0.

**Architecture:** Define a `Browser` interface (`preview(url)` → `{ screenshotPng, formFields }`). Production impl `LazyPlaywrightBrowser` lazy-imports `playwright` only when first used; throws a friendly "install playwright" error if unavailable. Tests inject a `MockBrowser`. New `crosswalk-mcp install-browser` CLI subcommand runs `npm install -g playwright && npx playwright install chromium` for users who opt in. Doctor reports browser availability.

**Tech Stack:** Same as M7 plus `playwright` as an **optional peer dep** (not a regular dep — base `npm install crosswalk-mcp` stays at ~50 KB without Chromium).

**M8 ships:**
- `Browser` interface + `LazyPlaywrightBrowser` impl
- `preview_application` MCP tool (becomes 17th tool)
- `crosswalk-mcp install-browser` CLI subcommand
- `crosswalk-mcp uninstall-browser` CLI subcommand
- Doctor browser-availability check
- README + USER_GUIDE updates
- Version 0.7.0

**Out of M8 (deferred to v0.8.0+):**
- Autonomous form-filling and submission (per-ATS scripts, captcha handling, multi-step state)
- MCP elicitation-based approval gates
- Real Playwright integration tests (flaky in CI; handled via mocks)
- Registry expansion (community-PR territory)

---

## File structure

```
crosswalk-mcp/
├── package.json                       # + playwright as optional peer dep
├── src/
│   ├── services/
│   │   └── browser/
│   │       ├── types.ts               # NEW — Browser interface
│   │       └── playwright.ts          # NEW — LazyPlaywrightBrowser
│   ├── tools/
│   │   ├── preview_application.ts     # NEW — 17th MCP tool
│   │   └── index.ts                   # MODIFY — register new tool
│   └── cli.ts                         # MODIFY — install-browser, uninstall-browser, doctor check
├── tests/
│   ├── services.browser.test.ts       # NEW — Browser interface contract
│   ├── tools.preview_application.test.ts # NEW
│   ├── server.tools.test.ts           # MODIFY — assert 17 tools
│   ├── cli.doctor.test.ts             # MODIFY — assert browser check exists
│   └── cli.installBrowser.test.ts     # NEW — flag verifies install detection
└── ...
```

---

## Task list (10 tasks)

| # | Theme | Task |
|---|---|---|
| 1 | Browser | Define `Browser` interface (`src/services/browser/types.ts`) |
| 2 | Browser | Implement `LazyPlaywrightBrowser` with graceful "playwright not installed" |
| 3 | Tool | `preview_application` MCP tool |
| 4 | Plumbing | Register `preview_application` (17th tool) |
| 5 | CLI | `crosswalk-mcp install-browser` subcommand |
| 6 | CLI | `crosswalk-mcp uninstall-browser` subcommand |
| 7 | Doctor | Add browser-availability check (warn-level) |
| 8 | Package | Mark `playwright` as optional peer dep |
| 9 | Docs | README + USER_GUIDE for v0.7.0 |
| 10 | Ship | Version bump + smoke + tag v0.7.0 |

---

## Task 1: Browser interface

**Files:**
- Create: `src/services/browser/types.ts`

A small interface with one method (`preview`) and one type (`BrowserPreview`). Makes the rest of the codebase testable with a mock — production code injects `LazyPlaywrightBrowser`, tests inject a stub.

- [ ] **Step 1: Implement (no test needed — pure types)**

Create `src/services/browser/types.ts`:

```ts
export type FormField = {
  name: string;
  type: string;        // 'text', 'email', 'file', 'select', 'textarea', etc.
  label?: string;
  required: boolean;
  value?: string;
};

export type BrowserPreview = {
  /** PNG bytes of the rendered page (above the fold). */
  screenshotPng: Buffer;
  /** Final URL after redirects. */
  resolvedUrl: string;
  /** Document title. */
  title: string;
  /** Best-effort manifest of visible form fields. */
  formFields: FormField[];
};

export interface Browser {
  /**
   * Open the URL in a headless browser, return a screenshot + form fields.
   * Throws if the browser runtime (Playwright + Chromium) is not installed.
   */
  preview(url: string): Promise<BrowserPreview>;

  /** Release any resources held by this browser instance. */
  close(): Promise<void>;
}

export class BrowserNotInstalledError extends Error {
  constructor(message?: string) {
    super(message ?? 'browser runtime (playwright + chromium) is not installed; run `crosswalk-mcp install-browser` to enable preview_application');
    this.name = 'BrowserNotInstalledError';
  }
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/services/browser/types.ts
git commit -m "feat(browser): Browser interface + BrowserPreview + BrowserNotInstalledError"
```

---

## Task 2: `LazyPlaywrightBrowser` implementation

**Files:**
- Create: `src/services/browser/playwright.ts`, `tests/services.browser.test.ts`

Lazy-imports `playwright` only when `preview()` is first called. Throws `BrowserNotInstalledError` if the import fails. Once loaded, holds a single `chromium.Browser` instance and reuses across calls.

- [ ] **Step 1: Failing test**

Create `tests/services.browser.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LazyPlaywrightBrowser } from '../src/services/browser/playwright.ts';
import { BrowserNotInstalledError } from '../src/services/browser/types.ts';

describe('services/browser/LazyPlaywrightBrowser', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws BrowserNotInstalledError when playwright import fails', async () => {
    // Inject a custom dynamic-import that always throws (simulates missing dep).
    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => {
        throw new Error('Cannot find module \'playwright\'');
      }
    });
    await expect(browser.preview('https://example.com')).rejects.toThrow(BrowserNotInstalledError);
  });

  it('uses injected playwright module to preview a page', async () => {
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Example Domain'),
      url: vi.fn().mockReturnValue('https://example.com/'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      evaluate: vi.fn().mockResolvedValue([
        { name: 'email', type: 'email', label: 'Email', required: true },
        { name: 'resume', type: 'file', label: 'Resume', required: true }
      ]),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = {
      chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) }
    };

    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => fakePw as never
    });
    const out = await browser.preview('https://example.com');
    expect(out.title).toBe('Example Domain');
    expect(out.resolvedUrl).toBe('https://example.com/');
    expect(out.screenshotPng).toBeInstanceOf(Buffer);
    expect(out.formFields).toHaveLength(2);
    expect(out.formFields[0]).toMatchObject({ name: 'email', type: 'email', required: true });

    await browser.close();
    expect(fakeBrowser.close).toHaveBeenCalled();
  });

  it('reuses the launched browser across multiple preview calls', async () => {
    const launchMock = vi.fn();
    const fakeContext = {
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(), title: vi.fn().mockResolvedValue('t'),
        url: vi.fn().mockReturnValue('u'),
        screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
        evaluate: vi.fn().mockResolvedValue([]),
        close: vi.fn()
      }),
      close: vi.fn()
    };
    launchMock.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue(fakeContext),
      close: vi.fn()
    });
    const fakePw = { chromium: { launch: launchMock } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    await browser.preview('https://a.example');
    await browser.preview('https://b.example');
    expect(launchMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- services.browser
```

- [ ] **Step 3: Implement**

Create `src/services/browser/playwright.ts`:

```ts
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
      // Dynamic import, isolated from the module graph so missing deps don't crash startup.
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

/**
 * Runs in the page context (no Node imports). Walks visible form controls
 * and returns a structured manifest. Best-effort: hidden, disabled, and
 * 0-size fields are skipped.
 */
const extractFormFieldsScript = (): FormField[] => {
  const fields: FormField[] = [];
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  for (const el of inputs) {
    const e = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const tag = e.tagName.toLowerCase();
    if ((e as HTMLInputElement).type === 'hidden') continue;
    if (e.disabled) continue;
    const rect = e.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const name = e.name || (e as HTMLElement).id || '(unnamed)';
    const type = tag === 'input' ? ((e as HTMLInputElement).type || 'text') : tag;
    let label: string | undefined;
    if ((e as HTMLElement).id) {
      const lbl = document.querySelector(`label[for="${(e as HTMLElement).id}"]`);
      if (lbl) label = (lbl.textContent ?? '').trim();
    }
    if (!label) {
      const parent = e.closest('label');
      if (parent) label = (parent.textContent ?? '').trim();
    }
    fields.push({
      name,
      type,
      label,
      required: (e as HTMLInputElement).required,
      value: 'value' in e ? (e as HTMLInputElement).value || undefined : undefined
    });
  }
  return fields;
};
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 178 passing (175 + 3 new). Lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/browser/playwright.ts tests/services.browser.test.ts
git commit -m "feat(browser): LazyPlaywrightBrowser with graceful 'not installed' error"
```

---

## Task 3: `preview_application` MCP tool

**Files:**
- Create: `src/tools/preview_application.ts`, `tests/tools.preview_application.test.ts`

Takes an `applicationId`, fetches the row's `deepLink`, opens it via the injected `Browser`, returns the preview as base64 PNG + form-fields JSON. Browser is dependency-injected so tests can use a mock without Playwright.

- [ ] **Step 1: Failing test**

Create `tests/tools.preview_application.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication } from '../src/store/application.ts';
import { previewApplication } from '../src/tools/preview_application.ts';
import type { Browser } from '../src/services/browser/types.ts';

describe('tools/preview_application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '#', coverLetterMd: '.',
      answerPack: {}, deepLink: 'https://apply.example.com/job/12345'
    });
  });

  it('previews the deep link via the injected browser', async () => {
    const browser: Browser = {
      preview: vi.fn().mockResolvedValue({
        screenshotPng: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        resolvedUrl: 'https://apply.example.com/job/12345',
        title: 'Apply: PM',
        formFields: [
          { name: 'email', type: 'email', required: true },
          { name: 'resume', type: 'file', required: true }
        ]
      }),
      close: vi.fn()
    };
    const out = await previewApplication({ applicationId: 'app1' }, { db, browser });
    expect(browser.preview).toHaveBeenCalledWith('https://apply.example.com/job/12345');
    expect(out.title).toBe('Apply: PM');
    expect(out.screenshotPngBase64).toBeTypeOf('string');
    expect(Buffer.from(out.screenshotPngBase64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
    expect(out.formFields).toHaveLength(2);
  });

  it('throws on unknown application', async () => {
    const browser: Browser = { preview: vi.fn(), close: vi.fn() };
    await expect(
      previewApplication({ applicationId: 'nope' }, { db, browser })
    ).rejects.toThrow(/unknown application/i);
    expect(browser.preview).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- preview_application
```

- [ ] **Step 3: Implement**

Create `src/tools/preview_application.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getApplication } from '../store/application.ts';
import type { Browser, FormField } from '../services/browser/types.ts';

export const previewApplicationInput = z.object({
  applicationId: z.string()
});

export type PreviewApplicationResult = {
  applicationId: string;
  deepLink: string;
  resolvedUrl: string;
  title: string;
  /** PNG screenshot of the rendered page, base64-encoded. */
  screenshotPngBase64: string;
  /** Best-effort list of visible form fields. */
  formFields: FormField[];
};

export async function previewApplication(
  input: z.infer<typeof previewApplicationInput>,
  ctx: { db: Db; browser: Browser }
): Promise<PreviewApplicationResult> {
  const app = getApplication(ctx.db, input.applicationId);
  if (!app) throw new Error(`unknown application: ${input.applicationId}`);

  const preview = await ctx.browser.preview(app.deepLink);

  return {
    applicationId: app.id,
    deepLink: app.deepLink,
    resolvedUrl: preview.resolvedUrl,
    title: preview.title,
    screenshotPngBase64: preview.screenshotPng.toString('base64'),
    formFields: preview.formFields
  };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 180 passing (178 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/tools/preview_application.ts tests/tools.preview_application.test.ts
git commit -m "feat(tools): preview_application — render deepLink, return screenshot + form fields"
```

---

## Task 4: Register `preview_application` (17th tool)

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `src/server.ts` — instantiate `LazyPlaywrightBrowser` and pass into `ToolCtx`
- Modify: `tests/server.tools.test.ts` — assert 17 tools

The new tool needs the `browser` in its context. Update `ToolCtx` to include `browser: Browser`. The server bootstrap creates a single `LazyPlaywrightBrowser` and passes it into `ToolCtx`.

- [ ] **Step 1: Update test**

Open `tests/server.tools.test.ts`. Find the assertion that lists 16 tool names. Update to 17:

```ts
  it('exports all 17 v1 tools', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    const names = toolDefinitions.map(t => t.name).sort();
    expect(names).toEqual([
      'add_note', 'add_resume', 'delete_workflow', 'draft_application',
      'explain_fit', 'fetch_jobs', 'list_pipeline', 'list_resumes',
      'list_workflows', 'preview_application', 'run_workflow',
      'schedule_workflow', 'score_fit', 'set_status',
      'setup_profile', 'submit_application', 'tailor_resume'
    ]);
  });
```

(Update the `it(...)` description from "all 16 v1 tools" to "all 17 v1 tools" and add `'preview_application'` in alphabetical order — between `list_workflows` and `run_workflow`.)

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- server.tools
```

- [ ] **Step 3: Update `ToolCtx` in `src/tools/index.ts`**

Find:

```ts
export type ToolCtx = { db: Db; sampling: SamplingClient };
```

Replace with:

```ts
import type { Browser } from '../services/browser/types.ts';
// ... (other imports)

export type ToolCtx = { db: Db; sampling: SamplingClient; browser: Browser };
```

Add the import for the new tool:

```ts
import { previewApplication, previewApplicationInput } from './preview_application.ts';
```

Append a new entry to `toolDefinitions` (alphabetical: between `list_workflows` and `run_workflow`):

```ts
  ,
  {
    name: 'preview_application',
    description: 'Open the application\'s deep link in a headless browser and return a screenshot + visible form fields. Requires `crosswalk-mcp install-browser` first.',
    inputSchema: zodToJsonSchema(previewApplicationInput),
    run: (i, c) => previewApplication(previewApplicationInput.parse(i), c)
  }
```

- [ ] **Step 4: Update `src/server.ts` to instantiate the browser**

Open `src/server.ts`. Find the `bootstrap` function. Add to imports:

```ts
import { LazyPlaywrightBrowser } from './services/browser/playwright.ts';
```

Find the `ToolCtx` construction (currently `const ctx: ToolCtx = { db, sampling };`). Replace with:

```ts
  const browser = new LazyPlaywrightBrowser();
  const ctx: ToolCtx = { db, sampling, browser };
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 180 passing.

- [ ] **Step 6: Build + smoke**

```bash
npm run build
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "ok"
```
Expected: `ok`.

- [ ] **Step 7: Commit**

```bash
git add src/tools/index.ts src/server.ts tests/server.tools.test.ts
git commit -m "feat(server): register preview_application (17th tool)"
```

---

## Task 5: `crosswalk-mcp install-browser` subcommand

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.installBrowser.test.ts`

Wraps `npm install -g playwright && npx playwright install chromium` so users have one command for "make preview_application work." We don't try to be too clever — we shell out and stream output. If the user wants finer-grained control, the underlying commands still work.

- [ ] **Step 1: Failing test**

Create `tests/cli.installBrowser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPlaywrightImportable } from '../src/cli.ts';

describe('cli/installBrowser', () => {
  it('isPlaywrightImportable returns boolean', async () => {
    const result = await isPlaywrightImportable();
    expect(typeof result).toBe('boolean');
  });
});
```

(Limited test surface — we don't shell out in tests. The command is exercised manually.)

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.installBrowser
```

- [ ] **Step 3: Add helper + subcommand in `src/cli.ts`**

Add this exported function near the top of the existing exports:

```ts
export async function isPlaywrightImportable(): Promise<boolean> {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
}
```

Add a new branch in `main()` (before the unknown-command fallback):

```ts
  if (cmd === 'install-browser') {
    const { spawn } = await import('node:child_process');
    console.log('Installing Playwright + Chromium for `preview_application`...');
    console.log('(This downloads ~200 MB on first run.)');

    const npmInstall = spawn('npm', ['install', '-g', 'playwright'], { stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
      npmInstall.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm install exited ${code}`)));
      npmInstall.on('error', reject);
    });

    const pwInstall = spawn('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
      pwInstall.on('exit', code => code === 0 ? resolve() : reject(new Error(`playwright install exited ${code}`)));
      pwInstall.on('error', reject);
    });

    console.log('\n✓ Browser installed. `preview_application` is now available.');
    return;
  }
```

- [ ] **Step 4: Update `--help`**

Insert the new subcommand into the help text (alphabetically near `install`):

```
  crosswalk-mcp install-browser            # download Playwright + Chromium for preview_application
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 181 passing (180 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.installBrowser.test.ts
git commit -m "feat(cli): install-browser subcommand (Playwright + Chromium)"
```

---

## Task 6: `crosswalk-mcp uninstall-browser` subcommand

**Files:**
- Modify: `src/cli.ts`

The inverse: remove globally-installed `playwright` and uninstall Chromium. Best-effort — if the user installed differently we just print a hint.

- [ ] **Step 1: Add the branch in `main()`**

After the `install-browser` branch, add:

```ts
  if (cmd === 'uninstall-browser') {
    const { spawn } = await import('node:child_process');
    console.log('Removing Playwright + Chromium...');

    const pwUninstall = spawn('npx', ['playwright', 'uninstall', '--all'], { stdio: 'inherit' });
    await new Promise<void>(resolve => {
      pwUninstall.on('exit', () => resolve());
      pwUninstall.on('error', () => resolve()); // best-effort
    });

    const npmUninstall = spawn('npm', ['uninstall', '-g', 'playwright'], { stdio: 'inherit' });
    await new Promise<void>(resolve => {
      npmUninstall.on('exit', () => resolve());
      npmUninstall.on('error', () => resolve());
    });

    console.log('\n✓ Browser removed. `preview_application` will throw BrowserNotInstalledError until reinstalled.');
    return;
  }
```

- [ ] **Step 2: Update `--help`**

Add a line near the install-browser entry:

```
  crosswalk-mcp uninstall-browser          # remove Playwright + Chromium
```

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 181 passing.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): uninstall-browser subcommand (best-effort cleanup)"
```

---

## Task 7: Doctor browser-availability check

**Files:**
- Modify: `src/cli.ts` — extend `runDoctor`
- Modify: `tests/cli.doctor.test.ts` — assert browser check exists

Adds a `browser` check that's `ok` if `playwright` imports successfully, `warn` otherwise (so `preview_application` is opt-in, not required).

- [ ] **Step 1: Update `runDoctor`**

In `src/cli.ts`, find the end of `runDoctor` (just before `return { checks, allOk: ... };`). Insert this new check:

```ts
  // 6. Browser (optional, only needed for preview_application)
  try {
    const isImportable = await isPlaywrightImportable();
    if (isImportable) {
      checks.push({ name: 'browser', status: 'ok', message: 'playwright is importable' });
    } else {
      checks.push({
        name: 'browser', status: 'warn',
        message: 'playwright not installed (optional — run `crosswalk-mcp install-browser` to enable preview_application)'
      });
    }
  } catch (e) {
    checks.push({ name: 'browser', status: 'warn', message: (e as Error).message });
  }
```

- [ ] **Step 2: Update doctor test**

Open `tests/cli.doctor.test.ts`. The existing "reports each named check" test asserts the names array. Update its expectation to include `browser`:

```ts
  it('reports each named check', async () => {
    const r = await runDoctor();
    const names = r.checks.map(c => c.name);
    expect(names).toContain('database');
    expect(names).toContain('migrations');
    expect(names).toContain('registry');
    expect(names).toContain('tools');
    expect(names).toContain('adapters');
    expect(names).toContain('browser');
  });
```

The "returns ok status" test expects `r.allOk === true`. Browser will be `warn` if Playwright isn't installed, but `warn` doesn't fail `allOk` (only `fail` does). So that test still passes.

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 181 passing.

- [ ] **Step 4: Smoke test**

```bash
npm run build
rm -rf /tmp/cw-doctor-m8 && CROSSWALK_HOME=/tmp/cw-doctor-m8 node dist/cli.js doctor
```
Expected: 6 lines including `! browser: playwright not installed ...` (warn level, since we haven't installed Playwright in CI).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.doctor.test.ts
git commit -m "feat(cli): doctor reports browser availability (warn if missing)"
```

---

## Task 8: Mark `playwright` as optional peer dep

**Files:**
- Modify: `package.json`

Tells consumers "we use Playwright if you've installed it, but we don't bundle it." Without `peerDependenciesMeta.optional: true`, npm 7+ would warn loudly when users install Crosswalk.

- [ ] **Step 1: Update `package.json`**

After the existing `"devDependencies"` block, insert:

```json
  ,
  "peerDependencies": {
    "playwright": ">=1.40.0"
  },
  "peerDependenciesMeta": {
    "playwright": { "optional": true }
  }
```

- [ ] **Step 2: Run tests + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: 181 passing.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(package): playwright as optional peer dep"
```

---

## Task 9: README + USER_GUIDE for v0.7.0

**Files:**
- Modify: `README.md`
- Modify: `docs/USER_GUIDE.md`

- [ ] **Step 1: Update README badges**

```markdown
[![Tests](https://img.shields.io/badge/tests-181%20passing-brightgreen.svg)](#development)
[![Version](https://img.shields.io/badge/version-0.7.0-blue.svg)](https://github.com/Mohakgarg5/crosswalk-mcp/releases)
```

- [ ] **Step 2: Update the "What it does" intro line**

Replace the existing line with:

```markdown
**17 MCP tools across 5 surfaces.** v0.7.0 adds the **`preview_application`** tool: render an application's deep link in a headless browser and get a screenshot + form-fields manifest before you submit. Playwright ships as an *optional* peer dep — base install stays light; opt in with `crosswalk-mcp install-browser`.
```

- [ ] **Step 3: Update the tools table**

Add a row in the **Pipeline tracker** section (between `list_pipeline` and the Scheduling section header), or in a new row at the end of the section. Either works:

```markdown
| `preview_application` | Open the application's deep link in a headless browser; return a screenshot + visible form fields. Requires `crosswalk-mcp install-browser` first. |
```

- [ ] **Step 4: Update the Roadmap**

```markdown
| Version | Headline |
|---|---|
| M1 | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| M3 | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 5 more ATS adapters (8 total); 51-company registry |
| M5 | Live-fit guardrail gate; uninstall + status CLI; registry to 74 |
| M6 | Multi-host install; doctor diagnostic; registry to 100 |
| M7 | Workday + iCIMS adapters (10 ATSs); sampling-driven workflow recipes; registry to 115 |
| **M8 (this release)** | `preview_application` (browser-driven preview); optional Playwright |
| v1.0 | Autonomous browser-driven applying (per-ATS form scripts + approval gates) |
```

- [ ] **Step 5: Update the timeline table**

```markdown
| v0.6.0 — M7 | Workday + iCIMS adapters · sampling_recipe workflows · 115-company registry · 175 tests | Shipped |
| **v0.7.0 — M8** | **preview_application · optional Playwright · browser-aware doctor · 181 tests** | **Current** |
| v1.0.0 — v1 | Autonomous browser-driven applying | Next |
```

- [ ] **Step 6: Update USER_GUIDE.md**

Update the title-block subtitle to `v0.7.0`. In Section 6.2 (CLI subcommands), add three new rows:

```markdown
| `crosswalk-mcp install-browser` | Download Playwright + Chromium (~200 MB) — required for `preview_application` |
| `crosswalk-mcp uninstall-browser` | Remove Playwright + Chromium |
```

In the tools-at-a-glance section, add row 17:

```markdown
| 17 | `preview_application` | | Render the deep link in a headless browser; screenshot + form fields |
```

In the FAQ, add an entry:

```markdown
**Q: Do I have to install Playwright?**

A: Only if you want `preview_application`. The base install (`npx crosswalk-mcp install`) is lightweight and works without a browser. Run `crosswalk-mcp install-browser` later if you want screenshot previews.
```

- [ ] **Step 7: Run tests + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: 181 passing, lint clean, build clean.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/USER_GUIDE.md
git commit -m "docs: update for v0.7.0 — preview_application + optional Playwright"
```

---

## Task 10: Ship v0.7.0

**Files:**
- Modify: `package.json` (version 0.6.0 → 0.7.0)
- Modify: `src/server.ts` (SERVER_VERSION 0.6.0 → 0.7.0)

- [ ] **Step 1: Bump version**

In `package.json`: `"version": "0.6.0"` → `"version": "0.7.0"`.
In `src/server.ts`: `SERVER_VERSION = '0.6.0'` → `SERVER_VERSION = '0.7.0'`.

- [ ] **Step 2: Final verify**

```bash
npm test && npm run lint && npm run build
```
Expected: 181 passing, lint clean, build clean.

- [ ] **Step 3: Smoke run**

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "smoke=ok"
rm -rf /tmp/cw-m8-smoke && CROSSWALK_HOME=/tmp/cw-m8-smoke node dist/cli.js doctor
```
Expected: `smoke=ok`. Doctor shows 6 checks (5 ok + 1 warn for browser).

- [ ] **Step 4: Commit**

```bash
git add package.json src/server.ts
git commit -m "feat: ship v0.7.0 — preview_application, optional Playwright"
```

---

## Self-review checklist

- [ ] All 10 tasks completed; all tests passing.
- [ ] Build clean. Smoke run boots cleanly.
- [ ] `crosswalk-mcp doctor` reports 6 checks; browser is `warn` if Playwright not installed.
- [ ] `preview_application` is the 17th tool in the registry.
- [ ] Without Playwright installed, calling `preview_application` throws `BrowserNotInstalledError` with a friendly message.
- [ ] `package.json` lists `playwright` as an optional peer dep — `npm install crosswalk-mcp` doesn't pull Chromium.
- [ ] No model-provider keys.

---

**End of M8 plan.**
