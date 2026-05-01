import type { SamplingClient } from '../sampling/client.ts';

export type PickResumeJobCtx = {
  jobTitle: string;
  jobDescription: string;
};

export type PickResumeCandidate = {
  id: string;
  label: string;
  parsed: Record<string, unknown>;
};

export type PickResumeResult = {
  resumeId: string;
  reason: string;
};

const SYSTEM = `You select the best base resume to tailor for a job description.
You will be given a job (title + description) and an array of candidate resumes.
Each candidate has an id, a label, and a parsed structure with skills/experiences.
Return JSON: { "resume_id": "<id>", "reason": "<one short sentence>" }.
Pick the resume whose existing strengths best overlap with the job's most-critical asks.
Tie-break toward more specific labels.`;

export async function pickBestResume(
  job: PickResumeJobCtx,
  resumes: PickResumeCandidate[],
  sampling: SamplingClient
): Promise<PickResumeResult> {
  if (resumes.length === 0) throw new Error('no resumes available');
  if (resumes.length === 1) {
    return { resumeId: resumes[0].id, reason: 'only stored resume' };
  }

  const prompt = JSON.stringify({
    job: { title: job.jobTitle, description: job.jobDescription.slice(0, 4000) },
    resumes: resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed }))
  });

  const out = await sampling.completeJson<{ resume_id: string; reason: string }>({
    system: SYSTEM,
    prompt,
    maxTokens: 256
  });

  const ok = resumes.find(r => r.id === out.resume_id);
  if (!ok) {
    return { resumeId: resumes[0].id, reason: `LLM picked unknown id; defaulted to ${resumes[0].label}` };
  }

  return { resumeId: out.resume_id, reason: out.reason };
}
