import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { importCompanies, countCompanies, getCompany } from '../src/store/company.ts';

describe('importCompanies — bulk registry growth', () => {
  it('imports valid entries and derives <ats>:<slug> ids', () => {
    const db = openDb(':memory:');
    const before = countCompanies(db);
    const res = importCompanies(db, [
      { name: 'Acme', ats: 'greenhouse', slug: 'acme' },
      { name: 'Globex', ats: 'lever', slug: 'globex', h1bConfidence: 0.8 }
    ]);
    expect(res.imported).toBe(2);
    expect(countCompanies(db)).toBe(before + 2);
    expect(getCompany(db, 'greenhouse:acme')?.name).toBe('Acme');
    expect(getCompany(db, 'lever:globex')?.h1bConfidence).toBe(0.8);
  });

  it('skips entries with an unknown ATS or missing fields', () => {
    const db = openDb(':memory:');
    const res = importCompanies(db, [
      { name: 'Bad', ats: 'notreal', slug: 'bad' },
      { name: '', ats: 'greenhouse', slug: 'x' }
    ]);
    expect(res.imported).toBe(0);
    expect(res.skipped.length).toBe(2);
  });
});
