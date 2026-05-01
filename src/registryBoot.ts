import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Db } from './store/db.ts';
import { listAllCompanies, seedCompaniesFrom, type Company } from './store/company.ts';
import { paths } from './config.ts';

type H1bRow = { confidence: number; lastSeen: string };
type H1bFile = { snapshotDate: string; source: string; companies: Record<string, H1bRow> };

export function seedRegistryIfEmpty(db: Db): void {
  if (listAllCompanies(db).length > 0) return;

  const companiesPath = path.join(paths.registryDir(), 'companies.json');
  const h1bPath = path.join(paths.registryDir(), 'h1b.json');

  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf8')) as Company[];
  const h1b = JSON.parse(fs.readFileSync(h1bPath, 'utf8')) as H1bFile;

  const enriched: Company[] = companies.map(c => ({
    ...c,
    h1bConfidence: h1b.companies[c.id]?.confidence,
    h1bLastSeen: h1b.companies[c.id]?.lastSeen
  }));

  seedCompaniesFrom(db, enriched);
}
