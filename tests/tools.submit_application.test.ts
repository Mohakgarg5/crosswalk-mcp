import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listEventsForApplication
} from '../src/store/application.ts';
import { submitApplication } from '../src/tools/submit_application.ts';

describe('tools/submit_application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
  });

  it('marks application submitted and records event', async () => {
    const out = await submitApplication({ applicationId: 'app1' }, { db });
    expect(out.status).toBe('submitted');
    expect(out.submittedAt).toBeTypeOf('string');
    const app = getApplication(db, 'app1');
    expect(app?.status).toBe('submitted');
    const events = listEventsForApplication(db, 'app1');
    expect(events.some(e => e.kind === 'status_changed')).toBe(true);
  });

  it('throws on unknown application', async () => {
    await expect(submitApplication({ applicationId: 'nope' }, { db })).rejects.toThrow(/unknown application/);
  });
});
