import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, updateApplicationStatus
} from '../src/store/application.ts';
import { listPipeline } from '../src/tools/list_pipeline.ts';

describe('tools/list_pipeline', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertCompany(db, { id: 'airbnb', name: 'Airbnb', ats: 'greenhouse', atsOrgSlug: 'airbnb' });
    upsertJobs(db, [
      { id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://stripe', raw: {} },
      { id: 'g:airbnb:1', companyId: 'airbnb', title: 'Eng', url: 'https://airbnb', raw: {} }
    ]);
    addResume(db, { id: 'r1', label: 'Generic', rawText: 'r', parsed: {} });
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'a', coverLetterMd: 'a', answerPack: {}, deepLink: 'https://stripe'
    });
    createApplication(db, {
      id: 'a2', jobId: 'g:airbnb:1', resumeId: 'r1',
      tailoredResumeMd: 'b', coverLetterMd: 'b', answerPack: {}, deepLink: 'https://airbnb'
    });
    updateApplicationStatus(db, 'a2', 'submitted');
  });

  it('returns all applications with company + job context', async () => {
    const out = await listPipeline({}, { db });
    expect(out.items).toHaveLength(2);
    const names = out.items.map(i => i.company).sort();
    expect(names).toEqual(['Airbnb', 'Stripe']);
  });

  it('filters by status', async () => {
    const out = await listPipeline({ status: 'submitted' }, { db });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].company).toBe('Airbnb');
    expect(out.items[0].status).toBe('submitted');
  });
});
