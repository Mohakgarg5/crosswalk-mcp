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

// Real timers here (not fake): the auto-apply path generates a .docx, whose
// library uses internal timers that fake timers would freeze.
const tick = () => new Promise(r => setTimeout(r, 1100)); // advance wall-clock past ms granularity

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
  it('baselines on first run, then auto-applies new matches when auto-apply is on', async () => {
    const db = openDb(':memory:');
    seed(db);
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' }, source: 'companies', autoApply: true });
    const deps = { db, sampling: fakeSampling(), browser: fakeBrowser() };

    // First run = baseline: pre-existing jobs are not applied to.
    const first = await runWatch(deps);
    expect(first.totalNew).toBe(0);
    expect(listApplications(db).length).toBe(0);

    // A new matching job appears later → caught and auto-applied.
    await tick();
    upsertJobs(db, [{ id: 'g-2', companyId: 'stripe', title: 'Senior PM', url: 'https://x/2', descriptionMd: 'd', raw: {} }]);
    const second = await runWatch(deps);
    expect(second.totalNew).toBe(1);
    expect(listApplications(db).length).toBe(1);
  });

  it('only notifies (no apply) when auto-apply is off', async () => {
    const db = openDb(':memory:');
    seed(db);
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' }, source: 'companies', autoApply: false });
    const deps = { db, sampling: fakeSampling(), browser: fakeBrowser() };

    await runWatch(deps); // baseline
    await tick();
    upsertJobs(db, [{ id: 'g-2', companyId: 'stripe', title: 'Senior PM', url: 'https://x/2', descriptionMd: 'd', raw: {} }]);
    const r = await runWatch(deps);
    expect(r.totalNew).toBe(1);
    expect(r.searches[0].autoApplied).toBeUndefined();
    expect(listApplications(db).length).toBe(0);
  });
});
