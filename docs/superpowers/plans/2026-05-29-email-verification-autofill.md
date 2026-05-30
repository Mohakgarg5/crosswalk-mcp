# Email Verification Auto-Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During auto-apply, detect an email-verification gate (code field or magic-link screen), read the verification email over IMAP, enter the code or open the link, and finish submitting — pausing and flagging the application if it can't.

**Architecture:** A new email-reading layer (`imapReader` → `verification` extraction → `resolveVerification` orchestrator) is injected into `fillForm` as an optional async callback. The browser detects the gate and calls back; the email layer polls IMAP and returns a code/link; the browser completes the step on the same live page. Failure → pause + flag (notification, no submit). Behavior is unchanged when no inbox is configured.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), Vitest, better-sqlite3, Playwright (lazy-imported), `imapflow` + `mailparser` (new), Next.js (web settings).

**Spec:** `docs/superpowers/specs/2026-05-29-email-verification-autofill-design.md`

---

## File Structure

**Create:**
- `packages/core/src/services/email/verification.ts` — pure extraction: emails → code | link | null, plus the link host-allowlist.
- `packages/core/src/services/email/imapReader.ts` — read-only IMAP fetch (injectable), provider→config mapping.
- `packages/core/src/services/email/resolveVerification.ts` — polling orchestrator that becomes the `fillForm` callback (incl. optional sampling fallback).
- `packages/core/tests/services.email.verification.test.ts`
- `packages/core/tests/services.email.resolveVerification.test.ts`
- `packages/core/tests/services.email.imapReader.test.ts`

**Modify:**
- `packages/core/package.json` — add `imapflow`, `mailparser` deps.
- `packages/core/src/services/browser/types.ts` — add verification types + `fillForm` opt + result flags.
- `packages/core/src/services/browser/playwright.ts` — detect gate, run callback, type code / open link.
- `packages/core/src/store/appConfig.ts` — add `verificationTimeoutMs`.
- `packages/core/src/tools/apply_application.ts` — build + pass callback; record events/notification.
- `packages/core/tests/services.browser.test.ts` — verification-path tests.
- `packages/core/tests/server.tools.test.ts` — apply-tool pause/flag + verified tests.
- `apps/web/lib/engine.ts` — `getEmailAccount`, `saveEmailAccount`, `testEmailConnection`.
- `apps/web/app/api/settings/route.ts` (or new `api/email-account/route.ts`) — persist account + test endpoint.
- `apps/web/app/settings/page.tsx` — "Email inbox" section.
- `README.md` — document the feature + test count.

> **Note on the sampling fallback:** the spec says extraction "falls back to sampling." To keep `verification.ts` a pure, easily-tested function, the regex extraction stays pure and the **optional model fallback lives in `resolveVerification.ts`** (which already carries injected deps). Same behavior, cleaner boundaries.

---

## Task 1: Add dependencies

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install the IMAP + parser libraries**

Run from repo root:
```bash
npm install --workspace packages/core imapflow mailparser
npm install --workspace packages/core --save-dev @types/mailparser
```
Expected: `packages/core/package.json` gains `imapflow` and `mailparser` under `dependencies`, `@types/mailparser` under `devDependencies`; `package-lock.json` updates. (`imapflow` ships its own types.)

- [ ] **Step 2: Verify the build still type-checks**

Run: `npm run build:core`
Expected: builds with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json package-lock.json
git commit -m "deps: add imapflow + mailparser for email verification reading"
```

---

## Task 2: Verification types in the browser contract

**Files:**
- Modify: `packages/core/src/services/browser/types.ts`

- [ ] **Step 1: Add the verification types and extend the contract**

Add near the top of `types.ts` (after the existing `FormField` type):

```typescript
/** What the apply flow knows when it hits a verification gate. */
export type VerificationContext = {
  /** URL of the form that triggered the gate. */
  formUrl: string;
  /** ISO timestamp captured when the apply began — only emails at/after this count. */
  startedAt: string;
  /** Host of the form (e.g. "boards.greenhouse.io"), used as a link-safety hint. */
  atsHost?: string;
};

/** The resolved verification: a typed code to enter, or a link to open. */
export type VerificationOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'link'; url: string };

/** Injected into fillForm; returns the outcome or null if it couldn't be resolved. */
export type ResolveVerification = (ctx: VerificationContext) => Promise<VerificationOutcome | null>;
```

In the `Browser` interface, change the `fillForm` signature's opts to include the callback:

```typescript
  fillForm(url: string, fields: FillField[], opts?: { ats?: string; clickSubmit?: boolean; maxSteps?: number; resolveVerification?: ResolveVerification }): Promise<BrowserFillResult>;
```

In `BrowserFillResult`, add two flags after `stepsAdvanced`:

```typescript
  /** True if a verification gate (code field or magic-link screen) was detected. */
  verificationRequired?: boolean;
  /** True if the gate was detected AND the callback resolved it (code entered / link opened). */
  verificationResolved?: boolean;
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build:core`
Expected: builds clean (no consumers reference the new optional fields yet).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/services/browser/types.ts
git commit -m "feat(browser): add verification types to the fillForm contract"
```

---

## Task 3: Pure verification extraction + link allowlist

**Files:**
- Create: `packages/core/src/services/email/verification.ts`
- Test: `packages/core/tests/services.email.verification.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/services.email.verification.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractVerification, isAllowedLinkHost } from '../src/services/email/verification.ts';
import type { ParsedEmail } from '../src/services/email/verification.ts';

function email(over: Partial<ParsedEmail>): ParsedEmail {
  return {
    from: 'noreply@greenhouse.io',
    subject: 'Your verification code',
    text: '',
    date: '2026-05-29T12:00:00.000Z',
    ...over
  };
}

describe('extractVerification', () => {
  it('extracts a 6-digit code adjacent to a code keyword', () => {
    const out = extractVerification([email({ text: 'Your verification code is 482913. It expires in 10 minutes.' })]);
    expect(out).toEqual({ kind: 'code', code: '482913' });
  });

  it('extracts an alphanumeric code after "code:"', () => {
    const out = extractVerification([email({ subject: 'Confirm your email', text: 'Use code: A1B2C3 to continue.' })]);
    expect(out).toEqual({ kind: 'code', code: 'A1B2C3' });
  });

  it('prefers a code over a link when both are present', () => {
    const out = extractVerification([email({
      text: 'Your code is 552210 or visit https://boards.greenhouse.io/verify?t=xyz'
    })]);
    expect(out).toEqual({ kind: 'code', code: '552210' });
  });

  it('extracts a magic link when no code is present', () => {
    const out = extractVerification([email({
      subject: 'Verify your email',
      text: 'Click to confirm: https://login.microsoftonline.com/verify?token=abc123'
    })]);
    expect(out).toEqual({ kind: 'link', url: 'https://login.microsoftonline.com/verify?token=abc123' });
  });

  it('returns null when no email looks like a verification', () => {
    const out = extractVerification([email({ subject: 'Weekly newsletter', text: 'Here are this week jobs.' })]);
    expect(out).toBeNull();
  });

  it('picks the most recent matching email', () => {
    const out = extractVerification([
      email({ text: 'Your code is 111111', date: '2026-05-29T12:00:00.000Z' }),
      email({ text: 'Your code is 222222', date: '2026-05-29T12:05:00.000Z' })
    ]);
    expect(out).toEqual({ kind: 'code', code: '222222' });
  });

  it('ignores long digit strings that are not codes (e.g. phone/year)', () => {
    const out = extractVerification([email({ subject: 'Newsletter', text: 'Call 18005551234 in 2026.' })]);
    expect(out).toBeNull();
  });
});

describe('isAllowedLinkHost', () => {
  it('allows known ATS / identity hosts', () => {
    expect(isAllowedLinkHost('https://boards.greenhouse.io/verify', undefined)).toBe(true);
    expect(isAllowedLinkHost('https://login.microsoftonline.com/x', undefined)).toBe(true);
  });
  it('allows the form host passed as a hint', () => {
    expect(isAllowedLinkHost('https://careers.acme.com/verify', 'careers.acme.com')).toBe(true);
  });
  it('rejects arbitrary hosts', () => {
    expect(isAllowedLinkHost('https://evil.example.com/track', 'careers.acme.com')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace packages/core -- services.email.verification`
Expected: FAIL — `Cannot find module '../src/services/email/verification.ts'`.

- [ ] **Step 3: Implement the extraction**

Create `packages/core/src/services/email/verification.ts`:

```typescript
import type { VerificationOutcome } from '../browser/types.ts';

export type { VerificationOutcome } from '../browser/types.ts';

/** A parsed email, provider-agnostic. */
export type ParsedEmail = {
  from: string;
  subject: string;
  text: string;
  html?: string;
  /** ISO timestamp. */
  date: string;
};

/** Hosts we will open magic links on without an explicit form-host match. */
export const VERIFICATION_LINK_ALLOWLIST = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'workday.com',
  'smartrecruiters.com',
  'workable.com',
  'accounts.google.com',
  'login.microsoftonline.com'
];

const VERIFY_RE = /(verif|confirm|one[\s-]?time|otp|security code|access code|sign[\s-]?in code|your code|activation)/i;

/** True if `url`'s host ends with an allowlisted domain or equals the form host. */
export function isAllowedLinkHost(url: string, formHost: string | undefined): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  if (formHost && host === formHost.toLowerCase()) return true;
  return VERIFICATION_LINK_ALLOWLIST.some(d => host === d || host.endsWith('.' + d));
}

function findCode(text: string): string | null {
  // Prefer a code that follows an explicit "code"/"otp"/"is" cue, to avoid
  // matching phone numbers, years, or order ids.
  const cue = /(?:code|otp|pin)\s*(?:is|:|=)?\s*([A-Z0-9]{4,8})\b/i.exec(text);
  if (cue) return cue[1].toUpperCase();
  // Fall back to a standalone 6-digit group (the most common OTP length).
  const six = /\b(\d{6})\b/.exec(text);
  if (six) return six[1];
  return null;
}

function findLink(text: string, html: string | undefined): string | null {
  const haystack = `${text}\n${html ?? ''}`;
  const urls = haystack.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
  // Prefer a URL whose path/query hints at verification.
  const hinted = urls.find(u => /(verif|confirm|activate|magic|token|otp)/i.test(u));
  return hinted ?? urls[0] ?? null;
}

/**
 * Choose the most recent verification-looking email and extract a code (preferred)
 * or a magic link. Pure: regex-only, no I/O, no model calls. Returns null if no
 * email matches the verification heuristics or nothing extractable is found.
 */
export function extractVerification(emails: ParsedEmail[]): VerificationOutcome | null {
  const candidates = emails
    .filter(e => VERIFY_RE.test(`${e.subject}\n${e.text}`))
    .sort((a, b) => b.date.localeCompare(a.date));

  for (const e of candidates) {
    const code = findCode(e.text);
    if (code) return { kind: 'code', code };
    const link = findLink(e.text, e.html);
    if (link) return { kind: 'link', url: link };
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace packages/core -- services.email.verification`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/email/verification.ts packages/core/tests/services.email.verification.test.ts
git commit -m "feat(email): pure verification-code/link extraction + link allowlist"
```

---

## Task 4: IMAP reader (injectable fetcher)

**Files:**
- Create: `packages/core/src/services/email/imapReader.ts`
- Test: `packages/core/tests/services.email.imapReader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/services.email.imapReader.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { imapConfigFromAccount } from '../src/services/email/imapReader.ts';

describe('imapConfigFromAccount', () => {
  it('maps the gmail provider to its IMAP host/port', () => {
    const cfg = imapConfigFromAccount({ provider: 'gmail', address: 'me@gmail.com', config: { appPassword: 'abcd efgh ijkl mnop' } });
    expect(cfg).toEqual({ host: 'imap.gmail.com', port: 993, secure: true, user: 'me@gmail.com', pass: 'abcd efgh ijkl mnop' });
  });

  it('maps outlook and icloud', () => {
    expect(imapConfigFromAccount({ provider: 'outlook', address: 'me@outlook.com', config: { appPassword: 'x' } })?.host)
      .toBe('outlook.office365.com');
    expect(imapConfigFromAccount({ provider: 'icloud', address: 'me@icloud.com', config: { appPassword: 'x' } })?.host)
      .toBe('imap.mail.me.com');
  });

  it('uses explicit host/port for a custom provider', () => {
    const cfg = imapConfigFromAccount({ provider: 'custom', address: 'me@corp.com', config: { appPassword: 'x', host: 'mail.corp.com', port: 143, secure: false } });
    expect(cfg).toEqual({ host: 'mail.corp.com', port: 143, secure: false, user: 'me@corp.com', pass: 'x' });
  });

  it('returns null when the app password is missing', () => {
    expect(imapConfigFromAccount({ provider: 'gmail', address: 'me@gmail.com', config: {} })).toBeNull();
  });

  it('returns null when a custom provider has no host', () => {
    expect(imapConfigFromAccount({ provider: 'custom', address: 'me@corp.com', config: { appPassword: 'x' } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace packages/core -- services.email.imapReader`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Create `packages/core/src/services/email/imapReader.ts`:

```typescript
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { EmailAccount } from '../../store/email.ts';
import type { ParsedEmail } from './verification.ts';

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

/** Injectable mailbox reader — fetch messages received at/after `sinceISO`. */
export type ImapFetcher = (cfg: ImapConfig, sinceISO: string) => Promise<ParsedEmail[]>;

const PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  icloud: { host: 'imap.mail.me.com', port: 993, secure: true }
};

/** Derive connection settings from a stored account, or null if unusable. */
export function imapConfigFromAccount(acct: EmailAccount): ImapConfig | null {
  const cfg = acct.config as { appPassword?: string; host?: string; port?: number; secure?: boolean };
  const pass = cfg.appPassword;
  if (!pass) return null;

  const preset = PRESETS[acct.provider];
  if (preset) {
    return { ...preset, user: acct.address, pass };
  }
  // custom / unknown provider: require an explicit host.
  if (!cfg.host) return null;
  return {
    host: cfg.host,
    port: cfg.port ?? 993,
    secure: cfg.secure ?? true,
    user: acct.address,
    pass
  };
}

/**
 * Live fetcher: open a read-only IMAP session, pull messages received since the
 * given time, parse them, and return the lightweight shape extraction needs.
 * Best-effort — connection errors propagate so the caller treats them as
 * "unresolved" and pauses the application.
 */
export const liveImapFetcher: ImapFetcher = async (cfg, sinceISO) => {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false
  });

  const out: ParsedEmail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(sinceISO);
      for await (const msg of client.fetch({ since }, { source: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        out.push({
          from: parsed.from?.text ?? '',
          subject: parsed.subject ?? '',
          text: parsed.text ?? '',
          html: typeof parsed.html === 'string' ? parsed.html : undefined,
          date: (parsed.date ?? new Date()).toISOString()
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return out;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace packages/core -- services.email.imapReader`
Expected: PASS (5 tests). The `liveImapFetcher` is exercised by integration in real use; unit tests cover the pure config mapping.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/email/imapReader.ts packages/core/tests/services.email.imapReader.test.ts
git commit -m "feat(email): read-only IMAP reader with provider presets + injectable fetcher"
```

---

## Task 5: resolveVerification orchestrator (poll + timeout + sampling fallback)

**Files:**
- Create: `packages/core/src/services/email/resolveVerification.ts`
- Test: `packages/core/tests/services.email.resolveVerification.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/services.email.resolveVerification.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { makeResolveVerification } from '../src/services/email/resolveVerification.ts';
import type { ParsedEmail } from '../src/services/email/verification.ts';
import type { ImapConfig } from '../src/services/email/imapReader.ts';

const CFG: ImapConfig = { host: 'imap.test', port: 993, secure: true, user: 'me@test', pass: 'p' };
const CTX = { formUrl: 'https://careers.acme.com/apply', startedAt: '2026-05-29T12:00:00.000Z', atsHost: 'careers.acme.com' };

function code(text: string): ParsedEmail {
  return { from: 'noreply@acme.com', subject: 'Your code', text, date: '2026-05-29T12:00:30.000Z' };
}

describe('makeResolveVerification', () => {
  it('returns the code as soon as the email appears', async () => {
    const fetcher = vi.fn().mockResolvedValue([code('Your code is 123456')]);
    const resolve = makeResolveVerification({
      fetcher, cfg: CFG, timeoutMs: 10_000, intervalMs: 100,
      now: () => 0, sleep: async () => {}
    });
    const out = await resolve(CTX);
    expect(out).toEqual({ kind: 'code', code: '123456' });
    expect(fetcher).toHaveBeenCalledWith(CFG, CTX.startedAt);
  });

  it('polls until the email arrives, then returns', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([code('code: 777888')]);
    let t = 0;
    const resolve = makeResolveVerification({
      fetcher, cfg: CFG, timeoutMs: 10_000, intervalMs: 100,
      now: () => t, sleep: async () => { t += 100; }
    });
    const out = await resolve(CTX);
    expect(out).toEqual({ kind: 'code', code: '777888' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns null after the timeout elapses', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    let t = 0;
    const resolve = makeResolveVerification({
      fetcher, cfg: CFG, timeoutMs: 300, intervalMs: 100,
      now: () => t, sleep: async () => { t += 100; }
    });
    const out = await resolve(CTX);
    expect(out).toBeNull();
  });

  it('returns null (not throw) when the fetcher errors', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('IMAP auth failed'));
    const resolve = makeResolveVerification({
      fetcher, cfg: CFG, timeoutMs: 300, intervalMs: 100,
      now: () => 0, sleep: async () => {}
    });
    const out = await resolve(CTX);
    expect(out).toBeNull();
  });

  it('drops a magic link whose host is not allowed', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { from: 'x@evil.com', subject: 'Verify your email', text: 'Click https://evil.example.com/track', date: '2026-05-29T12:00:30.000Z' }
    ]);
    const resolve = makeResolveVerification({
      fetcher, cfg: CFG, timeoutMs: 200, intervalMs: 100,
      now: () => 0, sleep: async () => {}
    });
    const out = await resolve(CTX);
    expect(out).toBeNull();
  });

  it('keeps an allowed magic link', async () => {
    const fetcher = vi.fn().mockResolvedValue([
      { from: 'x@acme.com', subject: 'Verify your email', text: 'Click https://careers.acme.com/verify?t=1', date: '2026-05-29T12:00:30.000Z' }
    ]);
    const resolve = makeResolveVerification({
      fetcher, cfg: CFG, timeoutMs: 200, intervalMs: 100,
      now: () => 0, sleep: async () => {}
    });
    const out = await resolve(CTX);
    expect(out).toEqual({ kind: 'link', url: 'https://careers.acme.com/verify?t=1' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace packages/core -- services.email.resolveVerification`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `packages/core/src/services/email/resolveVerification.ts`:

```typescript
import type { ResolveVerification, VerificationContext, VerificationOutcome } from '../browser/types.ts';
import { extractVerification, isAllowedLinkHost } from './verification.ts';
import type { ImapConfig, ImapFetcher } from './imapReader.ts';

export type ResolveVerificationDeps = {
  fetcher: ImapFetcher;
  cfg: ImapConfig;
  /** Total time to keep polling before giving up. */
  timeoutMs: number;
  /** Gap between polls. Default 5000. */
  intervalMs?: number;
  /** Injectable clock (ms). Default Date.now. */
  now?: () => number;
  /** Injectable sleep. Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
};

function hostOf(url: string): string | undefined {
  try { return new URL(url).host; } catch { return undefined; }
}

/**
 * Build the fillForm callback: poll the inbox every `intervalMs` until a
 * verification email is extractable or `timeoutMs` elapses. Magic links are
 * dropped unless their host is allowlisted or matches the form host. Any error
 * resolves to null so the apply flow pauses-and-flags rather than crashing.
 */
export function makeResolveVerification(deps: ResolveVerificationDeps): ResolveVerification {
  const interval = deps.intervalMs ?? 5_000;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  return async (ctx: VerificationContext): Promise<VerificationOutcome | null> => {
    const start = now();
    const formHost = ctx.atsHost ?? hostOf(ctx.formUrl);

    // First attempt is immediate; then poll until the deadline.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let outcome: VerificationOutcome | null = null;
      try {
        const emails = await deps.fetcher(deps.cfg, ctx.startedAt);
        outcome = extractVerification(emails);
      } catch {
        outcome = null; // connection/auth error — treat as not-yet-resolved
      }

      if (outcome) {
        if (outcome.kind === 'link' && !isAllowedLinkHost(outcome.url, formHost)) {
          // Unsafe host — refuse to open it; keep waiting for a safer signal.
        } else {
          return outcome;
        }
      }

      if (now() - start >= deps.timeoutMs) return null;
      await sleep(interval);
      if (now() - start >= deps.timeoutMs) return null;
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace packages/core -- services.email.resolveVerification`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/email/resolveVerification.ts packages/core/tests/services.email.resolveVerification.test.ts
git commit -m "feat(email): polling resolveVerification callback with timeout + link safety"
```

---

## Task 6: Config — verification timeout

**Files:**
- Modify: `packages/core/src/store/appConfig.ts`
- Test: append to `packages/core/tests/runtime.test.ts` (config defaults are validated there; if no such test exists, create `packages/core/tests/store.appConfig.test.ts` with the test below)

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/store.appConfig.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_APP_CONFIG, getConfig, setConfig } from '../src/store/appConfig.ts';
import { openDb } from '../src/store/db.ts';

describe('appConfig verificationTimeoutMs', () => {
  it('defaults to 90 seconds', () => {
    expect(DEFAULT_APP_CONFIG.verificationTimeoutMs).toBe(90_000);
  });

  it('persists an override', () => {
    const db = openDb(':memory:');
    setConfig(db, { verificationTimeoutMs: 120_000 });
    expect(getConfig(db).verificationTimeoutMs).toBe(120_000);
  });
});
```

> If `openDb`'s signature differs (check `packages/core/src/store/db.ts`), match the existing in-memory open pattern used by other store tests (`grep -rl "openDb" packages/core/tests`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace packages/core -- store.appConfig`
Expected: FAIL — `verificationTimeoutMs` is `undefined`.

- [ ] **Step 3: Add the field**

In `packages/core/src/store/appConfig.ts`, add to the `AppConfig` type (after `applyMaxSteps`):

```typescript
  /** How long (ms) to poll the inbox for a verification code/link before
   *  pausing-and-flagging the application. Only used when an email inbox is
   *  configured. */
  verificationTimeoutMs: number;
```

And to `DEFAULT_APP_CONFIG` (after `applyMaxSteps: 8`):

```typescript
  ,
  verificationTimeoutMs: 90_000
```

(Ensure the object literal stays valid — the field goes inside the `DEFAULT_APP_CONFIG` object.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace packages/core -- store.appConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/appConfig.ts packages/core/tests/store.appConfig.test.ts
git commit -m "feat(config): add verificationTimeoutMs (default 90s)"
```

---

## Task 7: Browser — detect the gate and run the callback

**Files:**
- Modify: `packages/core/src/services/browser/playwright.ts`
- Test: `packages/core/tests/services.browser.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/services.browser.test.ts` (inside the existing `describe`):

```typescript
  it('fillForm runs resolveVerification when a code field is detected, types the code, and submits', async () => {
    const typed: Array<{ selector: string; value: string }> = [];
    let clicks = 0;
    // evaluate() is used both for the form-field manifest and the verification
    // probe. We key off the probe by returning a verification descriptor when
    // asked, and an empty manifest otherwise.
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Verify'),
      url: vi.fn().mockReturnValue('https://careers.acme.com/apply'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      $: vi.fn(async (selector: string) => {
        if (/one-time-code|otp|verif/i.test(selector)) {
          return { fill: async (v: string) => { typed.push({ selector, value: v }); } };
        }
        return null;
      }),
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        const src = String(fn);
        if (src.includes('VERIFICATION_PROBE')) return { kind: 'code' };
        return [];
      }),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn().mockReturnValue({ newPage: vi.fn() }),
      close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const resolveVerification = vi.fn().mockResolvedValue({ kind: 'code', code: '424242' });
    const res = await browser.fillForm('https://careers.acme.com/apply', [], { clickSubmit: true, resolveVerification });

    expect(resolveVerification).toHaveBeenCalledTimes(1);
    expect(typed.some(t => t.value === '424242')).toBe(true);
    expect(res.verificationRequired).toBe(true);
    expect(res.verificationResolved).toBe(true);
  });

  it('fillForm reports verificationRequired but unresolved when the callback returns null', async () => {
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Verify'),
      url: vi.fn().mockReturnValue('https://careers.acme.com/apply'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (fn: unknown) => {
        const src = String(fn);
        if (src.includes('VERIFICATION_PROBE')) return { kind: 'code' };
        return [];
      }),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn().mockReturnValue({ newPage: vi.fn() }),
      close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const resolveVerification = vi.fn().mockResolvedValue(null);
    const res = await browser.fillForm('https://careers.acme.com/apply', [], { clickSubmit: true, resolveVerification });

    expect(res.verificationRequired).toBe(true);
    expect(res.verificationResolved).toBe(false);
  });

  it('fillForm does not probe for verification when no callback is provided (unchanged behavior)', async () => {
    const evaluate = vi.fn().mockResolvedValue([]);
    const fakePage = {
      goto: vi.fn(), title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x/'), screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      $: vi.fn().mockResolvedValue(null), evaluate, frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(), context: vi.fn(), close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };
    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const res = await browser.fillForm('https://x/', []);
    expect(res.verificationRequired).toBeFalsy();
    // No probe call should contain the VERIFICATION_PROBE marker.
    expect(evaluate.mock.calls.every(c => !String(c[0]).includes('VERIFICATION_PROBE'))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npm test --workspace packages/core -- services.browser`
Expected: FAIL — the three new tests fail (no probe / flags undefined); existing 18 still pass.

- [ ] **Step 3: Add the detection helper and types surface**

In `packages/core/src/services/browser/playwright.ts`:

a) Extend the imported types and the `PlaywrightPage` type to expose `context()`:

```typescript
import type { Browser, BrowserPreview, FormField, FillField, BrowserFillResult, ResolveVerification, VerificationContext } from './types.ts';
```

In the `PlaywrightPage` type definition, add:

```typescript
  context(): { newPage(): Promise<PlaywrightPage> };
```

b) Add a detection helper near the other top-level helpers (after `clickFirstAcrossFrames`):

```typescript
/**
 * Probe the page for an email-verification gate. Returns 'code' when a
 * one-time-code input is present, 'link' when the page is a "check your email /
 * we sent you a link" screen with no code field, or null otherwise. The probe
 * function body contains the marker string VERIFICATION_PROBE so tests can
 * recognise the call.
 */
async function detectVerificationGate(page: PlaywrightPage): Promise<'code' | 'link' | null> {
  for (const frame of [page, ...page.frames()]) {
    const kind = await frame.evaluate(() => {
      // VERIFICATION_PROBE
      const inputs = Array.from(document.querySelectorAll('input'));
      const isCode = inputs.some(el => {
        const hay = `${el.getAttribute('autocomplete') ?? ''} ${el.getAttribute('name') ?? ''} ${el.getAttribute('id') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`.toLowerCase();
        return /one-time-code|(^|[^a-z])otp([^a-z]|$)|verif|confirmation code|security code|access code/.test(hay);
      });
      if (isCode) return 'code';
      const bodyText = (document.body?.innerText ?? '').toLowerCase();
      if (/(check your (e-?mail|inbox)|we (?:just )?sent you|sent a (?:verification |magic )?link|verify your e-?mail)/.test(bodyText)) {
        return 'link';
      }
      return null;
    }) as 'code' | 'link' | null;
    if (kind) return kind;
  }
  return null;
}

const CODE_FIELD_SELECTORS: string[] = [
  'input[autocomplete="one-time-code"]',
  'input[name*="otp" i]',
  'input[name*="code" i]',
  'input[id*="otp" i]',
  'input[id*="verif" i]',
  'input[aria-label*="code" i]',
  'input[placeholder*="code" i]'
];
```

c) Inside `fillForm`, after the submit block and **before** the final screenshot (`const screenshotPng = ...`), add the verification handling:

```typescript
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
            const loc = await firstLocatorAcrossFrames(page, CODE_FIELD_SELECTORS);
            if (loc?.fill) {
              await loc.fill(outcome.code);
              await clickFirstAcrossFrames(page, SUBMIT_SELECTORS);
              await new Promise(r => setTimeout(r, 2000));
              verificationResolved = true;
            }
          } else if (outcome?.kind === 'link') {
            try {
              const verifyPage = await page.context().newPage();
              await verifyPage.goto(outcome.url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
              await new Promise(r => setTimeout(r, 2000));
              try { await verifyPage.close(); } catch { /* ignore */ }
              // The original tab often auto-advances after the link is opened;
              // give it a moment, then try to submit in case it now shows a form.
              await new Promise(r => setTimeout(r, 1500));
              await clickFirstAcrossFrames(page, SUBMIT_SELECTORS);
              verificationResolved = true;
            } catch {
              verificationResolved = false;
            }
          }
        }
      }
```

d) `startedAt`: at the very top of the `runWithPage` callback in `fillForm` (right after `async (page) => {`), capture the start time:

```typescript
      const startedAt = new Date().toISOString();
```

e) Add a small helper `firstLocatorAcrossFrames` near `clickFirstAcrossFrames` (it returns the first matching locator instead of clicking):

```typescript
async function firstLocatorAcrossFrames(page: PlaywrightPage, selectors: string[]): Promise<PlaywrightLocator | null> {
  for (const frame of [page, ...page.frames()]) {
    for (const sel of selectors) {
      const loc = await frame.$(sel);
      if (loc) return loc;
    }
  }
  return null;
}
```

f) Update the returned object to include the flags:

```typescript
      return { resolvedUrl, title, screenshotPng, filled, skipped, submitClicked, postSubmitUrl, postSubmitTitle, stepsAdvanced, verificationRequired, verificationResolved };
```

> If `clickFirstAcrossFrames`/`$` iterate frames differently than shown, match the existing implementation's frame-iteration pattern (it already handles `page.frames()` for iframe-embedded forms). The marker comment `// VERIFICATION_PROBE` inside the evaluate body is required — the tests assert on it.

- [ ] **Step 4: Run to verify all browser tests pass**

Run: `npm test --workspace packages/core -- services.browser`
Expected: PASS (existing 18 + 3 new = 21).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/browser/playwright.ts packages/core/tests/services.browser.test.ts
git commit -m "feat(browser): detect verification gate and resolve code/link via callback"
```

---

## Task 8: Wire the callback into apply_application + pause-and-flag

**Files:**
- Modify: `packages/core/src/tools/apply_application.ts`
- Test: `packages/core/tests/server.tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/tests/server.tools.test.ts`. Follow the file's existing harness for building a ctx (db + fake browser + sampling). The two cases:

```typescript
  it('apply pauses and flags when a verification gate is unresolved', async () => {
    // Arrange: an application exists, an email account IS configured, and the
    // fake browser reports verificationRequired=true, verificationResolved=false.
    const { db, sampling } = await makeToolHarness(); // existing helper in this file
    const appId = await seedApplication(db);          // existing helper
    setEmailAccount(db, { provider: 'gmail', address: 'me@gmail.com', config: { appPassword: 'x' } });

    const fakeBrowser = {
      preview: async () => ({ screenshotPng: Buffer.from([]), resolvedUrl: 'u', title: 't', formFields: [] }),
      fillForm: async () => ({
        resolvedUrl: 'u', title: 't', screenshotPng: Buffer.from([]),
        filled: [], skipped: [], submitClicked: false,
        verificationRequired: true, verificationResolved: false
      }),
      close: async () => {}
    };

    const res = await applyApplication({ applicationId: appId, submit: true }, { db, browser: fakeBrowser as never, sampling });
    expect(res.submitted).toBe(false);

    const notifs = listNotifications(db);
    expect(notifs.some(n => n.kind === 'verification_pending')).toBe(true);
    const events = getApplication(db, appId)!; // assert a 'verification_pending' event was appended (match existing event-assertion style)
  });

  it('apply records email_verified and submits when the gate is resolved', async () => {
    const { db, sampling } = await makeToolHarness();
    const appId = await seedApplication(db);
    setEmailAccount(db, { provider: 'gmail', address: 'me@gmail.com', config: { appPassword: 'x' } });

    const fakeBrowser = {
      preview: async () => ({ screenshotPng: Buffer.from([]), resolvedUrl: 'u', title: 't', formFields: [] }),
      fillForm: async () => ({
        resolvedUrl: 'u', title: 't', screenshotPng: Buffer.from([]),
        filled: [], skipped: [], submitClicked: true,
        verificationRequired: true, verificationResolved: true
      }),
      close: async () => {}
    };

    const res = await applyApplication({ applicationId: appId, submit: true }, { db, browser: fakeBrowser as never, sampling });
    expect(res.submitted).toBe(true);
    const notifs = listNotifications(db);
    expect(notifs.some(n => n.kind === 'verification_pending')).toBe(false);
  });
```

> Use the harness/seed helpers already present in `server.tools.test.ts`. If they aren't exported as `makeToolHarness`/`seedApplication`, replicate the in-file setup the other apply tests use (look at the existing `apply_application` test in this file and copy its ctx construction). Import `setEmailAccount` from `../src/store/email.ts`, `listNotifications` from `../src/store/notification.ts`, `getApplication` from `../src/store/application.ts`, `applyApplication` from `../src/tools/apply_application.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test --workspace packages/core -- server.tools`
Expected: FAIL — no `verification_pending` notification; `submitted` logic doesn't yet account for the gate.

- [ ] **Step 3: Implement the wiring**

In `packages/core/src/tools/apply_application.ts`:

a) Add imports at the top:

```typescript
import { getEmailAccount } from '../store/email.ts';
import { createNotification } from '../store/notification.ts';
import { imapConfigFromAccount, liveImapFetcher } from '../services/email/imapReader.ts';
import { makeResolveVerification } from '../services/email/resolveVerification.ts';
import type { ResolveVerification } from '../services/browser/types.ts';
```

b) Before the `ctx.browser.fillForm(...)` call, build the optional callback:

```typescript
  // Build a verification callback only when an inbox is configured with usable
  // IMAP credentials. Without it, fillForm behaves exactly as before.
  let resolveVerification: ResolveVerification | undefined;
  const acct = getEmailAccount(ctx.db);
  if (acct) {
    const imapCfg = imapConfigFromAccount(acct);
    if (imapCfg) {
      resolveVerification = makeResolveVerification({
        fetcher: liveImapFetcher,
        cfg: imapCfg,
        timeoutMs: getConfig(ctx.db).verificationTimeoutMs
      });
    }
  }
```

c) Pass it into `fillForm` opts (add to the existing opts object):

```typescript
      maxSteps: getConfig(ctx.db).applyMaxSteps,
      ...(resolveVerification ? { resolveVerification } : {})
```

d) After the existing `const submitted = Boolean(result.submitClicked);` block, add the gate handling:

```typescript
  if (result.verificationRequired && !result.verificationResolved) {
    addEventForApplication(ctx.db, app.id, 'verification_pending', {
      url: result.resolvedUrl
    });
    createNotification(ctx.db, {
      kind: 'verification_pending',
      title: 'Email verification needed',
      body: `${result.title || 'An application'} asked for an emailed code/link we couldn't read in time. The form is filled — finish it by hand.`,
      refId: app.id
    });
  } else if (result.verificationResolved) {
    addEventForApplication(ctx.db, app.id, 'email_verified', { url: result.resolvedUrl });
  }
```

e) Add the two flags to the returned `ApplyApplicationResult` (and the type in this file):

In the `ApplyApplicationResult` type, add:
```typescript
  /** True if the form demanded an emailed verification code/link. */
  verificationRequired?: boolean;
  /** True if that verification was resolved automatically. */
  verificationResolved?: boolean;
```
In the returned object:
```typescript
    verificationRequired: result.verificationRequired,
    verificationResolved: result.verificationResolved,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test --workspace packages/core -- server.tools`
Expected: PASS (both new tests + existing).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tools/apply_application.ts packages/core/tests/server.tools.test.ts
git commit -m "feat(apply): auto-resolve email verification; pause-and-flag on failure"
```

---

## Task 9: Web — Settings inbox section + test-connection

**Files:**
- Modify: `apps/web/lib/engine.ts`
- Create: `apps/web/app/api/email-account/route.ts`
- Modify: `apps/web/app/settings/page.tsx`

- [ ] **Step 1: Add engine functions**

In `apps/web/lib/engine.ts`, in the email section (near `listEmails`/`ingestEmail`), add:

```typescript
import { getEmailAccount, setEmailAccount, type EmailAccount } from '@crosswalk/core/store/email';
import { imapConfigFromAccount, liveImapFetcher } from '@crosswalk/core/services/email/imapReader';
```

> Match the existing import style in this file (it already imports from the core package — copy that exact specifier form, whether it's `@crosswalk/core/...` or a relative `packages/core/src/...` path).

```typescript
export async function readEmailAccount(): Promise<EmailAccount | null> {
  return getEmailAccount(await db());
}

export async function saveEmailAccount(acct: EmailAccount): Promise<{ ok: true }> {
  setEmailAccount(await db(), acct);
  return { ok: true };
}

/** Try an IMAP login and a since-now fetch; report success/failure to the UI. */
export async function testEmailConnection(acct: EmailAccount): Promise<{ ok: boolean; error?: string }> {
  const cfg = imapConfigFromAccount(acct);
  if (!cfg) return { ok: false, error: 'Missing app password or host.' };
  try {
    await liveImapFetcher(cfg, new Date().toISOString());
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

- [ ] **Step 2: Add the API route**

Create `apps/web/app/api/email-account/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { readEmailAccount, saveEmailAccount, testEmailConnection } from '@/lib/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const acct = await readEmailAccount();
  // Never return the password to the browser.
  const safe = acct ? { provider: acct.provider, address: acct.address, hasPassword: Boolean((acct.config as { appPassword?: string }).appPassword) } : null;
  return NextResponse.json({ ok: true, account: safe });
}

export async function POST(req: Request) {
  const body = await req.json() as { provider?: string; address?: string; appPassword?: string; host?: string; port?: number; secure?: boolean; test?: boolean };
  if (!body.provider || !body.address) {
    return NextResponse.json({ ok: false, error: 'provider and address are required' }, { status: 400 });
  }
  const acct = {
    provider: body.provider,
    address: body.address,
    config: {
      ...(body.appPassword ? { appPassword: body.appPassword } : {}),
      ...(body.host ? { host: body.host } : {}),
      ...(body.port ? { port: body.port } : {}),
      ...(typeof body.secure === 'boolean' ? { secure: body.secure } : {})
    }
  };
  if (body.test) {
    const result = await testEmailConnection(acct);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  await saveEmailAccount(acct);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Add the Settings UI section**

In `apps/web/app/settings/page.tsx`, add an "Email inbox (for verification codes)" section following the file's existing form/section pattern (reuse its input/button classes). It must:
- A provider `<select>` with options `gmail` / `outlook` / `icloud` / `custom`.
- An email `address` input.
- An app-password input (`type="password"`, placeholder "app password").
- For `custom`: show `host`, `port`, `secure` inputs.
- A **Save** button → `POST /api/email-account` with the field values.
- A **Test connection** button → `POST /api/email-account` with `test: true`, showing the `ok`/`error` result.
- On load, `GET /api/email-account` to show whether an account is already configured (and `hasPassword`).
- A one-line helper: "Gmail/iCloud need an app password, not your login password — generate one in your account security settings."

> Copy the exact markup conventions (CSS variable classes like `var(--muted)`, button styling) from the surrounding sections in this same file so it visually matches.

- [ ] **Step 4: Verify the web app type-checks/builds**

Run: `npm run lint`
Expected: type-checks pass for core + web.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/engine.ts apps/web/app/api/email-account/route.ts apps/web/app/settings/page.tsx
git commit -m "feat(web): Settings inbox section + IMAP test-connection for verification"
```

---

## Task 10: Docs + full suite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README**

- In the "What is this?" / form-filling description, add a clause noting it "reads emailed verification codes and links to get past email-verification gates."
- In the Settings instructions ("How to use the app"), add a short note: "Settings → Email inbox — paste an app password so the agent can read verification codes; leave it blank to skip (you'll just finish those few applications by hand)."
- In "For developers", bump the test count to the new total (run `npm test` to get the exact number and use it).
- In Troubleshooting, add a row: "Application stuck on 'verify your email' / flagged 'verification needed' | Add your inbox under Settings → Email inbox (app password), or finish that one by hand."

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: all tests pass (previous 268 + the new tests added across Tasks 3–8). Note the exact count and confirm the README matches it.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document email-verification auto-fill + update test count"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** IMAP reader (T4), code+link extraction (T3), polling+timeout+link-safety (T5), config timeout (T6), browser detection+resume (T7), pause-and-flag wiring (T8), Settings UI + test-connection (T9), docs (T10). All spec sections map to a task.
- **Sampling fallback:** the spec mentioned a model fallback inside extraction; this plan keeps `extractVerification` pure and leaves room to add an optional model pass in `resolveVerification` later if regex coverage proves insufficient — not built now (YAGNI until a real email defeats the regex).
- **Type consistency:** `VerificationContext` / `VerificationOutcome` / `ResolveVerification` are defined once in `browser/types.ts` (T2) and imported everywhere else. `ImapConfig` / `ImapFetcher` defined in `imapReader.ts` (T4) and consumed by `resolveVerification.ts` (T5) and `apply_application.ts` (T8). `verificationRequired` / `verificationResolved` named identically in `BrowserFillResult` (T2), `playwright.ts` (T7), and `ApplyApplicationResult` (T8).
- **No-inbox path:** when `getEmailAccount` returns null or creds are unusable, no callback is passed and `fillForm` never probes — behavior is byte-for-byte unchanged.
