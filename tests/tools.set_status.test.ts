import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listEventsForApplication
} from '../src/store/application.ts';
import { setStatus } from '../src/tools/set_status.ts';

describe('tools/set_status', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
  });

  it('updates status and records event', async () => {
    const out = await setStatus(
      { applicationId: 'app1', status: 'interviewing' },
      { db }
    );
    expect(out.status).toBe('interviewing');
    expect(getApplication(db, 'app1')?.status).toBe('interviewing');
    const events = listEventsForApplication(db, 'app1');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('status_changed');
    expect(events[0].payload).toEqual({ from: 'draft', to: 'interviewing' });
  });

  it('rejects invalid status values', async () => {
    await expect(
      // @ts-expect-error - testing runtime validation
      setStatus({ applicationId: 'app1', status: 'banana' }, { db })
    ).rejects.toThrow();
  });
});
