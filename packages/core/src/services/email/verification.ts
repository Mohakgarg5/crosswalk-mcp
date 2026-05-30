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
