import type { Db } from '../store/db.ts';
import type { WorkflowKind } from '../store/workflow.ts';
import { fetchJobs, fetchJobsInput } from '../tools/fetch_jobs.ts';

export type WorkflowRunResult = {
  status: 'ok' | 'error';
  error?: string;
  summary?: Record<string, unknown>;
};

export async function runWorkflowKind(
  db: Db,
  kind: WorkflowKind | string,
  params: Record<string, unknown>
): Promise<WorkflowRunResult> {
  try {
    if (kind === 'prune_old_jobs') {
      const olderThanDays = (params.olderThanDays as number | undefined) ?? 60;
      const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
      const result = db.prepare(
        `DELETE FROM job WHERE last_seen_at < ?`
      ).run(cutoff);
      return { status: 'ok', summary: { deleted: result.changes } };
    }

    if (kind === 'fetch_jobs_refresh') {
      const filters = fetchJobsInput.parse(params);
      const out = await fetchJobs(filters, { db });
      return { status: 'ok', summary: { fetched: out.meta.fetched, errors: out.meta.errors.length } };
    }

    return { status: 'error', error: `unknown workflow kind: ${kind}` };
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  }
}
