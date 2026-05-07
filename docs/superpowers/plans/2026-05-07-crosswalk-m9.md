# Crosswalk M9 Implementation Plan — Assisted apply (apply_application) → v1.0.0

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v1.0.0 by adding **`apply_application`** — an MCP tool that opens an application's `deepLink` in a headless browser, auto-fills the fields it can recognize (email, name, phone, resume upload) using the user's profile and the application's tailored resume DOCX, takes a screenshot, and **does NOT click submit**. The human reviews the filled form and submits manually. This delivers ~70% of the autonomous-apply value at ~20% of the risk.

**Architecture:** Extend the `Browser` interface (M8) with `fillForm(url, fields)` that returns `{ filled, skipped, screenshotPng, resolvedUrl, title }`. The implementation tries common ATS field selectors (Greenhouse, Lever, Ashby — `input[name="..."]`, `input[type="email"]`, `input[type="file"]`) for each requested field; on miss, the field is added to `skipped[]` rather than throwing. A new `apply_application` tool reads the application + profile, writes the tailored resume DOCX to a temp file via existing `mdToDocxBuffer`, builds the fill map, calls `browser.fillForm`, and returns base64 screenshot + filled/skipped manifest. Tests inject a mock `Browser`. Doctor's tool count bumps from 17 → 18.

**Tech Stack:** Same as M8. No new dependencies. Reuses `mdToDocxBuffer` from `src/exporters/docx.ts`, `getApplication` from `src/store/application.ts`, `getProfile` from `src/store/profile.ts`.

**M9 ships:**
- `Browser.fillForm` interface method + `BrowserFillResult` type
- `LazyPlaywrightBrowser.fillForm` implementation (best-effort selectors)
- `writeResumeDocxToTemp(md)` helper
- `apply_application` MCP tool (18th tool)
- Doctor expects 18 tools
- README + USER_GUIDE updates
- Version bump 0.7.0 → 1.0.0
- Tagged release v1.0.0

**Out of M9 (deferred to v1.1+):**
- Actual submit-and-confirm autonomy (user clicks Submit themselves in v1.0)
- Per-ATS scripts, captcha handling, multi-step form state
- MCP elicitation gates ("approve before submit?")
- Equal Opportunity / demographic question filling
- Cover-letter file upload (Greenhouse splits resume vs cover letter — handled in v1.1)
- Structured Q&A from `answerPack` (free-text textarea fills) — v1.1
- Real-browser integration tests (flaky in CI; mocks suffice for v1.0)

---

## File structure

```
crosswalk-mcp/
├── package.json                              # MODIFY — version 0.7.0 → 1.0.0
├── README.md                                 # MODIFY — apply_application + v1.0
├── docs/
│   └── USER_GUIDE.md                         # MODIFY — apply_application + v1.0
├── src/
│   ├── server.ts                             # MODIFY — SERVER_VERSION 0.7.0 → 1.0.0
│   ├── cli.ts                                # MODIFY — doctor expects 18 tools
│   ├── services/
│   │   └── browser/
│   │       ├── types.ts                      # MODIFY — add fillForm + BrowserFillResult + FillField
│   │       ├── playwright.ts                 # MODIFY — implement fillForm
│   │       └── resumeFile.ts                 # NEW — writeResumeDocxToTemp helper
│   └── tools/
│       ├── apply_application.ts              # NEW — 18th MCP tool
│       └── index.ts                          # MODIFY — register apply_application
└── tests/
    ├── services.browser.test.ts              # MODIFY — add fillForm tests
    ├── services.resumeFile.test.ts           # NEW — temp-file helper test
    ├── tools.apply_application.test.ts       # NEW — apply_application tool tests
    ├── server.tools.test.ts                  # MODIFY — assert 18 tools incl apply_application
    └── cli.doctor.test.ts                    # MODIFY — assert tools check expects 18
```

---

## Task list (8 tasks)

| # | Theme | Task |
|---|---|---|
| 1 | Browser | Extend `Browser` interface with `fillForm` + `FillField` + `BrowserFillResult` |
| 2 | Browser | Implement `LazyPlaywrightBrowser.fillForm` |
| 3 | Helper | `writeResumeDocxToTemp(md)` resume-to-disk helper |
| 4 | Tool | `apply_application` MCP tool |
| 5 | Plumbing | Register `apply_application` (18th tool) |
| 6 | Doctor | Update tools-count assertion 17 → 18 |
| 7 | Docs | README + USER_GUIDE updates for v1.0.0 |
| 8 | Ship | Version bump 1.0.0 + smoke + tag v1.0.0 |

---

## Task 1: Extend `Browser` interface with `fillForm`

**Files:**
- Modify: `src/services/browser/types.ts`

Adds the contract for form-filling. We keep it intentionally tolerant: callers describe what they want filled, the implementation reports what it did vs. couldn't.

- [ ] **Step 1: Modify `src/services/browser/types.ts`**

Append to the existing file (do NOT remove the existing exports — `FormField`, `BrowserPreview`, `Browser.preview`, `Browser.close`, `BrowserNotInstalledError` all stay):

```ts
/** A single field the caller wants filled, identified by purpose. */
export type FillField =
  | { kind: 'email'; value: string }
  | { kind: 'first_name'; value: string }
  | { kind: 'last_name'; value: string }
  | { kind: 'full_name'; value: string }
  | { kind: 'phone'; value: string }
  | { kind: 'linkedin'; value: string }
  | { kind: 'website'; value: string }
  | { kind: 'resume_file'; path: string };

export type BrowserFillResult = {
  /** Final URL after navigation/redirects. */
  resolvedUrl: string;
  /** Document title. */
  title: string;
  /** PNG bytes of the rendered page after fill (above the fold). */
  screenshotPng: Buffer;
  /** Field kinds successfully filled. */
  filled: string[];
  /** Field kinds we tried but couldn't find a selector for. */
  skipped: string[];
};
```

Then update the `Browser` interface in the same file to add a new method (place between `preview` and `close`):

```ts
export interface Browser {
  preview(url: string): Promise<BrowserPreview>;

  /**
   * Open the URL in a headless browser, attempt to fill each field by
   * its kind using common ATS selectors, and return a screenshot.
   * Does NOT submit the form. Unmatched fields go to `skipped`.
   * Throws if the browser runtime is not installed.
   */
  fillForm(url: string, fields: FillField[]): Promise<BrowserFillResult>;

  close(): Promise<void>;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: clean (existing test file `tests/services.browser.test.ts` will type-check against the new shape; no consumer of `Browser` calls `fillForm` yet).

- [ ] **Step 3: Commit**

```bash
git add src/services/browser/types.ts
git commit -m "feat(browser): extend Browser with fillForm + FillField + BrowserFillResult"
```

---

## Task 2: Implement `LazyPlaywrightBrowser.fillForm`

**Files:**
- Modify: `src/services/browser/playwright.ts`
- Modify: `tests/services.browser.test.ts`

Reuses the lazy-imported `chromium.Browser`. For each `FillField`, tries a list of selector candidates (most-specific first); first match wins. On no match, adds the kind to `skipped`. Resume uploads use `setInputFiles`. Returns the screenshot after fills.

- [ ] **Step 1: Failing test — fills email + resume, skips unknown**

Append to `tests/services.browser.test.ts` (inside the existing top-level `describe('services/browser/LazyPlaywrightBrowser', ...)` block, after the last `it(...)`):

```ts
  it('fillForm fills matching selectors and skips unmatched fields', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const setFilesCalls: Array<{ selector: string; files: string[] }> = [];

    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://apply.example.com/job/1'),
      // First selector candidate present for email; nothing for phone
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[type="email"]') {
          return {
            fill: async (value: string) => { fillCalls.push({ selector, value }); }
          };
        }
        if (selector === 'input[type="file"]') {
          return {
            setInputFiles: async (files: string[]) => { setFilesCalls.push({ selector, files }); }
          };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => fakePw as never
    });
    const result = await browser.fillForm('https://apply.example.com/job/1', [
      { kind: 'email', value: 'a@b.co' },
      { kind: 'phone', value: '+1-555-0100' },
      { kind: 'resume_file', path: '/tmp/resume.docx' }
    ]);

    expect(result.filled.sort()).toEqual(['email', 'resume_file']);
    expect(result.skipped).toEqual(['phone']);
    expect(fillCalls).toEqual([{ selector: 'input[type="email"]', value: 'a@b.co' }]);
    expect(setFilesCalls).toEqual([{ selector: 'input[type="file"]', files: ['/tmp/resume.docx'] }]);
    expect(result.title).toBe('Apply');
    expect(result.resolvedUrl).toBe('https://apply.example.com/job/1');
    expect(result.screenshotPng).toBeInstanceOf(Buffer);
  });

  it('fillForm throws BrowserNotInstalledError when playwright import fails', async () => {
    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => { throw new Error('no playwright'); }
    });
    await expect(
      browser.fillForm('https://x', [{ kind: 'email', value: 'a@b.co' }])
    ).rejects.toThrow(BrowserNotInstalledError);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/services.browser.test.ts
```
Expected: FAIL — `browser.fillForm is not a function`.

- [ ] **Step 3: Implement `fillForm` in `src/services/browser/playwright.ts`**

First, extend the local `PlaywrightPage` type (lines ~16–23) so `$` and `setInputFiles`/`fill` are typed. Replace the existing type with:

```ts
type PlaywrightLocator = {
  fill?(value: string): Promise<void>;
  setInputFiles?(files: string | string[]): Promise<void>;
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
```

Add the new import at the top of the file (alongside the existing imports from `./types.ts`):

```ts
import type { Browser, BrowserPreview, FormField, FillField, BrowserFillResult } from './types.ts';
```

Add the selector table near the bottom of the file, just above `extractFormFieldsScript`:

```ts
/** Selector candidates, in priority order. First match wins. */
const SELECTORS: Record<FillField['kind'], string[]> = {
  email: [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="job_application[email]"]',
    'input[autocomplete="email"]'
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
    'input[autocomplete="tel"]'
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
  resume_file: [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][name*="cv" i]',
    'input[type="file"]'
  ]
};
```

Then add the `fillForm` method on the `LazyPlaywrightBrowser` class, immediately after `preview(...)` and before `close(...)`:

```ts
  async fillForm(url: string, fields: FillField[]): Promise<BrowserFillResult> {
    const browser = await this.loadBrowser();
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      const filled: string[] = [];
      const skipped: string[] = [];

      for (const field of fields) {
        const candidates = SELECTORS[field.kind];
        let matched = false;
        for (const selector of candidates) {
          const el = await page.$(selector);
          if (!el) continue;
          if (field.kind === 'resume_file') {
            if (typeof el.setInputFiles !== 'function') continue;
            await el.setInputFiles([field.path]);
          } else {
            if (typeof el.fill !== 'function') continue;
            await el.fill(field.value);
          }
          matched = true;
          break;
        }
        (matched ? filled : skipped).push(field.kind);
      }

      const title = await page.title();
      const resolvedUrl = page.url();
      const screenshotPng = await page.screenshot({ fullPage: false });
      return { resolvedUrl, title, screenshotPng, filled, skipped };
    } finally {
      await ctx.close();
    }
  }
```

Note on the unused `FormField` import: it stays — `preview` still uses it. The new imports `FillField` and `BrowserFillResult` are consumed by the new method.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/services.browser.test.ts
```
Expected: PASS — all 5 tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/services/browser/playwright.ts tests/services.browser.test.ts
git commit -m "feat(browser): LazyPlaywrightBrowser.fillForm with best-effort selectors"
```

---

## Task 3: `writeResumeDocxToTemp(md)` helper

**Files:**
- Create: `src/services/browser/resumeFile.ts`
- Create: `tests/services.resumeFile.test.ts`

Writes a tailored resume Markdown to a temp `.docx` file so `fillForm`'s `setInputFiles` has a real path to upload. Reuses existing `mdToDocxBuffer`. Caller is responsible for cleanup; for the apply_application tool we just leave the file in `os.tmpdir()` (OS reaps it).

- [ ] **Step 1: Failing test**

Create `tests/services.resumeFile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import { writeResumeDocxToTemp } from '../src/services/browser/resumeFile.ts';

describe('services/browser/resumeFile', () => {
  it('writes a tailored resume DOCX to a temp path and returns the path', async () => {
    const md = '# Jane Smith\n\n## Experience\n\n- Built things at Acme';
    const path = await writeResumeDocxToTemp(md, 'app-abc123');
    expect(path.endsWith('.docx')).toBe(true);
    expect(path.includes('app-abc123')).toBe(true);
    const bytes = await fs.readFile(path);
    // PKZIP magic — DOCX is a zip
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    await fs.unlink(path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/services.resumeFile.test.ts
```
Expected: FAIL — file `src/services/browser/resumeFile.ts` does not exist.

- [ ] **Step 3: Implement**

Create `src/services/browser/resumeFile.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mdToDocxBuffer } from '../../exporters/docx.ts';

/**
 * Write a tailored resume Markdown to a temp DOCX file and return its absolute path.
 * The file lives in os.tmpdir() and is left for the OS to reap.
 */
export async function writeResumeDocxToTemp(resumeMd: string, applicationId: string): Promise<string> {
  const buf = await mdToDocxBuffer(resumeMd);
  const filename = `crosswalk-${applicationId}-${Date.now()}.docx`;
  const filepath = path.join(os.tmpdir(), filename);
  await fs.writeFile(filepath, buf);
  return filepath;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/services.resumeFile.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/browser/resumeFile.ts tests/services.resumeFile.test.ts
git commit -m "feat(browser): writeResumeDocxToTemp helper for fillForm uploads"
```

---

## Task 4: `apply_application` MCP tool

**Files:**
- Create: `src/tools/apply_application.ts`
- Create: `tests/tools.apply_application.test.ts`

Reads the application + profile, derives a `FillField[]` (email/name/phone/linkedin/website from profile, resume from `writeResumeDocxToTemp(app.tailoredResumeMd, app.id)`), calls `browser.fillForm`, and returns base64 screenshot + filled/skipped manifest. Does **not** submit. Does **not** mutate application state.

- [ ] **Step 1: Failing test**

Create `tests/tools.apply_application.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { createApplication } from '../src/store/application.ts';
import { applyApplication } from '../src/tools/apply_application.ts';
import type { Browser, FillField } from '../src/services/browser/types.ts';

describe('tools/apply_application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    upsertProfile(db, {
      email: 'jane@example.com',
      first_name: 'Jane',
      last_name: 'Smith',
      phone: '+1-555-0100',
      linkedin: 'https://linkedin.com/in/jane'
    });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# Jane Smith\n\nResume content',
      coverLetterMd: '.', answerPack: {},
      deepLink: 'https://apply.example.com/job/12345'
    });
  });

  it('fills known fields from profile + tailored resume and returns base64 screenshot', async () => {
    const seenFields: FillField[] = [];
    const browser: Browser = {
      preview: vi.fn(),
      close: vi.fn(),
      fillForm: vi.fn(async (url: string, fields: FillField[]) => {
        seenFields.push(...fields);
        return {
          resolvedUrl: url,
          title: 'Apply: PM',
          screenshotPng: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          filled: ['email', 'first_name', 'last_name', 'phone', 'linkedin', 'resume_file'],
          skipped: []
        };
      })
    };
    const out = await applyApplication({ applicationId: 'app1' }, { db, browser });

    expect(browser.fillForm).toHaveBeenCalledWith(
      'https://apply.example.com/job/12345',
      expect.any(Array)
    );
    const kinds = seenFields.map(f => f.kind).sort();
    expect(kinds).toEqual(
      ['email', 'first_name', 'last_name', 'linkedin', 'phone', 'resume_file']
    );
    const resumeField = seenFields.find(f => f.kind === 'resume_file');
    expect(resumeField).toBeDefined();
    if (resumeField && resumeField.kind === 'resume_file') {
      expect(resumeField.path.endsWith('.docx')).toBe(true);
    }

    expect(out.applicationId).toBe('app1');
    expect(out.title).toBe('Apply: PM');
    expect(out.filled).toContain('email');
    expect(out.filled).toContain('resume_file');
    expect(out.submitted).toBe(false);
    expect(out.screenshotPngBase64).toBeTypeOf('string');
    expect(Buffer.from(out.screenshotPngBase64, 'base64').subarray(0, 4)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
  });

  it('throws on unknown application', async () => {
    const browser: Browser = { preview: vi.fn(), close: vi.fn(), fillForm: vi.fn() };
    await expect(
      applyApplication({ applicationId: 'nope' }, { db, browser })
    ).rejects.toThrow(/unknown application/i);
    expect(browser.fillForm).not.toHaveBeenCalled();
  });

  it('skips fields the profile does not provide', async () => {
    upsertProfile(db, { email: 'only@example.com' });
    const browser: Browser = {
      preview: vi.fn(),
      close: vi.fn(),
      fillForm: vi.fn(async (_url: string, fields: FillField[]) => ({
        resolvedUrl: 'u', title: 't',
        screenshotPng: Buffer.from([]),
        filled: fields.map(f => f.kind),
        skipped: []
      }))
    };
    await applyApplication({ applicationId: 'app1' }, { db, browser });
    const passed = (browser.fillForm as ReturnType<typeof vi.fn>).mock.calls[0][1] as FillField[];
    const kinds = passed.map(f => f.kind).sort();
    // Only email + resume_file (no name, phone, linkedin in this profile)
    expect(kinds).toEqual(['email', 'resume_file']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/tools.apply_application.test.ts
```
Expected: FAIL — `Cannot find module '../src/tools/apply_application.ts'`.

- [ ] **Step 3: Implement**

Create `src/tools/apply_application.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getApplication } from '../store/application.ts';
import { getProfile } from '../store/profile.ts';
import type { Browser, FillField } from '../services/browser/types.ts';
import { writeResumeDocxToTemp } from '../services/browser/resumeFile.ts';

export const applyApplicationInput = z.object({
  applicationId: z.string()
});

export type ApplyApplicationResult = {
  applicationId: string;
  deepLink: string;
  resolvedUrl: string;
  title: string;
  /** PNG screenshot of the filled (but not submitted) form, base64-encoded. */
  screenshotPngBase64: string;
  /** Field kinds the browser successfully filled. */
  filled: string[];
  /** Field kinds the browser couldn't find a selector for. */
  skipped: string[];
  /** Always false for v1.0 — the user clicks Submit themselves. */
  submitted: false;
  /** Path to the tailored resume DOCX written to /tmp. */
  resumeDocxPath: string;
};

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function applyApplication(
  input: z.infer<typeof applyApplicationInput>,
  ctx: { db: Db; browser: Browser }
): Promise<ApplyApplicationResult> {
  const app = getApplication(ctx.db, input.applicationId);
  if (!app) throw new Error(`unknown application: ${input.applicationId}`);

  const profile = getProfile(ctx.db) ?? {};
  const fields: FillField[] = [];

  const email = asString(profile.email);
  if (email) fields.push({ kind: 'email', value: email });

  const firstName = asString(profile.first_name);
  if (firstName) fields.push({ kind: 'first_name', value: firstName });

  const lastName = asString(profile.last_name);
  if (lastName) fields.push({ kind: 'last_name', value: lastName });

  const fullName = asString(profile.name) ?? asString(profile.full_name);
  if (fullName && !firstName && !lastName) {
    fields.push({ kind: 'full_name', value: fullName });
  }

  const phone = asString(profile.phone);
  if (phone) fields.push({ kind: 'phone', value: phone });

  const linkedin = asString(profile.linkedin);
  if (linkedin) fields.push({ kind: 'linkedin', value: linkedin });

  const website = asString(profile.website);
  if (website) fields.push({ kind: 'website', value: website });

  const resumeDocxPath = await writeResumeDocxToTemp(app.tailoredResumeMd, app.id);
  fields.push({ kind: 'resume_file', path: resumeDocxPath });

  const result = await ctx.browser.fillForm(app.deepLink, fields);

  return {
    applicationId: app.id,
    deepLink: app.deepLink,
    resolvedUrl: result.resolvedUrl,
    title: result.title,
    screenshotPngBase64: result.screenshotPng.toString('base64'),
    filled: result.filled,
    skipped: result.skipped,
    submitted: false,
    resumeDocxPath
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/tools.apply_application.test.ts
```
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tools/apply_application.ts tests/tools.apply_application.test.ts
git commit -m "feat(tools): apply_application — fill known fields, screenshot, no submit"
```

---

## Task 5: Register `apply_application` (18th tool)

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `tests/server.tools.test.ts`

- [ ] **Step 1: Failing test — assert 18 tools incl apply_application**

Open `tests/server.tools.test.ts` and replace the `expect(names).toEqual([...])` array with the alphabetized 18-tool list:

```ts
    expect(names).toEqual([
      'add_note', 'add_resume', 'apply_application', 'delete_workflow',
      'draft_application', 'explain_fit', 'fetch_jobs', 'list_pipeline',
      'list_resumes', 'list_workflows', 'preview_application', 'run_workflow',
      'schedule_workflow', 'score_fit', 'set_status',
      'setup_profile', 'submit_application', 'tailor_resume'
    ]);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/server.tools.test.ts
```
Expected: FAIL — array has 17 entries, test expects 18.

- [ ] **Step 3: Register the new tool in `src/tools/index.ts`**

Add the import alongside the existing tool imports (after the `previewApplication` import, around line 21):

```ts
import { applyApplication, applyApplicationInput } from './apply_application.ts';
```

In the `toolDefinitions` array, change the closing brace of the existing `preview_application` entry from `}` to `},` and immediately after it (before the array's closing `];`) append:

```ts
  {
    name: 'apply_application',
    description: "Open the application's deep link in a headless browser, auto-fill known fields (email/name/phone/resume) from your profile + tailored resume, take a screenshot, and stop. Does NOT submit — review and click Submit yourself. Requires `crosswalk-mcp install-browser` first.",
    inputSchema: zodToJsonSchema(applyApplicationInput),
    run: (i, c) => applyApplication(applyApplicationInput.parse(i), c)
  }
```

The result: the `preview_application` entry now ends with `},`, and `apply_application` is the final entry (no trailing comma).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/server.tools.test.ts
```
Expected: PASS — both tests in the file (`exports all 18 v1 tools`, `every tool has a JSON-schema input`).

- [ ] **Step 5: Update test description in `tests/server.tools.test.ts`**

Change the `it('exports all 17 v1 tools', ...)` string to `it('exports all 18 v1 tools', ...)` so the test name reflects reality.

- [ ] **Step 6: Commit**

```bash
git add src/tools/index.ts tests/server.tools.test.ts
git commit -m "feat(server): register apply_application as 18th MCP tool"
```

---

## Task 6: Update doctor's tools-count assertion

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.doctor.test.ts`

- [ ] **Step 1: Failing test — doctor reports 18 tools**

Append a new `it(...)` block inside `describe('cli/doctor', ...)` in `tests/cli.doctor.test.ts`:

```ts
  it('tools check passes with 18 tools registered', async () => {
    const r = await runDoctor();
    const tools = r.checks.find(c => c.name === 'tools');
    expect(tools?.status).toBe('ok');
    expect(tools?.message).toMatch(/18 tools/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli.doctor.test.ts
```
Expected: FAIL — current doctor compares against `length === 17`, so with 18 registered tools it returns `warn` with message `18 tools (expected 17)`. The test expects status `'ok'` and message matching `/18 tools/`.

- [ ] **Step 3: Update `src/cli.ts` doctor tools check**

In `src/cli.ts`, around line 191, change:

```ts
    if (toolDefinitions.length === 17) {
      checks.push({ name: 'tools', status: 'ok', message: `${toolDefinitions.length} tools registered` });
    } else {
      checks.push({ name: 'tools', status: 'warn', message: `${toolDefinitions.length} tools (expected 17)` });
    }
```

to:

```ts
    if (toolDefinitions.length === 18) {
      checks.push({ name: 'tools', status: 'ok', message: `${toolDefinitions.length} tools registered` });
    } else {
      checks.push({ name: 'tools', status: 'warn', message: `${toolDefinitions.length} tools (expected 18)` });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/cli.doctor.test.ts
```
Expected: PASS — both pre-existing tests + the new 18-tools assertion.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.doctor.test.ts
git commit -m "feat(cli): doctor expects 18 tools (apply_application registered)"
```

---

## Task 7: README + USER_GUIDE updates for v1.0

**Files:**
- Modify: `README.md`
- Modify: `docs/USER_GUIDE.md`

Documentation is content, not code; no test step. Keep the additions tight.

- [ ] **Step 1: Update README.md**

In the tool list section (the bulleted/numbered list of MCP tools currently ending with `preview_application`), add as the final entry:

```markdown
- **apply_application** — Auto-fill the application form in a headless browser using your profile + tailored resume, screenshot the filled form, **do not submit**. You review and click Submit. Requires `crosswalk-mcp install-browser`.
```

In the "What's new" / version section, replace the v0.7.0 callout with:

```markdown
### v1.0.0 (2026-05-07)

- New `apply_application` tool — assisted apply: opens the form, fills email/name/phone/resume, takes a screenshot, leaves submission to you.
- 18 MCP tools, 10 ATS adapters, 115+ companies, full pipeline tracking.
- Stable: API surface frozen; future minor releases keep backwards compatibility.
```

- [ ] **Step 2: Update `docs/USER_GUIDE.md`**

Add a new section after the existing `preview_application` section:

```markdown
## apply_application — assisted form fill

Opens the application's deep link in a headless browser, fills the fields it can recognize from your profile (email, first/last name, phone, LinkedIn, website) plus your tailored resume DOCX uploaded to the file input, then takes a screenshot. **It does not click Submit.** You review the screenshot in your MCP client, open the URL yourself, and submit manually.

### Prerequisites

```bash
crosswalk-mcp install-browser   # one-time, ~200 MB download
```

### Usage

In your MCP client (Claude Desktop, Cursor, Windsurf):

> "Apply for application app_abc123"

The tool returns:
- `screenshotPngBase64` — render the image to inspect what was filled
- `filled` — list of field kinds successfully filled (e.g., `['email', 'first_name', 'resume_file']`)
- `skipped` — field kinds we couldn't locate on the form
- `resolvedUrl` — final URL after redirects (open this in your browser to submit)
- `submitted` — always `false` in v1.0

### What it can fill (v1.0)

email · first_name · last_name · full_name · phone · linkedin · website · resume_file (tailored DOCX)

### What it can't fill (v1.0)

Cover-letter file uploads (separate from resume), free-text "Why this company?" textareas, demographic / EOC dropdowns, captchas, multi-page wizards. These remain manual; v1.1 will close some of these gaps.

### Safety

- No submit click. Ever. v1.0 is "review-then-submit-yourself" by design.
- No application state mutation. Pipeline status doesn't change until you call `submit_application` after manually submitting.
- DOCX written to `os.tmpdir()`. Path included in the response so you can retain it; OS reaps it on reboot.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/USER_GUIDE.md
git commit -m "docs: apply_application + v1.0.0 release notes"
```

---

## Task 8: Version bump 1.0.0 + smoke + tag

**Files:**
- Modify: `package.json`
- Modify: `src/server.ts`

- [ ] **Step 1: Bump version in `package.json`**

Change `"version": "0.7.0"` to `"version": "1.0.0"`.

- [ ] **Step 2: Bump version in `src/server.ts`**

Change `export const SERVER_VERSION = '0.7.0';` to `export const SERVER_VERSION = '1.0.0';`.

- [ ] **Step 3: Build + full test run**

```bash
npm run build && npx vitest run
```
Expected: build succeeds; all tests pass (181 existing + new fillForm tests + resumeFile test + apply_application tests + doctor 18-tools test = ~190).

- [ ] **Step 4: Smoke — doctor reports 18 tools, all OK**

```bash
node dist/cli.js doctor
```
Expected output includes:
```
  ✓ tools: 18 tools registered
```
and exit code 0.

- [ ] **Step 5: Smoke — version reports 1.0.0**

```bash
node dist/cli.js --version
```
Expected output: `1.0.0`.

- [ ] **Step 6: Commit version bump**

```bash
git add package.json src/server.ts
git commit -m "chore: bump version to 1.0.0"
```

- [ ] **Step 7: Tag release**

```bash
git tag v1.0.0
```

- [ ] **Step 8: Verify clean working tree**

```bash
git status
```
Expected: `nothing to commit, working tree clean`.
