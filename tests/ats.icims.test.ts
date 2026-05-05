import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { icims } from '../src/ats/icims.ts';

describe('ats/icims', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('lists jobs from HTML fixture', async () => {
    const html = await fs.readFile(path.resolve('tests/fixtures/icims-jobs.html'), 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => html
    }));
    const jobs = await icims.listJobs('example');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '12345',
      title: 'Senior Engineer',
      dept: 'Engineering',
      location: 'San Francisco, CA',
      url: 'https://careers-example.icims.com/jobs/12345/Senior-Engineer/job'
    });
    expect(jobs[1].locationType).toBe('remote');
  });

  it('parses postdate into ISO timestamp', async () => {
    const html = await fs.readFile(path.resolve('tests/fixtures/icims-jobs.html'), 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => html
    }));
    const jobs = await icims.listJobs('example');
    expect(jobs[0].postedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(jobs[1].postedAt).toBe('2026-04-20T00:00:00.000Z');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(icims.listJobs('nope')).rejects.toThrow(/404/);
  });
});
