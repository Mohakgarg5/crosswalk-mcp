import type Database from 'better-sqlite3';

export type Migration = { id: number; name: string; sql: string };

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE resume (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        source_path TEXT,
        raw_text TEXT NOT NULL,
        parsed_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE company (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ats TEXT NOT NULL,
        ats_org_slug TEXT NOT NULL,
        h1b_confidence REAL,
        h1b_last_seen TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_company_ats ON company(ats);
      CREATE INDEX idx_company_name ON company(name);

      CREATE TABLE job (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL REFERENCES company(id),
        title TEXT NOT NULL,
        dept TEXT,
        location TEXT,
        location_type TEXT,
        salary_min INTEGER,
        salary_max INTEGER,
        currency TEXT,
        description_md TEXT,
        url TEXT NOT NULL,
        posted_at TEXT,
        last_seen_at TEXT NOT NULL,
        raw_json TEXT NOT NULL
      );
      CREATE INDEX idx_job_company ON job(company_id);
      CREATE INDEX idx_job_last_seen ON job(last_seen_at);
    `
  }
];

export function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare(`SELECT id FROM migrations`).all() as Array<{ id: number }>).map(r => r.id)
  );
  const insert = db.prepare(`INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)`);
  const tx = db.transaction((m: Migration) => {
    db.exec(m.sql);
    insert.run(m.id, m.name, new Date().toISOString());
  });
  for (const m of migrations) {
    if (!applied.has(m.id)) tx(m);
  }
}
