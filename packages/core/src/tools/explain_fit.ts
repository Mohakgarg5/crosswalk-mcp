import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getJob } from '../store/job.ts';
import { listResumes, getResume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import { setCachedNarrative } from '../store/fitScoreCache.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const explainFitInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional()
});

const SYSTEM = `You are a career-fit narrator.
Given a job description and a candidate, produce a short markdown brief:
1. A single sentence with a percentage estimate of fit.
2. "Strengths" — 2–4 specific bullets (cite resume facts).
3. "Gaps" — 1–3 specific bullets.
4. "Positioning" — 1–2 sentences on how to frame the application.

Be honest and specific. No hedging. No filler.`;

export async function explainFit(
  input: z.infer<typeof explainFitInput>,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<{ narrativeMd: string; jobId: string; resumeId: string }> {
  const job = getJob(ctx.db, input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  const resume = input.resumeId
    ? getResume(ctx.db, input.resumeId)
    : (listResumes(ctx.db)[0] ?? null);
  if (!resume) throw new Error('no resumes stored — call add_resume first');

  const profile = getProfile(ctx.db);

  const prompt = JSON.stringify({
    job: { title: job.title, dept: job.dept, description: job.descriptionMd?.slice(0, 6000) },
    profile,
    resume: { label: resume.label, parsed: resume.parsed }
  });

  const narrativeMd = await ctx.sampling.complete({
    system: SYSTEM, prompt, maxTokens: 768
  });

  setCachedNarrative(ctx.db, input.jobId, resume.id, narrativeMd);

  return { narrativeMd, jobId: input.jobId, resumeId: resume.id };
}
