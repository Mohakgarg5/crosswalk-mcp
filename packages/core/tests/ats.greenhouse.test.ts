import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { greenhouse } from '../src/ats/greenhouse.ts';
import fixture from './fixtures/greenhouse-jobs.json' with { type: 'json' };

describe('ats/greenhouse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T00:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await greenhouse.listJobs('stripe');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '5523112004',
      title: 'Product Manager, Payments',
      dept: 'Product',
      location: 'San Francisco, CA',
      url: 'https://boards.greenhouse.io/stripe/jobs/5523112004'
    });
    expect(jobs[1].locationType).toBe('remote');
    expect(jobs[0].descriptionMd).toContain('next generation of payments');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(greenhouse.listJobs('nope')).rejects.toThrow(/404/);
  });

  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    // Fixture timestamps: 2026-04-25 and 2026-04-20.
    // System date is 2026-04-30; sinceDays=14 includes both, sinceDays=3 excludes both.
    const recent = await greenhouse.listJobs('stripe', { sinceDays: 14 });
    expect(recent).toHaveLength(2);
    const veryRecent = await greenhouse.listJobs('stripe', { sinceDays: 3 });
    expect(veryRecent).toHaveLength(0);
  });
});
