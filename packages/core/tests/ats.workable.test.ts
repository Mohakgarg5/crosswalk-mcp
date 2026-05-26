import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workable } from '../src/ats/workable.ts';
import fixture from './fixtures/workable-jobs.json' with { type: 'json' };

describe('ats/workable', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await workable.listJobs('example');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'ABC123',
      title: 'Senior Product Manager - Payments',
      dept: 'Product',
      location: 'San Francisco, United States',
      url: 'https://apply.workable.com/example/j/ABC123'
    });
    expect(jobs[1].locationType).toBe('remote');
    expect(jobs[0].descriptionMd).toContain('payments roadmap');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(workable.listJobs('nope')).rejects.toThrow(/404/);
  });
});
