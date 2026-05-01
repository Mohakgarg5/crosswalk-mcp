import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listResumes } from '../store/resume.ts';

export const listResumesInput = z.object({});

export async function listResumesTool(
  _input: z.infer<typeof listResumesInput>,
  ctx: { db: Db }
): Promise<{ resumes: Array<{ id: string; label: string; createdAt: string }> }> {
  return {
    resumes: listResumes(ctx.db).map(r => ({
      id: r.id, label: r.label, createdAt: r.createdAt
    }))
  };
}
