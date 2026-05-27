import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { createSavedSearch, listSavedSearches, deleteSavedSearch } from '../src/store/savedSearch.ts';
import { listNotifications, unreadCount, markAllRead } from '../src/store/notification.ts';
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

  it('notifies for matching jobs, dedupes on re-check, and catches later jobs', () => {
    const db = openDb(':memory:');
    seedCompany(db);
    vi.setSystemTime(new Date('2026-05-10T00:00:00Z'));
    const s = createSavedSearch(db, { name: 'PM roles', filters: { titleContains: 'PM' } });
    upsertJobs(db, [job('g-1', 'PM, Payments'), job('g-2', 'Staff Engineer')]);

    vi.setSystemTime(new Date('2026-05-10T01:00:00Z'));
    expect(refreshSavedSearch(db, s.id).newMatches).toBe(1); // only the PM job
    expect(unreadCount(db)).toBe(1);
    expect(listNotifications(db)[0].refId).toBe('g-1');

    // Re-check immediately: nothing new.
    expect(refreshSavedSearch(db, s.id).newMatches).toBe(0);
    expect(unreadCount(db)).toBe(1);

    // A new PM job appears later → caught on next refresh.
    vi.setSystemTime(new Date('2026-05-11T00:00:00Z'));
    upsertJobs(db, [job('g-3', 'Senior PM, Growth')]);
    expect(refreshSavedSearch(db, s.id).newMatches).toBe(1);
    expect(unreadCount(db)).toBe(2);
  });

  it('refreshAllSavedSearches sums across searches; markAllRead clears', () => {
    const db = openDb(':memory:');
    seedCompany(db);
    vi.setSystemTime(new Date('2026-05-10T00:00:00Z'));
    createSavedSearch(db, { name: 'PM', filters: { titleContains: 'PM' } });
    createSavedSearch(db, { name: 'Eng', filters: { titleContains: 'Engineer' } });
    upsertJobs(db, [job('g-1', 'PM, Payments'), job('g-2', 'Staff Engineer')]);

    vi.setSystemTime(new Date('2026-05-10T02:00:00Z'));
    expect(refreshAllSavedSearches(db).total).toBe(2);
    expect(unreadCount(db)).toBe(2);
    expect(markAllRead(db)).toBe(2);
    expect(unreadCount(db)).toBe(0);
    expect(listSavedSearches(db).length).toBe(2);
  });

  it('deletes a saved search', () => {
    const db = openDb(':memory:');
    const s = createSavedSearch(db, { name: 'x', filters: {} });
    deleteSavedSearch(db, s.id);
    expect(listSavedSearches(db).length).toBe(0);
  });
});
