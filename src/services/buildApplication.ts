import { randomUUID } from 'node:crypto';
import type { Db } from '../store/db.ts';
import { getJob } from '../store/job.ts';
import { listResumes, getResume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import { getCompany } from '../store/company.ts';
import { createApplication } from '../store/application.ts';
import { pickBestResume } from './pickResume.ts';
import { tailorResume } from './tailorResume.ts';
import { draftCoverLetter } from './coverLetter.ts';
import type { SamplingClient } from '../sampling/client.ts';

export type BuildApplicationInput = {
  jobId: string;
  resumeId?: string;
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

  const resumes = listResumes(ctx.db);
  if (resumes.length === 0) throw new Error('no resumes stored — call add_resume first');

  let chosenResumeId: string;
  let pickedReason: string;
  if (input.resumeId) {
    const explicit = getResume(ctx.db, input.resumeId);
    if (!explicit) throw new Error(`unknown resume: ${input.resumeId}`);
    chosenResumeId = explicit.id;
    pickedReason = 'caller-supplied';
  } else {
    const picked = await pickBestResume(
      { jobTitle: job.title, jobDescription: job.descriptionMd ?? '' },
      resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed })),
      ctx.sampling
    );
    chosenResumeId = picked.resumeId;
    pickedReason = picked.reason;
  }

  const resume = getResume(ctx.db, chosenResumeId);
  if (!resume) throw new Error(`internal: lost resume ${chosenResumeId}`);

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
