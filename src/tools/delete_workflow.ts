import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { deleteWorkflow } from '../store/workflow.ts';

export const deleteWorkflowInput = z.object({
  workflowId: z.string()
});

export async function deleteWorkflowTool(
  input: z.infer<typeof deleteWorkflowInput>,
  ctx: { db: Db }
): Promise<{ deleted: boolean }> {
  const parsed = deleteWorkflowInput.parse(input);
  const deleted = deleteWorkflow(ctx.db, parsed.workflowId);
  return { deleted };
}
