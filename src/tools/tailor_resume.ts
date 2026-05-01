import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getJob } from '../store/job.ts';
import { getProfile } from '../store/profile.ts';
import { resolveResume } from '../services/resolveResume.ts';
import { tailorResume } from '../services/tailorResume.ts';
import { mdToPrintHtml } from '../exporters/html.ts';
import { mdToDocxBuffer } from '../exporters/docx.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const tailorResumeInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional(),
  format: z.enum(['md', 'docx', 'html']).optional()
    .describe("Optional extra format. 'md' is always returned; 'docx' adds a base64 buffer; 'html' adds a print-styled string.")
});

export type TailorResumeToolInput = z.infer<typeof tailorResumeInput>;

export type TailorResumeToolResult = {
  tailoredMd: string;
  resumeId: string;
  pickedReason: string;
  docxBase64?: string;
  html?: string;
};

export async function tailorResumeTool(
  input: TailorResumeToolInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<TailorResumeToolResult> {
  const job = getJob(ctx.db, input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  const { resumeId: chosenResumeId, resume, pickedReason } = await resolveResume({
    db: ctx.db, sampling: ctx.sampling,
    jobTitle: job.title, jobDescription: job.descriptionMd ?? '',
    resumeId: input.resumeId
  });

  const profile = getProfile(ctx.db);

  const { tailoredMd } = await tailorResume({
    job: { title: job.title, description: job.descriptionMd ?? '' },
    profile,
    resume: { label: resume.label, rawText: resume.rawText, parsed: resume.parsed },
    sampling: ctx.sampling
  });

  const result: TailorResumeToolResult = {
    tailoredMd,
    resumeId: chosenResumeId,
    pickedReason
  };

  if (input.format === 'docx') {
    const buf = await mdToDocxBuffer(tailoredMd);
    result.docxBase64 = buf.toString('base64');
  } else if (input.format === 'html') {
    result.html = await mdToPrintHtml(tailoredMd, { title: `${resume.label} → ${job.title}` });
  }

  return result;
}
