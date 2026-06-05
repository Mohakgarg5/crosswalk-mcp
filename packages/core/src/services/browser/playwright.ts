import { execSync } from 'node:child_process';
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
      return { screenshotPng, resolvedUrl, title, formFields };
    });
  }

  async fillForm(url: string, fields: FillField[], opts: { ats?: string; clickSubmit?: boolean; maxSteps?: number; resolveVerification?: ResolveVerification } = {}): Promise<BrowserFillResult> {
    return this.runWithPage(async (page) => {
      // Captured up-front so the verification poller only considers emails that
      // arrived at/after this apply attempt began.
      const startedAt = new Date().toISOString();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
      // Many public ATS URLs (Greenhouse job-boards, Lever, Ashby) land on a job
      // description page that hides the application form behind an "Apply" button.
      // Try to advance past it before looking for form fields. No-op if the form
      // is already on the page or the button isn't found.
      await advanceToForm(page);
      const maxSteps = Math.max(1, opts.maxSteps ?? 1);
      const labelOf = (f: FillField) => ('name' in f ? `${f.kind}:${f.name}` : f.kind);
      const filledLabels = new Set<string>();
      let stepsAdvanced = 0;

      // Multi-step wizards: fill the current page, advance via Next/Continue,
      // repeat. A field skipped on one page may be filled on a later one.
      for (let step = 1; step <= maxSteps; step++) {
        for (const field of fields) {
          const label = labelOf(field);
          if (filledLabels.has(label)) continue;
          if (await tryFillFieldAcrossFrames(page, field, opts.ats)) filledLabels.add(label);
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
      const submitClickErrors: string[] = [];
      if (opts.clickSubmit) {
        // Uploads (résumé DOCX) keep ATS submit buttons disabled while they
        // process — Greenhouse times a 30s element click out. Wait for an
        // enabled submit control first.
        await waitForSubmitEnabled(page, 45_000);
        submitClicked = await clickFirstAcrossFrames(page, SUBMIT_SELECTORS, submitClickErrors);
        if (!submitClicked && submitClickErrors.length === 0) {
          // No button found at all — boards that re-render after uploads
          // (Ashby) detach it briefly. Give it one more patient attempt.
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
            }
            postSubmitUrl = page.url();
            postSubmitTitle = await page.title();
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
  'button[type="submit"]',
  'input[type="submit"]',
  'button[name="submit"]',
  'button[id*="submit" i]',
  'button[name*="submit" i]',
  'button[data-automation-id*="submit" i]',
  'button[data-automation-id="bottom-navigation-next-button"]',
  // Text fallbacks — some boards (Ashby re-renders) momentarily detach the
  // typed button; the visible label is the stable thing.
  'button:has-text("Submit application")',
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
async function tryReactSelect(frame: PlaywrightFrame, fieldName: string, value: string, label?: string): Promise<boolean> {
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
    const matchInfo = await frame.evaluate(() => {
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
        return { ...o, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (best && best.score >= 55) {
        const escapedText = best.text.replace(/"/g, '\\"');
        const candidates = [
          `.select__menu .select__option:has-text("${escapedText}")`,
          `[role="listbox"] [role="option"]:has-text("${escapedText}")`,
          `.select__option:has-text("${escapedText}")`,
          `[role="option"]:has-text("${escapedText}")`
        ];
        for (const sel of candidates) {
          const opt = await frame.$(sel);
          if (opt && typeof opt.click === 'function') {
            try { await opt.click(); await new Promise(r => setTimeout(r, 200)); return true; }
            catch { /* try next selector */ }
          }
        }
      }
    }
    // Fallback: type + select — works when the widget filters as you type
    // (react-select, downshift, location autocompletes). Async suggestion
    // lookups (Google Places) take >1s; pressing Enter too early commits
    // nothing, and a blind Escape afterwards CLEARS whatever did commit.
    if (typeof input.type === 'function') {
      await input.type(value, { delay: 30 });
    } else if (typeof input.fill === 'function') {
      await input.fill(value);
    }
    await new Promise(r => setTimeout(r, 1500)); // let async suggestions load
    if (typeof input.press === 'function') {
      try { await input.press('ArrowDown'); } catch { /* no menu — Enter may still commit */ }
      await new Promise(r => setTimeout(r, 200));
      await input.press('Enter');
    }
    await new Promise(r => setTimeout(r, 400));
    // No Escape here: on a committed react-select it clears the selection,
    // and option-menu pollution is already handled by the visible-container
    // filter in the enumeration above.
    return true;
  } catch { return false; }
}

/** Try filling a field on the main page first, then each nested frame (Stripe
 * and other custom-branded ATS pages render the Greenhouse form inside an
 * iframe — selectors on the parent page see nothing). */
async function tryFillFieldAcrossFrames(page: PlaywrightPage, field: FillField, ats: string | undefined): Promise<boolean> {
  for (const frame of allFrames(page)) {
    if (await tryFillField(frame, field, ats)) return true;
  }
  return false;
}

/** Fill a single field on the given frame. Returns whether it matched a selector. */
async function tryFillField(page: PlaywrightFrame, field: FillField, ats: string | undefined): Promise<boolean> {
  if (field.kind === 'text_by_name') {
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
    // Fallback to react-select (label-aware).
    return tryReactSelect(page, field.name, field.value, field.label);
  }

  if (field.kind === 'radio_by_name') {
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
          // time. The `__systemfield_…` (or generally `__…`) suffix is stable.
          const suffix = name.includes('__') ? name.slice(name.indexOf('__')) : null;
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
    if (!hasAnyIdentifier) continue;
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
  return fields;
};
