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
