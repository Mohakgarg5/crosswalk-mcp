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

/** Crude tag/entity strip so HTML-only email bodies are searchable as text. */
function stripHtml(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ');
}

/** Plain text + a text rendering of the HTML body (NOT the subject — a subject
 *  like "Your verification code" would otherwise pollute the code cue match). */
function messageBody(e: ParsedEmail): string {
  return `${e.text}\n${stripHtml(e.html)}`;
}

/** Subject + body — used only for the verification keyword filter and host match. */
function searchableAll(e: ParsedEmail): string {
  return `${e.subject}\n${messageBody(e)}`;
}

/** Last two labels of a host, e.g. "boards.greenhouse.io" -> "greenhouse.io". */
function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

/** ISO date → epoch ms, 0 for anything unparseable (so it sorts oldest). */
function dateMs(d: string): number {
  const n = Date.parse(d);
  return Number.isNaN(n) ? 0 : n;
}

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

function findCode(body: string): string | null {
  // Prefer a code that follows an explicit "code"/"otp"/"is" cue, to avoid
  // matching phone numbers, years, or order ids.
  const cue = /(?:code|otp|pin)\s*(?:is|:|=)?\s*([A-Z0-9]{4,8})\b/i.exec(body);
  if (cue) return cue[1].toUpperCase();
  // Fall back to a standalone 6-digit group (the most common OTP length).
  const six = /\b(\d{6})\b/.exec(body);
  if (six) return six[1];
  return null;
}

function findLink(body: string): string | null {
  const urls = (body.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [])
    // Strip trailing sentence punctuation an email's prose leaves on a URL
    // ("...verify at https://x/y?t=abc." → drops the period), which would
    // otherwise hand the browser a broken link.
    .map(u => u.replace(/[.,!?;:'")\]>]+$/, ''));
  // Only return a URL that actually hints at verification. We do NOT fall back
  // to "the first URL in the email" — a "confirm your order"-style message can
  // pass the subject filter, and its first link (unsubscribe, view-order) is
  // not a verification link. No hint → null → the apply flow pauses and flags.
  return urls.find(u => /(verif|confirm|activate|magic|token|otp)/i.test(u)) ?? null;
}

export type ExtractOpts = {
  /** Host of the form being applied to. When set, emails whose sender or body
   *  mention that registrable domain are preferred — reduces the chance of
   *  grabbing a code minted for a different in-flight application. */
  preferHost?: string;
};

/**
 * Choose the best verification-looking email and extract a code (preferred) or
 * a magic link. Pure: regex-only, no I/O, no model calls. Returns null if no
 * email matches the verification heuristics or nothing extractable is found.
 *
 * Candidate order: emails matching `preferHost` first, then most-recent.
 */
export function extractVerification(emails: ParsedEmail[], opts: ExtractOpts = {}): VerificationOutcome | null {
  const domain = opts.preferHost ? registrableDomain(opts.preferHost) : '';
  const matchesHost = (e: ParsedEmail): boolean =>
    domain.length > 0 && `${e.from}\n${searchableAll(e)}`.toLowerCase().includes(domain);

  const candidates = emails
    .filter(e => VERIFY_RE.test(searchableAll(e)))
    .sort((a, b) => {
      // Host-matching emails win; otherwise most-recent first.
      const ah = matchesHost(a) ? 1 : 0;
      const bh = matchesHost(b) ? 1 : 0;
      if (ah !== bh) return bh - ah;
      return dateMs(b.date) - dateMs(a.date);
    });

  for (const e of candidates) {
    const body = messageBody(e);
    const code = findCode(body);
    if (code) return { kind: 'code', code };
    const link = findLink(body);
    if (link) return { kind: 'link', url: link };
  }
  return null;
}
