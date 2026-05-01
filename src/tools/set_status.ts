import { z } from 'zod';
import type { Db } from '../store/db.ts';
import {
  getApplication, updateApplicationStatus, addEventForApplication
} from '../store/application.ts';

export const setStatusInput = z.object({
  applicationId: z.string(),
  status: z.enum(['draft', 'submitted', 'interviewing', 'rejected', 'offer'])
});

export async function setStatus(
  input: z.infer<typeof setStatusInput>,
  ctx: { db: Db }
): Promise<{ applicationId: string; status: string }> {
  const parsed = setStatusInput.parse(input);
  const before = getApplication(ctx.db, parsed.applicationId);
  if (!before) throw new Error(`unknown application: ${parsed.applicationId}`);

  updateApplicationStatus(ctx.db, parsed.applicationId, parsed.status);
  addEventForApplication(ctx.db, parsed.applicationId, 'status_changed', {
    from: before.status, to: parsed.status
  });

  return { applicationId: parsed.applicationId, status: parsed.status };
}
