import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import type { Browser, BrowserPreview, FormField, FillField, BrowserFillResult, ResolveVerification, VerificationContext } from './types.ts';
import { BrowserNotInstalledError } from './types.ts';
// Pure URL-safety util (no email/IMAP logic) — used to re-validate a magic
// link's host after the browser follows any redirects.
import { isAllowedLinkHost } from '../email/verification.ts';

/**
 * Launch a persistent Chromium context, recovering automatically if the
 * profile directory is still locked by a stale Chromium process from a prior
 * Crosswalk run (browser window left open, server killed mid-flight, etc.).
 * The user shouldn't have to manually `pkill Chrome` between runs.
 */
async function launchPersistentWithLockRecovery(
  pw: PlaywrightModule,
  profileDir: string,
  headless: boolean
): Promise<PlaywrightContext> {
  try {
    return await pw.chromium.launchPersistentContext(profileDir, { headless });
  } catch (e) {
    const msg = (e as Error).message || '';
    if (!/already in use|existing browser session|SingletonLock/i.test(msg)) {
      throw e;
    }
    // Stale chromium is holding the profile lock — find and kill it, then retry once.
    try {
      execSync(`pgrep -f ${JSON.stringify('--user-data-dir=' + profileDir)} | xargs -r kill -9`, { stdio: 'ignore' });
    } catch { /* nothing to kill */ }
    // Remove the SingletonLock file Chrome leaves behind.
    try {
      execSync(`rm -f ${JSON.stringify(profileDir + '/SingletonLock')} ${JSON.stringify(profileDir + '/SingletonCookie')} ${JSON.stringify(profileDir + '/SingletonSocket')}`, { stdio: 'ignore' });
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 800));
    return await pw.chromium.launchPersistentContext(profileDir, { headless });
  }
}

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
  selectOption?(values: string | { label?: string; value?: string }): Promise<string[]>;
  check?(): Promise<void>;
  uncheck?(): Promise<void>;
  type?(value: string, opts?: { delay?: number }): Promise<void>;
  press?(key: string): Promise<void>;
  focus?(): Promise<void>;
};

// A "frame-like" surface — same shape for both Page and Frame from Playwright.
// Page.$ only searches the main frame; we operate on frames directly so iframe-
// embedded forms (Stripe → embeds job-boards.greenhouse.io, etc.) actually fill.
type PlaywrightFrame = {
  $(selector: string): Promise<PlaywrightLocator | null>;
  evaluate<T>(fn: () => T): Promise<T>;
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>;
  url(): string;
};

type PlaywrightPage = PlaywrightFrame & {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  screenshot(opts?: { fullPage?: boolean }): Promise<Buffer>;
  frames(): PlaywrightFrame[];
  mainFrame(): PlaywrightFrame;
  context(): { newPage(): Promise<PlaywrightPage> };
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
      // playwright is an optional peer dep resolved at runtime. Using a
      // non-literal specifier avoids a compile-time module-resolution error
      // whether or not playwright is installed in the current environment.
      const specifier: string = 'playwright';
      return (await import(specifier)) as unknown as PlaywrightModule;
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
        this.persistentContext = await launchPersistentWithLockRecovery(pw, this.profileDir, !this.headed);
      }
      const page = await this.persistentContext.newPage();
      try {
        return await fn(page);
      } finally {
        // In headed mode keep the page open so the user can review the filled
        // form and click Submit themselves. They close the window when done.
        if (!this.headed) {
          try { await page.close(); } catch { /* ignore cleanup errors */ }
        }
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
      // Same: in headed mode, leave the context (and its page) open for manual
      // review. The context leaks until the browser process restarts — fine
      // for interactive testing, not for unattended automation.
      if (!this.headed) {
        try { await ctx.close(); } catch { /* ignore cleanup errors */ }
      }
    }
  }

  async preview(url: string): Promise<BrowserPreview> {
    return this.runWithPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      await advanceToForm(page);
      const title = await page.title();
      const resolvedUrl = page.url();
      const screenshotPng = await page.screenshot({ fullPage: true });
      // Aggregate fields across the main frame and every iframe — Greenhouse-
      // embedded forms (Stripe, DoorDash, etc.) live in a child frame.
      const frames = allFrames(page);
      const formFields: FormField[] = [];
      for (const frame of frames) {
        try {
          const fromFrame = await frame.evaluate(extractFormFieldsScript);
          if (Array.isArray(fromFrame)) formFields.push(...fromFrame);
        } catch { /* cross-origin frame or detached — skip */ }
      }
      // Custom comboboxes (react-select etc.) keep their options in a menu
      // that only exists while open — without them the model answers blind
      // ("United States" for an option list that says "US"; prose for a
      // years-range select). Open each one briefly and harvest its options.
      for (const f of formFields) {
        if (f.options?.length || !f.name) continue;
        if (f.type !== 'text') continue;
        try {
          const input = await page.$(`input[role="combobox"][id="${escAttr(f.name)}"]`)
                     ?? await page.$(`input[role="combobox"][name="${escAttr(f.name)}"]`);
          if (!input || typeof input.click !== 'function') continue;
          await input.click();
          await new Promise(r => setTimeout(r, 600));
          const opts = await page.evaluate(() => {
            const doc = (globalThis as unknown as { document: any }).document;
            const menus = (Array.from(doc.querySelectorAll('.select__menu, [role="listbox"]')) as any[])
              .filter(m => m.getBoundingClientRect().height > 0);
            return menus.flatMap(m =>
              (Array.from(m.querySelectorAll('.select__option, [role="option"]')) as any[])
                .map(o => String(o.textContent ?? '').trim())
            ).filter((t: string) => t.length > 0);
          }).catch(() => []);
          if (Array.isArray(opts) && opts.length > 0) f.options = [...new Set(opts as string[])];
          if (typeof input.press === 'function') await input.press('Escape').catch(() => {});
        } catch { /* best-effort harvesting */ }
      }
      return { screenshotPng, resolvedUrl, title, formFields };
    });
  }

  async fillForm(url: string, fields: FillField[], opts: { ats?: string; clickSubmit?: boolean; maxSteps?: number; resolveVerification?: ResolveVerification } = {}): Promise<BrowserFillResult> {
    return this.runWithPage(async (page) => {
      // Captured up-front so the verification poller only considers emails that
      // arrived at/after this apply attempt began.
      const startedAt = new Date().toISOString();
      // Ground truth for submissions: record the ATS's own submit responses.
      // "Click happened" is circumstantial; the POST result is the verdict.
      const submitResponses: string[] = [];
      const pageOn = (page as { on?: (ev: string, cb: (res: unknown) => void) => void }).on;
      if (typeof pageOn === 'function') {
        pageOn.call(page, 'response', (res: unknown) => {
          void (async () => {
            try {
              const r = res as { url: () => string; status: () => number; text: () => Promise<string> };
              if (/SubmitSingleApplicationFormAction|job_application|\/applications?\b.*submit|submit.*application/i.test(r.url())) {
                const body = await r.text().catch(() => '');
                submitResponses.push(`${r.status()} ${r.url().slice(0, 90)} :: ${body.slice(0, 220)}`);
              }
            } catch { /* response stream gone */ }
          })();
        });
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      // Many public ATS URLs (Greenhouse job-boards, Lever, Ashby) land on a job
      // description page that hides the application form behind an "Apply" button.
      // Try to advance past it before looking for form fields. No-op if the form
      // is already on the page or the button isn't found.
      await advanceToForm(page);
      // Let any post-load redirect/reload finish before we touch fields — the
      // ATS embed tearing down a frame mid-fill is what turned fillable forms
      // into "drafted, needs human".
      await settlePage(page);
      const maxSteps = Math.max(1, opts.maxSteps ?? 1);
      const labelOf = (f: FillField) => ('name' in f ? `${f.kind}:${f.name}` : f.kind);
      const filledLabels = new Set<string>();
      let stepsAdvanced = 0;

      // Fill one field, surviving a navigation that strikes mid-fill: settle and
      // retry once. A single field lost to a reload must never abort the whole
      // application — that's the difference between autonomous and "needs you".
      const fillOne = async (field: FillField): Promise<void> => {
        const label = labelOf(field);
        if (filledLabels.has(label)) return;
        try {
          if (await tryFillFieldAcrossFrames(page, field, opts.ats)) filledLabels.add(label);
        } catch (e) {
          if (isNavigationError(e)) {
            await settlePage(page);
            try {
              if (await tryFillFieldAcrossFrames(page, field, opts.ats)) filledLabels.add(label);
            } catch { /* field lost to a second navigation — skip it, keep going */ }
          }
          // Non-navigation per-field errors are swallowed too: one odd field
          // can't be allowed to tank an otherwise-complete application.
        }
      };

      // Multi-step wizards: fill the current page, advance via Next/Continue,
      // repeat. A field skipped on one page may be filled on a later one.
      for (let step = 1; step <= maxSteps; step++) {
        for (const field of fields) {
          await fillOne(field);
        }
        if (step < maxSteps) {
          const advanced = await clickFirstAcrossFrames(page, NEXT_SELECTORS);
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
      let confirmationSeen = false;
      let validationErrors: string[] = [];
      const submitClickErrors: string[] = [];
      if (opts.clickSubmit) {
        // Let async form-state syncs settle (Ashby PATCHes every field via
        // ApiSetFormValue; submitting mid-flight loses the last values).
        // Real pages only — mocks lack waitForLoadState.
        if (typeof (page as { waitForLoadState?: unknown }).waitForLoadState === 'function') {
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
        // Uploads (résumé DOCX) keep ATS submit buttons disabled while they
        // process — Greenhouse times a 30s element click out. Wait for an
        // enabled submit control first.
        await waitForSubmitEnabled(page, 45_000);
        submitClicked = await clickFirstAcrossFrames(page, SUBMIT_SELECTORS, submitClickErrors);
        if (!submitClicked && submitClickErrors.length === 0
            && typeof (page as { waitForLoadState?: unknown }).waitForLoadState === 'function') {
          // No button found at all — boards that re-render after uploads
          // (Ashby) detach it briefly. Give it one more patient attempt.
          // (Real pages only; mocks without the button just report false.)
          await new Promise(resolve => setTimeout(resolve, 5000));
          await waitForSubmitEnabled(page, 20_000);
          submitClicked = await clickFirstAcrossFrames(page, SUBMIT_SELECTORS, submitClickErrors);
        }
        if (!submitClicked && submitClickErrors.some(e => /Timeout/i.test(e))) {
          // Last resort: dispatch the click directly on the element — covers
          // sticky overlays (cookie banners) obscuring the hit point.
          submitClicked = await forceClickFirstAcrossFrames(page, SUBMIT_SELECTORS, submitClickErrors);
        }
        if (submitClicked) {
          try {
            // Wait for the submission to land: ATS POSTs + redirects routinely
            // take 5-10s. A flat 2s wait screenshotted the form mid-flight and
            // made real submissions look unconfirmed.
            const preUrl = page.url();
            // Real pages expose waitForLoadState; test mocks don't — they get
            // a single short wait instead of the patient poll.
            const patient = typeof (page as { waitForLoadState?: unknown }).waitForLoadState === 'function';
            for (let i = 0; i < (patient ? 30 : 1); i++) {
              await new Promise(resolve => setTimeout(resolve, 500));
              const nowUrl = page.url();
              if (nowUrl !== preUrl) break;
              const title = await page.title().catch(() => '');
              if (/thank|received|submitted|confirmation/i.test(title ?? '')) break;
              // Ashby renders an in-page success panel — same URL, same
              // title. The body text is the only signal. Likewise its
              // rejection banner ("flagged as possible spam").
              if (patient) {
                try {
                  const verdict = await page.evaluate(() => {
                    const doc = (globalThis as unknown as { document: any }).document;
                    const text = String(doc.body?.innerText ?? '').slice(0, 4000);
                    if (/your application has been submitted|application (was )?submitted successfully|thank you for applying/i.test(text)) return 'ok';
                    if (/flagged as possible spam|couldn'?t submit your application/i.test(text)) return 'rejected';
                    return '';
                  });
                  if (verdict === 'ok') { confirmationSeen = true; break; }
                  if (verdict === 'rejected') {
                    submitClickErrors.push('ATS rejected the submission as possible spam (rate-limited) — retry after a cool-down');
                    break;
                  }
                } catch { /* transient */ }
              }
            }
            postSubmitUrl = page.url();
            postSubmitTitle = await page.title();
            // If the submit didn't land (still on the form), ask the ATS which
            // required fields it's complaining about. Greenhouse/Ashby render
            // an inline "This field is required" next to the offending field;
            // reading the field's label tells the user the ONE thing to fix.
            const stillOnForm = postSubmitUrl === preUrl && !confirmationSeen;
            if (patient && stillOnForm) {
              validationErrors = await collectValidationErrors(page);
            }
          } catch {
            // Page might be in transient state; leave URL/title undefined
          }
        }
      }

      // Email-verification gate: only probed when a resolver was injected, so
      // default behavior is unchanged. On detection, call back to fetch the
      // emailed code/link, complete it on this same live page, then submit.
      let verificationRequired = false;
      let verificationResolved = false;
      if (opts.resolveVerification) {
        const gate = await detectVerificationGate(page);
        if (gate) {
          verificationRequired = true;
          const ctx: VerificationContext = {
            formUrl: page.url(),
            startedAt,
            atsHost: (() => { try { return new URL(page.url()).host; } catch { return undefined; } })()
          };
          const outcome = await opts.resolveVerification(ctx);
          if (outcome?.kind === 'code') {
            let entered = false;
            const loc = await firstLocatorAcrossFrames(page, CODE_FIELD_SELECTORS);
            if (loc?.fill) {
              await loc.fill(outcome.code);
              entered = true;
            } else {
              // Segmented one-char boxes (Greenhouse): focus the first box and
              // keyboard-type — the widget auto-advances per character.
              const segmented = await firstLocatorAcrossFrames(page, ['input[maxlength="1"]']);
              const kb = (page as { keyboard?: { type: (t: string, o?: { delay?: number }) => Promise<void> } }).keyboard;
              if (segmented && typeof segmented.click === 'function' && kb) {
                await segmented.click();
                await kb.type(outcome.code, { delay: 60 });
                entered = true;
              }
            }
            if (entered) {
              await waitForSubmitEnabled(page, 15_000);
              submitClicked = await clickFirstAcrossFrames(page, SUBMIT_SELECTORS) || submitClicked;
              await new Promise(resolve => setTimeout(resolve, 4000));
              verificationResolved = true;
            }
          } else if (outcome?.kind === 'link') {
            try {
              // Open the magic link in a sibling page of the SAME context so it
              // shares cookies/session with the form; the form tab usually
              // auto-advances once the email is verified.
              const verifyPage = await page.context().newPage();
              await verifyPage.goto(outcome.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
              await new Promise(resolve => setTimeout(resolve, 2000));
              // SSRF guard: the resolver allowlisted the INITIAL url, but goto
              // follows redirects in this session-sharing context. If it landed
              // somewhere off the allowlist (open-redirect → internal host, etc.),
              // abandon it — don't trust the page and don't mark resolved.
              const landed = verifyPage.url();
              const landedSafe = isAllowedLinkHost(landed, ctx.atsHost);
              try { await verifyPage.close(); } catch { /* ignore cleanup errors */ }
              if (landedSafe) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                submitClicked = await clickFirstAcrossFrames(page, SUBMIT_SELECTORS) || submitClicked;
                verificationResolved = true;
              }
            } catch {
              verificationResolved = false;
            }
          }
        }
      }

      const screenshotPng = await page.screenshot({ fullPage: true });
      return {
        resolvedUrl, title, screenshotPng, filled, skipped, submitClicked,
        postSubmitUrl, postSubmitTitle, stepsAdvanced, verificationRequired, verificationResolved,
        ...(confirmationSeen ? { confirmationSeen } : {}),
        ...(validationErrors.length ? { validationErrors } : {}),
        ...(submitResponses.length ? { submitResponses } : {}),
        ...(submitClickErrors.length ? { submitClickErrors } : {})
      };
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
  // Text-first: Ashby renders its Yes/No OPTION buttons as type=submit, so
  // the generic [type=submit] selector can hit "Yes" instead of the real
  // submit. The visible "Submit application" label is unambiguous.
  'button:has-text("Submit application")',
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="submit"]',
  'button[id*="submit" i]',
  'button[name*="submit" i]',
  'button[data-automation-id*="submit" i]',
  'button[data-automation-id="bottom-navigation-next-button"]',
  'button:has-text("Submit")'
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

/**
 * Buttons that open the application form from a public job-description page
 * (Greenhouse job-boards, Lever, Ashby, modern Workday postings). Tried in
 * order; stop at the first match. Specific phrases first so a generic "Apply"
 * link in a nav menu loses to the primary CTA when both exist.
 */
const APPLY_SELECTORS: string[] = [
  'a:has-text("Apply for this job")',
  'button:has-text("Apply for this job")',
  'a:has-text("Apply now")',
  'button:has-text("Apply now")',
  'button[data-automation-id="adventureButton"]', // Workday "Apply"
  'a:has-text("I\'m interested")', // Lever variant
  'a[href*="/apply"]',
  'a[href$="#app"]',
  // Generic primary CTAs — last-resort. Greenhouse job-boards uses a plain
  // <a>Apply</a> with no other distinguishing text.
  'a:has-text("Apply")',
  'button:has-text("Apply")'
];

/**
 * Workday interstitial: clicking "Apply" opens a chooser (Autofill with
 * Resume / Apply Manually / Use My Last Application). Pick manual — the
 * other two depend on Workday's parser or a previous application.
 */
const WORKDAY_CHOOSER_SELECTORS: string[] = [
  'a[data-automation-id="applyManually"]',
  'button[data-automation-id="applyManually"]',
  'a:has-text("Apply Manually")',
  'button:has-text("Apply Manually")'
];

/**
 * If the landed page hides the form behind an Apply button (job-description
 * page), click it so the form is on screen for fillForm/preview. Always tries
 * — `clickFirst` is a no-op if no selector matches, and clicking a redundant
 * Apply on a page that already has the form is harmless (typically scrolls
 * within the same page).
 */
async function advanceToForm(page: PlaywrightPage): Promise<void> {
  try {
    // Client-rendered boards (Ashby) mount the Apply button well AFTER
    // domcontentloaded — a single immediate probe misses it and the form
    // never opens. Poll for the button (or an already-present form) first.
    let clicked = false;
    for (let i = 0; i < 16; i++) {
      clicked = await clickFirst(page, APPLY_SELECTORS);
      if (clicked) break;
      const n = await countFormFields(page);
      if (n >= 3 || n === -1) break; // form on screen, or unknowable (mocks)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (clicked) {
      // Let the form render — Greenhouse renders client-side, Lever navigates.
      await new Promise(resolve => setTimeout(resolve, 3000));
      // Workday's Apply opens a chooser instead of the form — take the
      // manual-apply path when it's there (no-op everywhere else).
      const chose = await clickFirst(page, WORKDAY_CHOOSER_SELECTORS);
      if (chose) await new Promise(resolve => setTimeout(resolve, 3000));
    }
    // Poll up to 8s for an actual form to appear in any frame. Headed mode
    // renders visually (slower) and react-mounted iframes can take a second
    // past navigation to attach. Without this, fill ran on an empty DOM and
    // every selector returned null.
    await waitForFormReady(page, 8000);
  } catch { /* best effort — never block the calling flow */ }
}

/** Count visible form fields across frames. Returns -1 when no frame could
 * report a number (test-mocked pages) — callers treat that as "unknowable,
 * don't wait on it". */
async function countFormFields(page: PlaywrightPage): Promise<number> {
  let total = 0;
  let anyNumber = false;
  for (const frame of allFrames(page)) {
    try {
      const count = await frame.evaluate(() => {
        const doc = (globalThis as unknown as { document: any }).document;
        return doc.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length;
      });
      if (typeof count === 'number') {
        total += count;
        anyNumber = true;
      }
    } catch { /* skip cross-origin frame */ }
  }
  return anyNumber ? total : -1;
}

async function waitForFormReady(page: PlaywrightPage, timeoutMs: number): Promise<void> {
  const pollMs = 400;
  const maxPolls = Math.ceil(timeoutMs / pollMs);
  let consecutiveBadEvaluates = 0;
  for (let i = 0; i < maxPolls; i++) {
    const total = await countFormFields(page);
    if (total >= 3) return; // 3+ visible fields → form is ready
    // Test-mocked pages return arrays/undefined from evaluate. Bail after two
    // such polls so the test suite doesn't sit through the full 8s timeout.
    if (total === -1) {
      consecutiveBadEvaluates++;
      if (consecutiveBadEvaluates >= 2) return;
    } else {
      consecutiveBadEvaluates = 0;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

/** Click the first matching, clickable selector. Returns whether one was
 * clicked. Failures are pushed onto `errs` (when given) — a silently
 * swallowed click error is indistinguishable from "no button", which has
 * cost us real submissions. */
async function clickFirst(frame: PlaywrightFrame, selectors: string[], errs?: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const btn = await frame.$(selector);
    if (!btn || typeof btn.click !== 'function') continue;
    try {
      await btn.click();
      return true;
    } catch (e) {
      errs?.push(`${selector}: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
  }
  return false;
}

/** Return the page's main frame plus every nested frame in document order.
 * Tests mock Page without a frames() method; fall back to just the page itself. */
function allFrames(page: PlaywrightPage): PlaywrightFrame[] {
  if (typeof page.frames !== 'function') return [page];
  try {
    const frames = page.frames();
    return Array.isArray(frames) && frames.length > 0 ? frames : [page];
  } catch { return [page]; }
}

/** True for the family of Playwright errors raised when the page/frame we were
 *  operating on navigated, reloaded, or detached out from under us. These are
 *  transient and recoverable — we re-settle and retry rather than abandon the
 *  whole application (the #1 cause of "filled form became a draft"). */
export function isNavigationError(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? '';
  return /execution context was destroyed|because of a navigation|frame (was )?detached|target closed|cannot find context|navigating and changing the content/i.test(m);
}

/** Wait for post-load redirects/reloads to quiesce before interacting, so we
 *  don't start filling into a frame that's about to be torn down. Many ATS
 *  embeds (Greenhouse job_app) reload once after first paint. Real pages only —
 *  test mocks lack waitForLoadState, where this is a no-op. */
async function settlePage(page: PlaywrightPage, quietMs = 1200, maxWaitMs = 12_000): Promise<void> {
  const wfl = (page as { waitForLoadState?: (s?: string, o?: { timeout?: number }) => Promise<void> }).waitForLoadState;
  if (typeof wfl !== 'function') return; // mock/unknown page — nothing to settle
  try { await wfl.call(page, 'load', { timeout: maxWaitMs }); } catch { /* navigation in-flight */ }
  const start = Date.now();
  let lastUrl = typeof page.url === 'function' ? page.url() : '';
  let stableSince = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 250));
    const u = typeof page.url === 'function' ? page.url() : lastUrl;
    if (u !== lastUrl) { lastUrl = u; stableSince = Date.now(); continue; }
    if (Date.now() - stableSince >= quietMs) return;
  }
}

/** Like clickFirst but tries the main frame first, then every iframe. */
async function clickFirstAcrossFrames(page: PlaywrightPage, selectors: string[], errs?: string[]): Promise<boolean> {
  for (const frame of allFrames(page)) {
    if (await clickFirst(frame, selectors, errs)) return true;
  }
  return false;
}

/** Wait until any submit-selector element reports enabled (uploads finished).
 * Returns immediately when no submit element exists at all — only a present-
 * but-disabled button is worth waiting on. Best effort: resolves quietly on
 * timeout and the click still gets attempted. */
async function waitForSubmitEnabled(page: PlaywrightPage, timeoutMs: number): Promise<void> {
  const pollMs = 500;
  const deadline = Math.ceil(timeoutMs / pollMs);
  for (let i = 0; i < deadline; i++) {
    let sawDisabled = false;
    for (const frame of allFrames(page)) {
      for (const sel of SUBMIT_SELECTORS) {
        try {
          const el = await frame.$(sel);
          if (!el) continue;
          const enabledFn = (el as { isEnabled?: () => Promise<boolean> }).isEnabled;
          if (typeof enabledFn !== 'function') return; // mock/unknown handle — don't stall
          if (await enabledFn.call(el)) return;
          sawDisabled = true;
        } catch { /* detached frame — keep polling */ }
      }
    }
    if (!sawDisabled) return; // nothing to wait for
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

/** Force-dispatch a click on the first matching submit control — bypasses
 * actionability checks (hit-point obscured by sticky banners, etc.). */
async function forceClickFirstAcrossFrames(page: PlaywrightPage, selectors: string[], errs?: string[]): Promise<boolean> {
  for (const frame of allFrames(page)) {
    for (const selector of selectors) {
      const btn = await frame.$(selector);
      if (!btn || typeof btn.click !== 'function') continue;
      try {
        await (btn as unknown as { click: (o?: { force?: boolean; timeout?: number }) => Promise<void> })
          .click({ force: true, timeout: 5000 });
        return true;
      } catch (e) {
        errs?.push(`force ${selector}: ${(e as Error).message.split('\n')[0]}`);
      }
    }
  }
  return false;
}

/** Return the first element matching any selector, searching every frame. */
async function firstLocatorAcrossFrames(page: PlaywrightPage, selectors: string[]): Promise<PlaywrightLocator | null> {
  for (const frame of allFrames(page)) {
    for (const sel of selectors) {
      const loc = await frame.$(sel);
      if (loc) return loc;
    }
  }
  return null;
}

// Ordered specific → general. The generic "code" inputs explicitly EXCLUDE the
// common non-OTP uses (promo/coupon/zip/postal/area/country/dial/discount) so we
// never type a verification code into, say, a coupon field that happens to be on
// the same page.
const CODE_EXCLUSIONS = ':not([name*="promo" i]):not([name*="coupon" i]):not([name*="discount" i]):not([name*="zip" i]):not([name*="postal" i]):not([name*="area" i]):not([name*="country" i]):not([name*="dial" i])';
const CODE_FIELD_SELECTORS: string[] = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[id*="otp" i]',
  'input[name*="one-time" i]',
  'input[name*="onetime" i]',
  'input[name*="verif" i]',
  'input[id*="verif" i]',
  `input[name*="code" i]${CODE_EXCLUSIONS}`,
  `input[id*="code" i]${CODE_EXCLUSIONS}`,
  `input[aria-label*="code" i]${CODE_EXCLUSIONS}`,
  `input[placeholder*="code" i]${CODE_EXCLUSIONS}`
];

/**
 * Probe the page (and its frames) for an email-verification gate. Returns
 * 'code' when a one-time-code input is present, 'link' when it's a "check your
 * email / we sent you a link" screen with no code field, else null.
 */
async function detectVerificationGate(page: PlaywrightPage): Promise<'code' | 'link' | null> {
  for (const frame of allFrames(page)) {
    let kind: 'code' | 'link' | null = null;
    try {
      kind = await frame.evaluate(() => {
        // VERIFICATION_PROBE
        const doc = (globalThis as unknown as { document: any }).document;
        const inputs = Array.from(doc.querySelectorAll('input')) as any[];
        const isCode = inputs.some(el => {
          const hay = `${el.getAttribute('autocomplete') ?? ''} ${el.getAttribute('name') ?? ''} ${el.getAttribute('id') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`.toLowerCase();
          return /one-time-code|(^|[^a-z])otp([^a-z]|$)|verif|confirmation code|security code|access code/.test(hay);
        });
        if (isCode) return 'code';
        const bodyText = (doc.body?.innerText ?? '').toLowerCase();
        // Greenhouse's gate is 8 anonymous single-char boxes — no attributes
        // to match. The body copy is the reliable signal.
        const segmented = inputs.filter(el => el.getAttribute('maxlength') === '1').length >= 4;
        const looksLikeCodeGate = /(verification|security) code (was )?(sent|emailed)|enter the [\w-]{0,24}\s?(character )?code/.test(bodyText);
        if (looksLikeCodeGate && (segmented || bodyText.includes('security code'))) return 'code';
        // Don't treat a post-submit success page ("Thanks for applying, check
        // your email for next steps") as a verification gate — that would
        // mislabel a completed submission as pending.
        const looksSubmitted = /(application (?:submitted|received|complete)|thank you for applying|successfully (?:submitted|applied)|we(?:'ve| have) received your application)/.test(bodyText);
        const looksLikeLinkGate = /(verify your e-?mail|confirm your e-?mail|we (?:just )?sent you (?:a|an) (?:verification|confirmation|magic) (?:e-?mail|link)|click the (?:link|button) (?:we sent|in the e-?mail))/.test(bodyText);
        if (looksLikeLinkGate && !looksSubmitted) {
          return 'link';
        }
        return null;
      }) as 'code' | 'link' | null;
    } catch {
      continue; // cross-origin frame or evaluate failure — skip it, try the next
    }
    if (kind) return kind;
  }
  return null;
}

/**
 * After a submit that didn't navigate, read the ATS's own inline validation
 * errors and return the LABEL of each offending field. Greenhouse/Ashby/Lever
 * all render a small "This field is required" (or similar) node next to the
 * field; the nearest label/legend/aria-label names it. Best-effort and fully
 * defensive — any failure yields an empty list, never throws.
 */
async function collectValidationErrors(page: PlaywrightPage): Promise<string[]> {
  const seen = new Set<string>();
  for (const frame of allFrames(page)) {
    try {
      const labels = await frame.evaluate(() => {
        // VALIDATION_PROBE
        const doc = (globalThis as unknown as { document: any }).document;
        const ERR = /this field is required|is required|please (?:complete|fill|select|answer)|required field|please make a selection/i;
        const out: string[] = [];
        const seenLocal = new Set<string>();

        const labelFor = (el: any): string => {
          // 1) aria-labelledby / aria-label on the field or its container
          const aria = el.getAttribute?.('aria-label');
          if (aria && aria.trim()) return aria.trim();
          // 2) climb to a field container and grab its label/legend
          let node = el;
          for (let i = 0; i < 6 && node; i++) {
            const lbl = node.querySelector?.('label, legend');
            if (lbl && lbl.innerText && lbl.innerText.trim()) {
              return lbl.innerText.replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim();
            }
            node = node.parentElement;
          }
          return '';
        };

        // Strategy A: nodes whose own text IS a "required" message.
        const all = Array.from(doc.querySelectorAll('div,span,p,label,small,strong')) as any[];
        for (const node of all) {
          const txt = String(node.innerText ?? node.textContent ?? '').trim();
          if (!txt || txt.length > 80 || !ERR.test(txt)) continue;
          // Walk up to the field block, then name it.
          let block = node;
          for (let i = 0; i < 5 && block?.parentElement; i++) block = block.parentElement;
          const name = labelFor(block) || labelFor(node.parentElement);
          const key = (name || txt).toLowerCase();
          if (!seenLocal.has(key)) { seenLocal.add(key); out.push(name || txt); }
        }

        // Strategy B: aria-invalid fields (Ashby marks these).
        const invalids = Array.from(doc.querySelectorAll('[aria-invalid="true"]')) as any[];
        for (const el of invalids) {
          const name = labelFor(el);
          if (!name) continue;
          const key = name.toLowerCase();
          if (!seenLocal.has(key)) { seenLocal.add(key); out.push(name); }
        }
        return out.slice(0, 10);
      }) as string[];
      for (const l of labels) { if (l && !seen.has(l)) seen.add(l); }
    } catch {
      continue; // cross-origin frame or evaluate failure — skip
    }
  }
  return Array.from(seen);
}

/**
 * Handle React-based combobox/dropdown widgets (react-select, downshift, MUI
 * Autocomplete, etc.) — none are real `<select>` elements. Universal strategy:
 *   1. Click the combobox input → menu opens
 *   2. Enumerate the visible option labels
 *   3. Pick the best label match for the requested value (exact > prefix > substring)
 *   4. Click that option directly — far more reliable than type + Enter, which
 *      depends on the widget's internal filter matching exactly
 *
 * Returns true ONLY when an option was actually clicked. Type+Enter remains as
 * a last-resort fallback for widgets that don't render a discoverable menu.
 */
// Temporary fill-debug channel: set CROSSWALK_DEBUG_FILL=1 to trace combobox
// interactions to /tmp/crosswalk-fill-debug.log.
function fillDebug(event: string, data: Record<string, unknown>): void {
  if (!process.env.CROSSWALK_DEBUG_FILL) return;
  try {
    appendFileSync('/tmp/crosswalk-fill-debug.log', JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n');
  } catch { /* best effort */ }
}

export async function tryReactSelect(frame: PlaywrightFrame, fieldName: string, value: string, label?: string): Promise<boolean> {
  const isUsableName = isSafeFieldName(fieldName);
  const escaped = isUsableName ? escAttr(fieldName) : '';
  const inputSelectors = isUsableName ? [
    `input[role="combobox"][id="${escaped}"]`,
    `input[role="combobox"][name="${escaped}"]`,
    `input.select__input[id="${escaped}"]`,
    `input.select__input[name="${escaped}"]`,
    `input[id="react-select-${escaped}-input"]`,
    `input[id*="react-select-${escaped}"][role="combobox"]`,
    `input[role="combobox"][id*="${escaped}" i]`,
    `input[role="combobox"][name*="${escaped}" i]`,
    `input[role="combobox"][aria-label*="${escaped}" i]`
  ] : [];

  let input: PlaywrightLocator | null = null;
  for (const selector of inputSelectors) {
    input = await frame.$(selector);
    if (input) break;
  }

  // Label-based fallback: find a `<label>` whose visible text contains the
  // field's known label (or the field name as a humanised string), then
  // walk to the associated combobox input. Handles widgets where name/id is
  // missing or non-semantic (Anthropic "Please identify your race" etc.).
  if (!input) {
    const labelText = (label ?? fieldName).trim();
    if (labelText.length >= 3) {
      try {
        const inputHandle = await frame.evaluate<string | null, string>((labelStr: string) => {
          const doc = (globalThis as unknown as { document: any }).document;
          const labels = Array.from(doc.querySelectorAll('label, legend, [class*="label"]')) as any[];
          const wanted = labelStr.toLowerCase();
          // Score labels: prefer exact match > startsWith > contains.
          let best: any = null;
          let bestScore = 0;
          for (const l of labels) {
            const t = String(l.textContent ?? '').toLowerCase().trim();
            if (!t || t.length > 200) continue;
            let score = 0;
            if (t === wanted) score = 100;
            else if (t.startsWith(wanted)) score = 80;
            else if (wanted.startsWith(t) && t.length >= 5) score = 70;
            else if (t.includes(wanted)) score = 60;
            if (score > bestScore) { best = l; bestScore = score; }
          }
          if (!best || bestScore < 60) return null;
          // Resolve the associated input: <label for="X"> → #X, else nearest combobox in subtree/parent.
          const forAttr = best.getAttribute?.('for');
          let inp = forAttr ? doc.getElementById(forAttr) : null;
          if (!inp) {
            const parent = best.closest('.select__container, fieldset, .field, .question, div') || best.parentElement;
            inp = parent?.querySelector('input[role="combobox"], input.select__input, select');
          }
          if (!inp) return null;
          // Stamp a temporary marker so we can locate the element from outside evaluate.
          const marker = `__cw_rsel_${Math.floor(Math.random() * 1e9)}`;
          inp.setAttribute('data-cw-marker', marker);
          return marker;
        }, labelText).catch(() => null);
        if (inputHandle && typeof inputHandle === 'string') {
          input = await frame.$(`[data-cw-marker="${inputHandle}"]`);
        }
      } catch { /* best-effort */ }
    }
  }

  if (!input) return false;

  try {
    if (typeof input.click === 'function') await input.click();
    else if (typeof input.focus === 'function') await input.focus();
    else return false;
    await new Promise(r => setTimeout(r, 500));

    // Enumerate options from the CURRENTLY-OPEN menu only. react-select
    // keeps prior dropdowns' options in the DOM as `.select__option`, so a
    // global selector leaks "United States" into the Gender menu. The open
    // menu is wrapped in `.select__menu` (react-select) or has a visible
    // `[role="listbox"]` (MUI/Headless UI).
    const wanted = value.toLowerCase().trim();
    const wantedFirstSegment = wanted.split(/[,\(]/)[0].trim();
    const enumerateMenuOptions = () => frame.evaluate(() => {
      const doc = (globalThis as unknown as { document: any }).document;
      const containers = Array.from(doc.querySelectorAll(
        '.select__menu, [role="listbox"]'
      )) as any[];
      const visibleContainers = containers.filter(c => {
        const rect = c.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const opts: any[] = [];
      for (const c of visibleContainers) {
        opts.push(...Array.from(c.querySelectorAll(
          '.select__option, [role="option"], [class*="MenuItem"]'
        )));
      }
      return opts.map((o, i) => ({
        index: i,
        text: String(o.textContent ?? '').trim()
      })).filter(o => o.text.length > 0);
    }).catch(() => [] as Array<{ index: number; text: string }>);
    const clickOptionByText = async (text: string): Promise<boolean> => {
      const escapedText = text.replace(/"/g, '\\"');
      for (const sel of [
        `.select__menu .select__option:has-text("${escapedText}")`,
        `[role="listbox"] [role="option"]:has-text("${escapedText}")`,
        `.select__option:has-text("${escapedText}")`,
        `[role="option"]:has-text("${escapedText}")`
      ]) {
        const opt = await frame.$(sel);
        if (opt && typeof opt.click === 'function') {
          try { await opt.click(); await new Promise(r => setTimeout(r, 200)); return true; }
          catch { /* try next selector */ }
        }
      }
      return false;
    };
    const matchInfo = await enumerateMenuOptions();
    fillDebug('rsel:menu-at-open', { fieldName, value, optCount: matchInfo.length, sample: matchInfo.slice(0, 3).map(o => o.text) });

    if (matchInfo.length > 0) {
      // Stricter scoring. Exact > startsWith > contains-first-segment with
      // word boundaries. For short values (< 4 chars like "No", "Yes"), only
      // exact or word-boundary contains qualifies — substring would match
      // "Norfolk Island" for "No".
      const isShortValue = wanted.length < 4;
      // Detect explicit yes/no intent so a long AI answer like "Yes, I have
      // read the AI partnership guidelines" still picks the bare "Yes" option.
      const yesIntent = /\byes\b/.test(wanted) && !/\bno\b/.test(wanted);
      const noIntent = /\bno\b/.test(wanted) && !/\byes\b/.test(wanted);
      // Common-entity aliases: "United States" must match an option that just
      // says "US" (Stripe), and vice versa.
      const ALIASES: string[][] = [
        ['united states', 'us', 'usa', 'u.s.', 'u.s.a.', 'united states of america'],
        ['united kingdom', 'uk', 'great britain', 'gb'],
        ['united arab emirates', 'uae']
      ];
      const aliasGroup = ALIASES.find(g => g.includes(wanted));
      const scored = matchInfo.map(o => {
        const t = o.text.toLowerCase();
        const wordBoundaryHit = new RegExp(`(^|\\W)${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(t);
        let score = 0;
        if (t === wanted) score = 100;
        else if (t.startsWith(wanted + ' ') || t.startsWith(wanted + ',') || t.startsWith(wanted + '.')) score = 90;
        else if (t.startsWith(wanted)) score = 80;
        else if (wanted.startsWith(t) && t.length >= 3) score = 70;
        else if (!isShortValue && t.includes(wantedFirstSegment) && wantedFirstSegment.length >= 3) score = 60;
        else if (wordBoundaryHit) score = 55;
        else if (!isShortValue && wantedFirstSegment.length >= 3
                 && wantedFirstSegment.split(/\s+/).every(w => w.length < 3 || t.includes(w))) score = 40;
        // Intent boosters: if the AI's answer clearly signals Yes or No, and
        // the option starts with that word, lock in a high score so e.g.
        // "Yes, I have read..." picks the "Yes" option even when neither
        // string strictly starts-with the other.
        if (yesIntent && /^\s*yes\b/.test(t)) score = Math.max(score, 85);
        if (noIntent && /^\s*no\b/.test(t)) score = Math.max(score, 85);
        if (aliasGroup && aliasGroup.includes(t)) score = Math.max(score, 95);
        return { ...o, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best && best.score >= 55) {
        if (await clickOptionByText(best.text)) return true;
      }
    }
    // Fallback: type + select — works when the widget filters as you type
    // (react-select, downshift, location autocompletes) or queries a remote
    // list (Greenhouse school typeaheads).
    if (typeof input.fill === 'function') {
      // Clear any residue from a previous attempt — retyping into a non-empty
      // react-select filter produces "NorthwesternNorthwestern" and no results.
      try { await input.fill(''); } catch { /* readonly trigger inputs */ }
    }
    if (typeof input.type === 'function') {
      await input.type(value, { delay: 30 });
    } else if (typeof input.fill === 'function') {
      await input.fill(value);
    }
    // Remote suggestion lookups take seconds. Poll the menu instead of a
    // fixed sleep and CLICK the loaded suggestion — pressing Enter on a
    // still-loading menu commits nothing while reporting success (that's how
    // "filled" school fields came back empty). Only a CONFIDENT text match
    // may be clicked: another widget's still-open menu can be visible while
    // this one is loading, and clicking its first option fills garbage.
    let clickedSuggestion = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const opts = await enumerateMenuOptions();
      const target = opts.find(o => o.text.toLowerCase() === wanted)
        ?? opts.find(o => o.text.toLowerCase().includes(wanted) || wanted.includes(o.text.toLowerCase()));
      fillDebug('rsel:poll', { fieldName, optCount: opts.length, sample: opts.slice(0, 3).map(o => o.text), target: target?.text ?? null });
      if (target) {
        clickedSuggestion = await clickOptionByText(target.text);
        fillDebug('rsel:click', { fieldName, target: target.text, clickedSuggestion });
        if (clickedSuggestion) break;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    if (!clickedSuggestion && typeof input.press === 'function') {
      try { await input.press('ArrowDown'); } catch { /* no menu — Enter may still commit */ }
      await new Promise(r => setTimeout(r, 200));
      await input.press('Enter');
      await new Promise(r => setTimeout(r, 400));
    }
    // No Escape here: on a committed react-select it clears the selection,
    // and option-menu pollution is already handled by the visible-container
    // filter in the enumeration above.
    // Verify the widget actually committed a value. A committed react-select
    // renders it in .select__single-value; reporting success on an empty
    // widget turns a fixable skip into a silent hole in the application.
    if (typeof (input as unknown as { evaluate?: unknown }).evaluate === 'function') {
      try {
        const committed = await (input as unknown as { evaluate: (fn: (el: any) => boolean) => Promise<boolean> }).evaluate((el: any) => {
          let n = el;
          // 3 levels: input-container → value-container → control. Going
          // higher reaches SIBLING widgets' single-values (education rows).
          for (let i = 0; i < 3 && n; i++) {
            const sv = n.querySelector?.('.select__single-value, [class*="singleValue"]');
            if (sv && String(sv.textContent ?? '').trim().length > 0) return true;
            n = n.parentElement;
          }
          // react-select keeps the typed text in the input even when nothing
          // committed — only the single-value node proves a real selection.
          const isReactSelect = Boolean(el.closest?.('[class*="select__"], [class*="select_"]'));
          if (isReactSelect) return false;
          return Boolean(el.value && String(el.value).trim().length > 0);
        });
        fillDebug('rsel:commit-verdict', { fieldName, committed: Boolean(committed) });
        return Boolean(committed);
      } catch (e) { fillDebug('rsel:commit-verify-threw', { fieldName, err: String(e) }); }
    }
    return true;
  } catch (e) { fillDebug('rsel:threw', { fieldName, err: String(e) }); return false; }
}

/** Try filling a field on the main page first, then each nested frame (Stripe
 * and other custom-branded ATS pages render the Greenhouse form inside an
 * iframe — selectors on the parent page see nothing). */
async function tryFillFieldAcrossFrames(page: PlaywrightPage, field: FillField, ats: string | undefined): Promise<boolean> {
  for (const frame of allFrames(page)) {
    try {
      if (await tryFillField(frame, field, ats)) return true;
    } catch (e) {
      // A mid-fill navigation invalidates this frame — bubble it so the caller
      // can settle and retry. Any other per-frame error (detached iframe,
      // selector quirk) shouldn't stop us checking the remaining frames.
      if (isNavigationError(e)) throw e;
    }
  }
  return false;
}

/** Fill a single field on the given frame. Returns whether it matched a selector. */
async function tryFillField(page: PlaywrightFrame, field: FillField, ats: string | undefined): Promise<boolean> {
  if (field.kind === 'text_by_name') {
    // Synthetic label-keyed comboboxes (anonymous Ashby autocompletes):
    // route straight to the label-based react-select machinery.
    if (field.name.startsWith('__combobox__')) {
      const label = field.name.slice('__combobox__'.length);
      return tryReactSelect(page, label, field.value, field.label ?? label);
    }
    if (!isSafeFieldName(field.name)) return false;
    // First check whether `<input id="X">` is actually a react-select combobox.
    // For those, calling .fill() programmatically succeeds at the DOM level but
    // the React component never receives an onChange, so the visible dropdown
    // stays empty (the bug that bit us on Stripe EEO + Anthropic dropdowns).
    // Route comboboxes straight to the option-click handler.
    const comboboxSel = [
      `input[role="combobox"][id="${escAttr(field.name)}"]`,
      `input[role="combobox"][name="${escAttr(field.name)}"]`,
      `input.select__input[id="${escAttr(field.name)}"]`,
      `input.select__input[name="${escAttr(field.name)}"]`
    ];
    for (const sel of comboboxSel) {
      const found = await page.$(sel);
      if (found) return tryReactSelect(page, field.name, field.value, field.label);
    }
    // Regular textarea/input fill path.
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
    // Last-resort react-select fallback (fuzzy id/name + label match).
    if (await tryReactSelect(page, field.name, field.value, field.label)) return true;
    return false;
  }

  // --- Choice fields: <select>, radio, checkbox ---
  if (field.kind === 'select_by_name') {
    for (const selector of [`select[name="${escAttr(field.name)}"]`, `select[id="${escAttr(field.name)}"]`]) {
      const el = await page.$(selector);
      if (!el || typeof el.selectOption !== 'function') continue;
      try { await el.selectOption({ label: field.value }); return true; } catch { /* fall through to value */ }
      try { await el.selectOption(field.value); return true; } catch { continue; }
    }
    // Fallback to react-select (label-aware). One retry with a fresh element
    // lookup: Greenhouse re-renders the education section once the uploaded
    // résumé parses, which detaches the combobox mid-interaction.
    if (await tryReactSelect(page, field.name, field.value, field.label)) return true;
    await new Promise(r => setTimeout(r, 1000));
    return tryReactSelect(page, field.name, field.value, field.label);
  }

  if (field.kind === 'radio_by_name') {
    // Synthetic button-option groups (Ashby Yes/No widgets): the name embeds
    // the question. The in-page evaluate only LOCATES the button and stamps a
    // marker — the click must be a real Playwright click, because Ashby's
    // react-aria buttons listen for trusted pointer events and ignore the
    // synthetic DOM click() an in-page handler would dispatch.
    if (field.name.startsWith('__btnopt__')) {
      const q = field.name.slice('__btnopt__'.length);
      try {
        const marker = await page.evaluate(
          ({ q, value }: { q: string; value: string }) => {
            const doc = (globalThis as unknown as { document: any }).document;
            // Tolerate whitespace/asterisk drift between preview and fill.
            const norm = (s: string) => s.toLowerCase().replace(/\*/g, '').replace(/\s+/g, ' ').trim();
            const btns = Array.from(doc.querySelectorAll('button[class*="_option_"]')) as any[];
            for (const b of btns) {
              const txt = String(b.innerText ?? '').trim();
              if (txt.toLowerCase() !== value.toLowerCase().trim()) continue;
              let bq = '';
              let n = b.parentElement;
              for (let i = 0; i < 6 && n && !bq; i++) {
                const t = String(n.textContent ?? '').trim();
                if (t.includes('?') && t.length < 300) bq = t.split('?')[0].trim().slice(-120) + '?';
                n = n.parentElement;
              }
              if (norm(bq.slice(0, 100)) !== norm(q)) continue;
              const m = `__cw_btnopt_${Math.floor(Math.random() * 1e9)}`;
              b.setAttribute('data-cw-marker', m);
              return m;
            }
            return null;
          },
          { q, value: field.value }
        );
        if (marker && typeof marker === 'string') {
          const btn = await page.$(`[data-cw-marker="${marker}"]`);
          if (btn && typeof btn.click === 'function') { await btn.click(); return true; }
        }
      } catch { /* mocked page or cross-origin — report unfilled */ }
      return false;
    }
    for (const selector of [
      `input[type="radio"][name="${escAttr(field.name)}"][value="${escAttr(field.value)}"]`,
      `input[type="radio"][id="${escAttr(field.name)}"][value="${escAttr(field.value)}"]`,
      // Label-text fallback: boards like Ashby give every radio value="on",
      // so the option's visible label is the only way to target it. Clicking
      // the label checks its radio.
      `label:has(input[type="radio"][name="${escAttr(field.name)}"]):has-text("${escAttr(field.value)}")`
    ]) {
      const el = await page.$(selector);
      if (!el) continue;
      try {
        if (typeof el.check === 'function') { await el.check(); return true; }
      } catch { /* labels can't check() — click below */ }
      try {
        if (typeof el.click === 'function') { await el.click(); return true; }
      } catch { continue; }
    }
    // Sibling-label fallback: Ashby renders <input id=…><label for=…> pairs
    // (the label does NOT wrap the input), so CSS :has() can't reach them.
    // Match the radio by its group name + associated label text in the DOM.
    try {
      const clicked = await page.evaluate(
        ({ name, value }: { name: string; value: string }) => {
          const doc = (globalThis as unknown as { document: any }).document;
          // Ashby prefixes group names with a per-page-load instance id, so
          // the name captured at preview time won't equal the one at fill
          // time. The part from the FIRST underscore on is stable — covers
          // both `uuid__systemfield_x` and Cohere-style `uuid_question-uuid`.
          const us = name.indexOf('_');
          const suffix = us >= 0 ? name.slice(us) : null;
          // Checkboxes included: Lever single-select groups are checkboxes.
          const radios = (Array.from(doc.querySelectorAll('input[type="radio"], input[type="checkbox"]')) as any[])
            .filter((x: any) => x.name === name || (suffix && typeof x.name === 'string' && x.name.endsWith(suffix)));
          for (const r of radios) {
            const lbl = (r.id && doc.querySelector(`label[for="${r.id}"]`)) || r.closest('label');
            const text = (lbl?.textContent || '').trim();
            if (text && (text === value || text.includes(value) || value.includes(text))) {
              (lbl ?? r).click();
              return true;
            }
          }
          return false;
        },
        { name: field.name, value: field.value }
      );
      if (clicked === true) return true;
    } catch { /* cross-origin or mocked page — give up on this field */ }
    return false;
  }

  if (field.kind === 'checkbox_by_name') {
    for (const selector of [`input[type="checkbox"][name="${escAttr(field.name)}"]`, `input[type="checkbox"][id="${escAttr(field.name)}"]`]) {
      const el = await page.$(selector);
      if (!el) continue;
      try {
        if (field.checked && typeof el.check === 'function') { await el.check(); return true; }
        if (!field.checked && typeof el.uncheck === 'function') { await el.uncheck(); return true; }
        if (typeof el.click === 'function') { await el.click(); return true; }
      } catch { continue; }
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

/** Selector candidates, in priority order. First match wins. Each list goes
 * precise → fuzzy: exact name/id, then standard autocomplete attrs, then
 * substring matches on name/id/placeholder/aria-label so we catch custom
 * Greenhouse/Lever implementations (Stripe, DoorDash, etc.) that rename fields.
 */
const SELECTORS: Record<StaticKind, string[]> = {
  email: [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="job_application[email]"]',
    'input[autocomplete="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[aria-label*="email" i]',
    'input[placeholder*="email" i]'
  ],
  first_name: [
    'input[name="first_name"]',
    'input[name="firstName"]',
    'input[name="job_application[first_name]"]',
    'input[autocomplete="given-name"]',
    'input[id="first_name"]',
    'input[id="firstName"]',
    'input[name*="first" i][name*="name" i]',
    'input[id*="first" i][id*="name" i]',
    'input[aria-label*="first name" i]',
    'input[placeholder*="first name" i]'
  ],
  last_name: [
    'input[name="last_name"]',
    'input[name="lastName"]',
    'input[name="job_application[last_name]"]',
    'input[autocomplete="family-name"]',
    'input[id="last_name"]',
    'input[id="lastName"]',
    'input[name*="last" i][name*="name" i]',
    'input[id*="last" i][id*="name" i]',
    'input[aria-label*="last name" i]',
    'input[placeholder*="last name" i]'
  ],
  full_name: [
    'input[name="name"]',
    'input[name="full_name"]',
    'input[name="fullName"]',
    'input[autocomplete="name"]',
    'input[id="full_name"]',
    'input[id="name"]',
    'input[aria-label*="full name" i]',
    'input[placeholder*="full name" i]'
  ],
  phone: [
    'input[type="tel"]',
    'input[name="phone"]',
    'input[name="phoneNumber"]',
    'input[name="job_application[phone]"]',
    'input[autocomplete="tel"]',
    'input[name*="phone" i]',
    'input[name*="mobile" i]',
    'input[id*="phone" i]',
    'input[aria-label*="phone" i]',
    'input[placeholder*="phone" i]'
  ],
  linkedin: [
    'input[name="urls[LinkedIn]"]',
    'input[name="linkedin"]',
    'input[name*="linkedin" i]',
    'input[id*="linkedin" i]',
    'input[aria-label*="linkedin" i]',
    'input[placeholder*="linkedin" i]'
  ],
  website: [
    'input[name="urls[Website]"]',
    'input[name="urls[Portfolio]"]',
    'input[name="website"]',
    'input[name="portfolio"]',
    'input[type="url"]',
    'input[name*="website" i]',
    'input[name*="portfolio" i]',
    'input[id*="website" i]',
    'input[id*="portfolio" i]',
    'input[aria-label*="website" i]',
    'input[aria-label*="portfolio" i]'
  ],
  cover_letter_text: [
    'textarea[name="cover_letter"]',
    'textarea[name="coverLetter"]',
    'textarea[name="job_application[cover_letter]"]',
    'textarea[id="cover_letter"]',
    'textarea[id="coverLetter"]',
    'textarea[name*="cover" i]',
    'textarea[id*="cover" i]',
    'textarea[aria-label*="cover" i]',
    'textarea[placeholder*="cover" i]'
  ],
  cover_letter_file: [
    'input[type="file"][name*="cover" i]',
    'input[type="file"][name*="letter" i]',
    'input[type="file"][id*="cover" i]',
    'input[type="file"][aria-label*="cover" i]'
  ],
  resume_file: [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][name*="cv" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][aria-label*="resume" i]',
    'input[type="file"][aria-label*="cv" i]',
    'input[type="file"]'
  ]
};

type StaticKind = Exclude<FillField['kind'], 'text_by_name' | 'select_by_name' | 'radio_by_name' | 'checkbox_by_name'>;

/** ATS-specific selector overlays. Tried BEFORE generic candidates. */
const ATS_SELECTORS: Record<string, Partial<Record<StaticKind, string[]>>> = {
  workable: {
    first_name: ['input[name="firstName"]'],
    last_name: ['input[name="lastName"]'],
    phone: ['input[name="phoneNumber"]'],
    resume_file: ['input[name="resumeFile"]', 'input[name="cv"]']
  },
  ashby: {
    // Current Ashby boards use _systemfield_* ids; older ones data-testid.
    email: ['input[id="_systemfield_email"]', 'input[data-testid*="email" i]'],
    full_name: ['input[id="_systemfield_name"]'],
    phone: ['input[id="_systemfield_phone"]', 'input[data-testid*="phone" i]'],
    resume_file: ['input[id="_systemfield_resume"]', 'input[data-testid*="resume" i]']
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

/** Escape a string for use inside a double-quoted CSS attribute selector. */
function escAttr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
    // react-select internal inputs and similar tracking widgets have no name,
    // no id, no aria-* metadata, and no associated <label>. We can't reliably
    // address them and they're not user-facing fields — skip rather than
    // emit "(unnamed)" rows that downstream code will fail to fill.
    const ariaLabel = e.getAttribute('aria-label');
    const ariaLabelledBy = e.getAttribute('aria-labelledby');
    let derivedLabel: string | undefined;
    if (e.id) {
      const lbl = doc.querySelector(`label[for="${e.id}"]`);
      if (lbl) derivedLabel = String(lbl.textContent ?? '').trim();
    }
    if (!derivedLabel) {
      const parent = e.closest('label');
      if (parent) derivedLabel = String(parent.textContent ?? '').trim();
    }
    if (!derivedLabel && ariaLabelledBy) {
      const ref = doc.getElementById(ariaLabelledBy);
      if (ref) derivedLabel = String(ref.textContent ?? '').trim();
    }
    const hasAnyIdentifier = Boolean(e.name) || Boolean(e.id) || Boolean(ariaLabel)
                          || Boolean(ariaLabelledBy) || Boolean(derivedLabel);
    if (!hasAnyIdentifier) {
      // Anonymous comboboxes (Ashby's Location autocomplete: no name, no id,
      // no label association) — derive the question from the label-ish text
      // preceding the widget and emit a synthetic label-keyed field, else a
      // required field stays invisible and the form can never submit.
      if (e.getAttribute('role') === 'combobox') {
        let q = '';
        let node = e.parentElement;
        for (let depth = 0; depth < 5 && node && !q; depth++) {
          const prev = node.previousElementSibling;
          if (prev && /label|legend/i.test(prev.tagName + ' ' + (prev.className || ''))) {
            const t = String(prev.textContent ?? '').trim();
            if (t && t.length <= 120) q = t;
          }
          node = node.parentElement;
        }
        if (q) {
          fields.push({
            name: `__combobox__${q.replace(/\*+$/, '').trim()}`,
            type: 'text',
            label: q.replace(/\*+$/, '').trim(),
            required: q.includes('*'),
            value: undefined
          });
        }
      }
      continue;
    }
    const name = e.name || e.id || '(unnamed)';
    const type = tag === 'input' ? (e.type || 'text') : tag;
    let options: string[] | undefined;
    if (tag === 'select') {
      options = Array.from(e.options as any[])
        .map(o => String(o.textContent ?? '').trim())
        .filter((t: string) => t.length > 0);
    }
    // For grouped choices the per-option label ("United States") says nothing
    // about the QUESTION ("countries you anticipate working in") — find the
    // group's question text so the answer bank/model can reason about it.
    let groupLabel: string | undefined;
    if (type === 'radio' || type === 'checkbox') {
      const legend = e.closest('fieldset')?.querySelector('legend');
      if (legend) groupLabel = String(legend.textContent ?? '').trim();
      if (!groupLabel) {
        // Walk up a few containers; the question is usually the text of a
        // label-ish element immediately preceding the options container.
        let node = e.parentElement;
        for (let depth = 0; depth < 5 && node && !groupLabel; depth++) {
          const prev = node.previousElementSibling;
          if (prev && /label|legend/i.test(prev.tagName + ' ' + (prev.className || ''))) {
            const t = String(prev.textContent ?? '').trim();
            if (t && t.length <= 220) groupLabel = t;
          }
          node = node.parentElement;
        }
      }
      if (groupLabel && groupLabel === derivedLabel) groupLabel = undefined;
    }
    fields.push({
      name,
      type,
      label: derivedLabel ?? ariaLabel ?? undefined,
      groupLabel,
      required: Boolean(e.required),
      value: typeof e.value === 'string' && e.value.length > 0 ? e.value : undefined,
      options
    });
  }
  // Ashby's Yes/No widgets are plain <button class="_option_…"> pairs — no
  // input element at all. Surface them as a radio group keyed on the
  // question text so the choice resolver and the button-click fill path
  // can find them again.
  const optBtns = Array.from(doc.querySelectorAll('button[class*="_option_"]')) as any[];
  for (const b of optBtns) {
    const txt = String(b.innerText ?? '').trim();
    if (!txt || txt.length > 40) continue;
    let q = '';
    let n = b.parentElement;
    for (let i = 0; i < 6 && n && !q; i++) {
      const t = String(n.textContent ?? '').trim();
      if (t.includes('?') && t.length < 300) q = t.split('?')[0].trim().slice(-120) + '?';
      n = n.parentElement;
    }
    if (!q) continue;
    fields.push({
      name: `__btnopt__${q.slice(0, 100)}`,
      type: 'radio',
      label: txt,
      groupLabel: q,
      required: false,
      value: txt
    });
  }
  return fields;
};
