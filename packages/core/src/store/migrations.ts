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
  },
  {
    id: 2,
    name: 'application',
    sql: `
      CREATE TABLE application (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES job(id),
        resume_id TEXT NOT NULL REFERENCES resume(id),
        status TEXT NOT NULL DEFAULT 'draft',
        fit_score REAL,
        fit_narrative_md TEXT,
        tailored_resume_md TEXT NOT NULL,
        cover_letter_md TEXT NOT NULL,
        answer_pack_json TEXT NOT NULL,
        deep_link TEXT NOT NULL,
        created_at TEXT NOT NULL,
        submitted_at TEXT
      );
      CREATE INDEX idx_application_job ON application(job_id);
      CREATE INDEX idx_application_status ON application(status);
      CREATE INDEX idx_application_created ON application(created_at);

      CREATE TABLE application_event (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES application(id),
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX idx_application_event_app ON application_event(application_id);
      CREATE INDEX idx_application_event_at ON application_event(at);
    `
  }
  ,
  {
    id: 3,
    name: 'workflow',
    sql: `
      CREATE TABLE workflow (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        description TEXT NOT NULL,
        cron TEXT NOT NULL,
        params_json TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        last_status TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_workflow_next_run ON workflow(next_run_at);
    `
  }
  ,
  {
    id: 4,
    name: 'fit_score_cache',
    sql: `
      CREATE TABLE fit_score_cache (
        job_id TEXT NOT NULL REFERENCES job(id),
        resume_id TEXT NOT NULL REFERENCES resume(id),
        score REAL NOT NULL,
        top_strengths_json TEXT NOT NULL,
        top_gaps_json TEXT NOT NULL,
        narrative_md TEXT,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (job_id, resume_id)
      );
      CREATE INDEX idx_fit_cache_computed ON fit_score_cache(computed_at);
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
