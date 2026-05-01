import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import {
  createWorkflow, getWorkflow, listWorkflows,
  listDueWorkflows, recordWorkflowRun
} from '../src/store/workflow.ts';

describe('store/workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('creates and reads back a workflow', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'w1', kind: 'fetch_jobs_refresh',
      description: 'Refresh PM roles weekly',
      cron: '0 9 * * 1', params: { titleContains: 'PM' },
      nextRunAt: future
    });
    const w = getWorkflow(db, 'w1');
    expect(w?.kind).toBe('fetch_jobs_refresh');
    expect(w?.params).toEqual({ titleContains: 'PM' });
  });

  it('lists workflows newest first', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'a', kind: 'prune_old_jobs', description: 'a',
      cron: '0 0 * * *', params: { olderThanDays: 60 }, nextRunAt: future
    });
    createWorkflow(db, {
      id: 'b', kind: 'fetch_jobs_refresh', description: 'b',
      cron: '0 9 * * 1', params: {}, nextRunAt: future
    });
    expect(listWorkflows(db).map(w => w.id)).toEqual(['b', 'a']);
  });

  it('listDueWorkflows returns only those with next_run_at <= now', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'due', kind: 'prune_old_jobs', description: 'd',
      cron: '0 0 * * *', params: {}, nextRunAt: past
    });
    createWorkflow(db, {
      id: 'later', kind: 'prune_old_jobs', description: 'l',
      cron: '0 0 * * *', params: {}, nextRunAt: future
    });
    expect(listDueWorkflows(db).map(w => w.id)).toEqual(['due']);
  });

  it('recordWorkflowRun updates last_run_at, last_status, next_run_at', () => {
    createWorkflow(db, {
      id: 'w', kind: 'prune_old_jobs', description: 'd',
      cron: '0 0 * * *', params: {}, nextRunAt: new Date(Date.now() - 60_000).toISOString()
    });
    const next = new Date(Date.now() + 86400_000).toISOString();
    recordWorkflowRun(db, 'w', { status: 'ok', nextRunAt: next });
    const w = getWorkflow(db, 'w');
    expect(w?.lastStatus).toBe('ok');
    expect(w?.nextRunAt).toBe(next);
    expect(w?.lastRunAt).toBeTypeOf('string');
  });
});
