import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ashby } from '../src/ats/ashby.ts';
import fixture from './fixtures/ashby-jobs.json' with { type: 'json' };

describe('ats/ashby', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await ashby.listJobs('openai');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'uuid-1',
      title: 'Member of Technical Staff',
      dept: 'Research',
      location: 'San Francisco',
      url: 'https://jobs.ashbyhq.com/openai/uuid-1'
    });
    expect(jobs[0].salaryMin).toBe(300000);
    expect(jobs[0].salaryMax).toBe(500000);
    expect(jobs[1].locationType).toBe('remote');
  });

  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    // Ashby fixture: 2026-04-28 and 2026-04-22. System date 2026-04-30.
    const wide = await ashby.listJobs('openai', { sinceDays: 30 });
    expect(wide).toHaveLength(2);
    const narrow = await ashby.listJobs('openai', { sinceDays: 5 });
    expect(narrow).toHaveLength(1);
  });
});
