import { randomUUID } from 'node:crypto';
import type { Db } from '../store/db.ts';
import { getJob } from '../store/job.ts';
import { getProfile } from '../store/profile.ts';
import { getCompany } from '../store/company.ts';
import { createApplication } from '../store/application.ts';
import { resolveResume } from './resolveResume.ts';
import { tailorResume } from './tailorResume.ts';
import { draftCoverLetter } from './coverLetter.ts';
import { checkGuardrail } from './guardrail.ts';
import type { SamplingClient } from '../sampling/client.ts';

export type BuildApplicationInput = {
  jobId: string;
  resumeId?: string;
  allowDuplicate?: boolean;
  confirmLowFit?: boolean;
};

export type BuildApplicationResult = {
  applicationId: string;
  jobId: string;
  resumeId: string;
  tailoredResumeMd: string;
  coverLetterMd: string;
  answerPack: Record<string, string>;
  deepLink: string;
  pickedReason: string;
};

export async function buildApplication(
  input: BuildApplicationInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<BuildApplicationResult> {
  const job = getJob(ctx.db, input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  // Guardrail: check before any sampling cost.
  const guardrail = checkGuardrail(ctx.db, {
    jobId: input.jobId,
    resumeId: input.resumeId ?? '',
    allowDuplicate: input.allowDuplicate,
    confirmLowFit: input.confirmLowFit
  });
  if (!guardrail.allowed) throw new Error(guardrail.reason);

  const { resumeId: chosenResumeId, resume, pickedReason } = await resolveResume({
    db: ctx.db, sampling: ctx.sampling,
    jobTitle: job.title, jobDescription: job.descriptionMd ?? '',
    resumeId: input.resumeId
  });

  const profile = getProfile(ctx.db);
  const company = getCompany(ctx.db, job.companyId);
  const companyName = company?.name ?? 'this company';

  const tailored = await tailorResume({
    job: { title: job.title, description: job.descriptionMd ?? '' },
    profile,
    resume: { label: resume.label, rawText: resume.rawText, parsed: resume.parsed },
    sampling: ctx.sampling
  });

  const cover = await draftCoverLetter({
    job: { title: job.title, companyName, description: job.descriptionMd ?? '' },
    profile,
    tailoredResumeMd: tailored.tailoredMd,
    sampling: ctx.sampling
  });

  const applicationId = randomUUID();
  const answerPack: Record<string, string> = {};
  const deepLink = job.url;

  createApplication(ctx.db, {
    id: applicationId,
    jobId: job.id,
    resumeId: chosenResumeId,
    tailoredResumeMd: tailored.tailoredMd,
    coverLetterMd: cover.coverLetterMd,
    answerPack,
    deepLink
  });

  return {
    applicationId,
    jobId: job.id,
    resumeId: chosenResumeId,
    tailoredResumeMd: tailored.tailoredMd,
    coverLetterMd: cover.coverLetterMd,
    answerPack,
    deepLink,
    pickedReason
  };
}
