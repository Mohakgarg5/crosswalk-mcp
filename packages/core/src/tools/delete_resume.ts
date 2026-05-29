import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { deleteResume } from '../store/resume.ts';

export const deleteResumeInput = z.object({
  resumeId: z.string().min(1)
});

export async function deleteResumeTool(
  input: z.infer<typeof deleteResumeInput>,
  ctx: { db: Db }
): Promise<{ deleted: boolean }> {
  return deleteResume(ctx.db, input.resumeId);
}
