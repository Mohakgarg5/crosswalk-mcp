import type { Db } from '../store/db.ts';
import { listResumes, getResume, type Resume } from '../store/resume.ts';
import { pickBestResume } from './pickResume.ts';
import type { SamplingClient } from '../sampling/client.ts';

export type ResolveResumeArgs = {
  db: Db;
  sampling: SamplingClient;
  jobTitle: string;
  jobDescription: string;
  resumeId?: string;
};

export type ResolveResumeResult = {
  resumeId: string;
  resume: Resume;
  pickedReason: string;
};

export async function resolveResume(args: ResolveResumeArgs): Promise<ResolveResumeResult> {
  const resumes = listResumes(args.db);
  if (resumes.length === 0) throw new Error('no resumes stored — call add_resume first');

  let resumeId: string;
  let pickedReason: string;
  if (args.resumeId) {
    const r = getResume(args.db, args.resumeId);
    if (!r) throw new Error(`unknown resume: ${args.resumeId}`);
    resumeId = r.id;
    pickedReason = 'caller-supplied';
  } else {
    const picked = await pickBestResume(
      { jobTitle: args.jobTitle, jobDescription: args.jobDescription },
      resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed })),
      args.sampling
    );
    resumeId = picked.resumeId;
    pickedReason = picked.reason;
  }

  const resume = getResume(args.db, resumeId);
  if (!resume) throw new Error(`internal: lost resume ${resumeId}`);

  return { resumeId, resume, pickedReason };
}
