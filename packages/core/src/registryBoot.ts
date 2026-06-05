import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Db } from './store/db.ts';
import { listAllCompanies, seedCompaniesFrom, type Company } from './store/company.ts';
import { paths } from './config.ts';

type H1bRow = { confidence: number; lastSeen: string };
type H1bFile = { snapshotDate: string; source: string; companies: Record<string, H1bRow> };

export function seedRegistryIfEmpty(db: Db): void {
  // Merge-seed: add registry companies the DB doesn't know yet. The original
  // empty-check meant registry updates only ever reached FRESH installs — a
  // DB seeded from an older (smaller) registry never saw additions.
  const known = new Set(listAllCompanies(db).map(c => c.id));

  const companiesPath = path.join(paths.registryDir(), 'companies.json');
  const h1bPath = path.join(paths.registryDir(), 'h1b.json');

  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf8')) as Company[];
  const h1b = JSON.parse(fs.readFileSync(h1bPath, 'utf8')) as H1bFile;

  const missing = companies.filter(c => !known.has(c.id));
  if (missing.length === 0) return;

  const enriched: Company[] = missing.map(c => ({
    ...c,
    h1bConfidence: h1b.companies[c.id]?.confidence,
    h1bLastSeen: h1b.companies[c.id]?.lastSeen
  }));

  seedCompaniesFrom(db, enriched);
}
