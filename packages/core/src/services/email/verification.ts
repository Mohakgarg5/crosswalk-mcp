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
  // Strip trailing sentence punctuation an email's prose leaves on a URL
  // ("...verify at https://x/y?t=abc." → drops the period), which would
  // otherwise hand the browser a broken link.
  const urls = (haystack.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [])
    .map(u => u.replace(/[.,!?;:'")\]>]+$/, ''));
  // Only return a URL that actually hints at verification. We do NOT fall back
  // to "the first URL in the email" — a "confirm your order"-style message can
  // pass the subject filter, and its first link (unsubscribe, view-order) is
  // not a verification link. No hint → null → the apply flow pauses and flags.
  return urls.find(u => /(verif|confirm|activate|magic|token|otp)/i.test(u)) ?? null;
}

/**
 * Choose the most recent verification-looking email and extract a code (preferred)
 * or a magic link. Pure: regex-only, no I/O, no model calls. Returns null if no
 * email matches the verification heuristics or nothing extractable is found.
 */
export function extractVerification(emails: ParsedEmail[]): VerificationOutcome | null {
  const candidates = emails
    .filter(e => VERIFY_RE.test(`${e.subject}\n${e.text}`))
    // Most-recent first. Plain `<`/`>` on ISO-8601 strings is lexicographic =
    // chronological and locale-independent (unlike localeCompare).
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  for (const e of candidates) {
    const code = findCode(e.text);
    if (code) return { kind: 'code', code };
    const link = findLink(e.text, e.html);
    if (link) return { kind: 'link', url: link };
  }
  return null;
}
