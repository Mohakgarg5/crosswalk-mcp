import type { Db } from './db.ts';

export type Company = {
  id: string;
  name: string;
  ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'bamboohr' | 'recruitee' | 'personio' | 'workday' | 'icims';
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
