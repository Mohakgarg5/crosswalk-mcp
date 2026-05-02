import { z } from 'zod';
import type { Db } from '../store/db.ts';

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

type Row = {
  applicationId: string;
  status: string;
  jobId: string;
  jobTitle: string | null;
  company: string | null;
  deepLink: string;
  createdAt: string;
  submittedAt: string | null;
};

export async function listPipeline(
  input: z.infer<typeof listPipelineInput>,
  ctx: { db: Db }
): Promise<{ items: PipelineItem[] }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (input.status) {
    where.push('a.status = ?');
    args.push(input.status);
  }
  const sql = `
    SELECT a.id AS applicationId, a.status, a.job_id AS jobId,
           j.title AS jobTitle, c.name AS company,
           a.deep_link AS deepLink, a.created_at AS createdAt,
           a.submitted_at AS submittedAt
    FROM application a
    LEFT JOIN job j ON j.id = a.job_id
    LEFT JOIN company c ON c.id = j.company_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.created_at DESC, a.rowid DESC
  `;
  const rows = ctx.db.prepare(sql).all(...args) as Row[];
  const items: PipelineItem[] = rows.map(r => ({
    applicationId: r.applicationId,
    status: r.status,
    jobId: r.jobId,
    jobTitle: r.jobTitle ?? '(deleted)',
    company: r.company ?? '(unknown)',
    deepLink: r.deepLink,
    createdAt: r.createdAt,
    submittedAt: r.submittedAt ?? undefined
  }));
  return { items };
}
