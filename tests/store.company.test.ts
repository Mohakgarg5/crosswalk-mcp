import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany, listCompaniesByAts, seedCompaniesFrom } from '../src/store/company.ts';

describe('store/company', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('upserts and lists by ats', () => {
    upsertCompany(db, { id: 'c1', name: 'Acme', ats: 'greenhouse', atsOrgSlug: 'acme' });
    upsertCompany(db, { id: 'c2', name: 'Globex', ats: 'lever', atsOrgSlug: 'globex' });
    expect(listCompaniesByAts(db, 'greenhouse').map(c => c.name)).toEqual(['Acme']);
  });

  it('seeds from a registry array', () => {
    seedCompaniesFrom(db, [
      { id: 'c1', name: 'Acme', ats: 'greenhouse', atsOrgSlug: 'acme' },
      { id: 'c2', name: 'Globex', ats: 'lever', atsOrgSlug: 'globex' }
    ]);
    expect(listCompaniesByAts(db, 'greenhouse')).toHaveLength(1);
    expect(listCompaniesByAts(db, 'lever')).toHaveLength(1);
  });
});
