import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listApplications
} from '../src/store/application.ts';

describe('store/application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM',
      url: 'https://x', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('creates and reads back an application', () => {
    const id = 'app-1';
    createApplication(db, {
      id, jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# Resume', coverLetterMd: 'Hello',
      answerPack: { 'why-us': 'Because' }, deepLink: 'https://apply'
    });
    const app = getApplication(db, id);
    expect(app?.coverLetterMd).toBe('Hello');
    expect(app?.status).toBe('draft');
    expect(app?.answerPack).toEqual({ 'why-us': 'Because' });
  });

  it('lists newest first', () => {
    createApplication(db, {
      id: 'a', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'a', coverLetterMd: 'a', answerPack: {}, deepLink: 'https://x'
    });
    createApplication(db, {
      id: 'b', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'b', coverLetterMd: 'b', answerPack: {}, deepLink: 'https://x'
    });
    expect(listApplications(db).map(a => a.id)).toEqual(['b', 'a']);
  });

  it('returns null for unknown id', () => {
    expect(getApplication(db, 'nope')).toBeNull();
  });
});
