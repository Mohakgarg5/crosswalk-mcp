import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { setCachedFit, getCachedFit } from '../src/store/fitScoreCache.ts';
import { scoreAndGate } from '../src/services/fitGate.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

function seed(db: ReturnType<typeof openDb>) {
  upsertCompany(db, { id: 'c', name: 'Co', ats: 'greenhouse', atsOrgSlug: 'co' });
  upsertJobs(db, [
    { id: 'j-hi', companyId: 'c', title: 'PM', url: 'https://x/hi', descriptionMd: 'd', raw: {} },
    { id: 'j-lo', companyId: 'c', title: 'Sales', url: 'https://x/lo', descriptionMd: 'd', raw: {} }
  ]);
  addResume(db, { id: 'r-1', label: 'PM', rawText: 'resume', parsed: {} });
  upsertProfile(db, { name: 'Ada', email: 'ada@x.com' });
}

// Sampling stub that scores j-hi high and everything else low.
function scoringSampling(): SamplingClient {
  return {
    complete: async () => 'x',
    completeJson: async (req: { prompt: string }) => {
      const isHi = req.prompt.includes('"title":"PM"');
      return { score: isHi ? 0.82 : 0.2, top_strengths: ['s'], top_gaps: ['g'] };
    }
  } as unknown as SamplingClient;
}

describe('scoreAndGate', () => {
  it('keeps only jobs scoring >= minFit and caches every score', async () => {
    const db = openDb(':memory:');
    seed(db);
    const res = await scoreAndGate({ db, sampling: scoringSampling() }, ['j-hi', 'j-lo'], { resumeId: 'r-1', minFit: 0.6 });
    expect(res.kept).toEqual(['j-hi']);
    expect(res.considered).toBe(2);
    expect(res.scores['j-hi']).toBeCloseTo(0.82);
    expect(getCachedFit(db, 'j-hi', 'r-1')?.score).toBeCloseTo(0.82);
  });

  it('reuses a cached score instead of re-scoring', async () => {
    const db = openDb(':memory:');
    seed(db);
    setCachedFit(db, { jobId: 'j-hi', resumeId: 'r-1', score: 0.95, topStrengths: [], topGaps: [] });
    let calls = 0;
    const counting = {
      complete: async () => 'x',
      completeJson: async () => { calls++; return { score: 0.1, top_strengths: [], top_gaps: [] }; }
    } as unknown as SamplingClient;
    const res = await scoreAndGate({ db, sampling: counting }, ['j-hi'], { resumeId: 'r-1', minFit: 0.6 });
    expect(res.kept).toEqual(['j-hi']);
    expect(calls).toBe(0); // served from cache
  });

  it('falls back to auto-pick when no resumeId is given (uses first resume)', async () => {
    const db = openDb(':memory:');
    seed(db);
    const res = await scoreAndGate({ db, sampling: scoringSampling() }, ['j-hi'], { minFit: 0.6 });
    expect(res.kept).toEqual(['j-hi']);
  });
});
