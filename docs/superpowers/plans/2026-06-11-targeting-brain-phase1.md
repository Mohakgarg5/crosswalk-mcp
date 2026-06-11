# Targeting Brain (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the autonomous watcher apply only to *best-fit* jobs by scoring each new posting against a watch's chosen résumé and a per-watch minimum-fit threshold, with per-watch résumé/cap/auto-submit overrides surfaced in the GUI.

**Architecture:** A new `fitGate` service scores new job IDs against a résumé (reusing the existing `scoreFit` + fit-score cache) and returns only those at or above a threshold. `runWatch` calls it between match-detection and `autoApply`, passing the watch's résumé, effective weekly cap, and submit posture. `SavedSearch` gains four nullable override columns (résumé, min-fit, weekly cap, auto-submit); nulls fall back to global `AppConfig` defaults so existing watches behave exactly as before.

**Tech Stack:** TypeScript (strict), better-sqlite3, Vitest, Next.js (App Router) GUI, npm workspaces monorepo.

---

## File structure

- `packages/core/src/store/migrations.ts` **[MODIFY]** — add migration #10 (4 nullable columns on `saved_search`).
- `packages/core/src/store/savedSearch.ts` **[MODIFY]** — extend `SavedSearch` type, `createSavedSearch`, `toSearch`; add `updateSavedSearchConfig`.
- `packages/core/src/store/appConfig.ts` **[MODIFY]** — add `defaultMinFit` to `AppConfig` + default.
- `packages/core/src/services/fitGate.ts` **[NEW]** — `scoreAndGate()`.
- `packages/core/src/services/guardrail.ts` **[MODIFY]** — accept optional `capOverride`.
- `packages/core/src/services/buildApplication.ts` **[MODIFY]** — thread `capOverride` into guardrail.
- `packages/core/src/services/autoApplyEngine.ts` **[MODIFY]** — accept `resumeId` + `capOverride`, thread into `buildApplication`.
- `packages/core/src/services/watchEngine.ts` **[MODIFY]** — call `scoreAndGate`; pass per-watch résumé/cap/submit into `autoApply`.
- `packages/core/src/runtime.ts` **[MODIFY]** — export `updateSavedSearchConfig`, `scoreAndGate`.
- `apps/web/lib/engine.ts` **[MODIFY]** — `createSearch`/`updateSearchConfig` wrappers carry the new fields.
- `apps/web/app/api/searches/route.ts` **[MODIFY]** — accept/forward new fields + a `set-config` action.
- `apps/web/app/jobs/page.tsx` **[MODIFY]** — watch editor: résumé picker, min-fit slider, per-watch cap, auto-submit toggle.
- Tests: `packages/core/tests/fitGate.test.ts` **[NEW]**, plus extensions to `savedSearch.test.ts`, `watchEngine.test.ts`, `autoApply.test.ts`.

**Type contract (used across tasks — keep names exact):**

```typescript
// SavedSearch gains these optional fields:
//   resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean;
// fitGate:
//   scoreAndGate(deps: { db: Db; sampling: SamplingClient },
//                jobIds: string[],
//                opts: { resumeId?: string; minFit: number })
//     : Promise<{ kept: string[]; considered: number; scores: Record<string, number> }>
// autoApply options gain: resumeId?: string; capOverride?: number;
// guardrail GuardrailInput gains: capOverride?: number;
```

---

## Task 1: Migration — per-watch override columns

**Files:**
- Modify: `packages/core/src/store/migrations.ts` (append to the `migrations` array, after id 9)
- Test: `packages/core/tests/savedSearch.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the top-level `describe` in `savedSearch.test.ts`)

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- savedSearch`
Expected: FAIL — `createSavedSearch` doesn't accept `resumeId`/`minFit`/etc. (TS error or undefined assertions fail).

- [ ] **Step 3: Add migration #10**

In `packages/core/src/store/migrations.ts`, add a new object to the `migrations` array immediately after the `id: 9` (`answer_bank`) entry:

```typescript
  ,
  {
    id: 10,
    name: 'saved_search_per_watch_overrides',
    sql: `
      ALTER TABLE saved_search ADD COLUMN resume_id TEXT;
      ALTER TABLE saved_search ADD COLUMN min_fit REAL;
      ALTER TABLE saved_search ADD COLUMN weekly_cap INTEGER;
      ALTER TABLE saved_search ADD COLUMN auto_submit INTEGER;
    `
  }
```

(Implementation of the store mapping happens in Task 2; this task only adds the columns. The test fully passes after Task 2 — that's expected for a schema-then-mapping pair. Proceed to Task 2 before re-running.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/store/migrations.ts packages/core/tests/savedSearch.test.ts
git commit -m "feat(store): migration for per-watch override columns"
```

---

## Task 2: SavedSearch type + store mapping

**Files:**
- Modify: `packages/core/src/store/savedSearch.ts`
- Test: `packages/core/tests/savedSearch.test.ts` (tests written in Task 1)

- [ ] **Step 1: Extend the `SavedSearch` type**

In `packages/core/src/store/savedSearch.ts`, add these fields to the `SavedSearch` type (after `autoApply: boolean;`):

```typescript
  /** Résumé to tailor from for this track. Null → auto-pick per job. */
  resumeId?: string;
  /** Minimum fit score (0..1) a new job must reach to be auto-applied. Null → global defaultMinFit. */
  minFit?: number;
  /** Per-watch weekly application cap. Null → global weeklyCap. */
  weeklyCap?: number;
  /** Per-watch auto-submit override. Null → global submitPolicy. */
  autoSubmit?: boolean;
```

- [ ] **Step 2: Extend the `Row` type and `toSearch`**

Replace the `Row` type and `toSearch` function with:

```typescript
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
```

- [ ] **Step 3: Extend `createSavedSearch`**

Replace `createSavedSearch` with:

```typescript
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
```

- [ ] **Step 4: Add `updateSavedSearchConfig`**

Append this function (keep the existing `setSavedSearchAutoApply` for back-compat):

```typescript
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w crosswalk-mcp -- savedSearch`
Expected: PASS (both Task 1 tests + existing ones).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store/savedSearch.ts
git commit -m "feat(store): per-watch overrides on SavedSearch + updateSavedSearchConfig"
```

---

## Task 3: Add `defaultMinFit` to AppConfig

**Files:**
- Modify: `packages/core/src/store/appConfig.ts`
- Test: `packages/core/tests/store.test.ts`

- [ ] **Step 1: Write the failing test** (append to `store.test.ts` inside its top-level `describe`; import `getConfig` if not already imported)

```typescript
  it('defaults defaultMinFit to 0.6 and lets it be overridden', async () => {
    const { openDb } = await import('../src/store/db.ts');
    const { getConfig, setConfig } = await import('../src/store/appConfig.ts');
    const db = openDb(':memory:');
    expect(getConfig(db).defaultMinFit).toBe(0.6);
    setConfig(db, { defaultMinFit: 0.75 });
    expect(getConfig(db).defaultMinFit).toBe(0.75);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- store.test`
Expected: FAIL — `defaultMinFit` is `undefined`.

- [ ] **Step 3: Add the field**

In `packages/core/src/store/appConfig.ts`, add to the `AppConfig` type (after `verificationTimeoutMs: number;`):

```typescript
  /** Default minimum fit score (0..1) a job must reach to be auto-applied,
   *  when a watch doesn't set its own. */
  defaultMinFit: number;
```

And add to `DEFAULT_APP_CONFIG` (after `verificationTimeoutMs: 240_000`):

```typescript
  ,
  defaultMinFit: 0.6
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- store.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/appConfig.ts packages/core/tests/store.test.ts
git commit -m "feat(config): defaultMinFit global threshold (0.6)"
```

---

## Task 4: `fitGate` service

**Files:**
- Create: `packages/core/src/services/fitGate.ts`
- Test: `packages/core/tests/fitGate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { setCachedFit, getCachedFit } from '../src/store/fitScoreCache.ts';
import { scoreAndGate } from '../src/services/fitGate.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

function seed(db: ReturnType<typeof openDb>) {
  upsertCompany(db, { id: 'c', name: 'Co', ats: 'greenhouse', atsOrgSlug: 'co' });
  upsertJobs(db, [
    { id: 'j-hi', companyId: 'c', title: 'PM', url: 'https://x/hi', descriptionMd: 'd', raw: {} },
    { id: 'j-lo', companyId: 'c', title: 'Sales', url: 'https://x/lo', descriptionMd: 'd', raw: {} }
  ]);
  addResume(db, { id: 'r-1', label: 'PM', rawText: 'resume', parsed: {} });
  upsertProfile(db, { name: 'Ada', email: 'ada@x.com' });
}

// Sampling stub that scores j-hi high and everything else low.
function scoringSampling(): SamplingClient {
  return {
    complete: async () => 'x',
    completeJson: async (req: { prompt: string }) => {
      const isHi = req.prompt.includes('"title":"PM"');
      return { score: isHi ? 0.82 : 0.2, top_strengths: ['s'], top_gaps: ['g'] };
    }
  } as unknown as SamplingClient;
}

describe('scoreAndGate', () => {
  it('keeps only jobs scoring >= minFit and caches every score', async () => {
    const db = openDb(':memory:');
    seed(db);
    const res = await scoreAndGate({ db, sampling: scoringSampling() }, ['j-hi', 'j-lo'], { resumeId: 'r-1', minFit: 0.6 });
    expect(res.kept).toEqual(['j-hi']);
    expect(res.considered).toBe(2);
    expect(res.scores['j-hi']).toBeCloseTo(0.82);
    expect(getCachedFit(db, 'j-hi', 'r-1')?.score).toBeCloseTo(0.82);
  });

  it('reuses a cached score instead of re-scoring', async () => {
    const db = openDb(':memory:');
    seed(db);
    setCachedFit(db, { jobId: 'j-hi', resumeId: 'r-1', score: 0.95, topStrengths: [], topGaps: [] });
    let calls = 0;
    const counting = {
      complete: async () => 'x',
      completeJson: async () => { calls++; return { score: 0.1, top_strengths: [], top_gaps: [] }; }
    } as unknown as SamplingClient;
    const res = await scoreAndGate({ db, sampling: counting }, ['j-hi'], { resumeId: 'r-1', minFit: 0.6 });
    expect(res.kept).toEqual(['j-hi']);
    expect(calls).toBe(0); // served from cache
  });

  it('falls back to auto-pick when no resumeId is given (uses first resume)', async () => {
    const db = openDb(':memory:');
    seed(db);
    const res = await scoreAndGate({ db, sampling: scoringSampling() }, ['j-hi'], { minFit: 0.6 });
    expect(res.kept).toEqual(['j-hi']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- fitGate`
Expected: FAIL — `fitGate.ts` does not exist.

- [ ] **Step 3: Implement `scoreAndGate`**

Create `packages/core/src/services/fitGate.ts`:

```typescript
import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';
import { scoreFit } from '../tools/score_fit.ts';
import { getCachedFit } from '../store/fitScoreCache.ts';
import { listResumes } from '../store/resume.ts';

export type FitGateDeps = { db: Db; sampling: SamplingClient };
export type FitGateOpts = { resumeId?: string; minFit: number };
export type FitGateResult = { kept: string[]; considered: number; scores: Record<string, number> };

/**
 * Score each new job against a résumé and keep only those at or above `minFit`.
 * This is the autonomous-loop "best jobs for my skills" gate: it stops the
 * watcher from auto-applying to title-keyword matches that don't actually fit.
 *
 * - Uses the existing scoreFit (which writes the fit-score cache).
 * - Reuses a cached score for the same (job, résumé) pair instead of paying to
 *   re-score (cheap + idempotent across watcher passes).
 * - With no resumeId, scoreFit falls back to the first résumé; we resolve that
 *   same résumé id here so the cache lookup keys correctly.
 */
export async function scoreAndGate(
  deps: FitGateDeps,
  jobIds: string[],
  opts: FitGateOpts
): Promise<FitGateResult> {
  const resumeId = opts.resumeId ?? listResumes(deps.db)[0]?.id;
  const kept: string[] = [];
  const scores: Record<string, number> = {};

  for (const jobId of jobIds) {
    let score: number | undefined;
    if (resumeId) {
      const cached = getCachedFit(deps.db, jobId, resumeId);
      if (cached) score = cached.score;
    }
    if (score === undefined) {
      try {
        const out = await scoreFit({ jobId, resumeId }, deps);
        score = out.score;
      } catch {
        // A scoring failure (e.g. transient AI error) must not drop the job
        // permanently — skip it this pass; the next watcher pass retries.
        continue;
      }
    }
    scores[jobId] = score;
    if (score >= opts.minFit) kept.push(jobId);
  }

  return { kept, considered: jobIds.length, scores };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- fitGate`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/fitGate.ts packages/core/tests/fitGate.test.ts
git commit -m "feat(services): fitGate — score new jobs vs résumé, keep >= minFit"
```

---

## Task 5: Thread `capOverride` through guardrail + buildApplication

**Files:**
- Modify: `packages/core/src/services/guardrail.ts`
- Modify: `packages/core/src/services/buildApplication.ts`
- Test: `packages/core/tests/services.guardrail.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the top-level `describe` in `services.guardrail.test.ts`; reuse that file's existing imports/helpers for seeding applications — match its existing pattern for creating N applications in the last 7 days)

```typescript
  it('capOverride takes precedence over the global weekly cap', () => {
    const db = openDb(':memory:');
    // Global cap is 10 by default; create 3 recent submitted applications.
    seedSubmittedApplications(db, 3); // helper already used by other tests in this file
    // Override the cap down to 3 → next draft is blocked.
    const blocked = checkGuardrail(db, { jobId: 'new-job', resumeId: 'r-1', capOverride: 3 });
    expect(blocked.allowed).toBe(false);
    // Override the cap up to 100 → allowed.
    const ok = checkGuardrail(db, { jobId: 'new-job', resumeId: 'r-1', capOverride: 100 });
    expect(ok.allowed).toBe(true);
  });
```

> If `services.guardrail.test.ts` has no `seedSubmittedApplications` helper, inline the application-creation the same way the existing weekly-cap test in that file does (use `createApplication` from `../src/store/application.ts` with `status: 'submitted'` and a recent `created_at`). Read the file first and mirror its existing cap test exactly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- guardrail`
Expected: FAIL — `capOverride` is ignored (TS: not on `GuardrailInput`).

- [ ] **Step 3: Add `capOverride` to the guardrail**

In `packages/core/src/services/guardrail.ts`, add to `GuardrailInput` (after `resumeId: string;`):

```typescript
  /** Overrides the global weekly cap for this check (per-watch cap). <=0 = unlimited. */
  capOverride?: number;
```

Then replace the cap line:

```typescript
  const cap = getConfig(db).weeklyCap;
```

with:

```typescript
  const cap = input.capOverride ?? getConfig(db).weeklyCap;
```

- [ ] **Step 4: Thread `capOverride` through `buildApplication`**

In `packages/core/src/services/buildApplication.ts`, add to `BuildApplicationInput` (after `confirmLowFit?: boolean;`):

```typescript
  capOverride?: number;
```

And pass it into the guardrail call — change the `checkGuardrail(...)` call to include:

```typescript
    capOverride: input.capOverride,
```

(add it as a property in the object literal passed to `checkGuardrail`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- guardrail`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/guardrail.ts packages/core/src/services/buildApplication.ts packages/core/tests/services.guardrail.test.ts
git commit -m "feat(guardrail): per-watch capOverride threads through buildApplication"
```

---

## Task 6: `autoApply` accepts `resumeId` + `capOverride`

**Files:**
- Modify: `packages/core/src/services/autoApplyEngine.ts`
- Test: `packages/core/tests/autoApply.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the top-level `describe` in `autoApply.test.ts`; mirror that file's existing seed/deps helpers)

```typescript
  it('uses the supplied resumeId for every job in the batch', async () => {
    const db = openDb(':memory:');
    seed(db); // existing helper in this file: company + job(s) + a profile
    addResume(db, { id: 'r-product', label: 'Product', rawText: 'p', parsed: {} });
    addResume(db, { id: 'r-project', label: 'Project', rawText: 'j', parsed: {} });
    const deps = { db, sampling: fakeSampling(), browser: fakeBrowser() };

    const summary = await autoApply({ jobIds: ['g-1'], submit: false, resumeId: 'r-project' }, deps);
    expect(summary.total).toBe(1);
    const app = listApplications(db)[0];
    expect(app.resumeId).toBe('r-project');
  });
```

> Read `autoApply.test.ts` first to reuse its exact `seed`, `fakeSampling`, `fakeBrowser` helpers and imports (`addResume`, `listApplications`). If a helper name differs, match the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- autoApply`
Expected: FAIL — `resumeId` not accepted / application uses auto-picked résumé.

- [ ] **Step 3: Extend `AutoApplyOptions` and thread it through**

In `packages/core/src/services/autoApplyEngine.ts`, add to `AutoApplyOptions` (after `allowDuplicate?: boolean;`):

```typescript
  /** Résumé to tailor from for every job in this batch. Omit → auto-pick per job. */
  resumeId?: string;
  /** Per-watch weekly cap override passed to the guardrail. Omit → global cap. */
  capOverride?: number;
```

Then change the `buildApplication` call to forward both:

```typescript
      const draft = await buildApplication(
        { jobId, resumeId: opts.resumeId, capOverride: opts.capOverride, allowDuplicate: opts.allowDuplicate },
        deps
      );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- autoApply`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/autoApplyEngine.ts packages/core/tests/autoApply.test.ts
git commit -m "feat(autoApply): accept per-watch resumeId + capOverride"
```

---

## Task 7: Wire `runWatch` to score-and-gate per watch

**Files:**
- Modify: `packages/core/src/services/watchEngine.ts`
- Test: `packages/core/tests/watchEngine.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe` in `watchEngine.test.ts`; reuse its `seed`, `fakeBrowser`, `tick` helpers)

```typescript
  it('only auto-applies jobs that score >= the watch minFit', async () => {
    const db = openDb(':memory:');
    seed(db); // seeds resume r-1 + a PM job g-1
    // Sampling that scores any job with "Senior" in the title low, others high.
    const sampling = {
      complete: async () => 'GENERATED',
      completeJson: async (req: { prompt: string }) =>
        req.prompt.includes('Senior')
          ? { score: 0.2, top_strengths: [], top_gaps: [] }
          : { score: 0.85, top_strengths: [], top_gaps: [] }
    } as unknown as SamplingClient;
    const deps = { db, sampling, browser: fakeBrowser() };

    createSavedSearch(db, {
      name: 'PM', filters: { titleContains: 'PM' }, source: 'companies',
      autoApply: true, resumeId: 'r-1', minFit: 0.6
    });
    await runWatch(deps); // baseline
    await tick();
    // Two new matches: one high-fit, one low-fit ("Senior").
    upsertJobs(db, [
      { id: 'g-hi', companyId: 'stripe', title: 'PM, Growth', url: 'https://x/hi', descriptionMd: 'd', raw: {} },
      { id: 'g-lo', companyId: 'stripe', title: 'Senior PM', url: 'https://x/lo', descriptionMd: 'd', raw: {} }
    ]);
    const r = await runWatch(deps);
    expect(r.totalNew).toBe(2);            // both detected as new
    expect(listApplications(db).length).toBe(1); // only the high-fit one applied
    expect(listApplications(db)[0].jobId).toBe('g-hi');
  });
```

> Add `import { createSavedSearch } from '../src/store/savedSearch.ts';` and `import type { SamplingClient } from '../src/sampling/client.ts';` if not already present (they are, per the current file). Ensure the file's `seed` adds résumé `r-1` (it does).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- watchEngine`
Expected: FAIL — both jobs applied (no gate yet), so `listApplications(db).length` is 2.

- [ ] **Step 3: Wire the gate into `runWatch`**

In `packages/core/src/services/watchEngine.ts`:

Add imports at the top (after the existing imports):

```typescript
import { scoreAndGate } from './fitGate.ts';
import { getConfig } from '../store/appConfig.ts';
```

(`getConfig` is already imported — do not duplicate it. Only add `scoreAndGate`.)

Replace the auto-apply block inside the `for (const s of listSavedSearches(db))` loop:

```typescript
    let autoApplied: AutoApplySummary | undefined;
    if (s.autoApply && jobIds.length > 0) {
      autoApplied = await autoApply({ jobIds, submit }, deps);
      totalSubmitted += autoApplied.submitted;
    }
```

with:

```typescript
    let autoApplied: AutoApplySummary | undefined;
    if (s.autoApply && jobIds.length > 0) {
      const minFit = s.minFit ?? getConfig(db).defaultMinFit;
      const gate = await scoreAndGate({ db, sampling: deps.sampling }, jobIds, { resumeId: s.resumeId, minFit });
      if (gate.kept.length > 0) {
        const submitThisWatch = s.autoSubmit ?? submit;
        autoApplied = await autoApply(
          { jobIds: gate.kept, submit: submitThisWatch, resumeId: s.resumeId, capOverride: s.weeklyCap },
          deps
        );
        totalSubmitted += autoApplied.submitted;
      }
    }
```

> Note: `submit` (the global `submitPolicy === 'auto'`) is still computed once at the top of `runWatch` and is used as the fallback when a watch has no `autoSubmit` override. Leave that line unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- watchEngine`
Expected: PASS (new test + the two existing tests). The existing tests have no `minFit`/`resumeId` on their watches, so `minFit` falls back to `defaultMinFit` (0.6) and their `fakeSampling` returns `{}` → `score` is `undefined` → `NaN >= 0.6` is `false`, which would **drop** their jobs.

To keep the two existing tests valid, update their `fakeSampling` to return a passing score. Change the existing `fakeSampling` in this file from:

```typescript
function fakeSampling(): SamplingClient {
  return { complete: async () => 'GENERATED', completeJson: async () => ({}) } as unknown as SamplingClient;
}
```

to:

```typescript
function fakeSampling(): SamplingClient {
  return {
    complete: async () => 'GENERATED',
    completeJson: async () => ({ score: 0.85, top_strengths: [], top_gaps: [] })
  } as unknown as SamplingClient;
}
```

Re-run: `npm test -w crosswalk-mcp -- watchEngine` → Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/services/watchEngine.ts packages/core/tests/watchEngine.test.ts
git commit -m "feat(watch): fit-gate new matches per watch before auto-apply"
```

---

## Task 8: Export new functions from the runtime barrel

**Files:**
- Modify: `packages/core/src/runtime.ts`
- Test: `packages/core/tests/smoke.test.ts`

- [ ] **Step 1: Write the failing test** (append inside the top-level `describe` in `smoke.test.ts`)

```typescript
  it('runtime barrel exports updateSavedSearchConfig and scoreAndGate', async () => {
    const rt = await import('../src/runtime.ts');
    expect(typeof rt.updateSavedSearchConfig).toBe('function');
    expect(typeof rt.scoreAndGate).toBe('function');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- smoke`
Expected: FAIL — exports are undefined.

- [ ] **Step 3: Add the exports**

In `packages/core/src/runtime.ts`, update the savedSearch export line (currently line ~38) to include `updateSavedSearchConfig`:

```typescript
export { createSavedSearch, listSavedSearches, getSavedSearch, deleteSavedSearch, setSavedSearchAutoApply, updateSavedSearchConfig } from './store/savedSearch.ts';
```

And add a new export line near the other services exports (e.g. after the `savedSearchEngine` export at line ~44):

```typescript
export { scoreAndGate } from './services/fitGate.ts';
export type { FitGateResult } from './services/fitGate.ts';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- smoke`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/tests/smoke.test.ts
git commit -m "feat(runtime): export updateSavedSearchConfig + scoreAndGate"
```

---

## Task 9: Web — engine wrappers + searches API for new fields

**Files:**
- Modify: `apps/web/lib/engine.ts`
- Modify: `apps/web/app/api/searches/route.ts`

- [ ] **Step 1: Extend `createSearch` and add `updateSearchConfig` in `engine.ts`**

In `apps/web/lib/engine.ts`, replace `createSearch` with a version that accepts the new fields:

```typescript
export async function createSearch(
  name: string,
  filters: Record<string, unknown>,
  source?: 'web' | 'companies',
  autoApply?: boolean,
  overrides?: { resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean }
) {
  const { createSavedSearch } = await rt();
  return createSavedSearch(await db(), {
    name, filters: sanitizeFilters(filters), source, autoApply,
    resumeId: overrides?.resumeId, minFit: overrides?.minFit,
    weeklyCap: overrides?.weeklyCap, autoSubmit: overrides?.autoSubmit
  });
}
```

And add (after `setSearchAutoApply`):

```typescript
export async function updateSearchConfig(
  id: string,
  patch: { resumeId?: string | null; minFit?: number | null; weeklyCap?: number | null; autoSubmit?: boolean | null; autoApply?: boolean }
) {
  const { updateSavedSearchConfig } = await rt();
  updateSavedSearchConfig(await db(), id, patch);
}
```

- [ ] **Step 2: Forward the fields in the API route**

In `apps/web/app/api/searches/route.ts`, update the `POST` body type and handlers:

Change the body type to:

```typescript
    const body = (await req.json()) as {
      action?: string; id?: string; name?: string;
      filters?: Record<string, unknown>; source?: 'web' | 'companies'; autoApply?: boolean;
      resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean;
    };
```

Add a `set-config` action handler (after the `set-auto` block):

```typescript
    if (body.action === 'set-config') {
      if (!body.id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
      const { updateSearchConfig } = await import('@/lib/engine');
      await updateSearchConfig(body.id, {
        resumeId: body.resumeId ?? null,
        minFit: body.minFit ?? null,
        weeklyCap: body.weeklyCap ?? null,
        autoSubmit: body.autoSubmit ?? null,
        ...(body.autoApply === undefined ? {} : { autoApply: body.autoApply })
      });
      return NextResponse.json({ ok: true });
    }
```

Update the import at the top to include `updateSearchConfig` (or rely on the dynamic import above — keep one style; prefer adding it to the existing top import):

```typescript
import { listSearches, createSearch, deleteSearch, refreshSearches, setSearchAutoApply, updateSearchConfig } from '@/lib/engine';
```

(If you add it to the top import, drop the inline `await import` and call `updateSearchConfig(...)` directly.)

Update the create branch to forward overrides:

```typescript
    const search = await createSearch(body.name, body.filters ?? {}, body.source, body.autoApply, {
      resumeId: body.resumeId, minFit: body.minFit, weeklyCap: body.weeklyCap, autoSubmit: body.autoSubmit
    });
```

- [ ] **Step 3: Type-check the web app**

Run: `npm run lint -w @crosswalk/web`
Expected: PASS (no TS errors).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/engine.ts apps/web/app/api/searches/route.ts
git commit -m "feat(web): searches API carries per-watch résumé/minFit/cap/autoSubmit"
```

---

## Task 10: Web — watch editor UI (résumé, min-fit, cap, auto-submit)

**Files:**
- Modify: `apps/web/app/jobs/page.tsx`

- [ ] **Step 1: Load résumés and add editor state**

In `apps/web/app/jobs/page.tsx`:

1. Extend the `SavedSearch` type (line ~10) to include the new fields:

```typescript
type SavedSearch = { id: string; name: string; filters: Record<string, unknown>; source?: string; autoApply?: boolean; resumeId?: string; minFit?: number; weeklyCap?: number; autoSubmit?: boolean; lastCheckedAt?: string };
```

2. Add state for résumés and the "save as watch" form near the other `useState`s (~line 29-38):

```typescript
  const [resumes, setResumes] = useState<{ id: string; label: string }[]>([]);
  const [watchResumeId, setWatchResumeId] = useState<string>('');
  const [watchMinFit, setWatchMinFit] = useState<number>(0.6);
  const [watchCap, setWatchCap] = useState<string>('');        // '' = use global
  const [watchAutoSubmit, setWatchAutoSubmit] = useState<boolean>(false);
```

3. In the existing initial-load `useEffect` (the one that fetches `/api/searches`), also load résumés via the existing `runTool` helper used on the résumés page:

```typescript
    runTool<{ resumes: { id: string; label: string }[] }>('list_resumes', {})
      .then(r => setResumes(r.resumes ?? []))
      .catch(() => {});
```

> Confirm `runTool` is imported in this file; the résumés page imports it from the same lib. If not present, add the same import the résumés page uses (`import { runTool } from '@/lib/...'` — match `apps/web/app/resumes/page.tsx`).

- [ ] **Step 2: Send the new fields when saving a watch**

Find `saveSearch` (~line 105-112) and replace its `body` with the overrides included:

```typescript
    await fetch('/api/searches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, filters: currentFilters(), source: mode, autoApply: saveAutoApply,
        resumeId: watchResumeId || undefined,
        minFit: watchMinFit,
        weeklyCap: watchCap === '' ? undefined : Number(watchCap),
        autoSubmit: watchAutoSubmit
      })
    });
```

- [ ] **Step 3: Add the editor controls next to "Save as watch"**

In the search controls row (near the `Save as watch` button, ~line 197), add a compact control cluster. Insert before or after the button:

```tsx
        <select
          value={watchResumeId}
          onChange={e => setWatchResumeId(e.target.value)}
          className="rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
          title="Résumé this watch tailors from"
        >
          <option value="">Auto-pick résumé</option>
          {resumes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm text-[var(--muted)]" title="Minimum fit to auto-apply">
          min-fit {watchMinFit.toFixed(2)}
          <input type="range" min={0} max={1} step={0.05}
            value={watchMinFit} onChange={e => setWatchMinFit(Number(e.target.value))} />
        </label>
        <input
          type="number" min={0} placeholder="cap (blank=global)"
          value={watchCap} onChange={e => setWatchCap(e.target.value)}
          className="w-28 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
          title="Per-watch weekly cap (0 = unlimited, blank = use global)"
        />
        <label className="flex items-center gap-1 text-sm text-[var(--muted)]" title="Submit automatically for this watch">
          <input type="checkbox" checked={watchAutoSubmit} onChange={e => setWatchAutoSubmit(e.target.checked)} />
          auto-submit
        </label>
```

- [ ] **Step 4: Show per-watch settings in each watch row**

In the `searches.map(s => ...)` block (~line 221-234), add a line under the watch name showing its overrides:

```tsx
                    <div className="text-xs text-[var(--muted)]">
                      {s.resumeId ? `résumé set` : 'auto-pick résumé'}
                      {typeof s.minFit === 'number' ? ` · min-fit ${s.minFit.toFixed(2)}` : ' · min-fit (global)'}
                      {typeof s.weeklyCap === 'number' ? ` · cap ${s.weeklyCap}` : ''}
                      {s.autoSubmit ? ' · auto-submit' : ''}
                    </div>
```

- [ ] **Step 5: Type-check + build the web app**

Run: `npm run lint -w @crosswalk/web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/jobs/page.tsx
git commit -m "feat(web): watch editor — résumé picker, min-fit, per-watch cap, auto-submit"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the entire core test suite**

Run: `npm test`
Expected: PASS — all existing tests (303) plus the new fitGate tests and extensions. If any pre-existing watch/autoApply test fails because of the new gate, it's because its sampling stub returns no `score`; fix by giving that stub a passing `completeJson` score (as done in Task 7 Step 4) — do NOT weaken the gate.

- [ ] **Step 2: Lint both packages**

Run: `npm run lint`
Expected: PASS (strict TypeScript, core + web).

- [ ] **Step 3: Build core (the engine the GUI + watcher load)**

Run: `npm run build:core`
Expected: builds with no errors.

- [ ] **Step 4: Commit any lint/build fixups**

```bash
git add -A
git commit -m "chore: lint/build fixups for targeting-brain phase 1" || echo "nothing to commit"
```

---

## Post-implementation: apply to ~5 real jobs

This is a manual verification run, performed after the suite is green and core is rebuilt. It is NOT a code task — it exercises the real pipeline with the user's data.

- [ ] Rebuild + restart so the GUI loads the new engine: `npm run build:core` then restart the dev server (the engine is cached in memory; HMR does not pick up core dist — per project memory).
- [ ] Confirm an Anthropic API key is set (Settings) and the answer bank has "Load common defaults" applied.
- [ ] Pick a high-fit ATS with the best automation track record (Greenhouse fills + submits end-to-end incl. the emailed code gate; the inbox is already connected). Avoid Lever (silent captcha drop) and Workday (account wall) for this verification batch — those are Phase 2/4 work.
- [ ] Create/confirm a watch: query `product manager`, source `web` or `companies`, résumé = "My résumé", min-fit `0.6`, auto-submit per the user's choice.
- [ ] Trigger an apply batch of ~5 (via "Auto-apply" in the Jobs view, or `POST /api/auto-apply` with the chosen job IDs and `submit` per policy).
- [ ] Verify each outcome against ground truth (per project memory): inspect `~/.crosswalk/state.db` `application_event` kinds and decode the result screenshot for any `submit_unconfirmed`/`nothing_filled`. Report honestly which of the 5 confirmed-submitted vs. need a human hand.

---

## Self-review notes

- **Spec coverage:** fitGate (Task 4), savedSearch columns + migration (Tasks 1–2), watchEngine wiring (Task 7), autoApply résumé/cap threading (Tasks 5–6), defaultMinFit (Task 3), runtime exports (Task 8), watch-editor UI (Tasks 9–10), full verification + 5-job run (Task 11 + post-impl). All Phase-1 spec bullets map to a task.
- **Type consistency:** `scoreAndGate(deps, jobIds, opts)` signature is identical in Task 4 (definition), Task 7 (call), Task 8 (export). `capOverride` named identically across guardrail/buildApplication/autoApply. `updateSavedSearchConfig` named identically in Tasks 2/8/9. `minFit`/`weeklyCap`/`autoSubmit`/`resumeId` column and field names consistent across store, API, and UI.
- **No placeholders:** every code step shows the actual code; the two "read the file first and mirror its helpers" notes (Tasks 5/6) are because those test files' seed helpers must be matched exactly rather than guessed — the test body itself is fully specified.
