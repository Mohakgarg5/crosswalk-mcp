import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { listApplications } from '../src/store/application.ts';
import { setConfig } from '../src/store/appConfig.ts';
import { autoApply } from '../src/services/autoApplyEngine.ts';
import type { Browser } from '../src/services/browser/types.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

function fakeSampling(): SamplingClient {
  return { complete: async () => 'GENERATED TEXT', completeJson: async () => ({}) } as unknown as SamplingClient;
}

function fakeBrowser(): Browser {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  return {
    preview: async () => ({ screenshotPng: png, resolvedUrl: 'https://x', title: 'Apply', formFields: [] }),
    fillForm: async (_url, _fields, opts) => ({
      resolvedUrl: 'https://x', title: 'Apply', screenshotPng: png,
      filled: ['email', 'resume_file'], skipped: [],
      submitClicked: Boolean(opts?.clickSubmit), postSubmitUrl: 'https://x/done'
    }),
    close: async () => {}
  };
}

function brokenBrowser(): Browser {
  return {
    preview: async () => { throw new Error('browser not installed'); },
    fillForm: async () => { throw new Error('browser not installed'); },
    close: async () => {}
  };
}

function seed(db: ReturnType<typeof openDb>) {
  upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
  upsertJobs(db, [
    { id: 'g-1', companyId: 'stripe', title: 'PM, Payments', url: 'https://x/1', descriptionMd: 'desc', raw: {} },
    { id: 'g-2', companyId: 'stripe', title: 'PM, Growth', url: 'https://x/2', descriptionMd: 'desc', raw: {} }
  ]);
  addResume(db, { id: 'r-1', label: 'PM', rawText: 'resume text', parsed: {} });
  upsertProfile(db, { name: 'Ada L', email: 'ada@example.com', phone: '555-0100' });
}

describe('autoApply — applies to a batch on the user\'s behalf', () => {
  it('drafts and submits every job when submit=true', async () => {
    const db = openDb(':memory:');
    seed(db);
    const summary = await autoApply({ jobIds: ['g-1', 'g-2'], submit: true }, { db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(summary.total).toBe(2);
    expect(summary.submitted).toBe(2);
    expect(listApplications(db).length).toBe(2);
  });

  it('fills without submitting when submit=false', async () => {
    const db = openDb(':memory:');
    seed(db);
    const s = await autoApply({ jobIds: ['g-1'], submit: false }, { db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(s.applied).toBe(1);
    expect(s.submitted).toBe(0);
  });

  it('honors the anti-spam weekly cap (cap 1 → first submits, second skipped)', async () => {
    const db = openDb(':memory:');
    seed(db);
    setConfig(db, { weeklyCap: 1 });
    const s = await autoApply({ jobIds: ['g-1', 'g-2'], submit: true }, { db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(s.submitted).toBe(1);
    expect(s.skipped).toBe(1);
  });

  it('weekly cap 0 = unlimited → submits all', async () => {
    const db = openDb(':memory:');
    seed(db);
    setConfig(db, { weeklyCap: 0 });
    const s = await autoApply({ jobIds: ['g-1', 'g-2'], submit: true }, { db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(s.submitted).toBe(2);
  });

  it('records drafted (not failed) when the browser is unavailable', async () => {
    const db = openDb(':memory:');
    seed(db);
    const s = await autoApply({ jobIds: ['g-1'], submit: true }, { db, sampling: fakeSampling(), browser: brokenBrowser() });
    expect(s.drafted).toBe(1);
    expect(listApplications(db).length).toBe(1); // the draft is still saved
  });

  it('uses the supplied resumeId for every job in the batch', async () => {
    const db = openDb(':memory:');
    seed(db);
    addResume(db, { id: 'r-product', label: 'Product', rawText: 'p', parsed: {} });
    addResume(db, { id: 'r-project', label: 'Project', rawText: 'j', parsed: {} });
    const deps = { db, sampling: fakeSampling(), browser: fakeBrowser() };

    const summary = await autoApply({ jobIds: ['g-1'], submit: false, resumeId: 'r-project' }, deps);
    expect(summary.total).toBe(1);
    const app = listApplications(db)[0];
    expect(app.resumeId).toBe('r-project');
  });
});
