import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { explainFit } from '../src/tools/explain_fit.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/explain_fit', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'greenhouse:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://x', descriptionMd: 'Lead Payments product.', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('returns a markdown narrative', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('## Fit\n\n82% fit. Strong on payments. Gap: Kafka.')
    } as unknown as SamplingClient;
    const out = await explainFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });
    expect(out.narrativeMd).toContain('Fit');
    expect(out.narrativeMd).toContain('Kafka');
  });

  it('writes the narrative to fit_score_cache when a score row exists', async () => {
    const { setCachedFit, getCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'greenhouse:stripe:1', resumeId: 'r1',
      score: 0.82, topStrengths: [], topGaps: []
    });

    const sampling = {
      complete: vi.fn().mockResolvedValue('## Fit\n\n82% fit. Strong on payments.')
    } as unknown as SamplingClient;
    await explainFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });

    const cached = getCachedFit(db, 'greenhouse:stripe:1', 'r1');
    expect(cached?.narrativeMd).toContain('Fit');
  });

  it('is a no-op on cache when no score row exists', async () => {
    const { getCachedFit } = await import('../src/store/fitScoreCache.ts');
    const sampling = {
      complete: vi.fn().mockResolvedValue('## Fit\n\nbody')
    } as unknown as SamplingClient;
    await explainFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });
    expect(getCachedFit(db, 'greenhouse:stripe:1', 'r1')).toBeNull();
  });
});
