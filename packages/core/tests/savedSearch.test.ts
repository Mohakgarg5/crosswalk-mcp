import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { createSavedSearch, listSavedSearches, deleteSavedSearch } from '../src/store/savedSearch.ts';
import { unreadCount, markAllRead } from '../src/store/notification.ts';
import { refreshSavedSearch, refreshAllSavedSearches } from '../src/services/savedSearchEngine.ts';

function seedCompany(db: ReturnType<typeof openDb>) {
  upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
}
function job(id: string, title: string) {
  return { id, companyId: 'stripe', title, url: `https://x/${id}`, raw: {} };
}

describe('saved searches + new-match notifications', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('baselines on first run, then notifies only for newly-seen matches (deduped)', () => {
    const db = openDb(':memory:');
    seedCompany(db);
    vi.setSystemTime(new Date('2026-05-10T00:00:00Z'));
    const s = createSavedSearch(db, { name: 'PM roles', filters: { titleContains: 'PM' } });
    upsertJobs(db, [job('g-1', 'PM, Payments'), job('g-2', 'Staff Engineer')]);

    // First run = baseline: pre-existing jobs are NOT treated as new.
    vi.setSystemTime(new Date('2026-05-10T01:00:00Z'));
    expect(refreshSavedSearch(db, s.id).newMatches).toBe(0);
    expect(unreadCount(db)).toBe(0);

    // A new PM job appears later → caught on the next run.
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'));
    upsertJobs(db, [job('g-3', 'Senior PM, Growth')]);
    const r = refreshSavedSearch(db, s.id);
    expect(r.newMatches).toBe(1);
    expect(r.jobIds).toEqual(['g-3']);
    expect(unreadCount(db)).toBe(1);

    // Re-running immediately: nothing new.
    expect(refreshSavedSearch(db, s.id).newMatches).toBe(0);
  });

  it('refreshAllSavedSearches sums new matches after baseline; markAllRead clears', () => {
    const db = openDb(':memory:');
    seedCompany(db);
    vi.setSystemTime(new Date('2026-05-10T00:00:00Z'));
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' } });
    createSavedSearch(db, { name: 'Eng', filters: { titleContains: 'Engineer' } });
    upsertJobs(db, [job('g-1', 'PM, Payments'), job('g-2', 'Staff Engineer')]);

    vi.setSystemTime(new Date('2026-05-10T02:00:00Z'));
    expect(refreshAllSavedSearches(db).total).toBe(0); // baseline both

    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'));
    upsertJobs(db, [job('g-3', 'PM, Growth'), job('g-4', 'Backend Engineer')]);
    expect(refreshAllSavedSearches(db).total).toBe(2);
    expect(unreadCount(db)).toBe(2);
    expect(markAllRead(db)).toBe(2);
    expect(unreadCount(db)).toBe(0);
  });

  it('deletes a saved search', () => {
    const db = openDb(':memory:');
    const s = createSavedSearch(db, { name: 'x', filters: {} });
    deleteSavedSearch(db, s.id);
    expect(listSavedSearches(db).length).toBe(0);
  });

  it('persists per-watch overrides (resumeId, minFit, weeklyCap, autoSubmit) and round-trips them', () => {
    const db = openDb(':memory:');
    const s = createSavedSearch(db, {
      name: 'PM track',
      filters: { titleContains: 'PM' },
      source: 'web',
      autoApply: true,
      resumeId: 'r-1',
      minFit: 0.7,
      weeklyCap: 5,
      autoSubmit: true
    });
    expect(s.resumeId).toBe('r-1');
    expect(s.minFit).toBe(0.7);
    expect(s.weeklyCap).toBe(5);
    expect(s.autoSubmit).toBe(true);

    const reloaded = listSavedSearches(db).find(x => x.id === s.id)!;
    expect(reloaded.resumeId).toBe('r-1');
    expect(reloaded.minFit).toBe(0.7);
    expect(reloaded.weeklyCap).toBe(5);
    expect(reloaded.autoSubmit).toBe(true);
  });

  it('leaves overrides undefined for a watch created without them (back-compat)', () => {
    const db = openDb(':memory:');
    const s = createSavedSearch(db, { name: 'plain', filters: {} });
    const reloaded = listSavedSearches(db).find(x => x.id === s.id)!;
    expect(reloaded.resumeId).toBeUndefined();
    expect(reloaded.minFit).toBeUndefined();
    expect(reloaded.weeklyCap).toBeUndefined();
    expect(reloaded.autoSubmit).toBeUndefined();
  });
});
