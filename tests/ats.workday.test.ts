import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workday } from '../src/ats/workday.ts';
import fixture from './fixtures/workday-jobs.json' with { type: 'json' };

describe('ats/workday', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T00:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('lists jobs and normalizes from POST response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'JR-12345',
      title: 'Senior Software Engineer, AI Infra',
      location: 'Santa Clara, CA',
      url: 'https://nvidia.wd5.myworkdayjobs.com/job/Santa-Clara-CA/Senior-Software-Engineer/JR-12345'
    });
    expect(jobs[1].locationType).toBe('remote');
  });

  it('parses "Posted N Days Ago" into postedAt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
    expect(jobs[0].postedAt).toBe('2026-04-27T00:00:00.000Z');
    expect(jobs[1].postedAt).toBe('2026-04-16T00:00:00.000Z');
  });

  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const recent = await workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', { sinceDays: 7 });
    expect(recent).toHaveLength(1);
    expect(recent[0].externalId).toBe('JR-12345');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite')
    ).rejects.toThrow(/404/);
  });
});
