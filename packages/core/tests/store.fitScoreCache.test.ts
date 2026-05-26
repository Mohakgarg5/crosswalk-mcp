import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  setCachedFit, getCachedFit, setCachedNarrative, listCachedFits
} from '../src/store/fitScoreCache.ts';

describe('store/fitScoreCache', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('upserts and reads back a fit score', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.78, topStrengths: ['payments domain'], topGaps: ['no Kafka']
    });
    const cached = getCachedFit(db, 'g:stripe:1', 'r1');
    expect(cached?.score).toBe(0.78);
    expect(cached?.topStrengths).toEqual(['payments domain']);
    expect(cached?.topGaps).toEqual(['no Kafka']);
    expect(cached?.narrativeMd).toBeUndefined();
  });

  it('returns null when no entry exists', () => {
    expect(getCachedFit(db, 'g:stripe:1', 'r1')).toBeNull();
  });

  it('overwrites on second setCachedFit', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.5, topStrengths: ['a'], topGaps: ['b']
    });
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.9, topStrengths: ['c'], topGaps: ['d']
    });
    expect(getCachedFit(db, 'g:stripe:1', 'r1')?.score).toBe(0.9);
  });

  it('setCachedNarrative updates only the narrative field', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.78, topStrengths: ['a'], topGaps: ['b']
    });
    setCachedNarrative(db, 'g:stripe:1', 'r1', '## Fit\n\n78%...');
    const cached = getCachedFit(db, 'g:stripe:1', 'r1');
    expect(cached?.score).toBe(0.78);
    expect(cached?.narrativeMd).toContain('Fit');
  });

  it('setCachedNarrative is a no-op when no row exists', () => {
    setCachedNarrative(db, 'g:stripe:1', 'r1', 'narrative');
    expect(getCachedFit(db, 'g:stripe:1', 'r1')).toBeNull();
  });

  it('listCachedFits returns all entries newest first', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.5, topStrengths: [], topGaps: []
    });
    addResume(db, { id: 'r2', label: 'Senior PM', rawText: 'PM', parsed: {} });
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r2',
      score: 0.8, topStrengths: [], topGaps: []
    });
    const all = listCachedFits(db);
    expect(all).toHaveLength(2);
    expect(all[0].resumeId).toBe('r2');
  });
});
