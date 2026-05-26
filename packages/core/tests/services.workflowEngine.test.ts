import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs, listJobs } from '../src/store/job.ts';
import { runWorkflowKind } from '../src/services/workflowEngine.ts';

describe('services/workflowEngine', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('runs prune_old_jobs and removes ancient jobs', async () => {
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [
      { id: 'old', companyId: 'stripe', title: 'old', url: 'https://x', raw: {},
        postedAt: '2020-01-01T00:00:00Z' },
      { id: 'new', companyId: 'stripe', title: 'new', url: 'https://y', raw: {},
        postedAt: new Date().toISOString() }
    ]);

    // Manually backdate 'old' so its last_seen_at is also 2020.
    db.prepare(`UPDATE job SET last_seen_at = '2020-01-01T00:00:00Z' WHERE id = 'old'`).run();

    const out = await runWorkflowKind(db, 'prune_old_jobs', { olderThanDays: 30 });
    expect(out.status).toBe('ok');
    expect(listJobs(db).map(j => j.id).sort()).toEqual(['new']);
  });

  it('returns error for unknown workflow kind', async () => {
    const out = await runWorkflowKind(db, 'unknown' as never, {});
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/unknown.*workflow.*kind/i);
  });

  it('returns descriptive error for invalid fetch_jobs_refresh params', async () => {
    const out = await runWorkflowKind(db, 'fetch_jobs_refresh', {
      // limit is bounded 1..200 in fetchJobsInput; 9999 fails the schema
      limit: 9999
    });
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/limit/i);
  });

  it('returns needs_host for sampling_recipe workflows', async () => {
    const out = await runWorkflowKind(db, 'sampling_recipe', {
      recipe: 'Find new senior PM roles, score them, draft applications for top 3.'
    });
    expect(out.status).toBe('needs_host');
    expect(out.summary).toEqual({
      recipe: 'Find new senior PM roles, score them, draft applications for top 3.'
    });
  });
});
