import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import type { Db } from '../store/db.ts';
import { getWorkflow, recordWorkflowRun } from '../store/workflow.ts';
import { runWorkflowKind } from '../services/workflowEngine.ts';

export const runWorkflowInput = z.object({
  workflowId: z.string()
});

export async function runWorkflow(
  input: z.infer<typeof runWorkflowInput>,
  ctx: { db: Db }
): Promise<{
  workflowId: string;
  status: 'ok' | 'error';
  error?: string;
  summary?: Record<string, unknown>;
  nextRunAt: string;
}> {
  const wf = getWorkflow(ctx.db, input.workflowId);
  if (!wf) throw new Error(`unknown workflow: ${input.workflowId}`);

  const result = await runWorkflowKind(ctx.db, wf.kind, wf.params);

  // Compute next run from the cron expression.
  const interval = CronExpressionParser.parse(wf.cron, { currentDate: new Date() });
  const nextRunAt = interval.next().toDate().toISOString();

  recordWorkflowRun(ctx.db, wf.id, {
    status: result.status, error: result.error, nextRunAt
  });

  return {
    workflowId: wf.id,
    status: result.status,
    error: result.error,
    summary: result.summary,
    nextRunAt
  };
}
