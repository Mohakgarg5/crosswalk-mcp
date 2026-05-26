import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listWorkflows } from '../store/workflow.ts';

export const listWorkflowsInput = z.object({});

export async function listWorkflowsTool(
  _input: z.infer<typeof listWorkflowsInput>,
  ctx: { db: Db }
): Promise<{ workflows: Array<{
  id: string; kind: string; description: string; cron: string;
  nextRunAt: string; lastRunAt?: string; lastStatus?: string; lastError?: string;
}> }> {
  return {
    workflows: listWorkflows(ctx.db).map(w => ({
      id: w.id, kind: w.kind, description: w.description, cron: w.cron,
      nextRunAt: w.nextRunAt, lastRunAt: w.lastRunAt,
      lastStatus: w.lastStatus, lastError: w.lastError
    }))
  };
}
