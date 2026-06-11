import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';
import type { Browser } from './browser/types.ts';
import { buildApplication } from './buildApplication.ts';
import { applyApplication } from '../tools/apply_application.ts';
import { createNotification, enqueueNeedsAction } from '../store/notification.ts';
import { getJob } from '../store/job.ts';

export type AutoApplyDeps = { db: Db; sampling: SamplingClient; browser: Browser };

export type AutoApplyOptions = {
  jobIds: string[];
  /** When true, click submit after filling. When false, fill + leave for review. */
  submit: boolean;
  allowDuplicate?: boolean;
  /** Résumé to tailor from for every job in this batch. Omit → auto-pick per job. */
  resumeId?: string;
  /** Per-watch weekly cap override passed to the guardrail. Omit → global cap. */
  capOverride?: number;
};

export type AutoApplyOutcome = {
  jobId: string;
  status: 'submitted' | 'applied' | 'drafted' | 'skipped';
  applicationId?: string;
  message?: string;
};

export type AutoApplySummary = {
  total: number;
  submitted: number;
  applied: number;
  drafted: number;
  skipped: number;
  results: AutoApplyOutcome[];
};

/**
 * Apply to a batch of jobs on the user's behalf: for each job, draft a tailored
 * application (AI) and then auto-fill / optionally submit it in the browser.
 *
 * - Guardrail/duplicate failures from buildApplication → `skipped` (not fatal).
 * - Draft succeeds but the browser step throws (e.g. browser not installed,
 *   login wall) → `drafted` (the application is saved for manual finishing).
 * - Browser fills and submits → `submitted`; fills without submit → `applied`.
 *
 * The per-job guardrail (configurable weekly cap) still applies, so this honors
 * the user's anti-spam setting even in batch mode.
 */
export async function autoApply(opts: AutoApplyOptions, deps: AutoApplyDeps): Promise<AutoApplySummary> {
  const results: AutoApplyOutcome[] = [];

  for (const jobId of opts.jobIds) {
    let applicationId: string | undefined;
    try {
      const draft = await buildApplication(
        { jobId, resumeId: opts.resumeId, capOverride: opts.capOverride, allowDuplicate: opts.allowDuplicate },
        deps
      );
      applicationId = draft.applicationId;
    } catch (e) {
      results.push({ jobId, status: 'skipped', message: (e as Error).message });
      continue;
    }

    try {
      const applied = await applyApplication({ applicationId, submit: opts.submit }, deps);
      results.push({
        jobId,
        applicationId,
        status: applied.submitted ? 'submitted' : 'applied',
        message: `filled: ${applied.filled.join(', ') || 'none'}` +
          (applied.skipped.length ? ` · skipped: ${applied.skipped.join(', ')}` : '')
      });
    } catch (e) {
      const job = getJob(deps.db, jobId);
      if (applicationId) {
        enqueueNeedsAction(deps.db, {
          applicationId,
          reason: 'browser_unavailable',
          title: 'Application needs you',
          body: `Drafted, but auto-fill couldn't finish: ${(e as Error).message}`,
          link: job?.url ?? ''
        });
      }
      results.push({ jobId, applicationId, status: 'drafted', message: `drafted; auto-fill unavailable: ${(e as Error).message}` });
    }
  }

  const summary: AutoApplySummary = {
    total: results.length,
    submitted: results.filter(r => r.status === 'submitted').length,
    applied: results.filter(r => r.status === 'applied').length,
    drafted: results.filter(r => r.status === 'drafted').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    results
  };

  createNotification(deps.db, {
    kind: 'auto_apply',
    title: `Auto-apply run: ${summary.submitted} submitted, ${summary.applied} filled, ${summary.drafted} drafted, ${summary.skipped} skipped`,
    body: `${summary.total} jobs processed`
  });

  return summary;
}
