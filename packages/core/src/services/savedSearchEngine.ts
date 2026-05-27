import type { Db } from '../store/db.ts';
import { getSavedSearch, touchSavedSearch, listSavedSearches } from '../store/savedSearch.ts';
import { createNotification } from '../store/notification.ts';

/**
 * Find jobs matching a saved search that have appeared (or been re-seen)
 * since the search was last checked, and raise a `new_match` notification for
 * each. Advances the search's last_checked_at so the same job isn't re-notified.
 */
export function refreshSavedSearch(db: Db, id: string): { newMatches: number; jobIds: string[] } {
  const search = getSavedSearch(db, id);
  if (!search) throw new Error(`unknown saved search: ${id}`);

  // First run: establish a baseline (don't treat every pre-existing job as
  // "new", which would flood notifications and auto-apply to the whole cache).
  // Only postings seen AFTER this baseline count as new on later runs.
  if (!search.lastCheckedAt) {
    touchSavedSearch(db, id, new Date().toISOString());
    return { newMatches: 0, jobIds: [] };
  }

  const f = search.filters;
  const where: string[] = ['j.last_seen_at > ?'];
  const args: unknown[] = [search.lastCheckedAt];
  if (f.titleContains) { where.push('LOWER(j.title) LIKE ?'); args.push(`%${f.titleContains.toLowerCase()}%`); }
  if (f.locationContains) { where.push("LOWER(COALESCE(j.location, '')) LIKE ?"); args.push(`%${f.locationContains.toLowerCase()}%`); }
  if (f.remoteOnly) { where.push("j.location_type = 'remote'"); }
  if (f.companyIds?.length) { where.push(`j.company_id IN (${f.companyIds.map(() => '?').join(',')})`); args.push(...f.companyIds); }
  if (f.h1bSponsorOnly) { where.push('COALESCE(c.h1b_confidence, 0) >= ?'); args.push(f.h1bMinConfidence ?? 0.5); }

  const rows = db.prepare(`
    SELECT j.id AS id, j.title AS title, c.name AS company
    FROM job j LEFT JOIN company c ON c.id = j.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY j.last_seen_at DESC
  `).all(...args) as Array<{ id: string; title: string; company: string | null }>;

  for (const r of rows) {
    createNotification(db, {
      kind: 'new_match',
      title: `${r.title} @ ${r.company ?? 'unknown'}`,
      body: `matches "${search.name}"`,
      refId: r.id
    });
  }
  touchSavedSearch(db, id, new Date().toISOString());
  return { newMatches: rows.length, jobIds: rows.map(r => r.id) };
}

export function refreshAllSavedSearches(db: Db): { total: number; perSearch: Record<string, number> } {
  const perSearch: Record<string, number> = {};
  let total = 0;
  for (const s of listSavedSearches(db)) {
    const { newMatches } = refreshSavedSearch(db, s.id);
    perSearch[s.id] = newMatches;
    total += newMatches;
  }
  return { total, perSearch };
}
