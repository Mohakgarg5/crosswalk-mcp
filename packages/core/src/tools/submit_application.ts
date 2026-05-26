import { z } from 'zod';
import type { Db } from '../store/db.ts';
import {
  getApplication, updateApplicationStatus, addEventForApplication
} from '../store/application.ts';

export const submitApplicationInput = z.object({
  applicationId: z.string()
});

export async function submitApplication(
  input: z.infer<typeof submitApplicationInput>,
  ctx: { db: Db }
): Promise<{ applicationId: string; status: 'submitted'; submittedAt: string }> {
  const before = getApplication(ctx.db, input.applicationId);
  if (!before) throw new Error(`unknown application: ${input.applicationId}`);

  updateApplicationStatus(ctx.db, input.applicationId, 'submitted');
  addEventForApplication(ctx.db, input.applicationId, 'status_changed', {
    from: before.status, to: 'submitted'
  });

  const after = getApplication(ctx.db, input.applicationId);
  if (!after) throw new Error(`internal: application ${input.applicationId} disappeared`);
  return {
    applicationId: input.applicationId,
    status: 'submitted',
    submittedAt: after.submittedAt!
  };
}
