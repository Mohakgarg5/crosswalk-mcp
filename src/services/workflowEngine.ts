import type { Db } from '../store/db.ts';
import type { WorkflowKind } from '../store/workflow.ts';
import { fetchJobs, fetchJobsInput } from '../tools/fetch_jobs.ts';
import { ZodError } from 'zod';

export type WorkflowRunResult = {
  status: 'ok' | 'error' | 'needs_host';
  error?: string;
  summary?: Record<string, unknown>;
};

function formatZodError(e: ZodError): string {
  return e.issues
    .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

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
      const parsed = fetchJobsInput.safeParse(params);
      if (!parsed.success) {
        return { status: 'error', error: `invalid params: ${formatZodError(parsed.error)}` };
      }
      const out = await fetchJobs(parsed.data, { db });
      return { status: 'ok', summary: { fetched: out.meta.fetched, errors: out.meta.errors.length } };
    }

    if (kind === 'sampling_recipe') {
      const recipe = (params.recipe as string | undefined) ?? '';
      return { status: 'needs_host', summary: { recipe } };
    }

    return { status: 'error', error: `unknown workflow kind: ${kind}` };
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: 'error', error: `zod: ${formatZodError(e)}` };
    }
    return { status: 'error', error: (e as Error).message };
  }
}
