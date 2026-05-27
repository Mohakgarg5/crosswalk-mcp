import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { setConfig } from '../src/store/appConfig.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication, updateApplicationStatus } from '../src/store/application.ts';
import { checkGuardrail } from '../src/services/guardrail.ts';

function seedSubmitted(db: ReturnType<typeof openDb>, n: number) {
  upsertCompany(db, { id: 'c', name: 'C', ats: 'greenhouse', atsOrgSlug: 'c' });
  addResume(db, { id: 'r1', label: 'r', rawText: 'x', parsed: {} });
  for (let i = 0; i < n; i++) {
    upsertJobs(db, [{ id: `j${i}`, companyId: 'c', title: 't', url: 'u', raw: {} }]);
    createApplication(db, { id: `a${i}`, jobId: `j${i}`, resumeId: 'r1', tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'u' });
    updateApplicationStatus(db, `a${i}`, 'submitted');
  }
}

describe('guardrail weekly cap', () => {
  it('treats weeklyCap <= 0 as UNLIMITED (allowed for high-volume)', () => {
    const db = openDb(':memory:');
    seedSubmitted(db, 50);
    setConfig(db, { weeklyCap: 0 });
    expect(checkGuardrail(db, { jobId: 'new', resumeId: 'r1' }).allowed).toBe(true);
  });

  it('blocks once the submitted count reaches the cap', () => {
    const db = openDb(':memory:');
    seedSubmitted(db, 2);
    setConfig(db, { weeklyCap: 2 });
    const res = checkGuardrail(db, { jobId: 'new', resumeId: 'r1' });
    expect(res.allowed).toBe(false);
  });

  it('defaults to cap 10 (no config, no applications => allowed)', () => {
    const db = openDb(':memory:');
    const res = checkGuardrail(db, { jobId: 'j1', resumeId: 'r1' });
    expect(res.allowed).toBe(true);
  });
});
