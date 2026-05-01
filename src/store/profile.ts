import type { Db } from './db.ts';

export type Profile = Record<string, unknown>;

export function getProfile(db: Db): Profile | null {
  const row = db
    .prepare(`SELECT data_json FROM profile WHERE id = 1`)
    .get() as { data_json: string } | undefined;
  return row ? (JSON.parse(row.data_json) as Profile) : null;
}

export function upsertProfile(db: Db, data: Profile): void {
  db.prepare(`
    INSERT INTO profile (id, data_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(data), new Date().toISOString());
}
