import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listApplications,
  updateApplicationStatus, addEventForApplication, listEventsForApplication
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

  it('updates status and stamps submitted_at when status becomes submitted', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'a1', 'submitted');
    const app = getApplication(db, 'a1');
    expect(app?.status).toBe('submitted');
    expect(app?.submittedAt).toBeTypeOf('string');
  });

  it('updates status without stamping submitted_at for non-submitted statuses', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'a1', 'rejected');
    const app = getApplication(db, 'a1');
    expect(app?.status).toBe('rejected');
    expect(app?.submittedAt).toBeUndefined();
  });

  it('throws when updating status of unknown application', () => {
    expect(() => updateApplicationStatus(db, 'nope', 'submitted')).toThrow(/unknown application/);
  });

  it('appends events and lists them in order', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
    addEventForApplication(db, 'a1', 'note', { text: 'first note' });
    addEventForApplication(db, 'a1', 'status_changed', { from: 'draft', to: 'submitted' });
    const events = listEventsForApplication(db, 'a1');
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('note');
    // UUID v4 format check (8-4-4-4-12 hex)
    expect(events[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(events[0].payload).toEqual({ text: 'first note' });
    expect(events[1].kind).toBe('status_changed');
  });

  it('filters listApplications by status', () => {
    createApplication(db, {
      id: 'a', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'a', coverLetterMd: 'a', answerPack: {}, deepLink: 'https://x'
    });
    createApplication(db, {
      id: 'b', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'b', coverLetterMd: 'b', answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'b', 'submitted');
    expect(listApplications(db, { status: 'submitted' }).map(a => a.id)).toEqual(['b']);
    expect(listApplications(db, { status: 'draft' }).map(a => a.id)).toEqual(['a']);
  });
});
