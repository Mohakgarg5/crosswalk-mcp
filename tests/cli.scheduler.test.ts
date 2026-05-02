import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { createWorkflow, claimDueWorkflow } from '../src/store/workflow.ts';

describe('store/workflow concurrency', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('claimDueWorkflow returns the workflow once even if called twice', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createWorkflow(db, {
      id: 'w1', kind: 'prune_old_jobs', description: 'd',
      cron: '0 0 * * *', params: {}, nextRunAt: past
    });
    const first = claimDueWorkflow(db);
    expect(first?.id).toBe('w1');
    // Second claim with the same `now` should NOT return w1 — its next_run_at was
    // bumped 1h forward by the claim. Returns null.
    const second = claimDueWorkflow(db);
    expect(second).toBeNull();
  });

  it('claimDueWorkflow returns null when nothing is due', () => {
    expect(claimDueWorkflow(db)).toBeNull();
  });

  it('claimDueWorkflow returns multiple workflows across calls', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createWorkflow(db, {
      id: 'a', kind: 'prune_old_jobs', description: 'a',
      cron: '0 0 * * *', params: {}, nextRunAt: past
    });
    createWorkflow(db, {
      id: 'b', kind: 'prune_old_jobs', description: 'b',
      cron: '0 0 * * *', params: {}, nextRunAt: past
    });
    const first = claimDueWorkflow(db);
    const second = claimDueWorkflow(db);
    const third = claimDueWorkflow(db);
    expect([first?.id, second?.id].sort()).toEqual(['a', 'b']);
    expect(third).toBeNull();
  });
});
