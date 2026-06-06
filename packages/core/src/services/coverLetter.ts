import type { SamplingClient } from '../sampling/client.ts';
import { JD_CHARS_LETTER } from './constants.ts';
import { stripEmDashes } from './humanize.ts';

export type CoverLetterArgs = {
  job: { title: string; companyName: string; description: string };
  profile: Record<string, unknown> | null;
  tailoredResumeMd: string;
  sampling: SamplingClient;
};

export type CoverLetterResult = {
  coverLetterMd: string;
};

const SYSTEM = `You write a tight, specific cover letter (200–300 words) AS the candidate, in the first person. You ARE the applicant — write "I built", "my team", never "Mohak built" or "he/she/they". Third person anywhere is a hard failure.

Rules:
- Start with "Dear hiring manager," (no name, since we don't know it).
- Open with a single sentence that names the role and company and one specific reason I'm a fit (drawn from the resume, not invented).
- Body: 1–2 short paragraphs connecting my most relevant experience to the JD's top asks. Cite specific facts from the resume.
- Close with a sentence inviting next steps.
- Sign off with the candidate's name from the profile (or "Sincerely," if name is unknown).
- Plain markdown, no headings, no formatting flourishes.
- NEVER use an em dash (—) or semicolon. Use commas and periods.
- Plain, direct sentences a person would actually type. Vary sentence length.
- No clichés ("I am writing to express my interest", "passionate about", "team player") and no AI tells ("genuinely", "deeply", "exactly the kind of", "precisely the kind of", "That combination of"). Be direct.

Return ONLY the cover letter text. No preamble.`;

export async function draftCoverLetter(args: CoverLetterArgs): Promise<CoverLetterResult> {
  const prompt = JSON.stringify({
    job: {
      title: args.job.title,
      company: args.job.companyName,
      description: args.job.description.slice(0, JD_CHARS_LETTER)
    },
    profile: args.profile,
    tailored_resume_md: args.tailoredResumeMd
  });

  const coverLetterMd = await args.sampling.complete({
    system: SYSTEM,
    prompt,
    maxTokens: 768
  });

  return { coverLetterMd: stripEmDashes(coverLetterMd.trim()) };
}
