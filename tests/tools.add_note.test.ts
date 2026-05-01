import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication, listEventsForApplication } from '../src/store/application.ts';
import { addNote } from '../src/tools/add_note.ts';

describe('tools/add_note', () => {
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

  it('records a note as an event', async () => {
    const out = await addNote(
      { applicationId: 'app1', text: 'recruiter emailed back' },
      { db }
    );
    expect(out.eventId).toBeTypeOf('string');
    const events = listEventsForApplication(db, 'app1');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('note');
    expect(events[0].payload).toEqual({ text: 'recruiter emailed back' });
  });

  it('rejects empty notes', async () => {
    await expect(
      addNote({ applicationId: 'app1', text: '' }, { db })
    ).rejects.toThrow();
  });

  it('throws on unknown application', async () => {
    await expect(
      addNote({ applicationId: 'nope', text: 'hi' }, { db })
    ).rejects.toThrow(/unknown application/);
  });
});
