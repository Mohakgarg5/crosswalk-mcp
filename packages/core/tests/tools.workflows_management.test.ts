import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { createWorkflow } from '../src/store/workflow.ts';
import { listWorkflowsTool } from '../src/tools/list_workflows.ts';
import { deleteWorkflowTool } from '../src/tools/delete_workflow.ts';

describe('tools/list_workflows + delete_workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    createWorkflow(db, {
      id: 'w1', kind: 'prune_old_jobs', description: 'nightly prune',
      cron: '0 0 * * *', params: {},
      nextRunAt: new Date(Date.now() + 60_000).toISOString()
    });
  });

  it('lists workflows', async () => {
    const out = await listWorkflowsTool({}, { db });
    expect(out.workflows).toHaveLength(1);
    expect(out.workflows[0].id).toBe('w1');
    expect(out.workflows[0].kind).toBe('prune_old_jobs');
  });

  it('deletes a workflow by id', async () => {
    const out = await deleteWorkflowTool({ workflowId: 'w1' }, { db });
    expect(out.deleted).toBe(true);
    const after = await listWorkflowsTool({}, { db });
    expect(after.workflows).toHaveLength(0);
  });

  it('returns deleted=false for unknown workflow', async () => {
    const out = await deleteWorkflowTool({ workflowId: 'nope' }, { db });
    expect(out.deleted).toBe(false);
  });
});
