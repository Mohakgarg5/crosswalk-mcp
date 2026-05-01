import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication } from '../src/store/application.ts';
import { checkGuardrail, WEEKLY_CAP } from '../src/services/guardrail.ts';

describe('services/guardrail', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('passes when no applications exist', () => {
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(true);
  });

  it('blocks when weekly cap is reached', () => {
    // Use distinct jobIds so the duplicate check doesn't fire first.
    upsertJobs(db, Array.from({ length: WEEKLY_CAP }, (_, i) => ({
      id: `j${i}`, companyId: 'stripe', title: `J${i}`, url: 'https://x', raw: {}
    })));
    for (let i = 0; i < WEEKLY_CAP; i++) {
      createApplication(db, {
        id: `a${i}`, jobId: `j${i}`, resumeId: 'r1',
        tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
      });
    }
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(false);
    if (out.allowed === false) {
      expect(out.reason).toMatch(/weekly cap/i);
    }
  });

  it('blocks duplicate non-rejected application for same job', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(false);
    if (out.allowed === false) {
      expect(out.reason).toMatch(/already.*application/i);
    }
  });

  it('allows duplicate when allowDuplicate=true', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1', allowDuplicate: true });
    expect(out.allowed).toBe(true);
  });
});
