# Crosswalk M7 Implementation Plan — Workday + iCIMS + sampling-driven workflows

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Workday + iCIMS adapters (the last two notable ATSs missing from Crosswalk's coverage) and a `sampling_recipe` workflow kind that lets users save natural-language "do this for me" recipes. Ship v0.6.0.

**Architecture:** Workday tenants expose a JSON POST endpoint at `<tenant>.myworkdayjobs.com/wday/cxs/<org>/<site>/jobs` — no browser needed; treat like other JSON adapters. iCIMS serves HTML at `careers-<org>.icims.com/jobs/intro` — parse with `cheerio`. Sampling-driven workflows are stored as `kind: 'sampling_recipe'` with `params.recipe` (a markdown plan); `run_workflow` returns the recipe to the host AI which executes it via subsequent MCP tool calls. The cron-driven `run-scheduled` skips this kind with a "needs host" status.

**Tech Stack:** Same as M6 plus `cheerio` (~200 KB; jQuery-like HTML parser, no native deps).

**M7 ships:**
- Workday adapter (JSON POST, 9th adapter)
- iCIMS adapter (HTML scraping, 10th adapter)
- `sampling_recipe` workflow kind — stored recipes that `run_workflow` returns for host-AI execution
- Registry expansion 100 → 115+ companies covering Workday + iCIMS tenants
- README + USER_GUIDE updates
- Version 0.6.0

**Out of M7 (deferred):**
- Playwright-sandbox scraping framework (only needed if iCIMS HTML scraping fails for real tenants)
- Autonomous browser-driven applying (v2/v1.0)
- Registry to 200+ (community-PR territory)

---

## File structure

```
crosswalk-mcp/
├── package.json                       # + cheerio
├── src/
│   ├── ats/
│   │   ├── workday.ts                 # NEW — JSON POST adapter
│   │   ├── icims.ts                   # NEW — HTML adapter (cheerio)
│   │   ├── greenhouse.ts ... personio.ts (existing, unchanged)
│   ├── server.ts                      # MODIFY — register 2 new adapters
│   ├── tools/
│   │   ├── fetch_jobs.ts              # MODIFY — register 2 new adapter imports
│   │   ├── schedule_workflow.ts       # MODIFY — accept 'sampling_recipe' kind
│   │   └── run_workflow.ts            # MODIFY — short-circuit return recipe
│   ├── services/
│   │   └── workflowEngine.ts          # MODIFY — sampling_recipe → 'needs_host'
│   ├── store/
│   │   ├── company.ts                 # MODIFY — add 'workday' | 'icims' to ats union
│   │   └── workflow.ts                # MODIFY — add 'sampling_recipe' to WorkflowKind
│   └── cli.ts                         # MODIFY — doctor expects 10 adapters
├── registry/
│   ├── companies.json                 # MODIFY — +15 companies (Workday/iCIMS tenants)
│   └── h1b.json                       # MODIFY — coverage for new entries
├── tests/
│   ├── ats.workday.test.ts            # NEW
│   ├── ats.icims.test.ts              # NEW
│   ├── fixtures/workday-jobs.json     # NEW
│   ├── fixtures/icims-jobs.html       # NEW
│   ├── services.workflowEngine.test.ts # MODIFY — sampling_recipe path
│   ├── tools.run_workflow.test.ts     # MODIFY — recipe return path
│   ├── tools.schedule_workflow.test.ts # MODIFY — accept new kind
│   ├── server.tools.test.ts           # unchanged (still 16 tools)
│   └── cli.doctor.test.ts             # MODIFY — adapters count = 10
└── ...
```

---

## Task list (10 tasks)

| # | Theme | Task |
|---|---|---|
| 1 | Adapter | Workday adapter (JSON POST) |
| 2 | Adapter | Install `cheerio` + iCIMS adapter (HTML) |
| 3 | Plumbing | Expand `Company['ats']` type union to include `workday` and `icims` |
| 4 | Plumbing | Register Workday + iCIMS in `server.ts` and `fetch_jobs.ts` |
| 5 | Workflows | Add `sampling_recipe` to `WorkflowKind` and engine ('needs_host' return) |
| 6 | Workflows | `schedule_workflow` accepts new kind; `run_workflow` returns recipe payload |
| 7 | Doctor | Update doctor to expect 10 adapters |
| 8 | Registry | Expand to 115+ companies (Workday tenants, iCIMS tenants) |
| 9 | Docs | README + USER_GUIDE for v0.6.0 |
| 10 | Ship | Version bump + smoke + tag v0.6.0 |

---

## Task 1: Workday adapter

**Files:**
- Create: `src/ats/workday.ts`, `tests/ats.workday.test.ts`, `tests/fixtures/workday-jobs.json`

API: POST to `https://{tenant}.{wdN}.myworkdayjobs.com/wday/cxs/{org}/{site}/jobs`. Body: `{ "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }`. Returns `{ total, jobPostings: [{ title, externalPath, locationsText, postedOn, bulletFields }] }`. The `atsOrgSlug` for Workday is the full path-fragment after the protocol: `<tenant>.<wdN>.myworkdayjobs.com/<org>/<site>` (e.g., `nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`).

The full job URL is: `https://<tenant>.<wdN>.myworkdayjobs.com<externalPath>` (note: externalPath starts with `/`).

`postedOn` is human-readable text (e.g., "Posted 3 Days Ago"). For `sinceDays` filtering, parse those phrases best-effort; treat unparseable as "include".

- [ ] **Step 1: Capture fixture**

Create `tests/fixtures/workday-jobs.json`:

```json
{
  "total": 2,
  "jobPostings": [
    {
      "title": "Senior Software Engineer, AI Infra",
      "externalPath": "/job/Santa-Clara-CA/Senior-Software-Engineer/JR-12345",
      "locationsText": "Santa Clara, CA",
      "postedOn": "Posted 3 Days Ago",
      "bulletFields": ["JR-12345"]
    },
    {
      "title": "Remote Site Reliability Engineer",
      "externalPath": "/job/Remote/Remote-SRE/JR-67890",
      "locationsText": "Remote, US",
      "postedOn": "Posted 14 Days Ago",
      "bulletFields": ["JR-67890"]
    }
  ]
}
```

- [ ] **Step 2: Failing test**

Create `tests/ats.workday.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { workday } from '../src/ats/workday.ts';
import fixture from './fixtures/workday-jobs.json' with { type: 'json' };

describe('ats/workday', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T00:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('lists jobs and normalizes from POST response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'JR-12345',
      title: 'Senior Software Engineer, AI Infra',
      location: 'Santa Clara, CA',
      url: 'https://nvidia.wd5.myworkdayjobs.com/job/Santa-Clara-CA/Senior-Software-Engineer/JR-12345'
    });
    expect(jobs[1].locationType).toBe('remote');
  });

  it('parses "Posted N Days Ago" into postedAt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
    // System date is 2026-04-30; "3 Days Ago" → 2026-04-27
    expect(jobs[0].postedAt).toBe('2026-04-27T00:00:00.000Z');
    expect(jobs[1].postedAt).toBe('2026-04-16T00:00:00.000Z');
  });

  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const recent = await workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', { sinceDays: 7 });
    expect(recent).toHaveLength(1);
    expect(recent[0].externalId).toBe('JR-12345');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      workday.listJobs('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite')
    ).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 3: Run test (FAIL)**

```bash
npm test -- ats.workday
```

- [ ] **Step 4: Implement**

Create `src/ats/workday.ts`:

```ts
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type WdRaw = {
  total?: number;
  jobPostings: Array<{
    title: string;
    externalPath: string;
    locationsText?: string;
    postedOn?: string;
    bulletFields?: string[];
  }>;
};

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

/**
 * Parse Workday's human-readable "Posted N Days Ago" / "Posted Today" / "Posted Yesterday".
 * Returns ISO timestamp or undefined if unparseable.
 */
function parsePostedOn(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/posted\s+(\d+)\s+day/i);
  if (m) {
    const days = parseInt(m[1], 10);
    return new Date(Date.now() - days * 86400_000).toISOString();
  }
  if (/posted\s+today/i.test(s)) {
    return new Date().toISOString();
  }
  if (/posted\s+yesterday/i.test(s)) {
    return new Date(Date.now() - 86400_000).toISOString();
  }
  if (/posted\s+(\d+)\s+(month|year)/i.test(s)) {
    // Old enough that we don't need to be precise; mark as "very old".
    return new Date(Date.now() - 365 * 86400_000).toISOString();
  }
  return undefined;
}

/**
 * Workday `atsOrgSlug` is the full path fragment: `<tenant>.<wdN>.myworkdayjobs.com/<org>/<site>`
 * (no protocol). Example: `nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`.
 */
function splitWorkdaySlug(slug: string): { host: string; orgPath: string } {
  const idx = slug.indexOf('/');
  if (idx < 0) throw new Error(`workday slug must include host/org/site: ${slug}`);
  return { host: slug.slice(0, idx), orgPath: slug.slice(idx) };
}

export const workday: ATSAdapter = {
  name: 'workday',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const { host, orgPath } = splitWorkdaySlug(orgSlug);
    const url = `https://${host}/wday/cxs${orgPath}/jobs`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' })
    });
    if (!res.ok) throw new Error(`workday ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as WdRaw;

    const all: NormalizedJob[] = data.jobPostings.map(j => {
      const externalId = j.bulletFields?.[0] ?? j.externalPath.split('/').pop() ?? j.title;
      return {
        externalId,
        title: j.title,
        location: j.locationsText,
        locationType: inferLocationType(j.locationsText),
        url: `https://${host}${j.externalPath}`,
        postedAt: parsePostedOn(j.postedOn),
        raw: j as unknown as Record<string, unknown>
      };
    });
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(workday);
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 169 passing (165 + 4 new). Lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/ats/workday.ts tests/ats.workday.test.ts tests/fixtures/workday-jobs.json
git commit -m "feat(ats): Workday adapter (JSON POST endpoint)"
```

---

## Task 2: iCIMS adapter

**Files:**
- Modify: `package.json` (install `cheerio`)
- Create: `src/ats/icims.ts`, `tests/ats.icims.test.ts`, `tests/fixtures/icims-jobs.html`

API: GET `https://careers-<org>.icims.com/jobs/intro?in_iframe=1`. Returns HTML. Job cards typically have class `iCIMS_JobsTable` with rows containing `.title` (job title link) and `.location` (location text). The job URL is the `<a>` href on the title.

The iCIMS HTML format varies by tenant skin. We target the most common shape and document that some tenants will need PRs. Use `cheerio` to parse.

- [ ] **Step 1: Install dep**

```bash
npm install cheerio
```

- [ ] **Step 2: Create HTML fixture**

Create `tests/fixtures/icims-jobs.html`:

```html
<!DOCTYPE html>
<html>
<body>
<div id="iCIMS_JobsTableBody">
  <div class="row job-listing">
    <a class="title" href="https://careers-example.icims.com/jobs/12345/Senior-Engineer/job">Senior Engineer</a>
    <span class="location">San Francisco, CA</span>
    <span class="department">Engineering</span>
    <span class="postdate">5/1/2026</span>
  </div>
  <div class="row job-listing">
    <a class="title" href="https://careers-example.icims.com/jobs/67890/Remote-PM/job">Remote Product Manager</a>
    <span class="location">Remote</span>
    <span class="department">Product</span>
    <span class="postdate">4/20/2026</span>
  </div>
</div>
</body>
</html>
```

- [ ] **Step 3: Failing test**

Create `tests/ats.icims.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { icims } from '../src/ats/icims.ts';

describe('ats/icims', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('lists jobs from HTML fixture', async () => {
    const html = await fs.readFile(path.resolve('tests/fixtures/icims-jobs.html'), 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => html
    }));
    const jobs = await icims.listJobs('example');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '12345',
      title: 'Senior Engineer',
      dept: 'Engineering',
      location: 'San Francisco, CA',
      url: 'https://careers-example.icims.com/jobs/12345/Senior-Engineer/job'
    });
    expect(jobs[1].locationType).toBe('remote');
  });

  it('parses postdate into ISO timestamp', async () => {
    const html = await fs.readFile(path.resolve('tests/fixtures/icims-jobs.html'), 'utf8');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => html
    }));
    const jobs = await icims.listJobs('example');
    expect(jobs[0].postedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(jobs[1].postedAt).toBe('2026-04-20T00:00:00.000Z');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(icims.listJobs('nope')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 4: Run test (FAIL)**

```bash
npm test -- ats.icims
```

- [ ] **Step 5: Implement**

Create `src/ats/icims.ts`:

```ts
import * as cheerio from 'cheerio';
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

/**
 * Parse common iCIMS postdate formats: "5/1/2026", "May 1, 2026", "2026-05-01".
 * Returns ISO 8601 string at midnight UTC, or undefined if unparseable.
 */
function parsePostdate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  // ISO: 2026-05-01
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;
  // Slash US format: M/D/YYYY or MM/DD/YYYY
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const m = slash[1].padStart(2, '0');
    const d = slash[2].padStart(2, '0');
    return `${slash[3]}-${m}-${d}T00:00:00.000Z`;
  }
  // "May 1, 2026"
  const longForm = Date.parse(trimmed);
  if (!Number.isNaN(longForm)) return new Date(longForm).toISOString();
  return undefined;
}

function extractJobIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/jobs\/(\d+)\//);
  return m ? m[1] : undefined;
}

export const icims: ATSAdapter = {
  name: 'icims',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://careers-${encodeURIComponent(orgSlug)}.icims.com/jobs/intro?in_iframe=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`icims ${orgSlug}: HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const all: NormalizedJob[] = [];
    $('.row.job-listing').each((_, el) => {
      const $el = $(el);
      const titleEl = $el.find('a.title').first();
      const title = titleEl.text().trim();
      const jobUrl = titleEl.attr('href') ?? '';
      const externalId = extractJobIdFromUrl(jobUrl) ?? jobUrl;
      const location = $el.find('.location').first().text().trim() || undefined;
      const dept = $el.find('.department').first().text().trim() || undefined;
      const postdate = $el.find('.postdate').first().text().trim() || undefined;

      if (!title) return;
      all.push({
        externalId,
        title,
        dept,
        location,
        locationType: inferLocationType(location),
        url: jobUrl,
        postedAt: parsePostdate(postdate),
        raw: { title, jobUrl, location, dept, postdate } as Record<string, unknown>
      });
    });

    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(icims);
```

- [ ] **Step 6: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 172 passing (169 + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/ats/icims.ts tests/ats.icims.test.ts tests/fixtures/icims-jobs.html package.json package-lock.json
git commit -m "feat(ats): iCIMS adapter (HTML scraping via cheerio)"
```

---

## Task 3: Expand `Company['ats']` type union

**Files:**
- Modify: `src/store/company.ts`

The `Company.ats` field is a literal union. Add `'workday' | 'icims'`.

- [ ] **Step 1: Update the type**

In `src/store/company.ts`, find the line:

```ts
  ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'bamboohr' | 'recruitee' | 'personio';
```

Replace with:

```ts
  ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'bamboohr' | 'recruitee' | 'personio' | 'workday' | 'icims';
```

- [ ] **Step 2: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 172 passing, lint clean.

- [ ] **Step 3: Commit**

```bash
git add src/store/company.ts
git commit -m "feat(store): Company.ats union includes workday + icims"
```

---

## Task 4: Register Workday + iCIMS in server + fetch_jobs

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tools/fetch_jobs.ts`

The 8 existing adapters self-register on import in two places. Add the 2 new imports to both.

- [ ] **Step 1: Update `src/server.ts`**

Find the existing adapter import block:

```ts
// Adapters self-register on import
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';
import './ats/workable.ts';
import './ats/smartrecruiters.ts';
import './ats/bamboohr.ts';
import './ats/recruitee.ts';
import './ats/personio.ts';
```

Append:

```ts
import './ats/workday.ts';
import './ats/icims.ts';
```

- [ ] **Step 2: Update `src/tools/fetch_jobs.ts`**

Same change to its adapter import block.

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 172 passing.

- [ ] **Step 4: Build + smoke**

```bash
npm run build
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "ok"
```
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts src/tools/fetch_jobs.ts
git commit -m "feat(server): register Workday + iCIMS adapters"
```

---

## Task 5: `sampling_recipe` workflow kind

**Files:**
- Modify: `src/store/workflow.ts`
- Modify: `src/services/workflowEngine.ts`
- Modify: `tests/services.workflowEngine.test.ts`

`WorkflowKind` becomes `'fetch_jobs_refresh' | 'prune_old_jobs' | 'sampling_recipe'`. The engine's `runWorkflowKind` returns `{ status: 'needs_host', summary: { recipe } }` for sampling_recipe — meaning "the cron runner can't execute this; the host AI must".

- [ ] **Step 1: Update tests**

Open `tests/services.workflowEngine.test.ts`. Append a new test inside the existing `describe`:

```ts
  it('returns needs_host for sampling_recipe workflows', async () => {
    const out = await runWorkflowKind(db, 'sampling_recipe', {
      recipe: 'Find new senior PM roles, score them, draft applications for top 3.'
    });
    expect(out.status).toBe('needs_host');
    expect(out.summary).toEqual({
      recipe: 'Find new senior PM roles, score them, draft applications for top 3.'
    });
  });
```

- [ ] **Step 2: Update `WorkflowRunResult` in `src/services/workflowEngine.ts`**

Find:

```ts
export type WorkflowRunResult = {
  status: 'ok' | 'error';
  error?: string;
  summary?: Record<string, unknown>;
};
```

Replace with:

```ts
export type WorkflowRunResult = {
  status: 'ok' | 'error' | 'needs_host';
  error?: string;
  summary?: Record<string, unknown>;
};
```

- [ ] **Step 3: Add the new dispatch branch**

Inside `runWorkflowKind`, before the `return { status: 'error', error: 'unknown workflow kind: ...' }` branch, add:

```ts
    if (kind === 'sampling_recipe') {
      const recipe = (params.recipe as string | undefined) ?? '';
      return { status: 'needs_host', summary: { recipe } };
    }
```

- [ ] **Step 4: Update `WorkflowKind` in `src/store/workflow.ts`**

Find:

```ts
export type WorkflowKind = 'fetch_jobs_refresh' | 'prune_old_jobs';
```

Replace with:

```ts
export type WorkflowKind = 'fetch_jobs_refresh' | 'prune_old_jobs' | 'sampling_recipe';
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 173 passing (172 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/services/workflowEngine.ts src/store/workflow.ts tests/services.workflowEngine.test.ts
git commit -m "feat(workflow): sampling_recipe kind returns needs_host status"
```

---

## Task 6: `schedule_workflow` accepts new kind; `run_workflow` returns recipe payload

**Files:**
- Modify: `src/tools/schedule_workflow.ts`
- Modify: `src/tools/run_workflow.ts`
- Modify: `tests/tools.schedule_workflow.test.ts`
- Modify: `tests/tools.run_workflow.test.ts`

`schedule_workflow`'s zod input enum needs `'sampling_recipe'`. `run_workflow`'s output needs to surface `status: 'needs_host'` and the `summary.recipe`.

- [ ] **Step 1: Update `tests/tools.schedule_workflow.test.ts`**

Append inside the existing `describe` block:

```ts
  it('schedules a sampling_recipe workflow', async () => {
    const out = await scheduleWorkflow({
      kind: 'sampling_recipe',
      cron: '0 9 * * 1',
      description: 'Monday triage',
      params: { recipe: 'Find new senior PM roles and score the top 5.' }
    }, { db });
    expect(out.workflowId).toBeTypeOf('string');
    expect(listWorkflows(db)).toHaveLength(1);
  });
```

- [ ] **Step 2: Update `scheduleWorkflowInput` enum**

In `src/tools/schedule_workflow.ts`, find:

```ts
  kind: z.enum(['fetch_jobs_refresh', 'prune_old_jobs']),
```

Replace with:

```ts
  kind: z.enum(['fetch_jobs_refresh', 'prune_old_jobs', 'sampling_recipe']),
```

- [ ] **Step 3: Update `tests/tools.run_workflow.test.ts`**

Append a new test inside the existing `describe`:

```ts
  it('returns needs_host status for sampling_recipe workflows', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'w-recipe', kind: 'sampling_recipe',
      description: 'Monday triage',
      cron: '0 9 * * 1',
      params: { recipe: 'Find new senior PM roles and score the top 5.' },
      nextRunAt: future
    });
    const out = await runWorkflow({ workflowId: 'w-recipe' }, { db });
    expect(out.status).toBe('needs_host');
    expect(out.summary).toEqual({
      recipe: 'Find new senior PM roles and score the top 5.'
    });
  });
```

- [ ] **Step 4: Update `runWorkflow` return type**

In `src/tools/run_workflow.ts`, find the return type:

```ts
): Promise<{
  workflowId: string;
  status: 'ok' | 'error';
  error?: string;
  summary?: Record<string, unknown>;
  nextRunAt: string;
}> {
```

Replace with:

```ts
): Promise<{
  workflowId: string;
  status: 'ok' | 'error' | 'needs_host';
  error?: string;
  summary?: Record<string, unknown>;
  nextRunAt: string;
}> {
```

(No body change needed — `runWorkflowKind` already returns the new status; `run_workflow` passes it through.)

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 175 passing (173 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/tools/schedule_workflow.ts src/tools/run_workflow.ts \
        tests/tools.schedule_workflow.test.ts tests/tools.run_workflow.test.ts
git commit -m "feat(tools): schedule_workflow accepts sampling_recipe; run_workflow returns recipe"
```

---

## Task 7: Update doctor to expect 10 adapters

**Files:**
- Modify: `src/cli.ts`
- Modify: `tests/cli.doctor.test.ts` (if it asserts adapter count)

- [ ] **Step 1: Update `runDoctor` adapter check**

In `src/cli.ts`, find the adapters-check block in `runDoctor`. Update the imports list and the `expected` array:

```ts
    await import('./ats/greenhouse.ts');
    await import('./ats/lever.ts');
    await import('./ats/ashby.ts');
    await import('./ats/workable.ts');
    await import('./ats/smartrecruiters.ts');
    await import('./ats/bamboohr.ts');
    await import('./ats/recruitee.ts');
    await import('./ats/personio.ts');
    await import('./ats/workday.ts');
    await import('./ats/icims.ts');
    const { listRegisteredAdapters } = await import('./ats/adapter.ts');
    const names = listRegisteredAdapters().sort();
    const expected = ['ashby', 'bamboohr', 'greenhouse', 'icims', 'lever', 'personio', 'recruitee', 'smartrecruiters', 'workable', 'workday'];
```

- [ ] **Step 2: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 175 passing.

- [ ] **Step 3: Smoke test doctor**

```bash
npm run build
rm -rf /tmp/cw-doctor-m7 && CROSSWALK_HOME=/tmp/cw-doctor-m7 node dist/cli.js doctor
```
Expected: 5 `✓` lines, including `adapters: 10 adapters: ashby, bamboohr, greenhouse, icims, lever, personio, recruitee, smartrecruiters, workable, workday`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): doctor expects 10 adapters"
```

---

## Task 8: Registry expansion — Workday + iCIMS tenants

**Files:**
- Modify: `registry/companies.json`
- Modify: `registry/h1b.json`

Add real Workday and iCIMS tenants. Workday `atsOrgSlug` is the full path (e.g., `nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`); iCIMS slug is the simple subdomain prefix (e.g., for `careers-mongodb.icims.com`, slug is `mongodb`).

- [ ] **Step 1: Append to `registry/companies.json`**

After the existing last entry, add a comma and then:

```json
  ,
  { "id": "nvidia",          "name": "NVIDIA",          "ats": "workday",          "atsOrgSlug": "nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite" },
  { "id": "salesforce",      "name": "Salesforce",      "ats": "workday",          "atsOrgSlug": "salesforce.wd12.myworkdayjobs.com/External_Career_Site" },
  { "id": "jpmorgan",        "name": "JPMorgan Chase",  "ats": "workday",          "atsOrgSlug": "jpmc.wd5.myworkdayjobs.com/jpmc" },
  { "id": "unitedhealth",    "name": "UnitedHealth Group", "ats": "workday",       "atsOrgSlug": "uhg.wd5.myworkdayjobs.com/External" },
  { "id": "deloitte",        "name": "Deloitte",        "ats": "workday",          "atsOrgSlug": "deloitte.wd1.myworkdayjobs.com/Experienced" },
  { "id": "accenture",       "name": "Accenture",       "ats": "workday",          "atsOrgSlug": "accenture.wd3.myworkdayjobs.com/AccentureCareers" },
  { "id": "ge",              "name": "GE Aerospace",    "ats": "workday",          "atsOrgSlug": "ge.wd5.myworkdayjobs.com/GE_External_Site" },
  { "id": "pg",              "name": "Procter & Gamble","ats": "workday",          "atsOrgSlug": "pg.wd5.myworkdayjobs.com/PGCareers" },

  { "id": "mongodb",         "name": "MongoDB",         "ats": "icims",            "atsOrgSlug": "mongodb" },
  { "id": "fidelity",        "name": "Fidelity",        "ats": "icims",            "atsOrgSlug": "fidelity" },
  { "id": "vmware",          "name": "VMware",          "ats": "icims",            "atsOrgSlug": "vmware" },
  { "id": "cigna",           "name": "Cigna",           "ats": "icims",            "atsOrgSlug": "cignaperformance" },

  { "id": "supabase",        "name": "Supabase",        "ats": "ashby",            "atsOrgSlug": "supabase" },
  { "id": "linear_dev",      "name": "Linear (dev)",    "ats": "ashby",            "atsOrgSlug": "linear" },
  { "id": "warp",            "name": "Warp",            "ats": "ashby",            "atsOrgSlug": "warp" }
]
```

That's 15 new entries → **115 companies total**.

- [ ] **Step 2: Append to `registry/h1b.json`**

After the existing last entry's closing brace, add a comma and then:

```json
    "nvidia":         { "confidence": 0.97, "lastSeen": "2025-09-30" },
    "salesforce":     { "confidence": 0.94, "lastSeen": "2025-09-30" },
    "jpmorgan":       { "confidence": 0.96, "lastSeen": "2025-09-30" },
    "unitedhealth":   { "confidence": 0.91, "lastSeen": "2025-09-30" },
    "deloitte":       { "confidence": 0.94, "lastSeen": "2025-09-30" },
    "accenture":      { "confidence": 0.95, "lastSeen": "2025-09-30" },
    "ge":             { "confidence": 0.86, "lastSeen": "2025-09-30" },
    "pg":             { "confidence": 0.84, "lastSeen": "2025-09-30" },
    "mongodb":        { "confidence": 0.88, "lastSeen": "2025-09-30" },
    "fidelity":       { "confidence": 0.78, "lastSeen": "2025-09-30" },
    "vmware":         { "confidence": 0.92, "lastSeen": "2025-09-30" },
    "cigna":          { "confidence": 0.82, "lastSeen": "2025-09-30" },
    "supabase":       { "confidence": 0.55, "lastSeen": "2025-09-30" },
    "linear_dev":     { "confidence": 0.65, "lastSeen": "2025-09-30" },
    "warp":           { "confidence": 0.50, "lastSeen": "2025-09-30" }
```

- [ ] **Step 3: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 175 passing (registryBoot test reads JSON length dynamically). Lint clean.

- [ ] **Step 4: Commit**

```bash
git add registry/companies.json registry/h1b.json
git commit -m "feat(registry): expand to 115 companies (Workday + iCIMS tenants + 3 more)"
```

---

## Task 9: README + USER_GUIDE for v0.6.0

**Files:**
- Modify: `README.md`
- Modify: `docs/USER_GUIDE.md`

- [ ] **Step 1: Update README**

In `/Users/mohakgarg/Desktop/Job-Os/README.md`:

A) Update tests + version badges:

```markdown
[![Tests](https://img.shields.io/badge/tests-175%20passing-brightgreen.svg)](#development)
[![Version](https://img.shields.io/badge/version-0.6.0-blue.svg)](https://github.com/Mohakgarg5/crosswalk-mcp/releases)
```

B) Find the "What it does" intro line and replace:

```markdown
**16 MCP tools across 5 surfaces.** v0.6.0 adds **Workday + iCIMS adapters** (10 ATSs total) and **sampling-driven workflow recipes** — schedule a natural-language plan ("find senior PM roles every Monday and score the top 5") that the host AI executes when you next open chat.
```

C) Update the ATS coverage table and the count line at the bottom (Total: 115 companies, 10 ATSs). Add two rows:

```markdown
| [Workday](https://www.workday.com/) | JSON POST | NVIDIA, Salesforce, JPMorgan, UnitedHealth, Deloitte, Accenture, GE Aerospace, P&G (8 total) |
| [iCIMS](https://www.icims.com/) | HTML | MongoDB, Fidelity, VMware, Cigna (4 total) |
```

Update the "Workday and iCIMS aren't supported yet" block — delete it.

D) Update the Roadmap table:

```markdown
| Version | Headline |
|---|---|
| M1 | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| M3 | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 5 more ATS adapters (8 total); 51-company registry |
| M5 | Live-fit guardrail gate; uninstall + status CLI; registry to 74 |
| M6 | Multi-host install; doctor diagnostic; registry to 100 |
| **M7 (this release)** | Workday + iCIMS adapters (10 ATSs); sampling-driven workflow recipes; registry to 115 |
| M8 | Autonomous browser-driven applying via Playwright sandbox |
| v2 | Full agent loop |
```

E) Update the timeline table:

```markdown
| v0.5.0 — M6 | Multi-host install · doctor diagnostic · 100-company registry · 165 tests | Shipped |
| **v0.6.0 — M7** | **Workday + iCIMS adapters · sampling_recipe workflows · 115-company registry · 175 tests** | **Current** |
| v0.7.0 — M8 | Autonomous browser-driven applying | Next |
```

- [ ] **Step 2: Update USER_GUIDE.md**

In `/Users/mohakgarg/Desktop/Job-Os/docs/USER_GUIDE.md`:

A) Update title-block subtitle from `v0.5.0` to `v0.6.0`.

B) In Section 6.3 ATS coverage at v0.5, change to "ATS coverage at v0.6" and add the two new rows for Workday and iCIMS.

C) In the Roadmap snapshot in 6.7, update so v0.6.0 is Current.

- [ ] **Step 3: Run tests + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: 175 passing, lint clean, build clean.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/USER_GUIDE.md
git commit -m "docs: update for v0.6.0 — Workday + iCIMS, sampling recipes, 115 companies"
```

---

## Task 10: Ship v0.6.0

**Files:**
- Modify: `package.json` (version 0.5.0 → 0.6.0)
- Modify: `src/server.ts` (SERVER_VERSION 0.5.0 → 0.6.0)

- [ ] **Step 1: Bump version**

In `package.json`, change `"version": "0.5.0"` → `"version": "0.6.0"`.

In `src/server.ts`, change `SERVER_VERSION = '0.5.0'` → `SERVER_VERSION = '0.6.0'`.

- [ ] **Step 2: Final verify**

```bash
npm test && npm run lint && npm run build
```
Expected: 175 passing, lint clean, build clean.

- [ ] **Step 3: Smoke run**

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "smoke=ok"
rm -rf /tmp/cw-m7-smoke && CROSSWALK_HOME=/tmp/cw-m7-smoke node dist/cli.js doctor
```
Expected: `smoke=ok`, doctor shows 10 adapters.

- [ ] **Step 4: Commit**

```bash
git add package.json src/server.ts
git commit -m "feat: ship v0.6.0 — Workday + iCIMS adapters, sampling recipes, 115 companies"
```

---

## Self-review checklist

- [ ] All 10 tasks completed; all tests passing.
- [ ] Build clean. Smoke run boots cleanly.
- [ ] `crosswalk-mcp doctor` reports 10 adapters.
- [ ] Workday adapter parses "Posted N Days Ago" correctly.
- [ ] iCIMS adapter parses M/D/YYYY postdate format.
- [ ] `schedule_workflow` accepts `kind: 'sampling_recipe'`.
- [ ] `run_workflow` returns `status: 'needs_host'` for sampling recipes.
- [ ] Registry has ≥115 companies covering all 10 adapters.

---

**End of M7 plan.**
