# Crosswalk M2 Implementation Plan — Author (tailor + draft application)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new MCP tools — `tailor_resume` and `draft_application` — that take a job-id + (optional) resume-id, pick the best base resume, edit it for the JD via sampling, draft a cover letter, build an application "PR" bundle, persist it, and return the artifact (markdown by default; DOCX or HTML on request).

**Architecture:** Three new layers on top of M1: (1) a `services/` directory holding the sampling-driven helpers (pick, tailor, draft cover letter, assemble PR), (2) a `exporters/` directory holding format converters (markdown→DOCX, markdown→print-HTML), and (3) a new SQLite migration for the `application` and `application_event` tables. Two new MCP tools wrap the services. Plus two M1 cleanup tasks (`getJob` helper, adapter `sinceDays`).

**Tech Stack:** Same as M1 plus `docx` (DOCX writer, ~80 KB), `marked` (markdown→HTML, ~30 KB). No browser/Chromium dependency.

**M2 ships these tools:** `tailor_resume`, `draft_application`. **Plus M3-foreshadowing storage:** `application` + `application_event` tables (only the writes that `draft_application` needs are wired in M2; full tracker tools land in M3).

**Out of M2 (deferred to M3):** native PDF rendering, `submit_application`, `list_pipeline`, `set_status`, `add_note`, anti-spam guardrail, scheduled workflows, autonomous applying. PDF in M2 = print-ready HTML; users save as PDF from their browser.

---

## File structure (locked in before tasks)

```
crosswalk-mcp/
├── package.json                       # + docx, + marked
├── src/
│   ├── store/
│   │   ├── application.ts             # NEW — application CRUD (M2 subset)
│   │   ├── job.ts                     # MODIFY — add getJob(db, id)
│   │   └── migrations.ts              # MODIFY — migration #2
│   ├── ats/
│   │   ├── adapter.ts                 # unchanged
│   │   ├── greenhouse.ts              # MODIFY — honor opts.sinceDays
│   │   ├── lever.ts                   # MODIFY — honor opts.sinceDays
│   │   ├── ashby.ts                   # MODIFY — honor opts.sinceDays
│   │   └── types.ts                   # unchanged
│   ├── exporters/                     # NEW DIR
│   │   ├── html.ts                    # NEW — markdown → print-styled HTML
│   │   └── docx.ts                    # NEW — markdown → DOCX (Buffer)
│   ├── services/                      # NEW DIR
│   │   ├── pickResume.ts              # NEW — sampling: best resume for JD
│   │   ├── tailorResume.ts            # NEW — sampling: JD-aware edit
│   │   ├── coverLetter.ts             # NEW — sampling: cover letter
│   │   └── buildApplication.ts        # NEW — assembles full PR
│   ├── tools/
│   │   ├── tailor_resume.ts           # NEW — MCP tool
│   │   ├── draft_application.ts      # NEW — MCP tool
│   │   ├── score_fit.ts               # MODIFY — use getJob
│   │   ├── explain_fit.ts             # MODIFY — use getJob
│   │   └── index.ts                   # MODIFY — register 2 new tools
│   └── ... (server.ts, cli.ts, sampling/, parsers/, config.ts unchanged)
├── tests/
│   ├── store.application.test.ts      # NEW
│   ├── store.job.test.ts              # MODIFY — getJob test
│   ├── ats.greenhouse.test.ts         # MODIFY — sinceDays test
│   ├── ats.lever.test.ts              # MODIFY — sinceDays test
│   ├── ats.ashby.test.ts              # MODIFY — sinceDays test
│   ├── exporters.html.test.ts         # NEW
│   ├── exporters.docx.test.ts         # NEW
│   ├── services.pickResume.test.ts    # NEW
│   ├── services.tailorResume.test.ts  # NEW
│   ├── services.coverLetter.test.ts   # NEW
│   ├── services.buildApplication.test.ts # NEW
│   ├── tools.tailor_resume.test.ts    # NEW
│   ├── tools.draft_application.test.ts # NEW
│   └── server.tools.test.ts           # MODIFY — assert 8 tools (was 6)
└── registry/                          # unchanged
```

Each new file has one job. No file should exceed ~200 lines.

---

## M2 milestones (logical slicing for the implementation plan)

| M | Theme | Tasks |
|---|---|---|
| M2A | M1 cleanup | 1, 2 |
| M2B | Storage | 3, 4 |
| M2C | Exporters | 5, 6 |
| M2D | Services | 7, 8, 9, 10 |
| M2E | Tools + ship | 11, 12, 13 |

---

## Task 1: M1 cleanup — `getJob(db, id)` helper

**Files:**
- Modify: `src/store/job.ts`
- Modify: `src/tools/score_fit.ts`
- Modify: `src/tools/explain_fit.ts`
- Modify: `tests/store.job.test.ts`

`score_fit` and `explain_fit` currently scan up to 5000 rows to find a job by primary key. Add a direct `getJob(db, id)` and use it.

- [ ] **Step 1: Write the failing test**

Add a new `it` block to `tests/store.job.test.ts` (after the existing test):

```ts
import { upsertJobs, listJobs, getJob } from '../src/store/job.ts';
// ... existing imports/describe/beforeEach unchanged ...

  it('looks up a job by id', () => {
    upsertJobs(db, [{
      id: 'g-1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://x', raw: {}
    }]);
    expect(getJob(db, 'g-1')?.title).toBe('PM, Payments');
    expect(getJob(db, 'missing')).toBeNull();
  });
```

(Keep the existing `import { upsertJobs, listJobs } from ...` — extend it to also import `getJob`. The first import becomes `import { upsertJobs, listJobs, getJob } from '../src/store/job.ts';`.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- store.job
```
Expected: FAIL — `getJob is not a function`.

- [ ] **Step 3: Add `getJob` to `src/store/job.ts`**

Add this function at the end of `src/store/job.ts`, right before the existing `listJobs` (or after `upsertJobs` — order doesn't matter as long as it's exported):

```ts
export function getJob(db: Db, id: string): StoredJob | null {
  const r = db.prepare(`
    SELECT id, company_id AS companyId, title, dept, location,
           location_type AS locationType, salary_min AS salaryMin,
           salary_max AS salaryMax, currency, description_md AS descriptionMd,
           url, posted_at AS postedAt, raw_json
    FROM job WHERE id = ?
  `).get(id) as (StoredJob & { raw_json: string }) | undefined;
  if (!r) return null;
  return {
    id: r.id, companyId: r.companyId, title: r.title,
    dept: r.dept ?? undefined, location: r.location ?? undefined,
    locationType: r.locationType ?? undefined,
    salaryMin: r.salaryMin ?? undefined, salaryMax: r.salaryMax ?? undefined,
    currency: r.currency ?? undefined,
    descriptionMd: r.descriptionMd ?? undefined,
    url: r.url, postedAt: r.postedAt ?? undefined,
    raw: JSON.parse(r.raw_json) as Record<string, unknown>
  };
}
```

- [ ] **Step 4: Update `score_fit` to use `getJob`**

In `src/tools/score_fit.ts`, change the import line:

```ts
import { listJobs } from '../store/job.ts';
```
to:
```ts
import { getJob } from '../store/job.ts';
```

And replace this line:
```ts
  const job = listJobs(ctx.db, { limit: 5000 }).find(j => j.id === input.jobId);
```
with:
```ts
  const job = getJob(ctx.db, input.jobId);
```

- [ ] **Step 5: Update `explain_fit` to use `getJob`**

In `src/tools/explain_fit.ts`, make the same two changes (import + lookup).

- [ ] **Step 6: Run all tests**

```bash
npm test
```
Expected: 43+ passing (the new `getJob` test plus all M1 tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/store/job.ts src/tools/score_fit.ts src/tools/explain_fit.ts tests/store.job.test.ts
git commit -m "perf(store): add getJob(db, id); use it in score_fit and explain_fit"
```

---

## Task 2: M1 cleanup — adapters honor `opts.sinceDays`

**Files:**
- Modify: `src/ats/greenhouse.ts`, `src/ats/lever.ts`, `src/ats/ashby.ts`
- Modify: `tests/ats.greenhouse.test.ts`, `tests/ats.lever.test.ts`, `tests/ats.ashby.test.ts`

The three M1 adapters accept an `opts.sinceDays` parameter but currently ignore it. Filter results by `postedAt` before returning. If `postedAt` is null/missing, include the job (consistent with the store's `listJobs` behavior).

- [ ] **Step 1: Write failing tests**

Add a new `it` block to **each** of `tests/ats.greenhouse.test.ts`, `tests/ats.lever.test.ts`, `tests/ats.ashby.test.ts`. Use the appropriate fixture and adapter for each.

For `tests/ats.greenhouse.test.ts`, add (after the existing tests, inside the existing `describe`):

```ts
  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    // Fixture has updated_at: 2026-04-25 and 2026-04-20.
    // System date is 2026-04-30; sinceDays=14 includes both, sinceDays=3 excludes both.
    const recent = await greenhouse.listJobs('stripe', { sinceDays: 14 });
    expect(recent).toHaveLength(2);
    const veryRecent = await greenhouse.listJobs('stripe', { sinceDays: 3 });
    expect(veryRecent).toHaveLength(0);
  });
```

For `tests/ats.lever.test.ts`, add the same shape but with the Lever fixture timestamps. The Lever fixture has `createdAt: 1745539200000` (Apr 25, 2025) and `1745366400000` (Apr 23, 2025). Note: those fixture epochs are 2025, not 2026 — both jobs are >365 days old by the time of test, so a `sinceDays: 30` returns 0 and `sinceDays: 1000` returns 2.

```ts
  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const wide = await lever.listJobs('netflix', { sinceDays: 1000 });
    expect(wide).toHaveLength(2);
    const narrow = await lever.listJobs('netflix', { sinceDays: 30 });
    expect(narrow).toHaveLength(0);
  });
```

For `tests/ats.ashby.test.ts`, the Ashby fixture has `publishedDate: 2026-04-28` and `2026-04-22`. `sinceDays: 5` returns the 04-28 one only, `sinceDays: 30` returns both:

```ts
  it('filters by sinceDays', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const wide = await ashby.listJobs('openai', { sinceDays: 30 });
    expect(wide).toHaveLength(2);
    const narrow = await ashby.listJobs('openai', { sinceDays: 5 });
    expect(narrow).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- ats
```
Expected: 3 new tests fail (each adapter returns the unfiltered set).

- [ ] **Step 3: Add a shared filter helper**

Each adapter needs the same logic. Add a helper inside each adapter's file (NOT a shared module — keep adapters self-contained). At the top of `src/ats/greenhouse.ts`, after the imports, add:

```ts
function withinSinceDays(postedAt: string | undefined, sinceDays: number | undefined): boolean {
  if (sinceDays === undefined) return true;
  if (!postedAt) return true;  // include jobs with unknown date
  const cutoff = Date.now() - sinceDays * 86400_000;
  return new Date(postedAt).getTime() >= cutoff;
}
```

Add the same helper to `src/ats/lever.ts` and `src/ats/ashby.ts` (verbatim). Yes, this is duplicated three times — that's deliberate. The DRY-up to a shared module can happen in M3 once we have 6+ adapters.

- [ ] **Step 4: Wire the filter into Greenhouse**

In `src/ats/greenhouse.ts`, change the `listJobs` signature and filter the output:

Before:
```ts
async listJobs(orgSlug: string): Promise<NormalizedJob[]> {
  // ...
  return data.jobs.map(j => ({ /* ... */ }));
}
```

After:
```ts
async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
  // ... existing fetch + url building ...
  const all: NormalizedJob[] = data.jobs.map(j => ({
    externalId: String(j.id),
    title: j.title,
    dept: j.departments?.[0]?.name,
    location: j.location?.name,
    locationType: inferLocationType(j.location?.name),
    url: j.absolute_url,
    descriptionMd: j.content ? htmlToMarkdown(j.content) : undefined,
    postedAt: j.updated_at,
    raw: j as unknown as Record<string, unknown>
  }));
  return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
}
```

- [ ] **Step 5: Wire the filter into Lever**

Same pattern in `src/ats/lever.ts`. Before:
```ts
async listJobs(orgSlug: string): Promise<NormalizedJob[]> {
```
After:
```ts
async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
```
And replace `return data.map(...)` with:
```ts
const all: NormalizedJob[] = data.map(j => ({
  externalId: j.id,
  title: j.text,
  dept: j.categories?.team,
  location: j.categories?.location,
  locationType: inferLocationType(j.categories?.location),
  url: j.hostedUrl,
  descriptionMd: j.descriptionPlain,
  postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
  raw: j as unknown as Record<string, unknown>
}));
return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
```

- [ ] **Step 6: Wire the filter into Ashby**

Same pattern in `src/ats/ashby.ts`. Update the signature and filter the final output. The mapping function returns a `NormalizedJob`, so collect it into a const and `.filter()` before returning:

```ts
async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
  // ... existing fetch + url ...
  const all: NormalizedJob[] = data.jobs.map(j => {
    const sal = parseSalary(j.compensationTierSummary);
    return {
      externalId: j.id,
      title: j.title,
      dept: j.departmentName,
      location: j.locationName,
      locationType: inferLocationType(j.locationName),
      url: j.jobUrl,
      descriptionMd: j.descriptionHtml ? htmlToMarkdown(j.descriptionHtml) : undefined,
      postedAt: j.publishedDate,
      salaryMin: sal.min,
      salaryMax: sal.max,
      currency: sal.currency,
      raw: j as unknown as Record<string, unknown>
    };
  });
  return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
}
```

- [ ] **Step 7: Run all tests**

```bash
npm test
```
Expected: 46+ passing.

- [ ] **Step 8: Commit**

```bash
git add src/ats/greenhouse.ts src/ats/lever.ts src/ats/ashby.ts \
        tests/ats.greenhouse.test.ts tests/ats.lever.test.ts tests/ats.ashby.test.ts
git commit -m "perf(ats): adapters honor opts.sinceDays before returning"
```

---

## Task 3: Migration #2 — `application` + `application_event` tables

**Files:**
- Modify: `src/store/migrations.ts`
- Modify: `tests/store.test.ts`

- [ ] **Step 1: Update the existing test**

Edit `tests/store.test.ts`. Update the first test's expected table list to include `application` and `application_event`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';

describe('store/db', () => {
  it('opens an in-memory db and applies all migrations', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('profile');
    expect(names).toContain('resume');
    expect(names).toContain('company');
    expect(names).toContain('job');
    expect(names).toContain('application');
    expect(names).toContain('application_event');
    expect(names).toContain('migrations');
  });

  it('is idempotent across repeat openings', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });

  it('applied two migrations', () => {
    const db = openDb(':memory:');
    const ids = (db.prepare(`SELECT id FROM migrations ORDER BY id`).all() as Array<{ id: number }>).map(r => r.id);
    expect(ids).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- store.test
```
Expected: FAIL on the table-name expectations and on the migrations-applied count.

- [ ] **Step 3: Append migration #2 to `src/store/migrations.ts`**

Add a new entry to the `migrations` array, after the existing migration #1:

```ts
  {
    id: 2,
    name: 'application',
    sql: `
      CREATE TABLE application (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES job(id),
        resume_id TEXT NOT NULL REFERENCES resume(id),
        status TEXT NOT NULL DEFAULT 'draft',
        fit_score REAL,
        fit_narrative_md TEXT,
        tailored_resume_md TEXT NOT NULL,
        cover_letter_md TEXT NOT NULL,
        answer_pack_json TEXT NOT NULL,
        deep_link TEXT NOT NULL,
        created_at TEXT NOT NULL,
        submitted_at TEXT
      );
      CREATE INDEX idx_application_job ON application(job_id);
      CREATE INDEX idx_application_status ON application(status);
      CREATE INDEX idx_application_created ON application(created_at);

      CREATE TABLE application_event (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES application(id),
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX idx_application_event_app ON application_event(application_id);
      CREATE INDEX idx_application_event_at ON application_event(at);
    `
  }
```

- [ ] **Step 4: Run tests**

```bash
npm test -- store.test
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/store/migrations.ts tests/store.test.ts
git commit -m "feat(store): migration #2 — application + application_event tables"
```

---

## Task 4: Application CRUD (M2 subset)

**Files:**
- Create: `src/store/application.ts`
- Create: `tests/store.application.test.ts`

M2 needs `createApplication` (writes the PR) and `getApplication` (reads it back). `listApplications` is included as a small bonus that costs nothing to add. Full status mutation + event log writes land in M3.

- [ ] **Step 1: Failing test**

Create `tests/store.application.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listApplications
} from '../src/store/application.ts';

describe('store/application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM',
      url: 'https://x', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('creates and reads back an application', () => {
    const id = 'app-1';
    createApplication(db, {
      id, jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# Resume', coverLetterMd: 'Hello',
      answerPack: { 'why-us': 'Because' }, deepLink: 'https://apply'
    });
    const app = getApplication(db, id);
    expect(app?.coverLetterMd).toBe('Hello');
    expect(app?.status).toBe('draft');
    expect(app?.answerPack).toEqual({ 'why-us': 'Because' });
  });

  it('lists newest first', () => {
    createApplication(db, {
      id: 'a', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'a', coverLetterMd: 'a', answerPack: {}, deepLink: 'https://x'
    });
    createApplication(db, {
      id: 'b', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'b', coverLetterMd: 'b', answerPack: {}, deepLink: 'https://x'
    });
    expect(listApplications(db).map(a => a.id)).toEqual(['b', 'a']);
  });

  it('returns null for unknown id', () => {
    expect(getApplication(db, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- store.application
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/store/application.ts`:

```ts
import type { Db } from './db.ts';

export type Application = {
  id: string;
  jobId: string;
  resumeId: string;
  status: 'draft' | 'submitted' | 'interviewing' | 'rejected' | 'offer';
  fitScore?: number;
  fitNarrativeMd?: string;
  tailoredResumeMd: string;
  coverLetterMd: string;
  answerPack: Record<string, string>;
  deepLink: string;
  createdAt: string;
  submittedAt?: string;
};

export type ApplicationInput = {
  id: string;
  jobId: string;
  resumeId: string;
  fitScore?: number;
  fitNarrativeMd?: string;
  tailoredResumeMd: string;
  coverLetterMd: string;
  answerPack: Record<string, string>;
  deepLink: string;
};

export function createApplication(db: Db, input: ApplicationInput): Application {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO application (
      id, job_id, resume_id, status, fit_score, fit_narrative_md,
      tailored_resume_md, cover_letter_md, answer_pack_json, deep_link,
      created_at, submitted_at
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    input.id, input.jobId, input.resumeId,
    input.fitScore ?? null, input.fitNarrativeMd ?? null,
    input.tailoredResumeMd, input.coverLetterMd,
    JSON.stringify(input.answerPack), input.deepLink, createdAt
  );
  return {
    ...input,
    status: 'draft',
    createdAt
  };
}

type Row = {
  id: string; jobId: string; resumeId: string; status: Application['status'];
  fitScore: number | null; fitNarrativeMd: string | null;
  tailoredResumeMd: string; coverLetterMd: string;
  answer_pack_json: string; deepLink: string;
  createdAt: string; submittedAt: string | null;
};

function rowToApplication(r: Row): Application {
  return {
    id: r.id, jobId: r.jobId, resumeId: r.resumeId, status: r.status,
    fitScore: r.fitScore ?? undefined,
    fitNarrativeMd: r.fitNarrativeMd ?? undefined,
    tailoredResumeMd: r.tailoredResumeMd, coverLetterMd: r.coverLetterMd,
    answerPack: JSON.parse(r.answer_pack_json) as Record<string, string>,
    deepLink: r.deepLink, createdAt: r.createdAt,
    submittedAt: r.submittedAt ?? undefined
  };
}

const SELECT = `
  SELECT id, job_id AS jobId, resume_id AS resumeId, status,
         fit_score AS fitScore, fit_narrative_md AS fitNarrativeMd,
         tailored_resume_md AS tailoredResumeMd,
         cover_letter_md AS coverLetterMd,
         answer_pack_json, deep_link AS deepLink,
         created_at AS createdAt, submitted_at AS submittedAt
  FROM application
`;

export function getApplication(db: Db, id: string): Application | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToApplication(r) : null;
}

export function listApplications(db: Db): Application[] {
  const rows = db.prepare(`${SELECT} ORDER BY created_at DESC, rowid DESC`).all() as Row[];
  return rows.map(rowToApplication);
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- store.application
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/store/application.ts tests/store.application.test.ts
git commit -m "feat(store): application CRUD (M2 subset — create/get/list)"
```

---

## Task 5: HTML exporter (markdown → print-styled HTML)

**Files:**
- Modify: `package.json` (add `marked`)
- Create: `src/exporters/html.ts`, `tests/exporters.html.test.ts`

`marked` is a small (~30 KB) markdown→HTML converter. We wrap its output in a print-friendly HTML document that the user can open and "Save as PDF" from any browser.

- [ ] **Step 1: Install dependency**

```bash
npm install marked
```

- [ ] **Step 2: Failing test**

Create `tests/exporters.html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mdToPrintHtml } from '../src/exporters/html.ts';

describe('exporters/html', () => {
  it('wraps markdown in a print-styled HTML document', async () => {
    const md = '# Mohak Garg\n\nProduct Manager';
    const html = await mdToPrintHtml(md, { title: 'Resume' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Resume</title>');
    expect(html).toContain('<h1');
    expect(html).toContain('Mohak Garg');
    expect(html).toContain('@media print');
  });

  it('escapes HTML in raw text', async () => {
    const html = await mdToPrintHtml('A <script>alert(1)</script> B', { title: 'x' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('alert(1)');  // escaped form should still contain the text
  });
});
```

- [ ] **Step 3: Run test (FAIL)**

```bash
npm test -- exporters.html
```
Expected: FAIL — `Cannot find module '../src/exporters/html.ts'`.

- [ ] **Step 4: Implement**

Create `src/exporters/html.ts`:

```ts
import { marked } from 'marked';

export type HtmlOpts = { title: string };

const PRINT_CSS = `
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 7.5in;
         margin: 0.75in auto; color: #111; line-height: 1.5; }
  h1, h2, h3 { line-height: 1.2; }
  h1 { font-size: 1.6rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1.2rem; margin-top: 1.4rem; border-bottom: 1px solid #ddd;
       padding-bottom: 0.2rem; }
  h3 { font-size: 1.0rem; margin-top: 1.0rem; }
  ul { padding-left: 1.2rem; }
  li { margin-bottom: 0.2rem; }
  a { color: #0a4d8c; text-decoration: none; }
  @media print {
    body { margin: 0.5in; }
    a { color: #111; }
  }
`;

export async function mdToPrintHtml(md: string, opts: HtmlOpts): Promise<string> {
  const body = await marked.parse(md, { async: true });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(opts.title)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

> Note: `marked.parse` defaults to escaping raw HTML in the input (the `mangle` and `headerIds` options have nothing to do with safety; what matters is that `marked` doesn't pass through `<script>` tags as-is). The second test verifies this.

- [ ] **Step 5: Run tests (PASS)**

```bash
npm test -- exporters.html
```
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/exporters/html.ts tests/exporters.html.test.ts package.json package-lock.json
git commit -m "feat(exporters): markdown → print-styled HTML via marked"
```

---

## Task 6: DOCX exporter (markdown → DOCX Buffer)

**Files:**
- Modify: `package.json` (add `docx`)
- Create: `src/exporters/docx.ts`, `tests/exporters.docx.test.ts`

The `docx` package is a typed DOCX writer. We translate a small subset of markdown to DOCX paragraphs: headings, paragraphs, lists.

- [ ] **Step 1: Install dependency**

```bash
npm install docx
```

- [ ] **Step 2: Failing test**

Create `tests/exporters.docx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mdToDocxBuffer } from '../src/exporters/docx.ts';

describe('exporters/docx', () => {
  it('produces a Buffer with valid DOCX magic bytes', async () => {
    const md = '# Mohak Garg\n\n## Experience\n\n- Acme Corp — APM\n- Globex — PM';
    const buf = await mdToDocxBuffer(md);
    expect(buf).toBeInstanceOf(Buffer);
    // DOCX is a ZIP — first 4 bytes are PK\x03\x04
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    // Should be at least a few hundred bytes (not empty)
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it('handles empty input without crashing', async () => {
    const buf = await mdToDocxBuffer('');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.byteLength).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 3: Run test (FAIL)**

```bash
npm test -- exporters.docx
```
Expected: FAIL.

- [ ] **Step 4: Implement**

Create `src/exporters/docx.ts`:

```ts
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  let buf: string[] = [];

  const flushParagraph = () => {
    const text = buf.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    buf = [];
  };

  for (const line of lines) {
    const trim = line.trim();
    if (trim === '') {
      flushParagraph();
      continue;
    }
    if (/^# /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 1, text: trim.replace(/^# /, '') });
      continue;
    }
    if (/^## /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 2, text: trim.replace(/^## /, '') });
      continue;
    }
    if (/^### /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'heading', level: 3, text: trim.replace(/^### /, '') });
      continue;
    }
    if (/^[-*•] /.test(trim)) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: trim.replace(/^[-*•] /, '') });
      continue;
    }
    buf.push(trim);
  }
  flushParagraph();
  return blocks;
}

const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3
} as const;

function blockToParagraph(b: Block): Paragraph {
  if (b.kind === 'heading') {
    return new Paragraph({
      heading: HEADING_MAP[b.level],
      children: [new TextRun({ text: b.text })]
    });
  }
  if (b.kind === 'bullet') {
    return new Paragraph({
      bullet: { level: 0 },
      children: [new TextRun({ text: b.text })]
    });
  }
  return new Paragraph({ children: [new TextRun({ text: b.text })] });
}

export async function mdToDocxBuffer(md: string): Promise<Buffer> {
  const blocks = parseBlocks(md);
  const paragraphs = blocks.length > 0 ? blocks.map(blockToParagraph) : [new Paragraph({})];
  const doc = new Document({ sections: [{ children: paragraphs }] });
  return Packer.toBuffer(doc);
}
```

> Note: this is a minimal markdown subset (heading/paragraph/bullet). Bold, italic, links, and nested lists are out of scope for M2 — they fall through to plain text. The output is editable and recruiter-acceptable. Pixel-perfect cloning of an existing DOCX is explicitly out of scope per the spec (§9.3).

- [ ] **Step 5: Run tests (PASS)**

```bash
npm test -- exporters.docx
```
Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add src/exporters/docx.ts tests/exporters.docx.test.ts package.json package-lock.json
git commit -m "feat(exporters): markdown → DOCX Buffer via docx package"
```

---

## Task 7: Resume picker service

**Files:**
- Create: `src/services/pickResume.ts`, `tests/services.pickResume.test.ts`

Given a job and N stored resumes, pick the best base resume to tailor. Returns the chosen resume id + a short reason string. Sampling-driven.

- [ ] **Step 1: Failing test**

Create `tests/services.pickResume.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { pickBestResume } from '../src/services/pickResume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/pickResume', () => {
  it('returns the only resume when there is one', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    const out = await pickBestResume(
      { jobTitle: 'PM', jobDescription: 'Lead payments' },
      [{ id: 'r1', label: 'Generic PM', parsed: {} }],
      sampling
    );
    expect(out).toEqual({ resumeId: 'r1', reason: 'only stored resume' });
    expect(sampling.completeJson).not.toHaveBeenCalled();
  });

  it('asks sampling when there are multiple', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        resume_id: 'r2',
        reason: 'r2 leads with payments and Stripe APIs'
      })
    } as unknown as SamplingClient;

    const out = await pickBestResume(
      { jobTitle: 'PM, Payments', jobDescription: 'Lead payments product' },
      [
        { id: 'r1', label: 'Generic PM', parsed: { skills: ['analytics'] } },
        { id: 'r2', label: 'Payments PM', parsed: { skills: ['stripe', 'payments'] } }
      ],
      sampling
    );
    expect(out.resumeId).toBe('r2');
    expect(out.reason).toContain('payments');
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- pickResume
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/services/pickResume.ts`:

```ts
import type { SamplingClient } from '../sampling/client.ts';

export type PickResumeJobCtx = {
  jobTitle: string;
  jobDescription: string;
};

export type PickResumeCandidate = {
  id: string;
  label: string;
  parsed: Record<string, unknown>;
};

export type PickResumeResult = {
  resumeId: string;
  reason: string;
};

const SYSTEM = `You select the best base resume to tailor for a job description.
You will be given a job (title + description) and an array of candidate resumes.
Each candidate has an id, a label, and a parsed structure with skills/experiences.
Return JSON: { "resume_id": "<id>", "reason": "<one short sentence>" }.
Pick the resume whose existing strengths best overlap with the job's most-critical asks.
Tie-break toward more specific labels.`;

export async function pickBestResume(
  job: PickResumeJobCtx,
  resumes: PickResumeCandidate[],
  sampling: SamplingClient
): Promise<PickResumeResult> {
  if (resumes.length === 0) throw new Error('no resumes available');
  if (resumes.length === 1) {
    return { resumeId: resumes[0].id, reason: 'only stored resume' };
  }

  const prompt = JSON.stringify({
    job: { title: job.jobTitle, description: job.jobDescription.slice(0, 4000) },
    resumes: resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed }))
  });

  const out = await sampling.completeJson<{ resume_id: string; reason: string }>({
    system: SYSTEM,
    prompt,
    maxTokens: 256
  });

  // Validate the LLM didn't hallucinate an id.
  const ok = resumes.find(r => r.id === out.resume_id);
  if (!ok) {
    return { resumeId: resumes[0].id, reason: `LLM picked unknown id; defaulted to ${resumes[0].label}` };
  }

  return { resumeId: out.resume_id, reason: out.reason };
}
```

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- pickResume
```
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/pickResume.ts tests/services.pickResume.test.ts
git commit -m "feat(services): pickBestResume — sampling-driven multi-resume selector"
```

---

## Task 8: Tailored resume generator service

**Files:**
- Create: `src/services/tailorResume.ts`, `tests/services.tailorResume.test.ts`

Given a base resume, a job, and the user's profile, produce a tailored resume in markdown. The prompt instructs the LLM to keep the base resume's structure but emphasize/de-emphasize bullets and add JD-specific keywords without inventing experience.

- [ ] **Step 1: Failing test**

Create `tests/services.tailorResume.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { tailorResume } from '../src/services/tailorResume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/tailorResume', () => {
  it('produces tailored markdown via sampling', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak Garg\n\n## Experience\n\n- PM @ Acme (payments)')
    } as unknown as SamplingClient;
    const out = await tailorResume({
      job: { title: 'PM, Payments', description: 'Lead payments' },
      profile: { name: 'Mohak Garg' },
      resume: { label: 'Generic PM', rawText: 'PM @ Acme', parsed: { skills: ['payments'] } },
      sampling
    });
    expect(out.tailoredMd).toContain('Mohak Garg');
    expect(out.tailoredMd).toContain('payments');
    expect(sampling.complete).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- tailorResume
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/services/tailorResume.ts`:

```ts
import type { SamplingClient } from '../sampling/client.ts';

export type TailorResumeArgs = {
  job: { title: string; description: string };
  profile: Record<string, unknown> | null;
  resume: { label: string; rawText: string; parsed: Record<string, unknown> };
  sampling: SamplingClient;
};

export type TailorResumeResult = {
  tailoredMd: string;
};

const SYSTEM = `You tailor an existing resume to a specific job description.

Rules:
- Output the resume in clean markdown. Use # for the candidate's name (top), ## for sections (Experience, Skills, Education, Projects), - for bullets.
- Preserve all factual content from the base resume. Do NOT invent experience, titles, dates, schools, or metrics.
- You MAY rephrase bullets, reorder them, drop low-relevance bullets, and add JD keywords where a fact in the resume justifies them.
- Keep the resume to roughly the same length as the input (one page when typeset).
- Lead with the candidate's name as a level-1 heading. Below it, a one-line tagline drawn from their profile or resume.

Return ONLY the markdown. No preamble, no postscript, no code fences.`;

export async function tailorResume(args: TailorResumeArgs): Promise<TailorResumeResult> {
  const prompt = JSON.stringify({
    job: { title: args.job.title, description: args.job.description.slice(0, 6000) },
    profile: args.profile,
    base_resume: {
      label: args.resume.label,
      raw_text: args.resume.rawText.slice(0, 8000),
      parsed: args.resume.parsed
    }
  });

  const tailoredMd = await args.sampling.complete({
    system: SYSTEM,
    prompt,
    maxTokens: 2048
  });

  return { tailoredMd: tailoredMd.trim() };
}
```

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- tailorResume
```
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/tailorResume.ts tests/services.tailorResume.test.ts
git commit -m "feat(services): tailorResume — JD-aware markdown rewriter"
```

---

## Task 9: Cover letter drafter service

**Files:**
- Create: `src/services/coverLetter.ts`, `tests/services.coverLetter.test.ts`

- [ ] **Step 1: Failing test**

Create `tests/services.coverLetter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { draftCoverLetter } from '../src/services/coverLetter.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/coverLetter', () => {
  it('drafts a cover letter via sampling', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('Dear hiring manager,\n\nI am excited about the PM role at Stripe...')
    } as unknown as SamplingClient;

    const letter = await draftCoverLetter({
      job: { title: 'PM, Payments', companyName: 'Stripe', description: 'Lead Payments product' },
      profile: { name: 'Mohak Garg' },
      tailoredResumeMd: '# Mohak Garg\n\n- 2 yrs PM at Acme',
      sampling
    });
    expect(letter.coverLetterMd).toContain('Stripe');
    expect(letter.coverLetterMd.toLowerCase()).toContain('dear');
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- coverLetter
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/services/coverLetter.ts`:

```ts
import type { SamplingClient } from '../sampling/client.ts';

export type CoverLetterArgs = {
  job: { title: string; companyName: string; description: string };
  profile: Record<string, unknown> | null;
  tailoredResumeMd: string;
  sampling: SamplingClient;
};

export type CoverLetterResult = {
  coverLetterMd: string;
};

const SYSTEM = `You write a tight, specific cover letter (200–300 words) for the user.

Rules:
- Start with "Dear hiring manager," (no name, since we don't know it).
- Open with a single sentence that names the role and company and one specific reason this person is a fit (drawn from the resume, not invented).
- Body: 1–2 short paragraphs that connect the candidate's most relevant experience to the JD's top asks. Cite specific facts from the resume.
- Close with a sentence inviting next steps.
- Sign off with the candidate's name from the profile (or "Sincerely," if name is unknown).
- Plain markdown, no headings, no formatting flourishes.
- No clichés ("I am writing to express my interest", "passionate about", "team player"). Be direct.

Return ONLY the cover letter text. No preamble.`;

export async function draftCoverLetter(args: CoverLetterArgs): Promise<CoverLetterResult> {
  const prompt = JSON.stringify({
    job: {
      title: args.job.title,
      company: args.job.companyName,
      description: args.job.description.slice(0, 6000)
    },
    profile: args.profile,
    tailored_resume_md: args.tailoredResumeMd
  });

  const coverLetterMd = await args.sampling.complete({
    system: SYSTEM,
    prompt,
    maxTokens: 768
  });

  return { coverLetterMd: coverLetterMd.trim() };
}
```

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- coverLetter
```
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/coverLetter.ts tests/services.coverLetter.test.ts
git commit -m "feat(services): draftCoverLetter — JD + tailored-resume → letter"
```

---

## Task 10: Application PR builder service

**Files:**
- Create: `src/services/buildApplication.ts`, `tests/services.buildApplication.test.ts`

The orchestrator: takes a `jobId` (and optional `resumeId`), runs `pickBestResume` (if no resumeId), `tailorResume`, `draftCoverLetter`, persists via `createApplication`, returns the bundle.

`answerPack` in M2 is empty by default — answering ATS-specific screening questions is a stretch goal that lands in M2.5 or M3 (it requires per-ATS form scraping). The deepLink is the job's url.

- [ ] **Step 1: Failing test**

Create `tests/services.buildApplication.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { getApplication } from '../src/store/application.ts';
import { buildApplication } from '../src/services/buildApplication.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/buildApplication', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://apply', descriptionMd: 'Lead Payments.', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM at Acme', parsed: { skills: ['payments'] } });
  });

  it('builds and persists an application using the only stored resume', async () => {
    const calls: string[] = [];
    const sampling = {
      complete: vi.fn().mockImplementation(async ({ system }: { system: string }) => {
        if (system.includes('tailor an existing resume')) { calls.push('tailor'); return '# Mohak\n\n- PM @ Acme'; }
        if (system.includes('cover letter'))             { calls.push('letter'); return 'Dear hiring manager,\n\nI am excited...'; }
        throw new Error('unexpected system prompt');
      }),
      completeJson: vi.fn()  // not called when there's only 1 resume
    } as unknown as SamplingClient;

    const out = await buildApplication({ jobId: 'g:stripe:1' }, { db, sampling });
    expect(out.applicationId).toBeTypeOf('string');
    expect(out.tailoredResumeMd).toContain('Mohak');
    expect(out.coverLetterMd).toContain('hiring manager');
    expect(out.deepLink).toBe('https://apply');
    expect(calls).toEqual(['tailor', 'letter']);

    const stored = getApplication(db, out.applicationId);
    expect(stored?.coverLetterMd).toBe(out.coverLetterMd);
    expect(stored?.status).toBe('draft');
  });

  it('throws on unknown job', async () => {
    const sampling = { complete: vi.fn(), completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(buildApplication({ jobId: 'nope' }, { db, sampling })).rejects.toThrow(/unknown job/);
  });

  it('throws when no resumes exist', async () => {
    const empty = openDb(':memory:');
    upsertCompany(empty, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(empty, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    const sampling = { complete: vi.fn(), completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(buildApplication({ jobId: 'g:stripe:1' }, { db: empty, sampling }))
      .rejects.toThrow(/no resumes/);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- buildApplication
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/services/buildApplication.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '../store/db.ts';
import { getJob } from '../store/job.ts';
import { listResumes, getResume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import { listAllCompanies } from '../store/company.ts';
import { createApplication } from '../store/application.ts';
import { pickBestResume } from './pickResume.ts';
import { tailorResume } from './tailorResume.ts';
import { draftCoverLetter } from './coverLetter.ts';
import type { SamplingClient } from '../sampling/client.ts';

export type BuildApplicationInput = {
  jobId: string;
  resumeId?: string;
};

export type BuildApplicationResult = {
  applicationId: string;
  jobId: string;
  resumeId: string;
  tailoredResumeMd: string;
  coverLetterMd: string;
  answerPack: Record<string, string>;
  deepLink: string;
  pickedReason: string;
};

export async function buildApplication(
  input: BuildApplicationInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<BuildApplicationResult> {
  const job = getJob(ctx.db, input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  const resumes = listResumes(ctx.db);
  if (resumes.length === 0) throw new Error('no resumes stored — call add_resume first');

  let chosenResumeId: string;
  let pickedReason: string;
  if (input.resumeId) {
    const explicit = getResume(ctx.db, input.resumeId);
    if (!explicit) throw new Error(`unknown resume: ${input.resumeId}`);
    chosenResumeId = explicit.id;
    pickedReason = 'caller-supplied';
  } else {
    const picked = await pickBestResume(
      { jobTitle: job.title, jobDescription: job.descriptionMd ?? '' },
      resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed })),
      ctx.sampling
    );
    chosenResumeId = picked.resumeId;
    pickedReason = picked.reason;
  }

  const resume = getResume(ctx.db, chosenResumeId);
  if (!resume) throw new Error(`internal: lost resume ${chosenResumeId}`);

  const profile = getProfile(ctx.db);
  const company = listAllCompanies(ctx.db).find(c => c.id === job.companyId);
  const companyName = company?.name ?? 'this company';

  const tailored = await tailorResume({
    job: { title: job.title, description: job.descriptionMd ?? '' },
    profile,
    resume: { label: resume.label, rawText: resume.rawText, parsed: resume.parsed },
    sampling: ctx.sampling
  });

  const cover = await draftCoverLetter({
    job: { title: job.title, companyName, description: job.descriptionMd ?? '' },
    profile,
    tailoredResumeMd: tailored.tailoredMd,
    sampling: ctx.sampling
  });

  const applicationId = randomUUID();
  const answerPack: Record<string, string> = {};
  const deepLink = job.url;

  createApplication(ctx.db, {
    id: applicationId,
    jobId: job.id,
    resumeId: chosenResumeId,
    tailoredResumeMd: tailored.tailoredMd,
    coverLetterMd: cover.coverLetterMd,
    answerPack,
    deepLink
  });

  return {
    applicationId,
    jobId: job.id,
    resumeId: chosenResumeId,
    tailoredResumeMd: tailored.tailoredMd,
    coverLetterMd: cover.coverLetterMd,
    answerPack,
    deepLink,
    pickedReason
  };
}
```

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- buildApplication
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/buildApplication.ts tests/services.buildApplication.test.ts
git commit -m "feat(services): buildApplication — orchestrate pick + tailor + letter + persist"
```

---

## Task 11: `tailor_resume` MCP tool

**Files:**
- Create: `src/tools/tailor_resume.ts`, `tests/tools.tailor_resume.test.ts`

Returns the tailored resume in markdown by default. If `format: 'docx'` is requested, also returns a base64-encoded DOCX. If `format: 'html'`, also returns the print-styled HTML string. The markdown is always present; the optional formats are additive.

- [ ] **Step 1: Failing test**

Create `tests/tools.tailor_resume.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { tailorResumeTool } from '../src/tools/tailor_resume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/tailor_resume', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM',
      url: 'https://x', descriptionMd: 'Lead Payments', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('returns markdown only by default', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak\n\n- PM @ Acme'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;
    const out = await tailorResumeTool({ jobId: 'g:stripe:1' }, { db, sampling });
    expect(out.tailoredMd).toContain('Mohak');
    expect(out.docxBase64).toBeUndefined();
    expect(out.html).toBeUndefined();
  });

  it('returns html when requested', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;
    const out = await tailorResumeTool({ jobId: 'g:stripe:1', format: 'html' }, { db, sampling });
    expect(out.html).toContain('<!doctype html>');
    expect(out.html).toContain('Mohak');
  });

  it('returns docxBase64 when requested', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('# Mohak'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;
    const out = await tailorResumeTool({ jobId: 'g:stripe:1', format: 'docx' }, { db, sampling });
    expect(out.docxBase64).toBeTypeOf('string');
    const buf = Buffer.from(out.docxBase64!, 'base64');
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- tailor_resume
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/tools/tailor_resume.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getJob } from '../store/job.ts';
import { listResumes, getResume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import { pickBestResume } from '../services/pickResume.ts';
import { tailorResume } from '../services/tailorResume.ts';
import { mdToPrintHtml } from '../exporters/html.ts';
import { mdToDocxBuffer } from '../exporters/docx.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const tailorResumeInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional(),
  format: z.enum(['md', 'docx', 'html']).optional()
    .describe("Optional extra format. 'md' is always returned; 'docx' adds a base64 buffer; 'html' adds a print-styled string.")
});

export type TailorResumeToolInput = z.infer<typeof tailorResumeInput>;

export type TailorResumeToolResult = {
  tailoredMd: string;
  resumeId: string;
  pickedReason: string;
  docxBase64?: string;
  html?: string;
};

export async function tailorResumeTool(
  input: TailorResumeToolInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<TailorResumeToolResult> {
  const job = getJob(ctx.db, input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  const resumes = listResumes(ctx.db);
  if (resumes.length === 0) throw new Error('no resumes stored — call add_resume first');

  let chosenResumeId: string;
  let pickedReason: string;
  if (input.resumeId) {
    const r = getResume(ctx.db, input.resumeId);
    if (!r) throw new Error(`unknown resume: ${input.resumeId}`);
    chosenResumeId = r.id;
    pickedReason = 'caller-supplied';
  } else {
    const picked = await pickBestResume(
      { jobTitle: job.title, jobDescription: job.descriptionMd ?? '' },
      resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed })),
      ctx.sampling
    );
    chosenResumeId = picked.resumeId;
    pickedReason = picked.reason;
  }

  const resume = getResume(ctx.db, chosenResumeId);
  if (!resume) throw new Error(`internal: lost resume ${chosenResumeId}`);

  const profile = getProfile(ctx.db);

  const { tailoredMd } = await tailorResume({
    job: { title: job.title, description: job.descriptionMd ?? '' },
    profile,
    resume: { label: resume.label, rawText: resume.rawText, parsed: resume.parsed },
    sampling: ctx.sampling
  });

  const result: TailorResumeToolResult = {
    tailoredMd,
    resumeId: chosenResumeId,
    pickedReason
  };

  if (input.format === 'docx') {
    const buf = await mdToDocxBuffer(tailoredMd);
    result.docxBase64 = buf.toString('base64');
  } else if (input.format === 'html') {
    result.html = await mdToPrintHtml(tailoredMd, { title: `${resume.label} → ${job.title}` });
  }

  return result;
}
```

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- tailor_resume
```
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/tailor_resume.ts tests/tools.tailor_resume.test.ts
git commit -m "feat(tools): tailor_resume — md + optional docx/html export"
```

---

## Task 12: `draft_application` MCP tool

**Files:**
- Create: `src/tools/draft_application.ts`, `tests/tools.draft_application.test.ts`

Thin wrapper around `buildApplication`. Input: `jobId`, optional `resumeId`. Output: full PR bundle plus the persisted `applicationId`.

- [ ] **Step 1: Failing test**

Create `tests/tools.draft_application.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { draftApplication } from '../src/tools/draft_application.ts';
import { getApplication } from '../src/store/application.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/draft_application', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://apply', descriptionMd: 'Lead Payments', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('drafts and persists an application', async () => {
    const sampling = {
      complete: vi.fn()
        .mockResolvedValueOnce('# Mohak\n\n- PM')   // tailor
        .mockResolvedValueOnce('Dear hiring manager,\n\nLetter body.'),  // letter
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    const out = await draftApplication({ jobId: 'g:stripe:1' }, { db, sampling });
    expect(out.applicationId).toBeTypeOf('string');
    expect(out.tailoredResumeMd).toContain('Mohak');
    expect(out.coverLetterMd).toContain('hiring manager');
    expect(out.deepLink).toBe('https://apply');
    expect(getApplication(db, out.applicationId)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- draft_application
```
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/tools/draft_application.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { buildApplication, type BuildApplicationResult } from '../services/buildApplication.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const draftApplicationInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional()
});

export type DraftApplicationInput = z.infer<typeof draftApplicationInput>;

export async function draftApplication(
  input: DraftApplicationInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<BuildApplicationResult> {
  return buildApplication(input, ctx);
}
```

(Yes, this is a thin wrapper. The job of the tool layer is to validate input via zod and provide the MCP-facing description; the orchestration is in the service.)

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- draft_application
```
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/draft_application.ts tests/tools.draft_application.test.ts
git commit -m "feat(tools): draft_application — wrap buildApplication service"
```

---

## Task 13: Wire new tools, update server tests, README, version bump

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `tests/server.tools.test.ts`
- Modify: `README.md`
- Modify: `package.json` (version 0.0.1 → 0.1.0)

- [ ] **Step 1: Update server.tools test**

Edit `tests/server.tools.test.ts`. Update the expected names array:

```ts
import { describe, it, expect } from 'vitest';

describe('server tools registration', () => {
  it('exports all 8 v1 tools', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    const names = toolDefinitions.map(t => t.name).sort();
    expect(names).toEqual([
      'add_resume', 'draft_application', 'explain_fit', 'fetch_jobs',
      'list_resumes', 'score_fit', 'setup_profile', 'tailor_resume'
    ]);
  });

  it('every tool has a JSON-schema input', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    for (const t of toolDefinitions) {
      expect(t.inputSchema).toBeTypeOf('object');
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});
```

(Change "all 6 v1 tools" → "all 8 v1 tools" and add `draft_application` + `tailor_resume` to the sorted name list.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- server.tools
```
Expected: FAIL — registry has only 6 tools.

- [ ] **Step 3: Register new tools in `src/tools/index.ts`**

Add 2 new imports near the existing tool imports:

```ts
import { tailorResumeTool, tailorResumeInput } from './tailor_resume.ts';
import { draftApplication, draftApplicationInput } from './draft_application.ts';
```

Append 2 new entries to the `toolDefinitions` array (after `explainFit`):

```ts
  ,
  {
    name: 'tailor_resume',
    description: 'Tailor your stored resume for a specific job. Returns markdown by default; optional DOCX (base64) or print-ready HTML on request.',
    inputSchema: zodToJsonSchema(tailorResumeInput),
    run: (i, c) => tailorResumeTool(tailorResumeInput.parse(i), c)
  },
  {
    name: 'draft_application',
    description: 'Build a full application "PR" — tailored resume + cover letter + deep link to the form — and persist it. Returns the application id and bundle.',
    inputSchema: zodToJsonSchema(draftApplicationInput),
    run: (i, c) => draftApplication(draftApplicationInput.parse(i), c)
  }
```

(Watch the leading comma if you're appending after the explainFit closing brace.)

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: all passing.

- [ ] **Step 5: Smoke-run the server**

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "ok"
```
First, run `npm run build` to refresh `dist/`. Then the smoke run. Expected: `ok`.

- [ ] **Step 6: Update README**

In `README.md`, update the "What it does" table to include the 2 new tools. Replace the existing table with:

```markdown
| Tool | Purpose |
|---|---|
| `setup_profile` | Store a structured profile from a free-form description. |
| `add_resume` | Parse and store a labeled resume version (DOCX/PDF/text). |
| `list_resumes` | List stored resumes. |
| `fetch_jobs` | Pull live roles from Greenhouse, Lever, and Ashby. |
| `score_fit` | Numeric fit score + structured strengths/gaps. |
| `explain_fit` | Markdown narrative — why fit, gap, positioning. |
| `tailor_resume` | Edit your best base resume for a specific JD; returns markdown, DOCX, or print-ready HTML. |
| `draft_application` | Build a complete application bundle (tailored resume + cover letter + deep link), persisted as a tracked draft. |
```

Also update the Roadmap row for M2:

Replace:
```markdown
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
```
with:
```markdown
| **M2 (this release)** | Tailor resume, draft cover letter, application "PR" bundle |
```

And update M1's row from "this release" back to its plain form:

Replace:
```markdown
| **M1 (this release)** | Discover + match + explain |
```
with:
```markdown
| M1 | Discover + match + explain |
```

- [ ] **Step 7: Bump version**

In `package.json`, change:
```json
  "version": "0.0.1",
```
to:
```json
  "version": "0.1.0",
```

- [ ] **Step 8: Run the full suite + build one more time**

```bash
npm test && npm run lint && npm run build
```
Expected: all green, build emits dist/server.js + dist/cli.js with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/tools/index.ts tests/server.tools.test.ts README.md package.json
git commit -m "feat(server): register tailor_resume + draft_application; bump 0.1.0"
```

---

## Self-review checklist (before declaring M2 done)

- [ ] All 13 tasks completed; all tests passing.
- [ ] `npm run build` clean, `dist/server.js` and `dist/cli.js` produced.
- [ ] `node dist/cli.js < /dev/null` boots, exits cleanly.
- [ ] `node dist/cli.js install` writes a Claude Desktop config.
- [ ] In Claude Desktop, you can run a full M2 flow: `setup_profile` → `add_resume` → `fetch_jobs` → `tailor_resume` (with a real JD; verify the markdown comes back tailored) → `draft_application` (verify the bundle includes a cover letter, the deepLink matches the job url, and `getApplication(applicationId)` returns the persisted row).
- [ ] `npm test` count >= 60 (was 42 in M1; M2 adds ~20 new tests across services/exporters/tools/store).
- [ ] No new model-provider keys in the codebase. All LLM calls still go through MCP sampling.

When all of the above hold, M2 is complete and ready for M3 (pipeline tracker + anti-spam + scheduled workflows).

---

**End of M2 plan.**
