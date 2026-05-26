import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bamboohr } from '../src/ats/bamboohr.ts';
import fixture from './fixtures/bamboohr-jobs.json' with { type: 'json' };

describe('ats/bamboohr', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await bamboohr.listJobs('exampleco');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'abc123',
      title: 'Marketing Manager',
      dept: 'Marketing',
      url: 'https://exampleco.bamboohr.com/jobs/view.php?id=abc123'
    });
    expect(jobs[0].location).toContain('Salt Lake City');
    expect(jobs[1].locationType).toBe('remote');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(bamboohr.listJobs('nope')).rejects.toThrow(/404/);
  });
});
