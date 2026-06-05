import type { Db } from './db.ts';

export type SubmitPolicy = 'review' | 'auto';

export type AppConfig = {
  /** Model id used by the API-key (GUI) sampling path. */
  model: string;
  /** Anti-spam weekly application cap. */
  weeklyCap: number;
  /** Default auto-submit posture for the apply flow. */
  submitPolicy: SubmitPolicy;
  /** Max wizard pages to navigate when applying (1 = single-page only; raise
   *  to ~8 for multi-step ATSes like Workday). */
  applyMaxSteps: number;
  /** How long (ms) to poll the inbox for a verification code/link before
   *  pausing-and-flagging the application. Only used when an email inbox is
   *  configured. */
  verificationTimeoutMs: number;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  model: 'claude-sonnet-4-6',
  weeklyCap: 10,
  submitPolicy: 'review',
  // Walk up to 8 wizard pages (covers Workday's typical 3-5 step flow plus
  // safety margin). Auto-fill on each page; the loop stops when no Next
  // button is found, so single-page forms still finish in one pass.
  applyMaxSteps: 8,
  verificationTimeoutMs: 240_000
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
