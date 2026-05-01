import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { buildApplication, type BuildApplicationResult } from '../services/buildApplication.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const draftApplicationInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional()
});

export type DraftApplicationInput = z.infer<typeof draftApplicationInput>;

export async function draftApplication(
  input: DraftApplicationInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<BuildApplicationResult> {
  return buildApplication(input, ctx);
}
