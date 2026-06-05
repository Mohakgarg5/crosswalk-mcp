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

  it('drops category jobs whose titles share no tokens with the query (Muse miscategorization)', async () => {
    const db = openDb(':memory:');
    const noisy = {
      total: 3, page_count: 1,
      results: [
        {
          id: 301, name: 'Assistant Manager - Shoppes on Maine', // retail, miscategorized by Muse
          refs: { landing_page: 'https://www.themuse.com/jobs/gapinc/am' },
          locations: [{ name: 'Maine' }], categories: [{ name: 'Product Management' }],
          company: { name: 'Gap Inc', short_name: 'gapinc' }
        },
        {
          id: 302, name: 'Senior Scrum Master', // also miscategorized
          refs: { landing_page: 'https://www.themuse.com/jobs/x/ssm' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'X', short_name: 'x' }
        },
        {
          id: 303, name: 'Group Product Manager, Payments',
          refs: { landing_page: 'https://www.themuse.com/jobs/stripe/gpm' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'Stripe', short_name: 'stripe' }
        }
      ]
    };
    const f = (async () => ({ ok: true, json: async () => noisy })) as unknown as typeof fetch;
    const r = await searchRoles(db, { query: 'product manager' }, f);
    expect(r.jobs.map(j => j.title)).toEqual(['Group Product Manager, Payments']);
  });

  it('keeps titles containing all query tokens in any order or phrasing', async () => {
    const db = openDb(':memory:');
    const pmFixture = {
      total: 2, page_count: 1,
      results: [
        {
          id: 201, name: 'Product Operations Manager', publication_date: '2026-05-25T00:00:00Z',
          refs: { landing_page: 'https://www.themuse.com/jobs/acme/pom' },
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
    expect(r.jobs[0].title).toBe('Senior Product Manager'); // exact-phrase match ranked first
    expect(r.jobs[1].title).toBe('Product Operations Manager'); // token match kept, ranked after
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

  it('drops stale postings by default and sorts newest first', async () => {
    const db = openDb(':memory:');
    const now = Date.now();
    const aged = {
      total: 3, page_count: 1,
      results: [
        {
          id: 401, name: 'Senior Product Manager, Old', publication_date: new Date(now - 60 * 86400_000).toISOString(),
          refs: { landing_page: 'https://www.themuse.com/jobs/a/old' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'OldCo', short_name: 'oldco' }
        },
        {
          id: 402, name: 'Senior Product Manager, Newest', publication_date: new Date(now - 1 * 86400_000).toISOString(),
          refs: { landing_page: 'https://www.themuse.com/jobs/b/new' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'NewCo', short_name: 'newco' }
        },
        {
          id: 403, name: 'Senior Product Manager, Recent', publication_date: new Date(now - 10 * 86400_000).toISOString(),
          refs: { landing_page: 'https://www.themuse.com/jobs/c/recent' },
          locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
          company: { name: 'RecentCo', short_name: 'recentco' }
        }
      ]
    };
    const f = (async () => ({ ok: true, json: async () => aged })) as unknown as typeof fetch;
    const r = await searchRoles(db, { query: 'senior product manager' }, f);
    // 60-day-old posting dropped (default 21-day window); newest first.
    expect(r.jobs.map(j => j.company)).toEqual(['NewCo', 'RecentCo']);
  });

  it('honors an explicit sinceDays override', async () => {
    const db = openDb(':memory:');
    const now = Date.now();
    const aged = {
      total: 1, page_count: 1,
      results: [{
        id: 405, name: 'Senior Product Manager, Old', publication_date: new Date(now - 60 * 86400_000).toISOString(),
        refs: { landing_page: 'https://www.themuse.com/jobs/a/old' },
        locations: [{ name: 'Remote' }], categories: [{ name: 'Product Management' }],
        company: { name: 'OldCo', short_name: 'oldco' }
      }]
    };
    const f = (async () => ({ ok: true, json: async () => aged })) as unknown as typeof fetch;
    const r = await searchRoles(db, { query: 'senior product manager', sinceDays: 90 }, f);
    expect(r.jobs.length).toBe(1);
  });
});
