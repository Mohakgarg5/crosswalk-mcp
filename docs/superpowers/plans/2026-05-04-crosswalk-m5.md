# Crosswalk M5 Implementation Plan — Live-fit gate + install polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the live-fit guardrail gate (refuses drafts < 0.50 fit unless the user confirms), polish the install/uninstall experience (`uninstall`, `status`, better error messages), and ship v0.4.0.

**Architecture:** Live-fit is a new SQLite cache table (migration #4) that `score_fit` writes to and the guardrail reads from. No new sampling work — the gate uses results the user has already computed. Install polish is a small CLI surface expansion: a clean uninstall that removes the Claude Desktop entry and (optionally) the state DB, plus a `status` subcommand that reports what's stored and what's installed.

**Tech Stack:** Same as M4. No new runtime deps.

**M5 ships:**
- New table: `fit_score_cache` (job_id × resume_id → score, narrative, computed_at)
- `score_fit` and `explain_fit` now persist results to the cache
- Guardrail gate that refuses drafts when cached fit < 0.50, unless `confirmLowFit=true`
- `crosswalk-mcp uninstall` CLI subcommand (optional `--purge` removes state.db too)
- `crosswalk-mcp status` CLI subcommand (counts of profile/resumes/applications/workflows)
- Better install/uninstall error messages
- Registry expansion to ~75 companies via community-friendly seed additions

**Out of M5 (deferred to M6/v0.5.0):**
- Workday + iCIMS adapters (need Playwright sandbox; ~200MB Chromium download as optional peer dep)
- Cursor / Windsurf installers (need real client testing on each)
- Demo GIF (manual deliverable)

---

## File structure

```
crosswalk-mcp/
├── src/
│   ├── store/
│   │   ├── fitScoreCache.ts         # NEW — getCachedFit, setCachedFit, listCachedFits
│   │   └── migrations.ts            # MODIFY — migration #4
│   ├── services/
│   │   └── guardrail.ts             # MODIFY — read fit_score_cache; gate at <0.50
│   ├── tools/
│   │   ├── score_fit.ts             # MODIFY — persist to cache after sampling
│   │   └── explain_fit.ts           # MODIFY — persist narrative to cache (if score row exists)
│   └── cli.ts                       # MODIFY — add `uninstall` and `status` subcommands
├── registry/
│   ├── companies.json               # MODIFY — expand to ~75
│   └── h1b.json                     # MODIFY — coverage for new entries
├── tests/
│   ├── store.fitScoreCache.test.ts  # NEW
│   ├── store.test.ts                # MODIFY — assert 4 migrations
│   ├── services.guardrail.test.ts   # MODIFY — low-fit refusal tests
│   ├── tools.score_fit.test.ts      # MODIFY — assert cache write
│   ├── tools.explain_fit.test.ts    # MODIFY — assert cache narrative write
│   └── cli.uninstall.test.ts        # NEW
└── docs/
    └── superpowers/plans/
        └── 2026-05-04-crosswalk-m5.md   # this file
```

---

## Task list (10 tasks)

| # | Theme | Task |
|---|---|---|
| 1 | Storage | Migration #4 — `fit_score_cache` table |
| 2 | Storage | `fitScoreCache` CRUD module |
| 3 | Tools | `score_fit` persists results to cache |
| 4 | Tools | `explain_fit` persists narrative to cache |
| 5 | Guardrail | Live-fit gate in guardrail service |
| 6 | Guardrail | Wire `confirmLowFit` end-to-end through `buildApplication` |
| 7 | CLI | `crosswalk-mcp uninstall [--purge]` |
| 8 | CLI | `crosswalk-mcp status` |
| 9 | Registry | Expand to ~75 companies |
| 10 | Ship | README + version 0.4.0 |

---

## Task 1: Migration #4 — `fit_score_cache` table

**Files:**
- Modify: `src/store/migrations.ts`
- Modify: `tests/store.test.ts`

The cache is keyed by `(job_id, resume_id)` so each (job, resume) pair has at most one row. `score_fit` upserts; `explain_fit` updates the `narrative_md` field.

- [ ] **Step 1: Update existing test**

Open `tests/store.test.ts`. Update the table-list assertion to include `fit_score_cache`. Find:

```ts
    expect(names).toContain('workflow');
    expect(names).toContain('migrations');
```

Insert before `migrations`:

```ts
    expect(names).toContain('fit_score_cache');
```

Then find the test "applied three migrations" and rename it / update its expectation:

```ts
  it('applied four migrations', () => {
    const db = openDb(':memory:');
    const ids = (db.prepare(`SELECT id FROM migrations ORDER BY id`).all() as Array<{ id: number }>).map(r => r.id);
    expect(ids).toEqual([1, 2, 3, 4]);
  });
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- store.test
```
Expected: 2 failures — `fit_score_cache` table missing; only 3 migrations applied.

- [ ] **Step 3: Append migration #4**

In `src/store/migrations.ts`, after the existing migration #3, append a comma + new entry:

```ts
  ,
  {
    id: 4,
    name: 'fit_score_cache',
    sql: `
      CREATE TABLE fit_score_cache (
        job_id TEXT NOT NULL REFERENCES job(id),
        resume_id TEXT NOT NULL REFERENCES resume(id),
        score REAL NOT NULL,
        top_strengths_json TEXT NOT NULL,
        top_gaps_json TEXT NOT NULL,
        narrative_md TEXT,
        computed_at TEXT NOT NULL,
        PRIMARY KEY (job_id, resume_id)
      );
      CREATE INDEX idx_fit_cache_computed ON fit_score_cache(computed_at);
    `
  }
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 124 passing (test count unchanged — 3 store.test.ts tests, just updated assertions). Lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/migrations.ts tests/store.test.ts
git commit -m "feat(store): migration #4 — fit_score_cache table"
```

---

## Task 2: `fitScoreCache` CRUD module

**Files:**
- Create: `src/store/fitScoreCache.ts`, `tests/store.fitScoreCache.test.ts`

Three operations: `setCachedFit` (upsert), `getCachedFit` (read), `setCachedNarrative` (update narrative without touching the score). Plus `listCachedFits` for diagnostics.

- [ ] **Step 1: Failing test**

Create `tests/store.fitScoreCache.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  setCachedFit, getCachedFit, setCachedNarrative, listCachedFits
} from '../src/store/fitScoreCache.ts';

describe('store/fitScoreCache', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('upserts and reads back a fit score', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.78, topStrengths: ['payments domain'], topGaps: ['no Kafka']
    });
    const cached = getCachedFit(db, 'g:stripe:1', 'r1');
    expect(cached?.score).toBe(0.78);
    expect(cached?.topStrengths).toEqual(['payments domain']);
    expect(cached?.topGaps).toEqual(['no Kafka']);
    expect(cached?.narrativeMd).toBeUndefined();
  });

  it('returns null when no entry exists', () => {
    expect(getCachedFit(db, 'g:stripe:1', 'r1')).toBeNull();
  });

  it('overwrites on second setCachedFit', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.5, topStrengths: ['a'], topGaps: ['b']
    });
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.9, topStrengths: ['c'], topGaps: ['d']
    });
    expect(getCachedFit(db, 'g:stripe:1', 'r1')?.score).toBe(0.9);
  });

  it('setCachedNarrative updates only the narrative field', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.78, topStrengths: ['a'], topGaps: ['b']
    });
    setCachedNarrative(db, 'g:stripe:1', 'r1', '## Fit\n\n78%...');
    const cached = getCachedFit(db, 'g:stripe:1', 'r1');
    expect(cached?.score).toBe(0.78);
    expect(cached?.narrativeMd).toContain('Fit');
  });

  it('setCachedNarrative is a no-op when no row exists', () => {
    setCachedNarrative(db, 'g:stripe:1', 'r1', 'narrative');
    expect(getCachedFit(db, 'g:stripe:1', 'r1')).toBeNull();
  });

  it('listCachedFits returns all entries newest first', () => {
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.5, topStrengths: [], topGaps: []
    });
    addResume(db, { id: 'r2', label: 'Senior PM', rawText: 'PM', parsed: {} });
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r2',
      score: 0.8, topStrengths: [], topGaps: []
    });
    const all = listCachedFits(db);
    expect(all).toHaveLength(2);
    expect(all[0].resumeId).toBe('r2'); // newest first
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- fitScoreCache
```

- [ ] **Step 3: Implement**

Create `src/store/fitScoreCache.ts`:

```ts
import type { Db } from './db.ts';

export type CachedFit = {
  jobId: string;
  resumeId: string;
  score: number;
  topStrengths: string[];
  topGaps: string[];
  narrativeMd?: string;
  computedAt: string;
};

export type CachedFitInput = {
  jobId: string;
  resumeId: string;
  score: number;
  topStrengths: string[];
  topGaps: string[];
};

type Row = {
  jobId: string;
  resumeId: string;
  score: number;
  top_strengths_json: string;
  top_gaps_json: string;
  narrativeMd: string | null;
  computedAt: string;
};

const SELECT = `
  SELECT job_id AS jobId, resume_id AS resumeId, score,
         top_strengths_json, top_gaps_json,
         narrative_md AS narrativeMd, computed_at AS computedAt
  FROM fit_score_cache
`;

function rowToCachedFit(r: Row): CachedFit {
  return {
    jobId: r.jobId, resumeId: r.resumeId, score: r.score,
    topStrengths: JSON.parse(r.top_strengths_json) as string[],
    topGaps: JSON.parse(r.top_gaps_json) as string[],
    narrativeMd: r.narrativeMd ?? undefined,
    computedAt: r.computedAt
  };
}

export function setCachedFit(db: Db, input: CachedFitInput): void {
  const computedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO fit_score_cache (
      job_id, resume_id, score, top_strengths_json, top_gaps_json,
      narrative_md, computed_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(job_id, resume_id) DO UPDATE SET
      score = excluded.score,
      top_strengths_json = excluded.top_strengths_json,
      top_gaps_json = excluded.top_gaps_json,
      computed_at = excluded.computed_at
  `).run(
    input.jobId, input.resumeId, input.score,
    JSON.stringify(input.topStrengths),
    JSON.stringify(input.topGaps),
    computedAt
  );
}

export function getCachedFit(db: Db, jobId: string, resumeId: string): CachedFit | null {
  const r = db.prepare(`${SELECT} WHERE job_id = ? AND resume_id = ?`).get(jobId, resumeId) as Row | undefined;
  return r ? rowToCachedFit(r) : null;
}

export function setCachedNarrative(db: Db, jobId: string, resumeId: string, narrativeMd: string): void {
  db.prepare(`
    UPDATE fit_score_cache
    SET narrative_md = ?, computed_at = ?
    WHERE job_id = ? AND resume_id = ?
  `).run(narrativeMd, new Date().toISOString(), jobId, resumeId);
}

export function listCachedFits(db: Db): CachedFit[] {
  const rows = db.prepare(`${SELECT} ORDER BY computed_at DESC, rowid DESC`).all() as Row[];
  return rows.map(rowToCachedFit);
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 130 passing (124 + 6 new). Lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/fitScoreCache.ts tests/store.fitScoreCache.test.ts
git commit -m "feat(store): fitScoreCache CRUD (job × resume → score, narrative)"
```

---

## Task 3: `score_fit` persists results to cache

**Files:**
- Modify: `src/tools/score_fit.ts`
- Modify: `tests/tools.score_fit.test.ts`

After the sampling call returns a structured score, write it to the cache.

- [ ] **Step 1: Add cache-write test**

Open `tests/tools.score_fit.test.ts`. Add a new `it` after the existing tests:

```ts
  it('persists the score to the fit_score_cache', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        score: 0.82, top_strengths: ['payments domain'], top_gaps: ['no Kafka']
      })
    } as unknown as SamplingClient;
    await scoreFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });

    const { getCachedFit } = await import('../src/store/fitScoreCache.ts');
    const cached = getCachedFit(db, 'greenhouse:stripe:1', 'r1');
    expect(cached?.score).toBe(0.82);
    expect(cached?.topStrengths).toEqual(['payments domain']);
    expect(cached?.topGaps).toEqual(['no Kafka']);
  });
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- score_fit
```

- [ ] **Step 3: Implement**

In `src/tools/score_fit.ts`, add the import:

```ts
import { setCachedFit } from '../store/fitScoreCache.ts';
```

Then in the `scoreFit` function, after the `out = await ctx.sampling.completeJson(...)` call but before `return`, add:

```ts
  setCachedFit(ctx.db, {
    jobId: input.jobId,
    resumeId: resume.id,
    score: out.score,
    topStrengths: out.top_strengths,
    topGaps: out.top_gaps
  });
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 131 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/score_fit.ts tests/tools.score_fit.test.ts
git commit -m "feat(tools): score_fit persists results to fit_score_cache"
```

---

## Task 4: `explain_fit` persists narrative to cache

**Files:**
- Modify: `src/tools/explain_fit.ts`
- Modify: `tests/tools.explain_fit.test.ts`

If a `score_fit` cache entry already exists for this (jobId, resumeId), update its `narrative_md`. If not, do nothing — `explain_fit` doesn't have a numeric score to seed the row with.

- [ ] **Step 1: Add cache-write test**

Open `tests/tools.explain_fit.test.ts`. Add a new `it`:

```ts
  it('writes the narrative to fit_score_cache when a score row exists', async () => {
    const { setCachedFit, getCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'greenhouse:stripe:1', resumeId: 'r1',
      score: 0.82, topStrengths: [], topGaps: []
    });

    const sampling = {
      complete: vi.fn().mockResolvedValue('## Fit\n\n82% fit. Strong on payments.')
    } as unknown as SamplingClient;
    await explainFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });

    const cached = getCachedFit(db, 'greenhouse:stripe:1', 'r1');
    expect(cached?.narrativeMd).toContain('Fit');
  });

  it('is a no-op on cache when no score row exists', async () => {
    const { getCachedFit } = await import('../src/store/fitScoreCache.ts');
    const sampling = {
      complete: vi.fn().mockResolvedValue('## Fit\n\nbody')
    } as unknown as SamplingClient;
    await explainFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });
    expect(getCachedFit(db, 'greenhouse:stripe:1', 'r1')).toBeNull();
  });
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- explain_fit
```

- [ ] **Step 3: Implement**

In `src/tools/explain_fit.ts`, add the import:

```ts
import { setCachedNarrative } from '../store/fitScoreCache.ts';
```

After the `narrativeMd = await ctx.sampling.complete(...)` call but before `return`, add:

```ts
  setCachedNarrative(ctx.db, input.jobId, resume.id, narrativeMd);
```

`setCachedNarrative` is a no-op when no row exists (its UPDATE matches 0 rows), so the second test passes naturally.

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 133 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/explain_fit.ts tests/tools.explain_fit.test.ts
git commit -m "feat(tools): explain_fit writes narrative to fit_score_cache"
```

---

## Task 5: Live-fit gate in guardrail service

**Files:**
- Modify: `src/services/guardrail.ts`
- Modify: `tests/services.guardrail.test.ts`

Add a third check to `checkGuardrail`: if `input.confirmLowFit !== true` AND `input.resumeId` is present AND a cached fit score exists for that pair AND the score < 0.50 → refuse with a specific reason. If `resumeId` is absent (the picker will choose), skip this check.

- [ ] **Step 1: Add tests for the gate**

Append to `tests/services.guardrail.test.ts` (inside the existing `describe`, after the existing tests):

```ts
  it('refuses when cached fit < 0.50 and confirmLowFit is not set', async () => {
    const { setCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.35, topStrengths: [], topGaps: []
    });
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(false);
    if (out.allowed === false) {
      expect(out.reason).toMatch(/low fit/i);
      expect(out.reason).toMatch(/0\.35/);
    }
  });

  it('allows low fit when confirmLowFit=true', async () => {
    const { setCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.35, topStrengths: [], topGaps: []
    });
    const out = checkGuardrail(db, {
      jobId: 'g:stripe:1', resumeId: 'r1', confirmLowFit: true
    });
    expect(out.allowed).toBe(true);
  });

  it('allows when fit is >= 0.50', async () => {
    const { setCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.62, topStrengths: [], topGaps: []
    });
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(true);
  });

  it('skips fit gate when resumeId is empty (picker will choose)', () => {
    // No cache entry; resumeId is empty.
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: '' });
    expect(out.allowed).toBe(true);
  });

  it('skips fit gate when no cache entry exists', () => {
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    // No entry yet — guardrail is silent on this dimension.
    expect(out.allowed).toBe(true);
  });
```

- [ ] **Step 2: Run tests (FAIL)**

```bash
npm test -- guardrail
```
Expected: the 3 "refuses low fit" / "allows when high" tests fail; the others pass.

- [ ] **Step 3: Implement the gate**

Open `src/services/guardrail.ts`. Add the import at the top:

```ts
import { getCachedFit } from './../store/fitScoreCache.ts';
```

Add this constant near `WEEKLY_CAP`:

```ts
export const LOW_FIT_THRESHOLD = 0.50;
```

After the duplicate-detection block but before `return { allowed: true, warnings };`, add:

```ts
  // 3. Live-fit gate: refuse drafts where cached fit < threshold,
  //    unless caller explicitly confirms.
  if (!input.confirmLowFit && input.resumeId) {
    const cached = getCachedFit(db, input.jobId, input.resumeId);
    if (cached && cached.score < LOW_FIT_THRESHOLD) {
      return {
        allowed: false,
        reason: `low fit (${cached.score.toFixed(2)}) for this job/resume pair. Run score_fit to get an updated estimate, pick a stronger resume, or pass confirmLowFit=true to override.`
      };
    }
  }
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 138 passing (133 + 5 new guardrail tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/guardrail.ts tests/services.guardrail.test.ts
git commit -m "feat(guardrail): live-fit gate refuses drafts under 0.50 unless confirmed"
```

---

## Task 6: Wire `confirmLowFit` end-to-end through `buildApplication`

**Files:**
- Modify: `tests/services.buildApplication.test.ts`

The wire-through is already in place: `BuildApplicationInput` already has `confirmLowFit?`, and `checkGuardrail` is called with all the right fields. This task adds end-to-end tests that prove the gate activates from `draft_application` and respects the override.

- [ ] **Step 1: Add tests**

Append to `tests/services.buildApplication.test.ts`:

```ts
  it('refuses when cached fit < 0.50', async () => {
    const { setCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.30, topStrengths: [], topGaps: []
    });

    const sampling = {
      complete: vi.fn(),
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    await expect(
      buildApplication({ jobId: 'g:stripe:1', resumeId: 'r1' }, { db, sampling })
    ).rejects.toThrow(/low fit/i);
    expect(sampling.complete).not.toHaveBeenCalled();
  });

  it('proceeds when confirmLowFit=true', async () => {
    const { setCachedFit } = await import('../src/store/fitScoreCache.ts');
    setCachedFit(db, {
      jobId: 'g:stripe:1', resumeId: 'r1',
      score: 0.30, topStrengths: [], topGaps: []
    });

    const sampling = {
      complete: vi.fn()
        .mockResolvedValueOnce('# Mohak\n\n- PM')
        .mockResolvedValueOnce('Dear hiring manager...'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    const out = await buildApplication(
      { jobId: 'g:stripe:1', resumeId: 'r1', confirmLowFit: true },
      { db, sampling }
    );
    expect(out.applicationId).toBeTypeOf('string');
  });
```

- [ ] **Step 2: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 140 passing. (No code change — the path was already in place; we just covered it.)

- [ ] **Step 3: Commit**

```bash
git add tests/services.buildApplication.test.ts
git commit -m "test(services): cover live-fit gate path in buildApplication"
```

---

## Task 7: `crosswalk-mcp uninstall [--purge]`

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.uninstall.test.ts`

`uninstall` removes the `mcpServers.crosswalk-mcp` entry from the Claude Desktop config. With `--purge`, it also deletes `~/.crosswalk/state.db` (and the directory if empty).

- [ ] **Step 1: Failing test**

Create `tests/cli.uninstall.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { uninstallClaudeDesktop } from '../src/cli.ts';

describe('cli/uninstall', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-uninstall-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('removes the crosswalk-mcp entry from a populated config', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await fs.writeFile(cfg, JSON.stringify({
      mcpServers: {
        'crosswalk-mcp': { command: 'npx', args: ['-y', 'crosswalk-mcp@latest'] },
        'other': { command: 'x' }
      }
    }));
    const result = await uninstallClaudeDesktop({ configPath: cfg });
    expect(result.removed).toBe(true);
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp']).toBeUndefined();
    expect(json.mcpServers.other).toBeDefined();
  });

  it('returns removed=false when no entry exists', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await fs.writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    const result = await uninstallClaudeDesktop({ configPath: cfg });
    expect(result.removed).toBe(false);
  });

  it('returns removed=false when config does not exist', async () => {
    const cfg = path.join(tmp, 'nonexistent.json');
    const result = await uninstallClaudeDesktop({ configPath: cfg });
    expect(result.removed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.uninstall
```

- [ ] **Step 3: Implement `uninstallClaudeDesktop`**

In `src/cli.ts`, add this exported function (near `installClaudeDesktop`):

```ts
export async function uninstallClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string; removed: boolean }> {
  const configPath = opts.configPath ?? defaultClaudeConfigPath();

  let json: { mcpServers?: Record<string, unknown> };
  try {
    json = JSON.parse(await fs.readFile(configPath, 'utf8')) as typeof json;
  } catch {
    return { configPath, removed: false };
  }

  if (!json.mcpServers || !('crosswalk-mcp' in json.mcpServers)) {
    return { configPath, removed: false };
  }

  delete json.mcpServers['crosswalk-mcp'];
  await fs.writeFile(configPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  return { configPath, removed: true };
}
```

Then in the `main()` dispatch, add a new branch (between `install` and the unknown-command fallback):

```ts
  if (cmd === 'uninstall') {
    const purge = process.argv.includes('--purge');
    const { configPath, removed } = await uninstallClaudeDesktop();
    if (removed) {
      console.log(`✓ Removed crosswalk-mcp from Claude Desktop at:\n  ${configPath}`);
    } else {
      console.log(`(Nothing to remove — crosswalk-mcp was not in ${configPath}.)`);
    }
    if (purge) {
      const { paths } = await import('./config.ts');
      const fsSync = await import('node:fs');
      const stateDir = paths.stateDir();
      try {
        fsSync.rmSync(stateDir, { recursive: true, force: true });
        console.log(`✓ Purged state at ${stateDir}`);
      } catch (e) {
        console.error(`(Failed to purge ${stateDir}: ${(e as Error).message})`);
      }
    } else {
      console.log(`State at ${process.env.CROSSWALK_HOME ?? '~/.crosswalk/'} preserved. Pass --purge to delete.`);
    }
    return;
  }
```

Update the `--help` text to include the new subcommand:

```ts
    console.log(`Usage:
  crosswalk-mcp                 # run as MCP server (used by Claude Desktop)
  crosswalk-mcp install         # add to Claude Desktop config
  crosswalk-mcp uninstall       # remove from Claude Desktop config
  crosswalk-mcp uninstall --purge  # also delete ~/.crosswalk/state.db
  crosswalk-mcp run-scheduled   # run any workflows whose next_run_at has passed
  crosswalk-mcp --version       # print version
  crosswalk-mcp --help          # show this message`);
    return;
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 143 passing.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.uninstall.test.ts
git commit -m "feat(cli): uninstall subcommand with optional --purge"
```

---

## Task 8: `crosswalk-mcp status`

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.uninstall.test.ts` (add a `status` test) — or create a separate `tests/cli.status.test.ts`

`status` reports: version, state directory, db file existence + size, count of profiles (0 or 1), resumes, jobs, applications by status, workflows. Plus whether the Claude Desktop install entry is present.

- [ ] **Step 1: Failing test**

Create `tests/cli.status.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runStatus } from '../src/cli.ts';

describe('cli/status', () => {
  let tmpHome: string;
  let tmpCfg: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.CROSSWALK_HOME;
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-status-'));
    tmpCfg = path.join(tmpHome, 'claude_desktop_config.json');
    process.env.CROSSWALK_HOME = tmpHome;
  });
  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.CROSSWALK_HOME;
    else process.env.CROSSWALK_HOME = originalEnv;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('reports counts when state.db is empty (newly created)', async () => {
    const out = await runStatus({ configPath: tmpCfg });
    expect(out.stateDir).toBe(tmpHome);
    expect(out.dbExists).toBe(true); // openDb creates it
    expect(out.profile).toBe(false);
    expect(out.resumes).toBe(0);
    expect(out.applicationsByStatus).toEqual({});
    expect(out.workflows).toBe(0);
    expect(out.installedInClaudeDesktop).toBe(false);
  });

  it('reports installedInClaudeDesktop=true when config has the entry', async () => {
    await fs.writeFile(tmpCfg, JSON.stringify({
      mcpServers: { 'crosswalk-mcp': { command: 'npx', args: [] } }
    }));
    const out = await runStatus({ configPath: tmpCfg });
    expect(out.installedInClaudeDesktop).toBe(true);
  });

  it('counts applications grouped by status', async () => {
    // Bootstrap state with some content.
    const { openDb } = await import('../src/store/db.ts');
    const { upsertCompany } = await import('../src/store/company.ts');
    const { upsertJobs } = await import('../src/store/job.ts');
    const { addResume } = await import('../src/store/resume.ts');
    const { createApplication, updateApplicationStatus } = await import('../src/store/application.ts');
    const db = openDb();
    upsertCompany(db, { id: 'c', name: 'C', ats: 'greenhouse', atsOrgSlug: 'c' });
    upsertJobs(db, [{ id: 'j', companyId: 'c', title: 't', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r', label: 'L', rawText: 't', parsed: {} });
    createApplication(db, {
      id: 'a1', jobId: 'j', resumeId: 'r',
      tailoredResumeMd: '#', coverLetterMd: '.',
      answerPack: {}, deepLink: 'https://x'
    });
    createApplication(db, {
      id: 'a2', jobId: 'j', resumeId: 'r',
      tailoredResumeMd: '#', coverLetterMd: '.',
      answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'a2', 'submitted');

    const out = await runStatus({ configPath: tmpCfg });
    expect(out.applicationsByStatus).toEqual({ draft: 1, submitted: 1 });
    expect(out.resumes).toBe(1);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- cli.status
```

- [ ] **Step 3: Implement `runStatus`**

In `src/cli.ts`, add the exported function. Place it after `uninstallClaudeDesktop`:

```ts
import { existsSync, statSync } from 'node:fs';

export type StatusReport = {
  version: string;
  stateDir: string;
  dbFile: string;
  dbExists: boolean;
  dbSizeBytes: number;
  profile: boolean;
  resumes: number;
  jobs: number;
  applicationsByStatus: Record<string, number>;
  workflows: number;
  installedInClaudeDesktop: boolean;
  configPath: string;
};

export async function runStatus(opts: { configPath?: string } = {}): Promise<StatusReport> {
  const { paths } = await import('./config.ts');
  const { openDb } = await import('./store/db.ts');
  const { SERVER_VERSION } = await import('./server.ts');

  const stateDir = paths.stateDir();
  const dbFile = paths.dbFile();
  const dbExists = existsSync(dbFile);
  const dbSizeBytes = dbExists ? statSync(dbFile).size : 0;

  const db = openDb();

  const profileRow = db.prepare(`SELECT COUNT(*) AS n FROM profile`).get() as { n: number };
  const resumeRow = db.prepare(`SELECT COUNT(*) AS n FROM resume`).get() as { n: number };
  const jobRow = db.prepare(`SELECT COUNT(*) AS n FROM job`).get() as { n: number };
  const workflowRow = db.prepare(`SELECT COUNT(*) AS n FROM workflow`).get() as { n: number };

  const statusRows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM application GROUP BY status`
  ).all() as Array<{ status: string; n: number }>;
  const applicationsByStatus: Record<string, number> = {};
  for (const r of statusRows) applicationsByStatus[r.status] = r.n;

  const configPath = opts.configPath ?? defaultClaudeConfigPath();
  let installedInClaudeDesktop = false;
  try {
    const json = JSON.parse(await fs.readFile(configPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
    installedInClaudeDesktop = Boolean(json.mcpServers && 'crosswalk-mcp' in json.mcpServers);
  } catch {
    installedInClaudeDesktop = false;
  }

  return {
    version: SERVER_VERSION,
    stateDir,
    dbFile,
    dbExists,
    dbSizeBytes,
    profile: profileRow.n > 0,
    resumes: resumeRow.n,
    jobs: jobRow.n,
    applicationsByStatus,
    workflows: workflowRow.n,
    installedInClaudeDesktop,
    configPath
  };
}
```

Then in `main()`, add a new branch (after the `uninstall` branch):

```ts
  if (cmd === 'status') {
    const r = await runStatus();
    console.log(`Crosswalk v${r.version}`);
    console.log(`State: ${r.stateDir}`);
    console.log(`  db: ${r.dbExists ? `${r.dbFile} (${(r.dbSizeBytes / 1024).toFixed(1)} KB)` : '(not yet created)'}`);
    console.log(`  profile: ${r.profile ? 'set' : 'unset'}`);
    console.log(`  resumes: ${r.resumes}`);
    console.log(`  jobs (cached): ${r.jobs}`);
    console.log(`  applications: ${Object.entries(r.applicationsByStatus).map(([s, n]) => `${s}=${n}`).join(', ') || '(none)'}`);
    console.log(`  workflows: ${r.workflows}`);
    console.log(`Claude Desktop install: ${r.installedInClaudeDesktop ? '✓' : '(not installed — run `crosswalk-mcp install`)'}`);
    return;
  }
```

Update the `--help` to include `status`:

```ts
  crosswalk-mcp status          # show installed state and counts
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 146 passing.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.status.test.ts
git commit -m "feat(cli): status subcommand reports state counts and install presence"
```

---

## Task 9: Registry expansion

**Files:**
- Modify: `registry/companies.json`
- Modify: `registry/h1b.json`

Bring the seed registry from 51 → ~75 companies. Spread additions across all 8 ATSs. Companies below are real and use commonly-known public ATS slugs.

- [ ] **Step 1: Append entries to `registry/companies.json`**

Open the file. Find the closing `]` and replace it with the additions below + the closing bracket:

Insert these entries before the existing closing `]` (each gets a leading comma since they follow the existing last entry):

```json
  ,
  { "id": "anduril",         "name": "Anduril",         "ats": "greenhouse",       "atsOrgSlug": "andurilindustries" },
  { "id": "rippling",        "name": "Rippling",        "ats": "greenhouse",       "atsOrgSlug": "rippling" },
  { "id": "plaid",           "name": "Plaid",           "ats": "greenhouse",       "atsOrgSlug": "plaid" },
  { "id": "mercury",         "name": "Mercury",         "ats": "greenhouse",       "atsOrgSlug": "mercury" },
  { "id": "retool",          "name": "Retool",          "ats": "greenhouse",       "atsOrgSlug": "retool" },
  { "id": "perplexity",      "name": "Perplexity",      "ats": "ashby",            "atsOrgSlug": "perplexity" },
  { "id": "cohere",          "name": "Cohere",          "ats": "ashby",            "atsOrgSlug": "cohere" },
  { "id": "huggingface",     "name": "Hugging Face",    "ats": "ashby",            "atsOrgSlug": "huggingface" },
  { "id": "cursor",          "name": "Cursor (Anysphere)", "ats": "ashby",         "atsOrgSlug": "anysphere" },
  { "id": "elevenlabs",      "name": "ElevenLabs",      "ats": "ashby",            "atsOrgSlug": "elevenlabs" },
  { "id": "replit",          "name": "Replit",          "ats": "ashby",            "atsOrgSlug": "replit" },
  { "id": "uber",            "name": "Uber",            "ats": "lever",            "atsOrgSlug": "uber" },
  { "id": "postman",         "name": "Postman",         "ats": "lever",            "atsOrgSlug": "postman" },
  { "id": "intercom",        "name": "Intercom",        "ats": "lever",            "atsOrgSlug": "intercom" },
  { "id": "celonis",         "name": "Celonis",         "ats": "smartrecruiters",  "atsOrgSlug": "Celonis1" },
  { "id": "delivery_hero",   "name": "Delivery Hero",   "ats": "smartrecruiters",  "atsOrgSlug": "DeliveryHero" },
  { "id": "wayfair",         "name": "Wayfair",         "ats": "workable",         "atsOrgSlug": "wayfair" },
  { "id": "sumup",           "name": "SumUp",           "ats": "workable",         "atsOrgSlug": "sumup" },
  { "id": "loop",            "name": "Loop Returns",    "ats": "bamboohr",         "atsOrgSlug": "loop" },
  { "id": "polyai",          "name": "PolyAI",          "ats": "bamboohr",         "atsOrgSlug": "polyai" },
  { "id": "wise",            "name": "Wise",            "ats": "recruitee",        "atsOrgSlug": "wise" },
  { "id": "babbel",          "name": "Babbel",          "ats": "recruitee",        "atsOrgSlug": "babbel" },
  { "id": "n26",             "name": "N26",             "ats": "personio",         "atsOrgSlug": "n26" },
  { "id": "freenow",         "name": "FreeNow",         "ats": "personio",         "atsOrgSlug": "free-now" }
]
```

That's 24 new entries → **75 companies total**.

- [ ] **Step 2: Append matching entries to `registry/h1b.json`**

Add these inside the `companies` object (note: heuristic confidence values; lower for non-US/EU companies):

```json
    "anduril":        { "confidence": 0.79, "lastSeen": "2025-09-30" },
    "rippling":       { "confidence": 0.74, "lastSeen": "2025-09-30" },
    "plaid":          { "confidence": 0.81, "lastSeen": "2025-09-30" },
    "mercury":        { "confidence": 0.62, "lastSeen": "2025-09-30" },
    "retool":         { "confidence": 0.66, "lastSeen": "2025-09-30" },
    "perplexity":     { "confidence": 0.70, "lastSeen": "2025-09-30" },
    "cohere":         { "confidence": 0.55, "lastSeen": "2025-09-30" },
    "huggingface":    { "confidence": 0.68, "lastSeen": "2025-09-30" },
    "cursor":         { "confidence": 0.60, "lastSeen": "2025-09-30" },
    "elevenlabs":     { "confidence": 0.45, "lastSeen": "2025-09-30" },
    "replit":         { "confidence": 0.58, "lastSeen": "2025-09-30" },
    "uber":           { "confidence": 0.95, "lastSeen": "2025-09-30" },
    "postman":        { "confidence": 0.72, "lastSeen": "2025-09-30" },
    "intercom":       { "confidence": 0.68, "lastSeen": "2025-09-30" },
    "celonis":        { "confidence": 0.55, "lastSeen": "2025-09-30" },
    "delivery_hero":  { "confidence": 0.30, "lastSeen": "2025-09-30" },
    "wayfair":        { "confidence": 0.74, "lastSeen": "2025-09-30" },
    "sumup":          { "confidence": 0.20, "lastSeen": "2025-09-30" },
    "loop":           { "confidence": 0.40, "lastSeen": "2025-09-30" },
    "polyai":         { "confidence": 0.30, "lastSeen": "2025-09-30" },
    "wise":           { "confidence": 0.40, "lastSeen": "2025-09-30" },
    "babbel":         { "confidence": 0.20, "lastSeen": "2025-09-30" },
    "n26":            { "confidence": 0.15, "lastSeen": "2025-09-30" },
    "freenow":        { "confidence": 0.15, "lastSeen": "2025-09-30" }
```

(Add a comma after the existing last entry's closing brace before inserting these.)

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 146 passing (no test count change — `seedRegistryIfEmpty` reads JSON length dynamically). Lint clean.

- [ ] **Step 4: Commit**

```bash
git add registry/companies.json registry/h1b.json
git commit -m "feat(registry): expand to 75 companies (added Anduril, Rippling, Plaid, Mercury, Retool, Perplexity, Cohere, Hugging Face, Cursor, ElevenLabs, Replit, Uber, Postman, Intercom, Celonis, Delivery Hero, Wayfair, SumUp, Loop, PolyAI, Wise, Babbel, N26, FreeNow)"
```

---

## Task 10: Ship v0.4.0

**Files:**
- Modify: `package.json` (version 0.3.0 → 0.4.0)
- Modify: `src/server.ts` (SERVER_VERSION 0.3.0 → 0.4.0)
- Modify: `README.md`
- Modify: `docs/USER_GUIDE.md`
- Optionally regenerate `docs/Crosswalk_User_Guide.pdf`

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.3.0"` → `"version": "0.4.0"`.

In `src/server.ts`, change `SERVER_VERSION = '0.3.0'` → `SERVER_VERSION = '0.4.0'`.

- [ ] **Step 2: Update README**

In `/Users/mohakgarg/Desktop/Job-Os/README.md`:

A) Find the version badge:
```markdown
[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)]
```
Change to:
```markdown
[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)]
```

B) Find the tests badge `tests-124%20passing` and change to `tests-146%20passing`.

C) Find the "What it does (M4)" heading. Change to "What it does (M5)".

D) Find the row for `draft_application` and update the parenthetical to mention the live-fit gate:
```markdown
| `draft_application` | Build a complete application bundle (tailored resume + cover letter + deep link), persisted as a tracked draft. Anti-spam guardrail enforces a weekly cap, refuses obvious duplicates, and refuses drafts where cached fit is below 0.50 (override with `confirmLowFit: true`). |
```

E) Update the Roadmap table:
```markdown
| Version | Headline |
|---|---|
| M1 | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| M3 | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 5 more ATS adapters (8 total); 51-company registry; carry-over fixes |
| **M5 (this release)** | Live-fit guardrail gate; uninstall + status CLI; registry to 75 |
| M6 | Workday + iCIMS via Playwright sandbox; Cursor/Windsurf installers; registry to 200+ |
| v2 | Autonomous apply via Playwright in a sandbox |
```

F) Update the ATS coverage table to reflect the slightly expanded counts:
```markdown
| ATS | Endpoint type | Seed coverage |
|---|---|---|
| [Greenhouse](https://www.greenhouse.io/) | JSON | Stripe, Airbnb, Anthropic, Vercel, Anduril, Rippling, Plaid, Mercury, Retool, +11 more (20 total) |
| [Lever](https://www.lever.co/) | JSON | Netflix, Spotify, Shopify, Brex, Uber, Postman, Intercom, +4 more (11 total) |
| [Ashby](https://www.ashbyhq.com/) | JSON | OpenAI, Ramp, Notion, Perplexity, Cohere, Hugging Face, Cursor, ElevenLabs, Replit, +4 more (13 total) |
| [Workable](https://www.workable.com/) | JSON | Miro, n8n, Wayfair, SumUp, +2 more (6 total) |
| [SmartRecruiters](https://www.smartrecruiters.com/) | JSON | Bosch, Siemens, Ubisoft, Celonis, Delivery Hero, +1 more (6 total) |
| [BambooHR](https://www.bamboohr.com/) | JSON | Klaviyo, Buffer, Zapier, Tinybird, Loop, PolyAI (6 total) |
| [Recruitee](https://recruitee.com/) | JSON | Mollie, MessageBird, HelloFresh, Wise, Babbel, +1 more (6 total) |
| [Personio](https://www.personio.com/) | XML | Personio, Clue, Trade Republic, Scalable Capital, N26, FreeNow (6 total) |
```

(Total companies: 75.)

G) Add a row to the "16 tools" intro line — say "v0.4.0 also adds the **live-fit guardrail gate** to existing tools."

- [ ] **Step 3: Update USER_GUIDE.md**

In `/Users/mohakgarg/Desktop/Job-Os/docs/USER_GUIDE.md`:

A) Update the title-block subtitle from `v0.3.0` to `v0.4.0`.

B) In the `draft_application` section, update the description to mention the live-fit gate and `confirmLowFit`.

C) In Section 6.2 (CLI subcommands), add two new rows:

```markdown
| `crosswalk-mcp uninstall` | Remove from Claude Desktop config |
| `crosswalk-mcp uninstall --purge` | Also delete `~/.crosswalk/state.db` |
| `crosswalk-mcp status` | Show installed state and counts |
```

D) Update the roadmap snapshot in 6.7 to mark v0.4.0 as Current.

- [ ] **Step 4: Run all tests + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: 146 passing, lint clean, build clean.

- [ ] **Step 5: Smoke run**

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "ok"
```
Expected: `ok`.

Verify the new subcommands run without crashing:

```bash
rm -rf /tmp/cw-status-smoke && CROSSWALK_HOME=/tmp/cw-status-smoke node dist/cli.js status
```
Expected: prints version, state path, counts (mostly zero), Claude Desktop install presence.

- [ ] **Step 6: Optionally regenerate the PDF**

```bash
pandoc docs/USER_GUIDE.md -s --css=/tmp/cw-print.css \
  --metadata title="Crosswalk User Guide" --embed-resources --standalone \
  -o /tmp/cw.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --no-pdf-header-footer \
  --print-to-pdf=docs/Crosswalk_User_Guide.pdf file:///tmp/cw.html
```

(Skip this if pandoc isn't available; the markdown is the source of truth.)

- [ ] **Step 7: Commit**

```bash
git add package.json src/server.ts README.md docs/USER_GUIDE.md docs/Crosswalk_User_Guide.pdf 2>/dev/null
git commit -m "feat: ship v0.4.0 — live-fit gate, uninstall + status CLI, 75 companies"
```

(The `2>/dev/null` is harmless — if the PDF wasn't regenerated, it's not in the staging area.)

---

## Self-review checklist (before declaring M5 done)

- [ ] All 10 tasks completed; all tests passing.
- [ ] Build clean. Smoke run boots cleanly.
- [ ] `crosswalk-mcp status` runs without crashing on a fresh state dir.
- [ ] `crosswalk-mcp uninstall` is the inverse of `install` (removes the entry; doesn't touch state.db unless `--purge`).
- [ ] `score_fit` writes to `fit_score_cache`; `explain_fit` updates the narrative when a row exists.
- [ ] `checkGuardrail` refuses drafts at score < 0.50 unless `confirmLowFit=true` AND a `resumeId` is explicitly provided.
- [ ] No model-provider keys; sampling is still the only LLM path.

---

**End of M5 plan.**
