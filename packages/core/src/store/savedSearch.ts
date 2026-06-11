import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export type SavedSearchFilters = {
  titleContains?: string;
  locationContains?: string;
  remoteOnly?: boolean;
  companyIds?: string[];
  h1bSponsorOnly?: boolean;
  h1bMinConfidence?: number;
};

export type SearchSource = 'web' | 'companies';

export type SavedSearch = {
  id: string;
  name: string;
  filters: SavedSearchFilters;
  /** 'web' = open role-based aggregator (uncapped); 'companies' = watched ATS list. */
  source: SearchSource;
  /** When true, the watcher auto-applies to new matches (per submit policy + cap). */
  autoApply: boolean;
  /** Résumé to tailor from for this track. Null → auto-pick per job. */
  resumeId?: string;
  /** Minimum fit score (0..1) a new job must reach to be auto-applied. Null → global defaultMinFit. */
  minFit?: number;
  /** Per-watch weekly application cap. Null → global weeklyCap. */
  weeklyCap?: number;
  /** Per-watch auto-submit override. Null → global submitPolicy. */
  autoSubmit?: boolean;
  lastCheckedAt?: string;
  createdAt: string;
};

type Row = {
  id: string; name: string; filters_json: string; source: string; auto_apply: number;
  resume_id: string | null; min_fit: number | null; weekly_cap: number | null; auto_submit: number | null;
  last_checked_at: string | null; created_at: string;
};

function toSearch(r: Row): SavedSearch {
  return {
    id: r.id,
    name: r.name,
    filters: JSON.parse(r.filters_json) as SavedSearchFilters,
    source: (r.source as SearchSource) ?? 'web',
    autoApply: r.auto_apply === 1,
    resumeId: r.resume_id ?? undefined,
    minFit: r.min_fit ?? undefined,
    weeklyCap: r.weekly_cap ?? undefined,
    autoSubmit: r.auto_submit == null ? undefined : r.auto_submit === 1,
    lastCheckedAt: r.last_checked_at ?? undefined,
    createdAt: r.created_at
  };
}

export function createSavedSearch(
  db: Db,
  input: {
    name: string; filters: SavedSearchFilters; source?: SearchSource; autoApply?: boolean;
    resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean;
  }
): SavedSearch {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const source = input.source ?? 'web';
  const autoApply = input.autoApply ?? false;
  db.prepare(`
    INSERT INTO saved_search
      (id, name, filters_json, source, auto_apply, resume_id, min_fit, weekly_cap, auto_submit, last_checked_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    id, input.name, JSON.stringify(input.filters), source, autoApply ? 1 : 0,
    input.resumeId ?? null,
    input.minFit ?? null,
    input.weeklyCap ?? null,
    input.autoSubmit == null ? null : (input.autoSubmit ? 1 : 0),
    createdAt
  );
  return {
    id, name: input.name, filters: input.filters, source, autoApply,
    resumeId: input.resumeId, minFit: input.minFit, weeklyCap: input.weeklyCap, autoSubmit: input.autoSubmit,
    createdAt
  };
}

export function listSavedSearches(db: Db): SavedSearch[] {
  return (db.prepare(`SELECT * FROM saved_search ORDER BY created_at DESC, rowid DESC`).all() as Row[]).map(toSearch);
}

export function getSavedSearch(db: Db, id: string): SavedSearch | null {
  const r = db.prepare(`SELECT * FROM saved_search WHERE id = ?`).get(id) as Row | undefined;
  return r ? toSearch(r) : null;
}

export function deleteSavedSearch(db: Db, id: string): void {
  db.prepare(`DELETE FROM saved_search WHERE id = ?`).run(id);
}

export function touchSavedSearch(db: Db, id: string, at: string): void {
  db.prepare(`UPDATE saved_search SET last_checked_at = ? WHERE id = ?`).run(at, id);
}

export function setSavedSearchAutoApply(db: Db, id: string, autoApply: boolean): void {
  db.prepare(`UPDATE saved_search SET auto_apply = ? WHERE id = ?`).run(autoApply ? 1 : 0, id);
}

export function updateSavedSearchConfig(
  db: Db,
  id: string,
  patch: { resumeId?: string | null; minFit?: number | null; weeklyCap?: number | null; autoSubmit?: boolean | null; autoApply?: boolean }
): void {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.resumeId !== undefined) { sets.push('resume_id = ?'); args.push(patch.resumeId); }
  if (patch.minFit !== undefined) { sets.push('min_fit = ?'); args.push(patch.minFit); }
  if (patch.weeklyCap !== undefined) { sets.push('weekly_cap = ?'); args.push(patch.weeklyCap); }
  if (patch.autoSubmit !== undefined) { sets.push('auto_submit = ?'); args.push(patch.autoSubmit == null ? null : (patch.autoSubmit ? 1 : 0)); }
  if (patch.autoApply !== undefined) { sets.push('auto_apply = ?'); args.push(patch.autoApply ? 1 : 0); }
  if (sets.length === 0) return;
  args.push(id);
  db.prepare(`UPDATE saved_search SET ${sets.join(', ')} WHERE id = ?`).run(...args);
}
