import { describe, it, expect, vi, beforeEach } from 'vitest';
import { smartrecruiters } from '../src/ats/smartrecruiters.ts';
import fixture from './fixtures/smartrecruiters-jobs.json' with { type: 'json' };

describe('ats/smartrecruiters', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await smartrecruiters.listJobs('example');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'abc-123',
      title: 'Staff Software Engineer',
      dept: 'Engineering',
      location: 'Berlin, Germany',
      url: 'https://jobs.smartrecruiters.com/example/abc-123'
    });
    expect(jobs[0].descriptionMd).toContain('distributed systems');
    expect(jobs[1].locationType).toBe('remote');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(smartrecruiters.listJobs('nope')).rejects.toThrow(/404/);
  });
});
