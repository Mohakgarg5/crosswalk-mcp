import type { Db } from '../store/db.ts';
import { getCachedFit } from '../store/fitScoreCache.ts';

export const WEEKLY_CAP = 10;
export const WEEKLY_WINDOW_MS = 7 * 86400_000;
export const LOW_FIT_THRESHOLD = 0.50;

export type GuardrailInput = {
  jobId: string;
  resumeId: string;
  allowDuplicate?: boolean;
  confirmLowFit?: boolean;  // reserved for M4 live-fit gate
};

export type GuardrailResult =
  | { allowed: true; warnings: string[] }
  | { allowed: false; reason: string };

export function checkGuardrail(db: Db, input: GuardrailInput): GuardrailResult {
  const warnings: string[] = [];

  // 1. Weekly cap
  const cutoff = new Date(Date.now() - WEEKLY_WINDOW_MS).toISOString();
  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM application
     WHERE created_at >= ?
       AND status IN ('submitted', 'interviewing', 'rejected', 'offer')`
  ).get(cutoff) as { n: number }).n;
  if (count >= WEEKLY_CAP) {
    return {
      allowed: false,
      reason: `weekly cap reached (${count}/${WEEKLY_CAP} in the last 7 days). Quality > quantity — review your pipeline before adding more.`
    };
  }
  if (count >= Math.floor(WEEKLY_CAP * 0.8)) {
    warnings.push(`approaching weekly cap (${count}/${WEEKLY_CAP})`);
  }

  // 2. Duplicate detection
  if (!input.allowDuplicate) {
    const dup = db.prepare(`
      SELECT id, status FROM application
      WHERE job_id = ? AND status != 'rejected'
      LIMIT 1
    `).get(input.jobId) as { id: string; status: string } | undefined;
    if (dup) {
      return {
        allowed: false,
        reason: `already drafted an application (${dup.id}, status=${dup.status}) for this job. Pass allowDuplicate=true to override.`
      };
    }
  }

  // 3. Live-fit gate: refuse drafts where cached fit < threshold,
  //    unless caller explicitly confirms.
  if (!input.confirmLowFit && input.resumeId) {
    const cached = getCachedFit(db, input.jobId, input.resumeId);
    if (cached && cached.score < LOW_FIT_THRESHOLD) {
      return {
        allowed: false,
        reason: `low fit (${cached.score.toFixed(2)}) for this job/resume pair. Run score_fit to get an updated estimate, pick a stronger resume, or pass confirmLowFit=true to override.`
      };
    }
  }

  return { allowed: true, warnings };
}
