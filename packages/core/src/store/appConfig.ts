import type { Db } from './db.ts';

export type SubmitPolicy = 'review' | 'auto';

export type AppConfig = {
  /** Model id used by the API-key (GUI) sampling path. */
  model: string;
  /** Anti-spam weekly application cap. */
  weeklyCap: number;
  /** Default auto-submit posture for the apply flow. */
  submitPolicy: SubmitPolicy;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  model: 'claude-sonnet-4-6',
  weeklyCap: 10,
  submitPolicy: 'review'
};

export function getConfig(db: Db): AppConfig {
  const row = db.prepare(`SELECT data_json FROM app_config WHERE id = 1`).get() as
    | { data_json: string }
    | undefined;
  if (!row) return { ...DEFAULT_APP_CONFIG };
  const stored = JSON.parse(row.data_json) as Partial<AppConfig>;
  return { ...DEFAULT_APP_CONFIG, ...stored };
}

export function setConfig(db: Db, patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(db), ...patch };
  db.prepare(`
    INSERT INTO app_config (id, data_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(next), new Date().toISOString());
  return next;
}
