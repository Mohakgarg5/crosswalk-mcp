import type { Db } from './db.ts';

/** ATS slugs that have a real adapter (queryable by org slug). */
export const KNOWN_ATS = [
  'greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters',
  'bamboohr', 'recruitee', 'personio', 'workday', 'icims'
] as const;
export type KnownAts = (typeof KNOWN_ATS)[number];

/** 'themuse' marks companies discovered via the role-based aggregator (not
 *  per-company ATS-queryable; jobs are fetched by role, not by org slug). */
export type Company = {
  id: string;
  name: string;
  ats: KnownAts | 'themuse';
  atsOrgSlug: string;
  h1bConfidence?: number;
  h1bLastSeen?: string;
};

export function upsertCompany(db: Db, c: Company): void {
  db.prepare(`
    INSERT INTO company (id, name, ats, ats_org_slug, h1b_confidence, h1b_last_seen, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, ats = excluded.ats, ats_org_slug = excluded.ats_org_slug,
      h1b_confidence = excluded.h1b_confidence, h1b_last_seen = excluded.h1b_last_seen,
      updated_at = excluded.updated_at
  `).run(c.id, c.name, c.ats, c.atsOrgSlug, c.h1bConfidence ?? null,
         c.h1bLastSeen ?? null, new Date().toISOString());
}

export function getCompany(db: Db, id: string): Company | null {
  const r = db.prepare(`
    SELECT id, name, ats, ats_org_slug AS atsOrgSlug,
           h1b_confidence AS h1bConfidence, h1b_last_seen AS h1bLastSeen
    FROM company WHERE id = ?
  `).get(id) as Company | undefined;
  return r ?? null;
}

export function listCompaniesByAts(db: Db, ats: Company['ats']): Company[] {
  return (db.prepare(`
    SELECT id, name, ats, ats_org_slug AS atsOrgSlug,
           h1b_confidence AS h1bConfidence, h1b_last_seen AS h1bLastSeen
    FROM company WHERE ats = ? ORDER BY name
  `).all(ats) as Company[]);
}

export function listAllCompanies(db: Db): Company[] {
  return (db.prepare(`
    SELECT id, name, ats, ats_org_slug AS atsOrgSlug,
           h1b_confidence AS h1bConfidence, h1b_last_seen AS h1bLastSeen
    FROM company ORDER BY name
  `).all() as Company[]);
}

export function seedCompaniesFrom(db: Db, list: Company[]): void {
  const tx = db.transaction((arr: Company[]) => { for (const c of arr) upsertCompany(db, c); });
  tx(list);
}

export function countCompanies(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM company`).get() as { n: number }).n;
}

export type CompanyImportEntry = {
  name: string;
  ats: string;
  slug: string;
  h1bConfidence?: number;
};

/**
 * Bulk-import companies into the Open Job Graph. Validates the ATS against the
 * known adapters, derives a stable id of `<ats>:<slug>`, and upserts in one
 * transaction. Returns counts so callers can report progress. This is how the
 * registry grows to thousands of companies from a real dataset.
 */
export function importCompanies(db: Db, entries: CompanyImportEntry[]): { imported: number; skipped: string[] } {
  const valid: Company[] = [];
  const skipped: string[] = [];
  const known = new Set<string>(KNOWN_ATS);
  for (const e of entries) {
    const ats = String(e.ats || '').toLowerCase().trim();
    const slug = String(e.slug || '').trim();
    if (!known.has(ats) || !slug || !e.name) {
      skipped.push(`${e.name ?? '(no name)'} [${e.ats}/${e.slug}]`);
      continue;
    }
    valid.push({ id: `${ats}:${slug}`, name: e.name, ats: ats as KnownAts, atsOrgSlug: slug, h1bConfidence: e.h1bConfidence });
  }
  seedCompaniesFrom(db, valid);
  return { imported: valid.length, skipped };
}
