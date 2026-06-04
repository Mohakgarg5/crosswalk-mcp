import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { setCachedFit } from '../src/store/fitScoreCache.ts';
import { topMatches } from '../src/tools/top_matches.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/top_matches', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [
      { id: 'j1', companyId: 'stripe', title: 'PM, Payments', location: 'NYC', url: 'https://x/1', raw: {} },
      { id: 'j2', companyId: 'stripe', title: 'PM, Terminal', location: 'Remote', locationType: 'remote', url: 'https://x/2', raw: {} },
      { id: 'j3', companyId: 'stripe', title: 'PM, Billing', location: 'SF', url: 'https://x/3', raw: {} }
    ]);
    addResume(db, { id: 'r1', label: 'PM', rawText: 'pm', parsed: {} });
  });

  it('returns cached fits joined with job info, best score first', async () => {
    setCachedFit(db, { jobId: 'j1', resumeId: 'r1', score: 0.61, topStrengths: ['a'], topGaps: [] });
    setCachedFit(db, { jobId: 'j2', resumeId: 'r1', score: 0.84, topStrengths: ['b'], topGaps: [] });
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;

    const out = await topMatches({}, { db, sampling });
    expect(out.matches.map(m => m.jobId)).toEqual(['j2', 'j1']);
    expect(out.matches[0]).toMatchObject({
      jobId: 'j2', title: 'PM, Terminal', company: 'Stripe',
      location: 'Remote', score: 0.84, topStrengths: ['b'], url: 'https://x/2'
    });
    expect(sampling.completeJson).not.toHaveBeenCalled(); // no scoring unless asked
  });

  it('scores unscored recent jobs when scoreMissing is true, up to maxToScore', async () => {
    const sampling = {
      completeJson: vi.fn()
        .mockResolvedValueOnce({ score: 0.7, top_strengths: ['x'], top_gaps: [] })
        .mockResolvedValueOnce({ score: 0.9, top_strengths: ['y'], top_gaps: [] })
    } as unknown as SamplingClient;

    const out = await topMatches({ scoreMissing: true, maxToScore: 2, limit: 4 }, { db, sampling });
    expect(sampling.completeJson).toHaveBeenCalledTimes(2);
    expect(out.matches.length).toBe(2);
    expect(out.matches[0].score).toBe(0.9); // best first
  });

  it('skips jobs that already have a cached score when scoring missing ones', async () => {
    setCachedFit(db, { jobId: 'j1', resumeId: 'r1', score: 0.5, topStrengths: [], topGaps: [] });
    setCachedFit(db, { jobId: 'j2', resumeId: 'r1', score: 0.6, topStrengths: [], topGaps: [] });
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({ score: 0.8, top_strengths: [], top_gaps: [] })
    } as unknown as SamplingClient;

    const out = await topMatches({ scoreMissing: true, maxToScore: 5 }, { db, sampling });
    expect(sampling.completeJson).toHaveBeenCalledTimes(1); // only j3 was unscored
    expect(out.matches.length).toBe(3);
  });

  it('keeps going when scoring one job fails (partial results beat none)', async () => {
    const sampling = {
      completeJson: vi.fn()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce({ score: 0.75, top_strengths: [], top_gaps: [] })
    } as unknown as SamplingClient;

    const out = await topMatches({ scoreMissing: true, maxToScore: 2 }, { db, sampling });
    expect(out.matches.length).toBe(1);
    expect(out.matches[0].score).toBe(0.75);
  });

  it('returns empty matches (not an error) when there are no resumes', async () => {
    const empty = openDb(':memory:');
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    const out = await topMatches({ scoreMissing: true }, { db: empty, sampling });
    expect(out.matches).toEqual([]);
  });

  it('respects limit', async () => {
    setCachedFit(db, { jobId: 'j1', resumeId: 'r1', score: 0.6, topStrengths: [], topGaps: [] });
    setCachedFit(db, { jobId: 'j2', resumeId: 'r1', score: 0.7, topStrengths: [], topGaps: [] });
    setCachedFit(db, { jobId: 'j3', resumeId: 'r1', score: 0.8, topStrengths: [], topGaps: [] });
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    const out = await topMatches({ limit: 2 }, { db, sampling });
    expect(out.matches.length).toBe(2);
    expect(out.matches[0].score).toBe(0.8);
  });
});
