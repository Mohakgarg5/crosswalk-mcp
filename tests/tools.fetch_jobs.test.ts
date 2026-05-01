import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { seedRegistryIfEmpty } from '../src/registryBoot.ts';
import { fetchJobs } from '../src/tools/fetch_jobs.ts';
import ghFixture from './fixtures/greenhouse-jobs.json' with { type: 'json' };
import lvFixture from './fixtures/lever-jobs.json' with { type: 'json' };
import abFixture from './fixtures/ashby-jobs.json' with { type: 'json' };

function mockFetch() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('greenhouse.io')) return { ok: true, status: 200, json: async () => ghFixture };
    if (url.includes('lever.co')) return { ok: true, status: 200, json: async () => lvFixture };
    if (url.includes('ashbyhq.com')) return { ok: true, status: 200, json: async () => abFixture };
    return { ok: false, status: 404 };
  });
}

describe('tools/fetch_jobs', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    seedRegistryIfEmpty(db);
    vi.stubGlobal('fetch', mockFetch());
  });

  it('aggregates jobs from all ATSs', async () => {
    const out = await fetchJobs({}, { db });
    expect(out.jobs.length).toBeGreaterThan(0);
    const companies = new Set(out.jobs.map(j => j.company));
    expect(companies.size).toBeGreaterThan(1);
  });

  it('respects titleContains filter', async () => {
    const out = await fetchJobs({ titleContains: 'Engineer' }, { db });
    expect(out.jobs.every(j => j.title.toLowerCase().includes('engineer'))).toBe(true);
  });

  it('respects h1bSponsorOnly filter', async () => {
    const out = await fetchJobs({ h1bSponsorOnly: true, h1bMinConfidence: 0.9 }, { db });
    expect(out.jobs.every(j => (j.h1bConfidence ?? 0) >= 0.9)).toBe(true);
  });
});
