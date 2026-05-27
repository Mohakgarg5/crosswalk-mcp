import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';
import type { Browser } from './browser/types.ts';
import { listSavedSearches } from '../store/savedSearch.ts';
import { refreshSavedSearch } from './savedSearchEngine.ts';
import { searchRoles } from './roleSearch.ts';
import { autoApply, type AutoApplySummary } from './autoApplyEngine.ts';
import { getConfig } from '../store/appConfig.ts';

export type WatchDeps = { db: Db; sampling: SamplingClient; browser: Browser };
export type WatchOptions = { pages?: number; fetchImpl?: typeof fetch };

export type WatchSearchOutcome = {
  searchId: string;
  name: string;
  source: string;
  newMatches: number;
  autoApplied?: AutoApplySummary;
};

export type WatchRunResult = {
  searches: WatchSearchOutcome[];
  totalNew: number;
  totalSubmitted: number;
};

/**
 * One pass of the continuous watcher. For every saved search:
 *  - 'web' sources are re-queried against the open role aggregator (uncapped),
 *  - new postings since the last check are detected (and notified),
 *  - and if the search has auto-apply on, those new matches are applied on the
 *    user's behalf (submit vs review follows the global submit policy + cap).
 *
 * Call this on an interval to get "the moment a role matching your title is
 * posted anywhere, it's caught (and applied to)".
 */
export async function runWatch(deps: WatchDeps, opts: WatchOptions = {}): Promise<WatchRunResult> {
  const { db } = deps;
  const submit = getConfig(db).submitPolicy === 'auto';
  const searches: WatchSearchOutcome[] = [];
  let totalNew = 0;
  let totalSubmitted = 0;

  for (const s of listSavedSearches(db)) {
    if (s.source === 'web') {
      try {
        await searchRoles(
          db,
          { query: s.filters.titleContains, location: s.filters.locationContains, pages: opts.pages ?? 3 },
          opts.fetchImpl ?? fetch
        );
      } catch {
        // Network hiccup — detection still runs against the cached jobs.
      }
    }

    const { newMatches, jobIds } = refreshSavedSearch(db, s.id);
    totalNew += newMatches;

    let autoApplied: AutoApplySummary | undefined;
    if (s.autoApply && jobIds.length > 0) {
      autoApplied = await autoApply({ jobIds, submit }, deps);
      totalSubmitted += autoApplied.submitted;
    }

    searches.push({ searchId: s.id, name: s.name, source: s.source, newMatches, autoApplied });
  }

  return { searches, totalNew, totalSubmitted };
}
