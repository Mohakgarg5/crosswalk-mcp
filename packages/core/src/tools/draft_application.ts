import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { buildApplication, type BuildApplicationResult } from '../services/buildApplication.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const draftApplicationInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional(),
  allowDuplicate: z.boolean().optional()
    .describe('Override duplicate-application refusal.'),
  confirmLowFit: z.boolean().optional()
    .describe('Reserved: override low-fit refusal (M4).')
});

export type DraftApplicationInput = z.infer<typeof draftApplicationInput>;

export async function draftApplication(
  input: DraftApplicationInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<BuildApplicationResult> {
  return buildApplication(input, ctx);
}
