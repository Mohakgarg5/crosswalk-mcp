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

  it('strips trailing sentence punctuation from a magic link', () => {
    const out = extractVerification([email({
      subject: 'Verify your email',
      text: 'Please verify at https://login.microsoftonline.com/verify?token=abc123.'
    })]);
    expect(out).toEqual({ kind: 'link', url: 'https://login.microsoftonline.com/verify?token=abc123' });
  });

  it('does not return a non-verification first URL when the subject only matched "confirm"', () => {
    // "confirm your order" passes the keyword filter, but its links are not
    // verification links — extraction must yield null, not the unsubscribe URL.
    const out = extractVerification([email({
      from: 'orders@shop.com',
      subject: 'Confirm your order',
      text: 'Thanks! View your order at https://shop.com/orders/123 or https://shop.com/unsubscribe'
    })]);
    expect(out).toBeNull();
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
    // Subject matches the verification filter so the email reaches findCode —
    // this exercises findCode's rejection of an 11-digit phone and a 4-digit
    // year, rather than passing vacuously on the subject filter.
    const out = extractVerification([email({ subject: 'Your verification code', text: 'Call 18005551234 in 2026.' })]);
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
