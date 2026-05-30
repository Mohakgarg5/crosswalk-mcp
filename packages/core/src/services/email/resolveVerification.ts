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
        outcome = extractVerification(emails, { preferHost: formHost });
      } catch {
        outcome = null; // connection/auth error — treat as not-yet-resolved
      }

      if (outcome) {
        // A code is always safe; a link is only safe if its host is allowlisted
        // or matches the form. An unsafe link → keep waiting for a safer signal.
        const safe = outcome.kind !== 'link' || isAllowedLinkHost(outcome.url, formHost);
        if (safe) return outcome;
      }

      if (now() - start >= deps.timeoutMs) return null;
      const before = now();
      await sleep(interval);
      if (now() - start >= deps.timeoutMs) return null;
      // Frozen clock (e.g. tests with a constant `now`): sleep advanced no time,
      // so further polling would spin forever. One immediate attempt is enough.
      if (now() === before) return null;
    }
  };
}
