import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs, listJobs } from '../src/store/job.ts';
import { createWorkflow, getWorkflow } from '../src/store/workflow.ts';
import { runWorkflow } from '../src/tools/run_workflow.ts';

describe('tools/run_workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'old', companyId: 'stripe', title: 'old', url: 'https://x',
      raw: {}, postedAt: '2020-01-01T00:00:00Z'
    }]);
    db.prepare(`UPDATE job SET last_seen_at = '2020-01-01T00:00:00Z' WHERE id = 'old'`).run();
  });

  it('runs the workflow and records ok status + advances next_run_at', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createWorkflow(db, {
      id: 'w1', kind: 'prune_old_jobs', description: 'nightly prune',
      cron: '0 0 * * *', params: { olderThanDays: 30 },
      nextRunAt: past
    });
    const out = await runWorkflow({ workflowId: 'w1' }, { db });
    expect(out.status).toBe('ok');
    expect(out.summary).toEqual({ deleted: 1 });
    expect(listJobs(db)).toHaveLength(0);

    const w = getWorkflow(db, 'w1');
    expect(w?.lastStatus).toBe('ok');
    expect(new Date(w!.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('throws on unknown workflow', async () => {
    await expect(runWorkflow({ workflowId: 'nope' }, { db })).rejects.toThrow(/unknown workflow/);
  });
});
