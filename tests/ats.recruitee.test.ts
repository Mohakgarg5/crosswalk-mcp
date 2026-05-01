import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recruitee } from '../src/ats/recruitee.ts';
import fixture from './fixtures/recruitee-jobs.json' with { type: 'json' };

describe('ats/recruitee', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await recruitee.listJobs('example');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '12345',
      title: 'Senior Product Manager',
      dept: 'Product',
      url: 'https://example.recruitee.com/o/senior-pm-eu'
    });
    expect(jobs[0].location).toContain('Amsterdam');
    expect(jobs[1].locationType).toBe('remote');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(recruitee.listJobs('nope')).rejects.toThrow(/404/);
  });
});
