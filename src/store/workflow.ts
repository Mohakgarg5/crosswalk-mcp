import type { Db } from './db.ts';

export type WorkflowKind = 'fetch_jobs_refresh' | 'prune_old_jobs';

export type Workflow = {
  id: string;
  kind: WorkflowKind;
  description: string;
  cron: string;
  params: Record<string, unknown>;
  lastRunAt?: string;
  nextRunAt: string;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
  createdAt: string;
};

export type WorkflowInput = {
  id: string;
  kind: WorkflowKind;
  description: string;
  cron: string;
  params: Record<string, unknown>;
  nextRunAt: string;
};

const SELECT = `
  SELECT id, kind, description, cron, params_json,
         last_run_at AS lastRunAt, next_run_at AS nextRunAt,
         last_status AS lastStatus, last_error AS lastError,
         created_at AS createdAt
  FROM workflow
`;

type Row = {
  id: string; kind: WorkflowKind; description: string; cron: string;
  params_json: string; lastRunAt: string | null; nextRunAt: string;
  lastStatus: 'ok' | 'error' | null; lastError: string | null;
  createdAt: string;
};

function rowToWorkflow(r: Row): Workflow {
  return {
    id: r.id, kind: r.kind, description: r.description, cron: r.cron,
    params: JSON.parse(r.params_json) as Record<string, unknown>,
    lastRunAt: r.lastRunAt ?? undefined,
    nextRunAt: r.nextRunAt,
    lastStatus: r.lastStatus ?? undefined,
    lastError: r.lastError ?? undefined,
    createdAt: r.createdAt
  };
}

export function createWorkflow(db: Db, input: WorkflowInput): Workflow {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO workflow (
      id, kind, description, cron, params_json,
      last_run_at, next_run_at, last_status, last_error, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)
  `).run(
    input.id, input.kind, input.description, input.cron,
    JSON.stringify(input.params), input.nextRunAt, createdAt
  );
  return { ...input, createdAt };
}

export function getWorkflow(db: Db, id: string): Workflow | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToWorkflow(r) : null;
}

export function listWorkflows(db: Db): Workflow[] {
  const rows = db.prepare(`${SELECT} ORDER BY created_at DESC, rowid DESC`).all() as Row[];
  return rows.map(rowToWorkflow);
}

export function listDueWorkflows(db: Db): Workflow[] {
  const now = new Date().toISOString();
  const rows = db.prepare(`${SELECT} WHERE next_run_at <= ? ORDER BY next_run_at ASC`).all(now) as Row[];
  return rows.map(rowToWorkflow);
}

export function deleteWorkflow(db: Db, id: string): boolean {
  const result = db.prepare(`DELETE FROM workflow WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function recordWorkflowRun(
  db: Db,
  id: string,
  result: { status: 'ok' | 'error'; error?: string; nextRunAt: string }
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE workflow
    SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?
    WHERE id = ?
  `).run(now, result.status, result.error ?? null, result.nextRunAt, id);
}
