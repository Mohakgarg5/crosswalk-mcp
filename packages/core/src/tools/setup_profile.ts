import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { upsertProfile, type Profile } from '../store/profile.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const setupProfileInput = z.object({
  description: z.string().min(1)
    .describe('Free-form description of the user: background, current role, what they want next.')
});

export type SetupProfileInput = z.infer<typeof setupProfileInput>;

export type SetupProfileCtx = {
  db: Db;
  sampling: SamplingClient;
};

const SYSTEM = `You are a structured-profile extractor for a job-search assistant.
Given a free-form description of a person, return a JSON object with:
- name (string)
- headline (string, e.g., "Senior PM, Marketplaces")
- years_experience (number)
- skills (string[])
- wants: { roles: string[], locations: string[], comp_min?: number, must_have?: string[], must_avoid?: string[] }
- notes (string, anything else worth remembering)

Be faithful to the input. Do not invent facts.`;

export async function setupProfile(
  input: SetupProfileInput,
  ctx: SetupProfileCtx
): Promise<{ profile: Profile }> {
  const profile = await ctx.sampling.completeJson<Profile>({
    system: SYSTEM,
    prompt: input.description,
    maxTokens: 1024
  });
  upsertProfile(ctx.db, profile);
  return { profile };
}
