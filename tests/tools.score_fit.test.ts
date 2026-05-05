import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { scoreFit } from '../src/tools/score_fit.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/score_fit', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'greenhouse:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://x', descriptionMd: 'Lead Payments product.', raw: {}
    }]);
    addResume(db, {
      id: 'r1', label: 'Generic PM', rawText: 'PM with payments experience',
      parsed: { skills: ['payments', 'sql'] }
    });
  });

  it('returns a structured score', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        score: 0.82, top_strengths: ['payments domain'], top_gaps: ['no Kafka']
      })
    } as unknown as SamplingClient;
    const out = await scoreFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });
    expect(out.score).toBe(0.82);
    expect(out.topStrengths).toEqual(['payments domain']);
    expect(out.topGaps).toEqual(['no Kafka']);
  });

  it('errors on unknown job', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(scoreFit({ jobId: 'nope' }, { db, sampling })).rejects.toThrow(/unknown job/);
  });

  it('persists the score to the fit_score_cache', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        score: 0.82, top_strengths: ['payments domain'], top_gaps: ['no Kafka']
      })
    } as unknown as SamplingClient;
    await scoreFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });

    const { getCachedFit } = await import('../src/store/fitScoreCache.ts');
    const cached = getCachedFit(db, 'greenhouse:stripe:1', 'r1');
    expect(cached?.score).toBe(0.82);
    expect(cached?.topStrengths).toEqual(['payments domain']);
    expect(cached?.topGaps).toEqual(['no Kafka']);
  });
});
