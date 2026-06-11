import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';
import { scoreFit } from '../tools/score_fit.ts';
import { getCachedFit } from '../store/fitScoreCache.ts';
import { listResumes } from '../store/resume.ts';

export type FitGateDeps = { db: Db; sampling: SamplingClient };
export type FitGateOpts = { resumeId?: string; minFit: number };
export type FitGateResult = { kept: string[]; considered: number; scores: Record<string, number> };

/**
 * Score each new job against a résumé and keep only those at or above `minFit`.
 * This is the autonomous-loop "best jobs for my skills" gate: it stops the
 * watcher from auto-applying to title-keyword matches that don't actually fit.
 *
 * - Uses the existing scoreFit (which writes the fit-score cache).
 * - Reuses a cached score for the same (job, résumé) pair instead of paying to
 *   re-score (cheap + idempotent across watcher passes).
 * - With no resumeId, scoreFit falls back to the first résumé; we resolve that
 *   same résumé id here so the cache lookup keys correctly.
 */
export async function scoreAndGate(
  deps: FitGateDeps,
  jobIds: string[],
  opts: FitGateOpts
): Promise<FitGateResult> {
  const resumeId = opts.resumeId ?? listResumes(deps.db)[0]?.id;
  const kept: string[] = [];
  const scores: Record<string, number> = {};

  for (const jobId of jobIds) {
    let score: number | undefined;
    if (resumeId) {
      const cached = getCachedFit(deps.db, jobId, resumeId);
      if (cached) score = cached.score;
    }
    if (score === undefined) {
      try {
        const out = await scoreFit({ jobId, resumeId }, deps);
        score = out.score;
      } catch {
        // A scoring failure (e.g. transient AI error) must not drop the job
        // permanently — skip it this pass; the next watcher pass retries.
        continue;
      }
    }
    scores[jobId] = score;
    if (score >= opts.minFit) kept.push(jobId);
  }

  return { kept, considered: jobIds.length, scores };
}
