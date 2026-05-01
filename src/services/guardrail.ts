import type { Db } from '../store/db.ts';

export const WEEKLY_CAP = 10;
export const WEEKLY_WINDOW_MS = 7 * 86400_000;

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

  return { allowed: true, warnings };
}
