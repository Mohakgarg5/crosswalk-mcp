# Email Verification Auto-Fill — Design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)

## Problem

Some application platforms interrupt the apply flow with an email verification
gate: "enter the code we emailed you" or "click the link we emailed you." Today
the agent stalls at that gate — it has no way to read the inbox, so the
application never completes without a human. We want this to be hands-off: when
the gate appears, the agent reads the verification email, enters the code (or
opens the magic link), and finishes submitting.

## Goals

- During auto-apply, detect an email-verification gate (code field or
  magic-link screen).
- Read the verification email over IMAP, extract the code or link, complete the
  step, and continue to submit — all within one live browser session.
- Handle **both** verification flavors: one-time codes and magic links.
- On any failure (no email in time, unreadable, unsafe link), **pause and flag**
  the application: leave the form filled, do not submit, raise a notification.
- Zero behavior change when no email inbox is configured.

## Non-goals

- No active background inbox polling for recruiter mail (the existing push-based
  `/api/email` ingest and `emailRouter` are unchanged).
- No OAuth/Gmail-API integration. IMAP + app password only.
- No opening of arbitrary links from email (host-allowlisted only).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Inbox access | IMAP + app password (universal, local-first) |
| Verification types | Codes **and** magic links |
| Failure behavior | Pause the application + flag for the user |
| Integration shape | Verification callback injected into `fillForm` (Approach A) |

Approach A was chosen because `fillForm` already runs the entire fill→submit
sequence inside a single `runWithPage(page => …)` closure
(`packages/core/src/services/browser/playwright.ts`), so the page stays live for
the whole call. We can pause inside that closure, fetch the code, and resume on
the same page — no cross-call browser lifecycle needed. The browser layer stays
ignorant of email; the email layer stays ignorant of Playwright; both are
testable with injected fakes.

## Architecture

### New — email-reading layer (no Playwright knowledge)

- **`services/email/imapReader.ts`** — connects read-only over IMAP using the
  stored account credentials and fetches messages received since a timestamp,
  lightly pre-filtered by sender domain / subject keywords. Built on `imapflow`
  + `mailparser` (new workspace deps). The low-level connect/fetch is injectable
  so tests pass a fake fetcher and touch no network.
- **`services/email/verification.ts`** — pure function. Given a batch of recent
  emails (+ optional domain hint from the form URL), select the verification
  email and extract `{ kind: 'code', code }` (regex for a 4–8 char OTP) or
  `{ kind: 'link', url }` (a verify/confirm anchor). Returns `null` if nothing
  matches. **Implemented as pure regex only — no model fallback** (kept simple
  per YAGNI; an ambiguous email the regex can't parse falls through to
  pause-and-flag, the documented failure mode). A `SamplingClient` fallback can
  be added later if real emails defeat the regex.
- **`services/email/resolveVerification.ts`** — orchestrator that becomes the
  callback. Polls `imapReader` every ~5s from when the apply began, up to a
  configurable timeout (default 90s), runs `verification.ts`, and returns the
  result or `null` on timeout.

### Changed — browser layer

- **`services/browser/types.ts`**
  - `fillForm` opts gain optional
    `resolveVerification?: (ctx: VerificationContext) => Promise<VerificationResult | null>`.
  - `VerificationContext = { formUrl: string; startedAt: string; atsHost?: string }`.
  - `VerificationResult = { kind: 'code'; code: string } | { kind: 'link'; url: string }`.
  - `BrowserFillResult` gains `verificationRequired: boolean` and
    `verificationResolved: boolean`.
- **`services/browser/playwright.ts`** — after the fill/submit step, detect a
  verification screen:
  - **Code field:** an input whose `name`/`label`/`autocomplete` matches
    `one-time-code` / `otp` / `verification` / `confirm code`.
  - **Magic-link screen:** a panel with "check your email" / "we sent you a
    link" copy and no submittable form field.

  If detected and `resolveVerification` is provided, call it. On a **code**, type
  it into the field and click continue/submit. On a **link**, open it in the
  **same browser context** (host-allowlisted, see Error handling), wait, return
  to the form, and submit. Re-screenshot. Set `verificationRequired` /
  `verificationResolved` accordingly. If no callback is provided, set
  `verificationRequired` from detection and leave `verificationResolved = false`
  (unchanged outward behavior — the form is simply left at the gate).

### Changed — apply tool & wiring

- **`tools/apply_application.ts`** — build the `resolveVerification` callback
  from the stored email account + the sampling client, and pass it into
  `fillForm`. After the call:
  - `verificationRequired && !verificationResolved` → do **not** mark submitted;
    add a `verification_pending` event and a notification (the pause-and-flag
    behavior). Form is left filled.
  - resolved & submitted → add an `email_verified` event and follow the normal
    submitted path.

### Changed — config & UI

- **`store/appConfig.ts`** — add `verificationTimeoutMs` (default `90000`). The
  feature is active only when an email account with IMAP credentials exists;
  otherwise the callback is absent and behavior is byte-for-byte unchanged.
- **`apps/web` Settings** — a new "Email inbox (for verification codes)"
  section: provider dropdown (Gmail / Outlook / iCloud / Custom IMAP — prefills
  host/port), address, app password, and a **Test connection** button. Persisted
  via the existing `setEmailAccount`. Include a short note on generating an app
  password.

## Data flow

```
apply_application
  → fillForm(url, fields, { clickSubmit, maxSteps, resolveVerification })
      → fill loop → click Next/Submit
      → detect verification screen?
          yes → resolveVerification({ formUrl, startedAt, atsHost })
                  → imapReader.fetchSince(startedAt)   (poll 5s × up to 90s)
                  → verification.extract(emails, hint)
                  → { code } | { link } | null
              code → type into field → click submit/continue
              link → open in same context (allowlisted host) → return → submit
      → result { verificationRequired, verificationResolved, submitClicked }
  → records: email_verified / verification_pending event, notification, status
```

The entire verification round-trip happens inside the one live `runWithPage`
closure, so the form session never drops.

## Error handling & link safety

- IMAP connect fails, timeout hits, or extraction returns `null` → callback
  returns `null` → treated as **unresolved** → pause + flag (notification carries
  the reason), form left filled, not submitted.
- **Magic-link safety:** only open a link whose host matches the application's
  domain or a small allowlist of known ATS / identity hosts (greenhouse, lever,
  ashby, workday, smartrecruiters, workable, accounts.google,
  login.microsoftonline). Any other host → skip, treat as unresolved, flag with
  the reason. Never open arbitrary URLs from email.
- The app password is stored in `~/.crosswalk/config.json` — the same local-only,
  gitignored location as the Anthropic API key. No new exfiltration surface.

## Testing

Mirrors the existing vitest patterns (see `tests/services.browser.test.ts`):

- `imapReader` with an injected fake fetcher (no network).
- `verification.ts` units: numeric code, alphanumeric code, magic-link
  extraction, sampling fallback, no-match → `null`.
- `resolveVerification` polling + timeout (injected clock/fetcher).
- `fillForm` verification path with a fake page + injected callback — code path
  **and** link path — plus the "no callback → unchanged" path.
- `apply_application`: `verificationRequired && !resolved` → notification + no
  submit; resolved → submitted + `email_verified` event.

## Backwards compatibility

No email account configured → no callback passed → `fillForm` behaves exactly as
today. Existing applications, profiles, answer bank, and the push-based recruiter
inbox are untouched. New deps (`imapflow`, `mailparser`) are the only additions.
