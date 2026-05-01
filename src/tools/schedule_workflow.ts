import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { Db } from '../store/db.ts';
import { createWorkflow } from '../store/workflow.ts';

export const scheduleWorkflowInput = z.object({
  kind: z.enum(['fetch_jobs_refresh', 'prune_old_jobs']),
  cron: z.string().min(1)
    .describe("Cron expression in standard 5-field format (e.g., '0 9 * * 1' for 9am Mondays)."),
  description: z.string().min(1),
  params: z.record(z.unknown()).default({})
});

export type ScheduleWorkflowInput = z.infer<typeof scheduleWorkflowInput>;

export async function scheduleWorkflow(
  input: ScheduleWorkflowInput,
  ctx: { db: Db }
): Promise<{ workflowId: string; nextRunAt: string }> {
  const parsed = scheduleWorkflowInput.parse(input);

  let nextRunAt: string;
  try {
    const interval = CronExpressionParser.parse(parsed.cron, { currentDate: new Date() });
    nextRunAt = interval.next().toDate().toISOString();
  } catch (e) {
    throw new Error(`invalid cron expression "${parsed.cron}": ${(e as Error).message}`);
  }

  const id = randomUUID();
  createWorkflow(ctx.db, {
    id, kind: parsed.kind, description: parsed.description,
    cron: parsed.cron, params: parsed.params, nextRunAt
  });
  return { workflowId: id, nextRunAt };
}
