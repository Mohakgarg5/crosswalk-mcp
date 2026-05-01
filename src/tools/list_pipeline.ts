import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listApplications } from '../store/application.ts';
import { getJob } from '../store/job.ts';
import { getCompany } from '../store/company.ts';

export const listPipelineInput = z.object({
  status: z.enum(['draft', 'submitted', 'interviewing', 'rejected', 'offer']).optional()
});

export type PipelineItem = {
  applicationId: string;
  status: string;
  jobId: string;
  jobTitle: string;
  company: string;
  deepLink: string;
  createdAt: string;
  submittedAt?: string;
};

export async function listPipeline(
  input: z.infer<typeof listPipelineInput>,
  ctx: { db: Db }
): Promise<{ items: PipelineItem[] }> {
  const apps = listApplications(ctx.db, { status: input.status });
  const items: PipelineItem[] = apps.map(a => {
    const job = getJob(ctx.db, a.jobId);
    const company = job ? getCompany(ctx.db, job.companyId) : null;
    return {
      applicationId: a.id,
      status: a.status,
      jobId: a.jobId,
      jobTitle: job?.title ?? '(deleted)',
      company: company?.name ?? '(unknown)',
      deepLink: a.deepLink,
      createdAt: a.createdAt,
      submittedAt: a.submittedAt
    };
  });
  return { items };
}
