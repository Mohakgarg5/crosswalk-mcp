import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Db } from '../store/db.ts';
import { addResume as storeAddResume, type Resume } from '../store/resume.ts';
import { extractResumeText } from '../parsers/resume.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const addResumeInput = z.object({
  path: z.string().optional().describe('Filesystem path to a .txt/.md/.docx/.pdf resume.'),
  rawText: z.string().optional().describe('Raw resume text (alternative to path).'),
  label: z.string().min(1).describe('Human-readable label, e.g., "Generic PM" or "Senior IC PM".')
}).refine(d => d.path || d.rawText, { message: 'one of path or rawText is required' });

export type AddResumeInput = z.infer<typeof addResumeInput>;

const SYSTEM = `Extract a structured resume into JSON with:
- skills (string[])
- experiences ({ company, title, start, end?, summary }[])
- education ({ school, degree?, field?, year? }[])
- projects ({ name, summary }[])
- highlights (string[], 3–5 short bullets capturing the strongest signals)
Do not invent facts. Use null/empty arrays if a section is absent.`;

export async function addResume(
  input: AddResumeInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<{ id: string; label: string }> {
  const rawText = await extractResumeText(input.path ?? { rawText: input.rawText! });
  const parsed = await ctx.sampling.completeJson<Record<string, unknown>>({
    system: SYSTEM,
    prompt: rawText,
    maxTokens: 2048
  });
  const id = randomUUID();
  const stored: Resume = storeAddResume(ctx.db, {
    id, label: input.label, sourcePath: input.path, rawText, parsed
  });
  return { id: stored.id, label: stored.label };
}
