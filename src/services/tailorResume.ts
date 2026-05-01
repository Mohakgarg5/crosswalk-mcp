import type { SamplingClient } from '../sampling/client.ts';

export type TailorResumeArgs = {
  job: { title: string; description: string };
  profile: Record<string, unknown> | null;
  resume: { label: string; rawText: string; parsed: Record<string, unknown> };
  sampling: SamplingClient;
};

export type TailorResumeResult = {
  tailoredMd: string;
};

const SYSTEM = `You tailor an existing resume to a specific job description.

Rules:
- Output the resume in clean markdown. Use # for the candidate's name (top), ## for sections (Experience, Skills, Education, Projects), - for bullets.
- Preserve all factual content from the base resume. Do NOT invent experience, titles, dates, schools, or metrics.
- You MAY rephrase bullets, reorder them, drop low-relevance bullets, and add JD keywords where a fact in the resume justifies them.
- Keep the resume to roughly the same length as the input (one page when typeset).
- Lead with the candidate's name as a level-1 heading. Below it, a one-line tagline drawn from their profile or resume.

Return ONLY the markdown. No preamble, no postscript, no code fences.`;

export async function tailorResume(args: TailorResumeArgs): Promise<TailorResumeResult> {
  const prompt = JSON.stringify({
    job: { title: args.job.title, description: args.job.description.slice(0, 6000) },
    profile: args.profile,
    base_resume: {
      label: args.resume.label,
      raw_text: args.resume.rawText.slice(0, 8000),
      parsed: args.resume.parsed
    }
  });

  const tailoredMd = await args.sampling.complete({
    system: SYSTEM,
    prompt,
    maxTokens: 2048
  });

  return { tailoredMd: tailoredMd.trim() };
}
