import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getProfile, upsertProfile, type Profile } from '../store/profile.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const setupProfileInput = z.object({
  description: z.string().min(1)
    .describe('Free-form description of the user: background, current role, what they want next, contact links. Subsequent calls merge with the existing profile — only mention the fields you want to add or change.')
});

export type SetupProfileInput = z.infer<typeof setupProfileInput>;

export type SetupProfileCtx = {
  db: Db;
  sampling: SamplingClient;
};

const SYSTEM = `You are a structured-profile extractor for a job-search assistant. The user may be (a) creating their profile for the first time or (b) updating one or two fields on an existing profile.

Return a JSON object with these keys, ALWAYS as the top-level structure (do not nest, do not wrap in another key):
- name (string, full display name)
- first_name (string, the given name used on application forms)
- last_name (string, the surname used on application forms — empty string "" if the candidate has only one name)
- headline (string, e.g., "Senior PM, Marketplaces")
- years_experience (number | null)
- email (string, primary contact email — extract from the description, do NOT put in notes)
- phone (string, primary phone with country code — extract from the description, do NOT put in notes)
- linkedin (string, full URL — extract from the description)
- website (string, full URL of portfolio/personal site — extract from the description)
- github (string, full URL if mentioned)
- location (string, "City, State" or "City, Country")
- skills (string[])
- links: { linkedin?: string, portfolio?: string, github?: string, website?: string }   // mirror of top-level URL fields, kept for older consumers
- wants: { roles: string[], locations: string[], comp_min?: number, must_have?: string[], must_avoid?: string[] }
- notes (string, ONLY non-contact information — visa, work preferences, anything not covered by the typed fields above)

If the user supplies a previous_profile, START from that object and modify ONLY the fields the new description explicitly mentions or contradicts. Preserve every field the description does not mention. NEVER reset preserved fields to "Unknown", null, or empty arrays unless the user explicitly says so.

If the description is too short to populate every field, that is fine — emit the partial update merged onto previous_profile. Do NOT refuse, do NOT return prose, do NOT ask clarifying questions. Output ONLY the JSON object, nothing else.`;

export async function setupProfile(
  input: SetupProfileInput,
  ctx: SetupProfileCtx
): Promise<{ profile: Profile }> {
  const previous = getProfile(ctx.db);
  const userPrompt = previous
    ? JSON.stringify({ previous_profile: previous, description: input.description })
    : input.description;
  const updated = await ctx.sampling.completeJson<Profile>({
    system: SYSTEM,
    prompt: userPrompt,
    maxTokens: 1024
  });
  // Defensive client-side merge: ensure any field the model accidentally dropped
  // falls back to the previous value.
  const profile: Profile = previous
    ? mergeProfile(previous, updated)
    : updated;
  upsertProfile(ctx.db, profile);
  return { profile };
}

function mergeProfile(prev: Profile, next: Profile): Profile {
  const out: Record<string, unknown> = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(prev[k] as object ?? {}), ...(v as object) };
    } else {
      out[k] = v;
    }
  }
  return out as Profile;
}
