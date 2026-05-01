import type { Db } from './db.ts';

export type StoredJob = {
  id: string;
  companyId: string;
  title: string;
  dept?: string;
  location?: string;
  locationType?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  descriptionMd?: string;
  url: string;
  postedAt?: string;
  raw: Record<string, unknown>;
};

export type JobFilters = {
  sinceDays?: number;
  titleContains?: string;
  companyIds?: string[];
  locationContains?: string;
  remoteOnly?: boolean;
  limit?: number;
};

export function upsertJobs(db: Db, jobs: StoredJob[]): void {
  const stmt = db.prepare(`
    INSERT INTO job (id, company_id, title, dept, location, location_type,
                     salary_min, salary_max, currency, description_md, url,
                     posted_at, last_seen_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, dept = excluded.dept, location = excluded.location,
      location_type = excluded.location_type, salary_min = excluded.salary_min,
      salary_max = excluded.salary_max, currency = excluded.currency,
      description_md = excluded.description_md, url = excluded.url,
      posted_at = excluded.posted_at, last_seen_at = excluded.last_seen_at,
      raw_json = excluded.raw_json
  `);
  const now = new Date().toISOString();
  const tx = db.transaction((arr: StoredJob[]) => {
    for (const j of arr) {
      stmt.run(j.id, j.companyId, j.title, j.dept ?? null, j.location ?? null,
        j.locationType ?? null, j.salaryMin ?? null, j.salaryMax ?? null,
        j.currency ?? null, j.descriptionMd ?? null, j.url, j.postedAt ?? null,
        now, JSON.stringify(j.raw));
    }
  });
  tx(jobs);
}

export function listJobs(db: Db, f: JobFilters = {}): StoredJob[] {
  const where: string[] = [];
  const args: unknown[] = [];

  if (f.sinceDays !== undefined) {
    const cutoff = new Date(Date.now() - f.sinceDays * 86400_000).toISOString();
    where.push(`(posted_at IS NULL OR posted_at >= ?)`);
    args.push(cutoff);
  }
  if (f.titleContains) {
    where.push(`title LIKE ?`);
    args.push(`%${f.titleContains}%`);
  }
  if (f.companyIds?.length) {
    where.push(`company_id IN (${f.companyIds.map(() => '?').join(',')})`);
    args.push(...f.companyIds);
  }
  if (f.locationContains) {
    where.push(`location LIKE ?`);
    args.push(`%${f.locationContains}%`);
  }
  if (f.remoteOnly) {
    where.push(`location_type = 'remote'`);
  }

  const limit = f.limit ?? 50;
  const sql = `
    SELECT id, company_id AS companyId, title, dept, location,
           location_type AS locationType, salary_min AS salaryMin,
           salary_max AS salaryMax, currency, description_md AS descriptionMd,
           url, posted_at AS postedAt, raw_json
    FROM job
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY posted_at DESC NULLS LAST
    LIMIT ?
  `;

  return (db.prepare(sql).all(...args, limit) as Array<StoredJob & { raw_json: string }>).map(r => ({
    id: r.id, companyId: r.companyId, title: r.title,
    dept: r.dept ?? undefined, location: r.location ?? undefined,
    locationType: r.locationType ?? undefined,
    salaryMin: r.salaryMin ?? undefined, salaryMax: r.salaryMax ?? undefined,
    currency: r.currency ?? undefined,
    descriptionMd: r.descriptionMd ?? undefined,
    url: r.url, postedAt: r.postedAt ?? undefined,
    raw: JSON.parse(r.raw_json) as Record<string, unknown>
  }));
}
