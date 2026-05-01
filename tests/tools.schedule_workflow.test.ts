import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listWorkflows } from '../src/store/workflow.ts';
import { scheduleWorkflow } from '../src/tools/schedule_workflow.ts';

describe('tools/schedule_workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('persists a workflow with computed nextRunAt', async () => {
    const out = await scheduleWorkflow({
      kind: 'prune_old_jobs',
      cron: '0 0 * * *',
      description: 'nightly prune',
      params: { olderThanDays: 60 }
    }, { db });
    expect(out.workflowId).toBeTypeOf('string');
    expect(new Date(out.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(listWorkflows(db)).toHaveLength(1);
  });

  it('rejects an invalid cron expression', async () => {
    await expect(
      scheduleWorkflow({
        kind: 'prune_old_jobs',
        cron: 'not a cron',
        description: 'x', params: {}
      }, { db })
    ).rejects.toThrow();
  });
});
