import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lever } from '../src/ats/lever.ts';
import fixture from './fixtures/lever-jobs.json' with { type: 'json' };

describe('ats/lever', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await lever.listJobs('netflix');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'abc-123',
      title: 'Senior Backend Engineer',
      dept: 'Engineering',
      location: 'Los Gatos, CA',
      url: 'https://jobs.lever.co/netflix/abc-123'
    });
    expect(jobs[1].locationType).toBe('remote');
  });

  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    // Lever fixture epochs are 2025; very old by current 2026 system date.
    const wide = await lever.listJobs('netflix', { sinceDays: 1000 });
    expect(wide).toHaveLength(2);
    const narrow = await lever.listJobs('netflix', { sinceDays: 30 });
    expect(narrow).toHaveLength(0);
  });
});
