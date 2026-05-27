import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { createSavedSearch } from '../src/store/savedSearch.ts';
import { listApplications } from '../src/store/application.ts';
import { runWatch } from '../src/services/watchEngine.ts';
import type { Browser } from '../src/services/browser/types.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

function fakeSampling(): SamplingClient {
  return { complete: async () => 'GENERATED', completeJson: async () => ({}) } as unknown as SamplingClient;
}
function fakeBrowser(): Browser {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  return {
    preview: async () => ({ screenshotPng: png, resolvedUrl: 'https://x', title: 'Apply', formFields: [] }),
    fillForm: async (_u, _f, o) => ({ resolvedUrl: 'https://x', title: 'Apply', screenshotPng: png, filled: ['email'], skipped: [], submitClicked: Boolean(o?.clickSubmit) }),
    close: async () => {}
  };
}
function seed(db: ReturnType<typeof openDb>) {
  upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
  upsertJobs(db, [{ id: 'g-1', companyId: 'stripe', title: 'PM, Payments', url: 'https://x/1', descriptionMd: 'd', raw: {} }]);
  addResume(db, { id: 'r-1', label: 'PM', rawText: 'resume', parsed: {} });
  upsertProfile(db, { name: 'Ada', email: 'ada@x.com' });
}

describe('runWatch — continuous role-matched auto-apply', () => {
  it('detects new matches and auto-applies when the search has auto-apply on', async () => {
    const db = openDb(':memory:');
    seed(db);
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' }, source: 'companies', autoApply: true });
    const res = await runWatch({ db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(res.totalNew).toBe(1);
    expect(res.searches[0].autoApplied?.total).toBe(1);
    expect(listApplications(db).length).toBe(1); // applied on our behalf
  });

  it('only notifies (no apply) when auto-apply is off', async () => {
    const db = openDb(':memory:');
    seed(db);
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' }, source: 'companies', autoApply: false });
    const res = await runWatch({ db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(res.totalNew).toBe(1);
    expect(res.searches[0].autoApplied).toBeUndefined();
    expect(listApplications(db).length).toBe(0);
  });

  it('re-running finds nothing new (no duplicate applies)', async () => {
    const db = openDb(':memory:');
    seed(db);
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' }, source: 'companies', autoApply: true });
    await runWatch({ db, sampling: fakeSampling(), browser: fakeBrowser() });
    const second = await runWatch({ db, sampling: fakeSampling(), browser: fakeBrowser() });
    expect(second.totalNew).toBe(0);
    expect(listApplications(db).length).toBe(1);
  });
});
