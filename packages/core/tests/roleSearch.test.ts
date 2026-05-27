import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listJobs } from '../src/store/job.ts';
import { listAllCompanies } from '../src/store/company.ts';
import { searchRoles } from '../src/services/roleSearch.ts';

const fixture = {
  total: 2,
  page_count: 1,
  results: [
    {
      id: 101, name: 'Senior Product Manager', publication_date: '2026-05-25T00:00:00Z',
      refs: { landing_page: 'https://www.themuse.com/jobs/acme/spm' },
      locations: [{ name: 'New York, NY' }], categories: [{ name: 'Product Management' }],
      company: { id: 1, name: 'Acme', short_name: 'acme' }
    },
    {
      id: 102, name: 'Data Engineer', publication_date: '2026-05-24T00:00:00Z',
      refs: { landing_page: 'https://www.themuse.com/jobs/globex/de' },
      locations: [{ name: 'Flexible / Remote' }], categories: [{ name: 'Data and Analytics' }],
      company: { name: 'Globex', short_name: 'globex' }
    }
  ]
};

function fakeFetch(): typeof fetch {
  return (async () => ({ ok: true, json: async () => fixture })) as unknown as typeof fetch;
}

describe('searchRoles — role-based discovery across companies', () => {
  it('fetches, normalizes, and persists jobs across many companies', async () => {
    const db = openDb(':memory:');
    const r = await searchRoles(db, { pages: 1 }, fakeFetch());
    expect(r.jobs.length).toBe(2);
    expect(r.jobs[0]).toMatchObject({ id: 'themuse:101', company: 'Acme', title: 'Senior Product Manager', location: 'New York, NY' });
    expect(r.jobs[1].locationType).toBe('remote');
    expect(listJobs(db).length).toBe(2);
    expect(listAllCompanies(db).map(c => c.name).sort()).toEqual(['Acme', 'Globex']);
  });

  it('filters by role query (title contains), not by company', async () => {
    const db = openDb(':memory:');
    const r = await searchRoles(db, { query: 'product manager' }, fakeFetch());
    expect(r.jobs.length).toBe(1);
    expect(r.jobs[0].company).toBe('Acme');
  });
});
