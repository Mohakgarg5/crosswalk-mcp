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

  it('ranks title matches first when the query derives a category', async () => {
    const db = openDb(':memory:');
    const r = await searchRoles(db, { query: 'product manager' }, fakeFetch());
    // Category does the filtering server-side; everything returned is kept,
    // with title matches ranked first.
    expect(r.jobs[0].company).toBe('Acme');
    expect(r.jobs[0].title).toBe('Senior Product Manager');
  });

  it('derives a Muse category from a common role query and sends it to the API', async () => {
    const db = openDb(':memory:');
    const urls: string[] = [];
    const spyFetch = (async (u: string) => {
      urls.push(u);
      return { ok: true, json: async () => fixture };
    }) as unknown as typeof fetch;
    await searchRoles(db, { query: 'product manager' }, spyFetch);
    expect(urls.length).toBeGreaterThan(0);
    expect(new URL(urls[0]).searchParams.get('category')).toBe('Product Management');
  });

  it('with a derived category, keeps category jobs whose titles do not contain the query (title matches first)', async () => {
    const db = openDb(':memory:');
    const pmFixture = {
      total: 2, page_count: 1,
      results: [
        {
          id: 201, name: 'Director, Product', publication_date: '2026-05-25T00:00:00Z',
          refs: { landing_page: 'https://www.themuse.com/jobs/acme/dp' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'Acme', short_name: 'acme' }
        },
        {
          id: 202, name: 'Senior Product Manager', publication_date: '2026-05-24T00:00:00Z',
          refs: { landing_page: 'https://www.themuse.com/jobs/globex/spm' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'Globex', short_name: 'globex' }
        }
      ]
    };
    const f = (async () => ({ ok: true, json: async () => pmFixture })) as unknown as typeof fetch;
    const r = await searchRoles(db, { query: 'product manager' }, f);
    expect(r.jobs.length).toBe(2);
    expect(r.jobs[0].title).toBe('Senior Product Manager'); // title match ranked first
    expect(r.jobs[1].title).toBe('Director, Product');
  });

  it('an explicit category wins over the derived one and disables title narrowing', async () => {
    const db = openDb(':memory:');
    const urls: string[] = [];
    const spyFetch = (async (u: string) => {
      urls.push(u);
      return { ok: true, json: async () => fixture };
    }) as unknown as typeof fetch;
    const r = await searchRoles(db, { query: 'product manager', category: 'Data and Analytics' }, spyFetch);
    expect(new URL(urls[0]).searchParams.get('category')).toBe('Data and Analytics');
    expect(r.jobs.length).toBe(2); // no title narrowing when category is explicit
  });

  it('still narrows by title when no category can be derived from the query', async () => {
    const db = openDb(':memory:');
    const r = await searchRoles(db, { query: 'underwater basket weaver' }, fakeFetch());
    expect(r.jobs.length).toBe(0);
  });
});
