import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getJob, listJobs } from '../store/job.ts';
import { getCompany } from '../store/company.ts';
import { listResumes } from '../store/resume.ts';
import { listCachedFits } from '../store/fitScoreCache.ts';
import { scoreFit } from './score_fit.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const topMatchesInput = z.object({
  /** How many matches to return. */
  limit: z.number().int().positive().max(20).optional(),
  /** Score recent unscored jobs first (costs one model call per job). */
  scoreMissing: z.boolean().optional(),
  /** Cap on how many unscored jobs to score in this call. */
  maxToScore: z.number().int().positive().max(20).optional(),
  resumeId: z.string().optional()
});

export type TopMatch = {
  jobId: string;
  title: string;
  company: string;
  location?: string;
  locationType?: string;
  url: string;
  score: number;
  topStrengths: string[];
  topGaps: string[];
};

export type TopMatchesResult = {
  matches: TopMatch[];
  /** How many jobs were freshly scored in this call. */
  scored: number;
};

/** Real scored matches for the dashboard: cached fit scores joined with job
 * info, optionally scoring the most recent unscored jobs first. Returns empty
 * (not an error) when nothing is set up yet — the UI shows its CTA instead. */
export async function topMatches(
  input: z.infer<typeof topMatchesInput>,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<TopMatchesResult> {
  const limit = input.limit ?? 4;
  const resumes = listResumes(ctx.db);
  const resume = input.resumeId
    ? resumes.find(r => r.id === input.resumeId)
    : resumes[0];
  if (!resume) return { matches: [], scored: 0 };

  let scored = 0;
  if (input.scoreMissing) {
    const have = new Set(listCachedFits(ctx.db).filter(f => f.resumeId === resume.id).map(f => f.jobId));
    const candidates = listJobs(ctx.db)
      .filter(j => !have.has(j.id))
      .slice(0, input.maxToScore ?? 6);
    for (const job of candidates) {
      try {
        await scoreFit({ jobId: job.id, resumeId: resume.id }, ctx);
        scored++;
      } catch {
        // One bad job (expired page, rate limit) shouldn't sink the rest.
      }
    }
  }

  const matches = listCachedFits(ctx.db)
    .filter(f => f.resumeId === resume.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .flatMap<TopMatch>(f => {
      const job = getJob(ctx.db, f.jobId);
      if (!job) return [];
      const company = getCompany(ctx.db, job.companyId);
      return [{
        jobId: f.jobId,
        title: job.title,
        company: company?.name ?? 'Unknown',
        location: job.location,
        locationType: job.locationType,
        url: job.url,
        score: f.score,
        topStrengths: f.topStrengths,
        topGaps: f.topGaps
      }];
    });

  return { matches, scored };
}
