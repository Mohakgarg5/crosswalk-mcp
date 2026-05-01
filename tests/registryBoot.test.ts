import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listAllCompanies } from '../src/store/company.ts';
import { seedRegistryIfEmpty } from '../src/registryBoot.ts';
import companies from '../registry/companies.json' with { type: 'json' };

describe('registryBoot', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('seeds when empty', () => {
    seedRegistryIfEmpty(db);
    expect(listAllCompanies(db)).toHaveLength(companies.length);
  });

  it('does not double-seed', () => {
    seedRegistryIfEmpty(db);
    seedRegistryIfEmpty(db);
    expect(listAllCompanies(db)).toHaveLength(companies.length);
  });
});
