import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { personio } from '../src/ats/personio.ts';

describe('ats/personio', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes from XML', async () => {
    const xml = await fs.readFile(
      path.resolve('tests/fixtures/personio-jobs.xml'),
      'utf8'
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => xml
    }));
    const jobs = await personio.listJobs('example');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '1001',
      title: 'Backend Engineer',
      dept: 'Engineering',
      location: 'Munich',
      url: 'https://example.jobs.personio.de/job/1001'
    });
    expect(jobs[0].descriptionMd).toContain('Build APIs');
    expect(jobs[1].locationType).toBe('remote');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(personio.listJobs('nope')).rejects.toThrow(/404/);
  });
});
