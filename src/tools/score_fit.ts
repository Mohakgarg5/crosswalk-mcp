import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listJobs } from '../store/job.ts';
import { listResumes, getResume, type Resume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const scoreFitInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional()
});

const SYSTEM = `You are a career-fit scoring engine.
Given a job description and a candidate's profile + resume, produce JSON with:
- score: a number 0..1 representing overall fit
- top_strengths: string[] (1–3 bullets, why this candidate is a strong fit)
- top_gaps: string[] (1–3 bullets, what's missing or weak)
Be calibrated. A 0.9+ score should be rare. 0.5 means "even odds of an interview".`;

export async function scoreFit(
  input: z.infer<typeof scoreFitInput>,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<{ score: number; topStrengths: string[]; topGaps: string[]; jobId: string; resumeId: string }> {
  const job = listJobs(ctx.db, { limit: 5000 }).find(j => j.id === input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  let resume: Resume | null = null;
  if (input.resumeId) {
    resume = getResume(ctx.db, input.resumeId);
    if (!resume) throw new Error(`unknown resume: ${input.resumeId}`);
  } else {
    const all = listResumes(ctx.db);
    if (all.length === 0) throw new Error('no resumes stored — call add_resume first');
    resume = all[0];
  }

  const profile = getProfile(ctx.db);

  const prompt = JSON.stringify({
    job: {
      title: job.title, dept: job.dept, location: job.location,
      description: job.descriptionMd?.slice(0, 6000)
    },
    profile,
    resume: { label: resume.label, parsed: resume.parsed }
  });

  const out = await ctx.sampling.completeJson<{
    score: number; top_strengths: string[]; top_gaps: string[];
  }>({ system: SYSTEM, prompt, maxTokens: 512 });

  return {
    score: out.score, topStrengths: out.top_strengths, topGaps: out.top_gaps,
    jobId: input.jobId, resumeId: resume.id
  };
}
