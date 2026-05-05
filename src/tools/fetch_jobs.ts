import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listAllCompanies, type Company } from '../store/company.ts';
import { upsertJobs, type StoredJob } from '../store/job.ts';
import { getAdapter } from '../ats/adapter.ts';
import type { NormalizedJob } from '../ats/types.ts';
// Adapters self-register on import
import '../ats/greenhouse.ts';
import '../ats/lever.ts';
import '../ats/ashby.ts';
import '../ats/workable.ts';
import '../ats/smartrecruiters.ts';
import '../ats/bamboohr.ts';
import '../ats/recruitee.ts';
import '../ats/personio.ts';
import '../ats/workday.ts';
import '../ats/icims.ts';

export const fetchJobsInput = z.object({
  titleContains: z.string().optional(),
  locationContains: z.string().optional(),
  remoteOnly: z.boolean().optional(),
  sinceDays: z.number().int().positive().optional(),
  companyIds: z.array(z.string()).optional(),
  h1bSponsorOnly: z.boolean().optional(),
  h1bMinConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(200).optional()
});

export type FetchJobsInput = z.infer<typeof fetchJobsInput>;

export type FetchJobsResult = {
  jobs: Array<{
    id: string; company: string; companyId: string; title: string;
    dept?: string; location?: string; locationType?: string;
    salaryMin?: number; salaryMax?: number; currency?: string;
    url: string; postedAt?: string; h1bConfidence?: number;
  }>;
  meta: { fetched: number; afterFilters: number; companiesQueried: number; errors: string[] };
};

function jobIdFor(ats: string, orgSlug: string, externalId: string): string {
  return `${ats}:${orgSlug}:${externalId}`;
}

function passes(j: NormalizedJob, c: Company, f: FetchJobsInput): boolean {
  if (f.titleContains && !j.title.toLowerCase().includes(f.titleContains.toLowerCase())) return false;
  if (f.locationContains && !(j.location ?? '').toLowerCase().includes(f.locationContains.toLowerCase())) return false;
  if (f.remoteOnly && j.locationType !== 'remote') return false;
  if (f.sinceDays !== undefined && j.postedAt) {
    const cutoff = Date.now() - f.sinceDays * 86400_000;
    if (new Date(j.postedAt).getTime() < cutoff) return false;
  }
  if (f.h1bSponsorOnly) {
    const min = f.h1bMinConfidence ?? 0.5;
    if ((c.h1bConfidence ?? 0) < min) return false;
  }
  return true;
}

export async function fetchJobs(
  input: FetchJobsInput,
  ctx: { db: Db }
): Promise<FetchJobsResult> {
  const allCompanies = listAllCompanies(ctx.db);
  const companies = input.companyIds
    ? allCompanies.filter(c => input.companyIds!.includes(c.id))
    : allCompanies;

  const errors: string[] = [];
  let fetched = 0;
  const collected: Array<{ company: Company; job: NormalizedJob }> = [];

  await Promise.all(companies.map(async c => {
    try {
      const adapter = getAdapter(c.ats);
      const jobs = await adapter.listJobs(c.atsOrgSlug, { sinceDays: input.sinceDays });
      fetched += jobs.length;
      for (const j of jobs) collected.push({ company: c, job: j });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }));

  // Persist before filtering so the cache always reflects truth.
  const storedJobs: StoredJob[] = collected.map(({ company, job }) => ({
    id: jobIdFor(company.ats, company.atsOrgSlug, job.externalId),
    companyId: company.id, title: job.title, dept: job.dept,
    location: job.location, locationType: job.locationType,
    salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency,
    descriptionMd: job.descriptionMd, url: job.url, postedAt: job.postedAt,
    raw: job.raw
  }));
  upsertJobs(ctx.db, storedJobs);

  const filtered = collected.filter(({ company, job }) => passes(job, company, input));
  const limit = input.limit ?? 25;
  const sliced = filtered.slice(0, limit);

  return {
    jobs: sliced.map(({ company, job }) => ({
      id: jobIdFor(company.ats, company.atsOrgSlug, job.externalId),
      company: company.name, companyId: company.id, title: job.title,
      dept: job.dept, location: job.location, locationType: job.locationType,
      salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency,
      url: job.url, postedAt: job.postedAt, h1bConfidence: company.h1bConfidence
    })),
    meta: {
      fetched, afterFilters: filtered.length,
      companiesQueried: companies.length, errors
    }
  };
}
