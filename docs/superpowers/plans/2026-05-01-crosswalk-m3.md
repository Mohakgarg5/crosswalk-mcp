# Crosswalk M3 Implementation Plan — Track + Guard + Schedule

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pipeline tracker (4 tools — `submit_application`, `set_status`, `add_note`, `list_pipeline`), the anti-spam guardrail (a middleware on `draft_application` that enforces a weekly cap and refuses low-fit drafts), and a non-sampling scheduled-workflow system (2 tools — `schedule_workflow`, `run_workflow`, plus a CLI subcommand for cron). Ships v0.2.0.

**Architecture:** The pipeline tracker writes through `application` and `application_event` (both already exist from M2 migration #2). The guardrail is a service called from `draft_application` *before* it spends sampling tokens. Scheduled workflows are stored in a new `workflow` table, run via a `crosswalk-mcp run-scheduled` CLI subcommand the user invokes from cron — only **non-sampling** workflow kinds (job fetch + cache refresh) are supported in v1; sampling workflows are documented as M4.

**Tech Stack:** Same as M2 plus `cron-parser` (parses cron expressions into next-run timestamps; ~50 KB).

**M3 ships these tools** (registry grows from 8 → 14):
- Pipeline: `submit_application`, `set_status`, `add_note`, `list_pipeline`
- Guardrail: middleware on `draft_application` (no new tool)
- Scheduler: `schedule_workflow`, `run_workflow`

**Plus M2 carry-over fixes** flagged in the M2 final review:
- DRY the duplicated `withinSinceDays` helper across 3 adapters
- Add a `resolveResume(ctx, jobId, resumeId?)` helper used by `tailor_resume` + `buildApplication`
- Extract JD truncation constants

**Out of M3 (deferred to M4):** sampling-driven scheduled workflows, more ATS adapters (Workday, Workable, etc.), registry expansion to 200+ companies, autonomous applying.

---

## File structure

```
crosswalk-mcp/
├── package.json                           # + cron-parser
├── src/
│   ├── store/
│   │   ├── application.ts                 # MODIFY — add updateApplicationStatus, addEventForApplication, listApplications filters
│   │   ├── workflow.ts                    # NEW — workflow CRUD
│   │   └── migrations.ts                  # MODIFY — migration #3 (workflow table)
│   ├── ats/
│   │   ├── util.ts                        # NEW — shared withinSinceDays
│   │   ├── greenhouse.ts                  # MODIFY — import from util
│   │   ├── lever.ts                       # MODIFY — import from util
│   │   └── ashby.ts                       # MODIFY — import from util
│   ├── services/
│   │   ├── guardrail.ts                   # NEW — weekly cap, low-fit refusal, dup detection
│   │   ├── resolveResume.ts               # NEW — extracted helper
│   │   ├── buildApplication.ts            # MODIFY — call guardrail, use resolveResume
│   │   ├── pickResume.ts                  # MODIFY — JD truncation constant
│   │   ├── tailorResume.ts                # MODIFY — JD truncation constant
│   │   ├── coverLetter.ts                 # MODIFY — JD truncation constant
│   │   ├── workflowEngine.ts              # NEW — execute a stored workflow (non-sampling only)
│   │   └── constants.ts                   # NEW — JD_TRUNCATION_CHARS etc.
│   ├── tools/
│   │   ├── submit_application.ts          # NEW
│   │   ├── set_status.ts                  # NEW
│   │   ├── add_note.ts                    # NEW
│   │   ├── list_pipeline.ts               # NEW
│   │   ├── schedule_workflow.ts           # NEW
│   │   ├── run_workflow.ts                # NEW
│   │   ├── tailor_resume.ts               # MODIFY — use resolveResume
│   │   └── index.ts                       # MODIFY — register 6 new tools
│   ├── cli.ts                             # MODIFY — add `run-scheduled` subcommand
│   └── ...                                # everything else unchanged
├── tests/
│   ├── store.application.test.ts          # MODIFY — coverage for new methods
│   ├── store.workflow.test.ts             # NEW
│   ├── services.guardrail.test.ts         # NEW
│   ├── services.resolveResume.test.ts     # NEW
│   ├── services.workflowEngine.test.ts    # NEW
│   ├── tools.submit_application.test.ts   # NEW
│   ├── tools.set_status.test.ts           # NEW
│   ├── tools.add_note.test.ts             # NEW
│   ├── tools.list_pipeline.test.ts        # NEW
│   ├── tools.schedule_workflow.test.ts    # NEW
│   ├── tools.run_workflow.test.ts         # NEW
│   ├── ats.util.test.ts                   # NEW
│   ├── server.tools.test.ts               # MODIFY — assert 14 tools (was 8)
│   └── store.test.ts                      # MODIFY — assert 3 migrations
└── ...
```

---

## Task list (15 tasks)

| # | Theme | Task |
|---|---|---|
| 1 | Cleanup | DRY `withinSinceDays` to `src/ats/util.ts` |
| 2 | Cleanup | Extract JD truncation constant + apply across services |
| 3 | Cleanup | `resolveResume` helper + use in tailor_resume + buildApplication |
| 4 | Storage | Application module: `updateApplicationStatus`, `addEventForApplication`, filtered `listApplications` |
| 5 | Tracker | `submit_application` tool |
| 6 | Tracker | `set_status` tool |
| 7 | Tracker | `add_note` tool |
| 8 | Tracker | `list_pipeline` tool |
| 9 | Guardrail | `guardrail` service (weekly cap + low-fit refusal + dup) |
| 10 | Guardrail | Wire guardrail into `buildApplication` |
| 11 | Scheduler | Migration #3 — workflow table |
| 12 | Scheduler | `workflow` CRUD + `workflowEngine` (non-sampling) |
| 13 | Scheduler | `schedule_workflow` + `run_workflow` MCP tools |
| 14 | Scheduler | `crosswalk-mcp run-scheduled` CLI subcommand |
| 15 | Ship | Wire 6 new tools, README, version 0.2.0 |

---

## Task 1: DRY `withinSinceDays` to `src/ats/util.ts`

**Files:**
- Create: `src/ats/util.ts`, `tests/ats.util.test.ts`
- Modify: `src/ats/greenhouse.ts`, `src/ats/lever.ts`, `src/ats/ashby.ts`

- [ ] **Step 1: Failing test**

Create `tests/ats.util.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { withinSinceDays } from '../src/ats/util.ts';

describe('ats/util', () => {
  it('includes everything when sinceDays is undefined', () => {
    expect(withinSinceDays('2020-01-01T00:00:00Z', undefined)).toBe(true);
    expect(withinSinceDays(undefined, undefined)).toBe(true);
  });

  it('includes jobs with no postedAt regardless of sinceDays', () => {
    expect(withinSinceDays(undefined, 7)).toBe(true);
  });

  it('excludes postings older than sinceDays cutoff', () => {
    const old = new Date(Date.now() - 30 * 86400_000).toISOString();
    expect(withinSinceDays(old, 7)).toBe(false);
  });

  it('includes postings within sinceDays cutoff', () => {
    const recent = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect(withinSinceDays(recent, 7)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- ats.util
```

- [ ] **Step 3: Implement helper**

Create `src/ats/util.ts`:

```ts
export function withinSinceDays(postedAt: string | undefined, sinceDays: number | undefined): boolean {
  if (sinceDays === undefined) return true;
  if (!postedAt) return true;
  const cutoff = Date.now() - sinceDays * 86400_000;
  return new Date(postedAt).getTime() >= cutoff;
}
```

- [ ] **Step 4: Update each adapter to import the shared helper**

In `src/ats/greenhouse.ts`, `src/ats/lever.ts`, `src/ats/ashby.ts`:
- DELETE the local `function withinSinceDays(...)` definition.
- ADD `import { withinSinceDays } from './util.ts';` next to the other top-level imports.

- [ ] **Step 5: Run all tests + lint**

```bash
npm test && npm run lint
```
Expected: 71 passing (was 68 + 3 new helper tests), lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/ats/util.ts tests/ats.util.test.ts \
        src/ats/greenhouse.ts src/ats/lever.ts src/ats/ashby.ts
git commit -m "refactor(ats): DRY withinSinceDays to ats/util"
```

---

## Task 2: Extract JD truncation constants

**Files:**
- Create: `src/services/constants.ts`
- Modify: `src/services/pickResume.ts`, `src/services/tailorResume.ts`, `src/services/coverLetter.ts`

The picker uses 4000 chars, the tailorer uses 6000, the cover letter uses 6000. The picker can stay smaller (it doesn't need full context). Lock in named constants.

- [ ] **Step 1: Create constants module**

Create `src/services/constants.ts`:

```ts
/**
 * Maximum characters of a job description to include in sampling prompts.
 * Different services use different windows — picker only needs the gist;
 * tailorer + cover letter benefit from the full description.
 */
export const JD_CHARS_PICKER = 4000;
export const JD_CHARS_TAILOR = 6000;
export const JD_CHARS_LETTER = 6000;

/** Maximum characters of a resume's raw text to include in sampling prompts. */
export const RESUME_RAW_CHARS = 8000;
```

- [ ] **Step 2: Update `src/services/pickResume.ts`**

Add this import near the top:

```ts
import { JD_CHARS_PICKER } from './constants.ts';
```

Replace `description: job.jobDescription.slice(0, 4000)` with:
```ts
description: job.jobDescription.slice(0, JD_CHARS_PICKER)
```

- [ ] **Step 3: Update `src/services/tailorResume.ts`**

Add import:

```ts
import { JD_CHARS_TAILOR, RESUME_RAW_CHARS } from './constants.ts';
```

Replace `description: args.job.description.slice(0, 6000)` with:
```ts
description: args.job.description.slice(0, JD_CHARS_TAILOR)
```

Replace `raw_text: args.resume.rawText.slice(0, 8000)` with:
```ts
raw_text: args.resume.rawText.slice(0, RESUME_RAW_CHARS)
```

- [ ] **Step 4: Update `src/services/coverLetter.ts`**

Add import:

```ts
import { JD_CHARS_LETTER } from './constants.ts';
```

Replace `description: args.job.description.slice(0, 6000)` with:
```ts
description: args.job.description.slice(0, JD_CHARS_LETTER)
```

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 71 passing, lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/constants.ts src/services/pickResume.ts \
        src/services/tailorResume.ts src/services/coverLetter.ts
git commit -m "refactor(services): extract JD/resume truncation constants"
```

---

## Task 3: `resolveResume` helper

**Files:**
- Create: `src/services/resolveResume.ts`, `tests/services.resolveResume.test.ts`
- Modify: `src/tools/tailor_resume.ts`, `src/services/buildApplication.ts`

The current `tailor_resume` tool and `buildApplication` service each have ~20 identical lines: look up the explicit resume if `resumeId` is given (throw on miss), otherwise call `pickBestResume` and use the chosen id. Extract to a single helper.

- [ ] **Step 1: Failing test**

Create `tests/services.resolveResume.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addResume } from '../src/store/resume.ts';
import { resolveResume } from '../src/services/resolveResume.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/resolveResume', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    addResume(db, { id: 'r2', label: 'Payments PM', rawText: 'PM', parsed: {} });
  });

  it('uses explicit resumeId when supplied', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    const out = await resolveResume({
      db, sampling, jobTitle: 'PM', jobDescription: 'Lead', resumeId: 'r2'
    });
    expect(out.resumeId).toBe('r2');
    expect(out.pickedReason).toBe('caller-supplied');
    expect(sampling.completeJson).not.toHaveBeenCalled();
  });

  it('throws when explicit resumeId is unknown', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(
      resolveResume({ db, sampling, jobTitle: 'PM', jobDescription: 'Lead', resumeId: 'nope' })
    ).rejects.toThrow(/unknown resume/);
  });

  it('throws when no resumes exist', async () => {
    const empty = openDb(':memory:');
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(
      resolveResume({ db: empty, sampling, jobTitle: 'PM', jobDescription: 'Lead' })
    ).rejects.toThrow(/no resumes/);
  });

  it('delegates to picker when no resumeId given', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({ resume_id: 'r2', reason: 'better fit' })
    } as unknown as SamplingClient;
    const out = await resolveResume({
      db, sampling, jobTitle: 'PM', jobDescription: 'Lead'
    });
    expect(out.resumeId).toBe('r2');
    expect(out.pickedReason).toContain('better');
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- resolveResume
```

- [ ] **Step 3: Implement**

Create `src/services/resolveResume.ts`:

```ts
import type { Db } from '../store/db.ts';
import { listResumes, getResume, type Resume } from '../store/resume.ts';
import { pickBestResume } from './pickResume.ts';
import type { SamplingClient } from '../sampling/client.ts';

export type ResolveResumeArgs = {
  db: Db;
  sampling: SamplingClient;
  jobTitle: string;
  jobDescription: string;
  resumeId?: string;
};

export type ResolveResumeResult = {
  resumeId: string;
  resume: Resume;
  pickedReason: string;
};

export async function resolveResume(args: ResolveResumeArgs): Promise<ResolveResumeResult> {
  const resumes = listResumes(args.db);
  if (resumes.length === 0) throw new Error('no resumes stored — call add_resume first');

  let resumeId: string;
  let pickedReason: string;
  if (args.resumeId) {
    const r = getResume(args.db, args.resumeId);
    if (!r) throw new Error(`unknown resume: ${args.resumeId}`);
    resumeId = r.id;
    pickedReason = 'caller-supplied';
  } else {
    const picked = await pickBestResume(
      { jobTitle: args.jobTitle, jobDescription: args.jobDescription },
      resumes.map(r => ({ id: r.id, label: r.label, parsed: r.parsed })),
      args.sampling
    );
    resumeId = picked.resumeId;
    pickedReason = picked.reason;
  }

  const resume = getResume(args.db, resumeId);
  if (!resume) throw new Error(`internal: lost resume ${resumeId}`);

  return { resumeId, resume, pickedReason };
}
```

- [ ] **Step 4: Update `src/tools/tailor_resume.ts`**

Replace the 20-line resume-resolution block (between the job lookup and the profile lookup) with a single call to `resolveResume`. Add to imports:

```ts
import { resolveResume } from '../services/resolveResume.ts';
```

Remove the existing imports of `listResumes`, `getResume`, `pickBestResume` from this file (they're now used inside `resolveResume`).

Replace the block:
```ts
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
```

With:

```ts
  const { resumeId: chosenResumeId, resume, pickedReason } = await resolveResume({
    db: ctx.db, sampling: ctx.sampling,
    jobTitle: job.title, jobDescription: job.descriptionMd ?? '',
    resumeId: input.resumeId
  });
```

- [ ] **Step 5: Update `src/services/buildApplication.ts`**

Same refactor. Add `import { resolveResume } from './resolveResume.ts';`. Remove unused imports of `listResumes`, `getResume`, `pickBestResume`. Replace the equivalent 20-line block with the same `resolveResume` call (returns `resumeId`, `resume`, `pickedReason`).

- [ ] **Step 6: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 75 passing (71 + 4 new resolveResume tests), lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/services/resolveResume.ts tests/services.resolveResume.test.ts \
        src/tools/tailor_resume.ts src/services/buildApplication.ts
git commit -m "refactor(services): extract resolveResume helper"
```

---

## Task 4: Application module — status update + event log + filtered listing

**Files:**
- Modify: `src/store/application.ts`
- Modify: `tests/store.application.test.ts`

Add `updateApplicationStatus(db, id, status)`, `addEventForApplication(db, applicationId, kind, payload)`, `listEventsForApplication(db, applicationId)`. Extend `listApplications(db, filters?)` with optional `status` filter.

- [ ] **Step 1: Failing tests**

Append to `tests/store.application.test.ts` (inside the existing `describe`, after the existing tests):

```ts
  it('updates status and stamps submitted_at when status becomes submitted', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'a1', 'submitted');
    const app = getApplication(db, 'a1');
    expect(app?.status).toBe('submitted');
    expect(app?.submittedAt).toBeTypeOf('string');
  });

  it('updates status without stamping submitted_at for non-submitted statuses', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'a1', 'rejected');
    const app = getApplication(db, 'a1');
    expect(app?.status).toBe('rejected');
    expect(app?.submittedAt).toBeUndefined();
  });

  it('throws when updating status of unknown application', () => {
    expect(() => updateApplicationStatus(db, 'nope', 'submitted')).toThrow(/unknown application/);
  });

  it('appends events and lists them in order', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
    addEventForApplication(db, 'a1', 'note', { text: 'first note' });
    addEventForApplication(db, 'a1', 'status_changed', { from: 'draft', to: 'submitted' });
    const events = listEventsForApplication(db, 'a1');
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('note');
    expect(events[0].payload).toEqual({ text: 'first note' });
    expect(events[1].kind).toBe('status_changed');
  });

  it('filters listApplications by status', () => {
    createApplication(db, {
      id: 'a', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'a', coverLetterMd: 'a', answerPack: {}, deepLink: 'https://x'
    });
    createApplication(db, {
      id: 'b', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'b', coverLetterMd: 'b', answerPack: {}, deepLink: 'https://x'
    });
    updateApplicationStatus(db, 'b', 'submitted');
    expect(listApplications(db, { status: 'submitted' }).map(a => a.id)).toEqual(['b']);
    expect(listApplications(db, { status: 'draft' }).map(a => a.id)).toEqual(['a']);
  });
```

Update the existing imports at the top of `tests/store.application.test.ts` to include the new exports:

```ts
import {
  createApplication, getApplication, listApplications,
  updateApplicationStatus, addEventForApplication, listEventsForApplication
} from '../src/store/application.ts';
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- store.application
```

- [ ] **Step 3: Implement**

Edit `src/store/application.ts`. Append after the existing `listApplications` function:

```ts
export type ApplicationStatus = Application['status'];

export type ApplicationFilters = {
  status?: ApplicationStatus;
};

// Replace the existing `listApplications(db: Db)` signature with this richer one.
// (Find the existing `export function listApplications(db: Db): Application[] { ... }` and replace.)
```

Replace the existing `listApplications` function with this version:

```ts
export function listApplications(db: Db, filters: ApplicationFilters = {}): Application[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.status) {
    where.push('status = ?');
    args.push(filters.status);
  }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, rowid DESC`;
  const rows = db.prepare(sql).all(...args) as Row[];
  return rows.map(rowToApplication);
}
```

Then add the new functions:

```ts
export function updateApplicationStatus(db: Db, id: string, status: ApplicationStatus): void {
  const stampSubmitted = status === 'submitted';
  const submittedAt = stampSubmitted ? new Date().toISOString() : null;

  const result = stampSubmitted
    ? db.prepare(`UPDATE application SET status = ?, submitted_at = ? WHERE id = ?`)
        .run(status, submittedAt, id)
    : db.prepare(`UPDATE application SET status = ? WHERE id = ?`)
        .run(status, id);

  if (result.changes === 0) throw new Error(`unknown application: ${id}`);
}

export type ApplicationEvent = {
  id: string;
  applicationId: string;
  kind: string;
  payload: Record<string, unknown>;
  at: string;
};

export function addEventForApplication(
  db: Db,
  applicationId: string,
  kind: string,
  payload: Record<string, unknown>
): ApplicationEvent {
  const id = `evt_${Math.random().toString(36).slice(2, 12)}_${Date.now()}`;
  const at = new Date().toISOString();
  db.prepare(`
    INSERT INTO application_event (id, application_id, kind, payload_json, at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, applicationId, kind, JSON.stringify(payload), at);
  return { id, applicationId, kind, payload, at };
}

type EventRow = {
  id: string;
  applicationId: string;
  kind: string;
  payload_json: string;
  at: string;
};

export function listEventsForApplication(db: Db, applicationId: string): ApplicationEvent[] {
  const rows = db.prepare(`
    SELECT id, application_id AS applicationId, kind, payload_json, at
    FROM application_event WHERE application_id = ?
    ORDER BY at ASC, rowid ASC
  `).all(applicationId) as EventRow[];
  return rows.map(r => ({
    id: r.id,
    applicationId: r.applicationId,
    kind: r.kind,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    at: r.at
  }));
}
```

- [ ] **Step 4: Run tests (PASS)**

```bash
npm test -- store.application
```
Expected: 8 passing (3 existing + 5 new).

- [ ] **Step 5: Run full suite + lint**

```bash
npm test && npm run lint
```
Expected: 80 passing.

- [ ] **Step 6: Commit**

```bash
git add src/store/application.ts tests/store.application.test.ts
git commit -m "feat(store): application status update + event log + filtered list"
```

---

## Task 5: `submit_application` MCP tool

**Files:**
- Create: `src/tools/submit_application.ts`, `tests/tools.submit_application.test.ts`

Marks an application as submitted (the user has clicked "Apply" in their browser and confirmed). Stamps `submitted_at`, records a `status_changed` event.

- [ ] **Step 1: Failing test**

Create `tests/tools.submit_application.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listEventsForApplication
} from '../src/store/application.ts';
import { submitApplication } from '../src/tools/submit_application.ts';

describe('tools/submit_application', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
  });

  it('marks application submitted and records event', async () => {
    const out = await submitApplication({ applicationId: 'app1' }, { db });
    expect(out.status).toBe('submitted');
    expect(out.submittedAt).toBeTypeOf('string');
    const app = getApplication(db, 'app1');
    expect(app?.status).toBe('submitted');
    const events = listEventsForApplication(db, 'app1');
    expect(events.some(e => e.kind === 'status_changed')).toBe(true);
  });

  it('throws on unknown application', async () => {
    await expect(submitApplication({ applicationId: 'nope' }, { db })).rejects.toThrow(/unknown application/);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- submit_application
```

- [ ] **Step 3: Implement**

Create `src/tools/submit_application.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import {
  getApplication, updateApplicationStatus, addEventForApplication
} from '../store/application.ts';

export const submitApplicationInput = z.object({
  applicationId: z.string()
});

export async function submitApplication(
  input: z.infer<typeof submitApplicationInput>,
  ctx: { db: Db }
): Promise<{ applicationId: string; status: 'submitted'; submittedAt: string }> {
  const before = getApplication(ctx.db, input.applicationId);
  if (!before) throw new Error(`unknown application: ${input.applicationId}`);

  updateApplicationStatus(ctx.db, input.applicationId, 'submitted');
  addEventForApplication(ctx.db, input.applicationId, 'status_changed', {
    from: before.status, to: 'submitted'
  });

  const after = getApplication(ctx.db, input.applicationId);
  if (!after) throw new Error(`internal: application ${input.applicationId} disappeared`);
  return {
    applicationId: input.applicationId,
    status: 'submitted',
    submittedAt: after.submittedAt!
  };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 82 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/submit_application.ts tests/tools.submit_application.test.ts
git commit -m "feat(tools): submit_application — mark submitted + event log"
```

---

## Task 6: `set_status` MCP tool

**Files:**
- Create: `src/tools/set_status.ts`, `tests/tools.set_status.test.ts`

Allows arbitrary status transitions (`draft|submitted|interviewing|rejected|offer`) with an event log entry.

- [ ] **Step 1: Failing test**

Create `tests/tools.set_status.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, getApplication, listEventsForApplication
} from '../src/store/application.ts';
import { setStatus } from '../src/tools/set_status.ts';

describe('tools/set_status', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
  });

  it('updates status and records event', async () => {
    const out = await setStatus(
      { applicationId: 'app1', status: 'interviewing' },
      { db }
    );
    expect(out.status).toBe('interviewing');
    expect(getApplication(db, 'app1')?.status).toBe('interviewing');
    const events = listEventsForApplication(db, 'app1');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('status_changed');
    expect(events[0].payload).toEqual({ from: 'draft', to: 'interviewing' });
  });

  it('rejects invalid status values', async () => {
    await expect(
      // @ts-expect-error - testing runtime validation
      setStatus({ applicationId: 'app1', status: 'banana' }, { db })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- set_status
```

- [ ] **Step 3: Implement**

Create `src/tools/set_status.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import {
  getApplication, updateApplicationStatus, addEventForApplication
} from '../store/application.ts';

export const setStatusInput = z.object({
  applicationId: z.string(),
  status: z.enum(['draft', 'submitted', 'interviewing', 'rejected', 'offer'])
});

export async function setStatus(
  input: z.infer<typeof setStatusInput>,
  ctx: { db: Db }
): Promise<{ applicationId: string; status: string }> {
  const before = getApplication(ctx.db, input.applicationId);
  if (!before) throw new Error(`unknown application: ${input.applicationId}`);

  updateApplicationStatus(ctx.db, input.applicationId, input.status);
  addEventForApplication(ctx.db, input.applicationId, 'status_changed', {
    from: before.status, to: input.status
  });

  return { applicationId: input.applicationId, status: input.status };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 84 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/set_status.ts tests/tools.set_status.test.ts
git commit -m "feat(tools): set_status — explicit status transitions + event"
```

---

## Task 7: `add_note` MCP tool

**Files:**
- Create: `src/tools/add_note.ts`, `tests/tools.add_note.test.ts`

Append a free-text note to an application's event log.

- [ ] **Step 1: Failing test**

Create `tests/tools.add_note.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication, listEventsForApplication } from '../src/store/application.ts';
import { addNote } from '../src/tools/add_note.ts';

describe('tools/add_note', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
    createApplication(db, {
      id: 'app1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: '# r', coverLetterMd: 'Hello',
      answerPack: {}, deepLink: 'https://x'
    });
  });

  it('records a note as an event', async () => {
    const out = await addNote(
      { applicationId: 'app1', text: 'recruiter emailed back' },
      { db }
    );
    expect(out.eventId).toBeTypeOf('string');
    const events = listEventsForApplication(db, 'app1');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('note');
    expect(events[0].payload).toEqual({ text: 'recruiter emailed back' });
  });

  it('rejects empty notes', async () => {
    await expect(
      addNote({ applicationId: 'app1', text: '' }, { db })
    ).rejects.toThrow();
  });

  it('throws on unknown application', async () => {
    await expect(
      addNote({ applicationId: 'nope', text: 'hi' }, { db })
    ).rejects.toThrow(/unknown application/);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- add_note
```

- [ ] **Step 3: Implement**

Create `src/tools/add_note.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { getApplication, addEventForApplication } from '../store/application.ts';

export const addNoteInput = z.object({
  applicationId: z.string(),
  text: z.string().min(1)
});

export async function addNote(
  input: z.infer<typeof addNoteInput>,
  ctx: { db: Db }
): Promise<{ eventId: string }> {
  const app = getApplication(ctx.db, input.applicationId);
  if (!app) throw new Error(`unknown application: ${input.applicationId}`);

  const event = addEventForApplication(
    ctx.db, input.applicationId, 'note', { text: input.text }
  );
  return { eventId: event.id };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 87 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/add_note.ts tests/tools.add_note.test.ts
git commit -m "feat(tools): add_note — append free-text note to event log"
```

---

## Task 8: `list_pipeline` MCP tool

**Files:**
- Create: `src/tools/list_pipeline.ts`, `tests/tools.list_pipeline.test.ts`

Returns the user's application pipeline with optional status filter. Joins job + company info into the output for readability.

- [ ] **Step 1: Failing test**

Create `tests/tools.list_pipeline.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import {
  createApplication, updateApplicationStatus
} from '../src/store/application.ts';
import { listPipeline } from '../src/tools/list_pipeline.ts';

describe('tools/list_pipeline', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertCompany(db, { id: 'airbnb', name: 'Airbnb', ats: 'greenhouse', atsOrgSlug: 'airbnb' });
    upsertJobs(db, [
      { id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://stripe', raw: {} },
      { id: 'g:airbnb:1', companyId: 'airbnb', title: 'Eng', url: 'https://airbnb', raw: {} }
    ]);
    addResume(db, { id: 'r1', label: 'Generic', rawText: 'r', parsed: {} });
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'a', coverLetterMd: 'a', answerPack: {}, deepLink: 'https://stripe'
    });
    createApplication(db, {
      id: 'a2', jobId: 'g:airbnb:1', resumeId: 'r1',
      tailoredResumeMd: 'b', coverLetterMd: 'b', answerPack: {}, deepLink: 'https://airbnb'
    });
    updateApplicationStatus(db, 'a2', 'submitted');
  });

  it('returns all applications with company + job context', async () => {
    const out = await listPipeline({}, { db });
    expect(out.items).toHaveLength(2);
    const names = out.items.map(i => i.company).sort();
    expect(names).toEqual(['Airbnb', 'Stripe']);
  });

  it('filters by status', async () => {
    const out = await listPipeline({ status: 'submitted' }, { db });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].company).toBe('Airbnb');
    expect(out.items[0].status).toBe('submitted');
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- list_pipeline
```

- [ ] **Step 3: Implement**

Create `src/tools/list_pipeline.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listApplications } from '../store/application.ts';
import { getJob } from '../store/job.ts';
import { getCompany } from '../store/company.ts';

export const listPipelineInput = z.object({
  status: z.enum(['draft', 'submitted', 'interviewing', 'rejected', 'offer']).optional()
});

export type PipelineItem = {
  applicationId: string;
  status: string;
  jobId: string;
  jobTitle: string;
  company: string;
  deepLink: string;
  createdAt: string;
  submittedAt?: string;
};

export async function listPipeline(
  input: z.infer<typeof listPipelineInput>,
  ctx: { db: Db }
): Promise<{ items: PipelineItem[] }> {
  const apps = listApplications(ctx.db, { status: input.status });
  const items: PipelineItem[] = apps.map(a => {
    const job = getJob(ctx.db, a.jobId);
    const company = job ? getCompany(ctx.db, job.companyId) : null;
    return {
      applicationId: a.id,
      status: a.status,
      jobId: a.jobId,
      jobTitle: job?.title ?? '(deleted)',
      company: company?.name ?? '(unknown)',
      deepLink: a.deepLink,
      createdAt: a.createdAt,
      submittedAt: a.submittedAt
    };
  });
  return { items };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 89 passing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/list_pipeline.ts tests/tools.list_pipeline.test.ts
git commit -m "feat(tools): list_pipeline — applications with job + company context"
```

---

## Task 9: Anti-spam guardrail service

**Files:**
- Create: `src/services/guardrail.ts`, `tests/services.guardrail.test.ts`

Three checks before drafting an application:
1. **Weekly cap**: ≤10 applications created in the trailing 7 days
2. **Low-fit refusal**: if a `score_fit` was previously cached for (job, resume) and the score is < 0.50, refuse unless `confirmLowFit=true`
3. **Duplicate detection**: if any non-rejected application already exists for (jobId, resumeId), refuse unless `allowDuplicate=true`

For M3, low-fit is informed by checking the `application` table for any prior application against the same job that was rejected (signal: don't apply again with the same résumé). The full sampling-based "live score" path is integrated separately. We keep this simple: refuse if a recent application for the same job already exists.

> **Scope decision:** the spec's "low-fit" rule wants a real live fit score. M3 ships the cap + dup checks; live-fit refusal lands in M4 once `score_fit` results are persisted to the application row. The `confirmLowFit` field is reserved on the schema so callers can opt in early.

- [ ] **Step 1: Failing test**

Create `tests/services.guardrail.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { createApplication } from '../src/store/application.ts';
import { checkGuardrail, WEEKLY_CAP } from '../src/services/guardrail.ts';

describe('services/guardrail', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{ id: 'g:stripe:1', companyId: 'stripe', title: 'PM', url: 'https://x', raw: {} }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('passes when no applications exist', () => {
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(true);
  });

  it('blocks when weekly cap is reached', () => {
    for (let i = 0; i < WEEKLY_CAP; i++) {
      createApplication(db, {
        id: `a${i}`, jobId: 'g:stripe:1', resumeId: 'r1',
        tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
      });
    }
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/weekly cap/i);
  });

  it('blocks duplicate non-rejected application for same job', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1' });
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/already.*application/i);
  });

  it('allows duplicate when allowDuplicate=true', () => {
    createApplication(db, {
      id: 'a1', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });
    const out = checkGuardrail(db, { jobId: 'g:stripe:1', resumeId: 'r1', allowDuplicate: true });
    expect(out.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- guardrail
```

- [ ] **Step 3: Implement**

Create `src/services/guardrail.ts`:

```ts
import type { Db } from '../store/db.ts';

export const WEEKLY_CAP = 10;
export const WEEKLY_WINDOW_MS = 7 * 86400_000;

export type GuardrailInput = {
  jobId: string;
  resumeId: string;
  allowDuplicate?: boolean;
  confirmLowFit?: boolean;  // reserved for M4 live-fit gate
};

export type GuardrailResult =
  | { allowed: true; warnings: string[] }
  | { allowed: false; reason: string };

export function checkGuardrail(db: Db, input: GuardrailInput): GuardrailResult {
  const warnings: string[] = [];

  // 1. Weekly cap
  const cutoff = new Date(Date.now() - WEEKLY_WINDOW_MS).toISOString();
  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM application WHERE created_at >= ?`
  ).get(cutoff) as { n: number }).n;
  if (count >= WEEKLY_CAP) {
    return {
      allowed: false,
      reason: `weekly cap reached (${count}/${WEEKLY_CAP} in the last 7 days). Quality > quantity — review your pipeline before adding more.`
    };
  }
  if (count >= Math.floor(WEEKLY_CAP * 0.8)) {
    warnings.push(`approaching weekly cap (${count}/${WEEKLY_CAP})`);
  }

  // 2. Duplicate detection
  if (!input.allowDuplicate) {
    const dup = db.prepare(`
      SELECT id, status FROM application
      WHERE job_id = ? AND status != 'rejected'
      LIMIT 1
    `).get(input.jobId) as { id: string; status: string } | undefined;
    if (dup) {
      return {
        allowed: false,
        reason: `already drafted an application (${dup.id}, status=${dup.status}) for this job. Pass allowDuplicate=true to override.`
      };
    }
  }

  return { allowed: true, warnings };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 93 passing.

- [ ] **Step 5: Commit**

```bash
git add src/services/guardrail.ts tests/services.guardrail.test.ts
git commit -m "feat(services): anti-spam guardrail (weekly cap + duplicate detection)"
```

---

## Task 10: Wire guardrail into `buildApplication`

**Files:**
- Modify: `src/services/buildApplication.ts`
- Modify: `src/tools/draft_application.ts`
- Modify: `tests/services.buildApplication.test.ts`

`buildApplication` calls `checkGuardrail` BEFORE the expensive sampling work. The `draft_application` tool surfaces the new optional fields (`allowDuplicate`).

- [ ] **Step 1: Failing test**

Append to `tests/services.buildApplication.test.ts`:

```ts
  it('refuses when guardrail blocks (duplicate)', async () => {
    // Create one existing application for the same job.
    const { createApplication } = await import('../src/store/application.ts');
    createApplication(db, {
      id: 'pre', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });

    const sampling = {
      complete: vi.fn(),
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    await expect(
      buildApplication({ jobId: 'g:stripe:1' }, { db, sampling })
    ).rejects.toThrow(/already.*application/i);
    expect(sampling.complete).not.toHaveBeenCalled();
  });

  it('proceeds when allowDuplicate=true', async () => {
    const { createApplication } = await import('../src/store/application.ts');
    createApplication(db, {
      id: 'pre', jobId: 'g:stripe:1', resumeId: 'r1',
      tailoredResumeMd: 'x', coverLetterMd: 'x', answerPack: {}, deepLink: 'https://x'
    });

    const sampling = {
      complete: vi.fn()
        .mockResolvedValueOnce('# Mohak\n\n- PM')
        .mockResolvedValueOnce('Dear hiring manager...'),
      completeJson: vi.fn()
    } as unknown as SamplingClient;

    const out = await buildApplication(
      { jobId: 'g:stripe:1', allowDuplicate: true },
      { db, sampling }
    );
    expect(out.applicationId).toBeTypeOf('string');
  });
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- buildApplication
```

- [ ] **Step 3: Implement**

In `src/services/buildApplication.ts`:

Add to imports:
```ts
import { checkGuardrail } from './guardrail.ts';
```

Update `BuildApplicationInput` to include the new fields:
```ts
export type BuildApplicationInput = {
  jobId: string;
  resumeId?: string;
  allowDuplicate?: boolean;
  confirmLowFit?: boolean;
};
```

Inside `buildApplication`, call the guardrail BEFORE `resolveResume`:

```ts
export async function buildApplication(
  input: BuildApplicationInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<BuildApplicationResult> {
  const job = getJob(ctx.db, input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  // Guardrail check before any sampling cost.
  // We use the explicit resumeId for the check if provided; otherwise we
  // pass a placeholder — the duplicate check is by-job not by-resume.
  const guardrail = checkGuardrail(ctx.db, {
    jobId: input.jobId,
    resumeId: input.resumeId ?? '',
    allowDuplicate: input.allowDuplicate,
    confirmLowFit: input.confirmLowFit
  });
  if (!guardrail.allowed) throw new Error(guardrail.reason);

  // ...rest unchanged: resolveResume, tailor, cover letter, persist...
```

- [ ] **Step 4: Update `src/tools/draft_application.ts`**

Update the input schema to include the guardrail flags:

```ts
export const draftApplicationInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional(),
  allowDuplicate: z.boolean().optional()
    .describe('Override duplicate-application refusal.'),
  confirmLowFit: z.boolean().optional()
    .describe('Reserved: override low-fit refusal (M4).')
});
```

(The `draftApplication` body already passes through `input` to `buildApplication` — no change needed there.)

- [ ] **Step 5: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 95 passing.

- [ ] **Step 6: Commit**

```bash
git add src/services/buildApplication.ts src/tools/draft_application.ts \
        tests/services.buildApplication.test.ts
git commit -m "feat(services): buildApplication uses guardrail before sampling"
```

---

## Task 11: Migration #3 — `workflow` table

**Files:**
- Modify: `src/store/migrations.ts`
- Modify: `tests/store.test.ts`

- [ ] **Step 1: Update test**

In `tests/store.test.ts`, update both the table-list assertion and the migrations-applied assertion:

```ts
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
    expect(names).toContain('workflow');
    expect(names).toContain('migrations');
  });

  // ...

  it('applied three migrations', () => {
    const db = openDb(':memory:');
    const ids = (db.prepare(`SELECT id FROM migrations ORDER BY id`).all() as Array<{ id: number }>).map(r => r.id);
    expect(ids).toEqual([1, 2, 3]);
  });
```

(Rename the existing "applied two migrations" test to "applied three migrations" and update its expectation.)

- [ ] **Step 2: Run tests (FAIL)**

```bash
npm test -- store.test
```

- [ ] **Step 3: Append migration #3**

In `src/store/migrations.ts`, after the existing migration #2, append:

```ts
  ,
  {
    id: 3,
    name: 'workflow',
    sql: `
      CREATE TABLE workflow (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        description TEXT NOT NULL,
        cron TEXT NOT NULL,
        params_json TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        last_status TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_workflow_next_run ON workflow(next_run_at);
    `
  }
```

- [ ] **Step 4: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 95 passing (test count unchanged because the existing tests just changed their assertions).

- [ ] **Step 5: Commit**

```bash
git add src/store/migrations.ts tests/store.test.ts
git commit -m "feat(store): migration #3 — workflow table"
```

---

## Task 12: workflow CRUD + workflowEngine (non-sampling)

**Files:**
- Modify: `package.json` (install `cron-parser`)
- Create: `src/store/workflow.ts`, `tests/store.workflow.test.ts`
- Create: `src/services/workflowEngine.ts`, `tests/services.workflowEngine.test.ts`

Two workflow kinds in M3:
- **`fetch_jobs_refresh`**: runs `fetch_jobs` (no sampling — just hits the ATS APIs and persists). Params: same filters as `fetch_jobs`.
- **`prune_old_jobs`**: deletes cached jobs older than N days. Params: `{ olderThanDays: number }`.

(Sampling-driven kinds like "tailor top 3" are M4.)

- [ ] **Step 1: Install dep**

```bash
npm install cron-parser
```

- [ ] **Step 2: Failing test for workflow CRUD**

Create `tests/store.workflow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import {
  createWorkflow, getWorkflow, listWorkflows,
  listDueWorkflows, recordWorkflowRun
} from '../src/store/workflow.ts';

describe('store/workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('creates and reads back a workflow', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'w1', kind: 'fetch_jobs_refresh',
      description: 'Refresh PM roles weekly',
      cron: '0 9 * * 1', params: { titleContains: 'PM' },
      nextRunAt: future
    });
    const w = getWorkflow(db, 'w1');
    expect(w?.kind).toBe('fetch_jobs_refresh');
    expect(w?.params).toEqual({ titleContains: 'PM' });
  });

  it('lists workflows newest first', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'a', kind: 'prune_old_jobs', description: 'a',
      cron: '0 0 * * *', params: { olderThanDays: 60 }, nextRunAt: future
    });
    createWorkflow(db, {
      id: 'b', kind: 'fetch_jobs_refresh', description: 'b',
      cron: '0 9 * * 1', params: {}, nextRunAt: future
    });
    expect(listWorkflows(db).map(w => w.id)).toEqual(['b', 'a']);
  });

  it('listDueWorkflows returns only those with next_run_at <= now', () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    createWorkflow(db, {
      id: 'due', kind: 'prune_old_jobs', description: 'd',
      cron: '0 0 * * *', params: {}, nextRunAt: past
    });
    createWorkflow(db, {
      id: 'later', kind: 'prune_old_jobs', description: 'l',
      cron: '0 0 * * *', params: {}, nextRunAt: future
    });
    expect(listDueWorkflows(db).map(w => w.id)).toEqual(['due']);
  });

  it('recordWorkflowRun updates last_run_at, last_status, next_run_at', () => {
    createWorkflow(db, {
      id: 'w', kind: 'prune_old_jobs', description: 'd',
      cron: '0 0 * * *', params: {}, nextRunAt: new Date(Date.now() - 60_000).toISOString()
    });
    const next = new Date(Date.now() + 86400_000).toISOString();
    recordWorkflowRun(db, 'w', { status: 'ok', nextRunAt: next });
    const w = getWorkflow(db, 'w');
    expect(w?.lastStatus).toBe('ok');
    expect(w?.nextRunAt).toBe(next);
    expect(w?.lastRunAt).toBeTypeOf('string');
  });
});
```

- [ ] **Step 3: Run test (FAIL)**

```bash
npm test -- store.workflow
```

- [ ] **Step 4: Implement workflow CRUD**

Create `src/store/workflow.ts`:

```ts
import type { Db } from './db.ts';

export type WorkflowKind = 'fetch_jobs_refresh' | 'prune_old_jobs';

export type Workflow = {
  id: string;
  kind: WorkflowKind;
  description: string;
  cron: string;
  params: Record<string, unknown>;
  lastRunAt?: string;
  nextRunAt: string;
  lastStatus?: 'ok' | 'error';
  lastError?: string;
  createdAt: string;
};

export type WorkflowInput = {
  id: string;
  kind: WorkflowKind;
  description: string;
  cron: string;
  params: Record<string, unknown>;
  nextRunAt: string;
};

const SELECT = `
  SELECT id, kind, description, cron, params_json,
         last_run_at AS lastRunAt, next_run_at AS nextRunAt,
         last_status AS lastStatus, last_error AS lastError,
         created_at AS createdAt
  FROM workflow
`;

type Row = {
  id: string; kind: WorkflowKind; description: string; cron: string;
  params_json: string; lastRunAt: string | null; nextRunAt: string;
  lastStatus: 'ok' | 'error' | null; lastError: string | null;
  createdAt: string;
};

function rowToWorkflow(r: Row): Workflow {
  return {
    id: r.id, kind: r.kind, description: r.description, cron: r.cron,
    params: JSON.parse(r.params_json) as Record<string, unknown>,
    lastRunAt: r.lastRunAt ?? undefined,
    nextRunAt: r.nextRunAt,
    lastStatus: r.lastStatus ?? undefined,
    lastError: r.lastError ?? undefined,
    createdAt: r.createdAt
  };
}

export function createWorkflow(db: Db, input: WorkflowInput): Workflow {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO workflow (
      id, kind, description, cron, params_json,
      last_run_at, next_run_at, last_status, last_error, created_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)
  `).run(
    input.id, input.kind, input.description, input.cron,
    JSON.stringify(input.params), input.nextRunAt, createdAt
  );
  return { ...input, createdAt };
}

export function getWorkflow(db: Db, id: string): Workflow | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToWorkflow(r) : null;
}

export function listWorkflows(db: Db): Workflow[] {
  const rows = db.prepare(`${SELECT} ORDER BY created_at DESC, rowid DESC`).all() as Row[];
  return rows.map(rowToWorkflow);
}

export function listDueWorkflows(db: Db): Workflow[] {
  const now = new Date().toISOString();
  const rows = db.prepare(`${SELECT} WHERE next_run_at <= ? ORDER BY next_run_at ASC`).all(now) as Row[];
  return rows.map(rowToWorkflow);
}

export function recordWorkflowRun(
  db: Db,
  id: string,
  result: { status: 'ok' | 'error'; error?: string; nextRunAt: string }
): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE workflow
    SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?
    WHERE id = ?
  `).run(now, result.status, result.error ?? null, result.nextRunAt, id);
}
```

- [ ] **Step 5: Failing test for workflowEngine**

Create `tests/services.workflowEngine.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs, listJobs } from '../src/store/job.ts';
import { runWorkflowKind } from '../src/services/workflowEngine.ts';

describe('services/workflowEngine', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('runs prune_old_jobs and removes ancient jobs', async () => {
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [
      { id: 'old', companyId: 'stripe', title: 'old', url: 'https://x', raw: {},
        postedAt: '2020-01-01T00:00:00Z' },
      { id: 'new', companyId: 'stripe', title: 'new', url: 'https://y', raw: {},
        postedAt: new Date().toISOString() }
    ]);

    // Manually backdate 'old' so its last_seen_at is also 2020.
    db.prepare(`UPDATE job SET last_seen_at = '2020-01-01T00:00:00Z' WHERE id = 'old'`).run();

    const out = await runWorkflowKind(db, 'prune_old_jobs', { olderThanDays: 30 });
    expect(out.status).toBe('ok');
    expect(listJobs(db).map(j => j.id).sort()).toEqual(['new']);
  });

  it('returns error for unknown workflow kind', async () => {
    const out = await runWorkflowKind(db, 'unknown' as never, {});
    expect(out.status).toBe('error');
    expect(out.error).toMatch(/unknown.*workflow.*kind/i);
  });
});
```

- [ ] **Step 6: Run test (FAIL)**

```bash
npm test -- workflowEngine
```

- [ ] **Step 7: Implement engine**

Create `src/services/workflowEngine.ts`:

```ts
import type { Db } from '../store/db.ts';
import type { WorkflowKind } from '../store/workflow.ts';
import { fetchJobs, fetchJobsInput } from '../tools/fetch_jobs.ts';

export type WorkflowRunResult = {
  status: 'ok' | 'error';
  error?: string;
  summary?: Record<string, unknown>;
};

export async function runWorkflowKind(
  db: Db,
  kind: WorkflowKind | string,
  params: Record<string, unknown>
): Promise<WorkflowRunResult> {
  try {
    if (kind === 'prune_old_jobs') {
      const olderThanDays = (params.olderThanDays as number | undefined) ?? 60;
      const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
      const result = db.prepare(
        `DELETE FROM job WHERE last_seen_at < ?`
      ).run(cutoff);
      return { status: 'ok', summary: { deleted: result.changes } };
    }

    if (kind === 'fetch_jobs_refresh') {
      const filters = fetchJobsInput.parse(params);
      const out = await fetchJobs(filters, { db });
      return { status: 'ok', summary: { fetched: out.meta.fetched, errors: out.meta.errors.length } };
    }

    return { status: 'error', error: `unknown workflow kind: ${kind}` };
  } catch (e) {
    return { status: 'error', error: (e as Error).message };
  }
}
```

- [ ] **Step 8: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 100 passing (95 + 5 across the two new test files).

- [ ] **Step 9: Commit**

```bash
git add src/store/workflow.ts tests/store.workflow.test.ts \
        src/services/workflowEngine.ts tests/services.workflowEngine.test.ts \
        package.json package-lock.json
git commit -m "feat(workflow): workflow CRUD + non-sampling engine"
```

---

## Task 13: `schedule_workflow` + `run_workflow` MCP tools

**Files:**
- Create: `src/tools/schedule_workflow.ts`, `tests/tools.schedule_workflow.test.ts`
- Create: `src/tools/run_workflow.ts`, `tests/tools.run_workflow.test.ts`

`schedule_workflow` takes a kind, a cron expression, params, and a description. Validates the cron expression with `cron-parser`, computes the first `nextRunAt`, persists.

`run_workflow` takes a workflow id, runs it via `runWorkflowKind`, records the result, and computes the next run.

- [ ] **Step 1: Failing test for schedule_workflow**

Create `tests/tools.schedule_workflow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listWorkflows } from '../src/store/workflow.ts';
import { scheduleWorkflow } from '../src/tools/schedule_workflow.ts';

describe('tools/schedule_workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('persists a workflow with computed nextRunAt', async () => {
    const out = await scheduleWorkflow({
      kind: 'prune_old_jobs',
      cron: '0 0 * * *',
      description: 'nightly prune',
      params: { olderThanDays: 60 }
    }, { db });
    expect(out.workflowId).toBeTypeOf('string');
    expect(new Date(out.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(listWorkflows(db)).toHaveLength(1);
  });

  it('rejects an invalid cron expression', async () => {
    await expect(
      scheduleWorkflow({
        kind: 'prune_old_jobs',
        cron: 'not a cron',
        description: 'x', params: {}
      }, { db })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- schedule_workflow
```

- [ ] **Step 3: Implement schedule_workflow**

Create `src/tools/schedule_workflow.ts`:

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import type { Db } from '../store/db.ts';
import { createWorkflow } from '../store/workflow.ts';

export const scheduleWorkflowInput = z.object({
  kind: z.enum(['fetch_jobs_refresh', 'prune_old_jobs']),
  cron: z.string().min(1)
    .describe("Cron expression in standard 5-field format (e.g., '0 9 * * 1' for 9am Mondays)."),
  description: z.string().min(1),
  params: z.record(z.unknown()).default({})
});

export type ScheduleWorkflowInput = z.infer<typeof scheduleWorkflowInput>;

export async function scheduleWorkflow(
  input: ScheduleWorkflowInput,
  ctx: { db: Db }
): Promise<{ workflowId: string; nextRunAt: string }> {
  let nextRunAt: string;
  try {
    const interval = CronExpressionParser.parse(input.cron, { currentDate: new Date() });
    nextRunAt = interval.next().toDate().toISOString();
  } catch (e) {
    throw new Error(`invalid cron expression "${input.cron}": ${(e as Error).message}`);
  }

  const id = randomUUID();
  createWorkflow(ctx.db, {
    id, kind: input.kind, description: input.description,
    cron: input.cron, params: input.params, nextRunAt
  });
  return { workflowId: id, nextRunAt };
}
```

- [ ] **Step 4: Failing test for run_workflow**

Create `tests/tools.run_workflow.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs, listJobs } from '../src/store/job.ts';
import { createWorkflow, getWorkflow } from '../src/store/workflow.ts';
import { runWorkflow } from '../src/tools/run_workflow.ts';

describe('tools/run_workflow', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'old', companyId: 'stripe', title: 'old', url: 'https://x',
      raw: {}, postedAt: '2020-01-01T00:00:00Z'
    }]);
    db.prepare(`UPDATE job SET last_seen_at = '2020-01-01T00:00:00Z' WHERE id = 'old'`).run();
  });

  it('runs the workflow and records ok status + advances next_run_at', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    createWorkflow(db, {
      id: 'w1', kind: 'prune_old_jobs', description: 'nightly prune',
      cron: '0 0 * * *', params: { olderThanDays: 30 },
      nextRunAt: past
    });
    const out = await runWorkflow({ workflowId: 'w1' }, { db });
    expect(out.status).toBe('ok');
    expect(out.summary).toEqual({ deleted: 1 });
    expect(listJobs(db)).toHaveLength(0);

    const w = getWorkflow(db, 'w1');
    expect(w?.lastStatus).toBe('ok');
    expect(new Date(w!.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('throws on unknown workflow', async () => {
    await expect(runWorkflow({ workflowId: 'nope' }, { db })).rejects.toThrow(/unknown workflow/);
  });
});
```

- [ ] **Step 5: Run test (FAIL)**

```bash
npm test -- run_workflow
```

- [ ] **Step 6: Implement run_workflow**

Create `src/tools/run_workflow.ts`:

```ts
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';
import type { Db } from '../store/db.ts';
import { getWorkflow, recordWorkflowRun } from '../store/workflow.ts';
import { runWorkflowKind } from '../services/workflowEngine.ts';

export const runWorkflowInput = z.object({
  workflowId: z.string()
});

export async function runWorkflow(
  input: z.infer<typeof runWorkflowInput>,
  ctx: { db: Db }
): Promise<{
  workflowId: string;
  status: 'ok' | 'error';
  error?: string;
  summary?: Record<string, unknown>;
  nextRunAt: string;
}> {
  const wf = getWorkflow(ctx.db, input.workflowId);
  if (!wf) throw new Error(`unknown workflow: ${input.workflowId}`);

  const result = await runWorkflowKind(ctx.db, wf.kind, wf.params);

  // Compute next run from the cron expression.
  const interval = CronExpressionParser.parse(wf.cron, { currentDate: new Date() });
  const nextRunAt = interval.next().toDate().toISOString();

  recordWorkflowRun(ctx.db, wf.id, {
    status: result.status, error: result.error, nextRunAt
  });

  return {
    workflowId: wf.id,
    status: result.status,
    error: result.error,
    summary: result.summary,
    nextRunAt
  };
}
```

- [ ] **Step 7: Run tests + lint**

```bash
npm test && npm run lint
```
Expected: 104 passing.

- [ ] **Step 8: Commit**

```bash
git add src/tools/schedule_workflow.ts tests/tools.schedule_workflow.test.ts \
        src/tools/run_workflow.ts tests/tools.run_workflow.test.ts
git commit -m "feat(tools): schedule_workflow + run_workflow"
```

---

## Task 14: `crosswalk-mcp run-scheduled` CLI subcommand

**Files:**
- Modify: `src/cli.ts`

The user adds a single cron line on their machine (e.g., `* * * * * /usr/local/bin/crosswalk-mcp run-scheduled`). Each invocation finds workflows where `next_run_at <= now`, runs them, records results, advances `next_run_at`. The MCP server itself doesn't need to be running — this is a one-shot CLI.

- [ ] **Step 1: Update `main()` dispatch in `src/cli.ts`**

Locate the existing `main()` function and add a `run-scheduled` branch. The dispatch currently handles `undefined` (start server), `install`, `--version`, `--help`. Add this new branch:

```ts
  if (cmd === 'run-scheduled') {
    const { openDb } = await import('./store/db.ts');
    const { listDueWorkflows, recordWorkflowRun } = await import('./store/workflow.ts');
    const { runWorkflowKind } = await import('./services/workflowEngine.ts');
    const { CronExpressionParser } = await import('cron-parser');
    const db = openDb();
    const due = listDueWorkflows(db);
    if (due.length === 0) {
      console.log('No workflows due.');
      return;
    }
    for (const wf of due) {
      const result = await runWorkflowKind(db, wf.kind, wf.params);
      const interval = CronExpressionParser.parse(wf.cron, { currentDate: new Date() });
      const nextRunAt = interval.next().toDate().toISOString();
      recordWorkflowRun(db, wf.id, { status: result.status, error: result.error, nextRunAt });
      console.log(
        `[${result.status}] ${wf.id} (${wf.kind}) — next run ${nextRunAt}` +
        (result.error ? ` (error: ${result.error})` : '')
      );
    }
    return;
  }
```

Also update the `--help` text to mention the new subcommand:

```ts
  if (cmd === '--help' || cmd === '-h') {
    console.log(`Usage:
  crosswalk-mcp                 # run as MCP server (used by Claude Desktop)
  crosswalk-mcp install         # add to Claude Desktop config
  crosswalk-mcp run-scheduled   # run any workflows whose next_run_at has passed
  crosswalk-mcp --version       # print version
  crosswalk-mcp --help          # show this message`);
    return;
  }
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```
Expected: clean. `dist/cli.js` should now contain the `run-scheduled` branch.

- [ ] **Step 3: Smoke test**

```bash
node dist/cli.js run-scheduled
```
Expected: prints `No workflows due.` and exits 0 (no workflows have been scheduled yet).

- [ ] **Step 4: Run full suite + lint**

```bash
npm test && npm run lint
```
Expected: 104 passing, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): run-scheduled subcommand for cron-driven workflows"
```

---

## Task 15: Wire 6 new tools, README, version 0.2.0

**Files:**
- Modify: `src/tools/index.ts`
- Modify: `tests/server.tools.test.ts`
- Modify: `README.md`
- Modify: `package.json` (version 0.1.0 → 0.2.0)

- [ ] **Step 1: Update server.tools test**

Replace contents of `tests/server.tools.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';

describe('server tools registration', () => {
  it('exports all 14 v1 tools', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    const names = toolDefinitions.map(t => t.name).sort();
    expect(names).toEqual([
      'add_note', 'add_resume', 'draft_application', 'explain_fit',
      'fetch_jobs', 'list_pipeline', 'list_resumes', 'run_workflow',
      'schedule_workflow', 'score_fit', 'set_status',
      'setup_profile', 'submit_application', 'tailor_resume'
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

- [ ] **Step 2: Run test (FAIL)**

```bash
npm test -- server.tools
```

- [ ] **Step 3: Register new tools in `src/tools/index.ts`**

Add 6 new imports near the existing tool imports:

```ts
import { submitApplication, submitApplicationInput } from './submit_application.ts';
import { setStatus, setStatusInput } from './set_status.ts';
import { addNote, addNoteInput } from './add_note.ts';
import { listPipeline, listPipelineInput } from './list_pipeline.ts';
import { scheduleWorkflow, scheduleWorkflowInput } from './schedule_workflow.ts';
import { runWorkflow, runWorkflowInput } from './run_workflow.ts';
```

Append 6 new entries to the `toolDefinitions` array (after `draftApplication`):

```ts
  ,
  {
    name: 'submit_application',
    description: 'Mark an application as submitted (after the user clicks "Apply" in their browser).',
    inputSchema: zodToJsonSchema(submitApplicationInput),
    run: (i, c) => submitApplication(submitApplicationInput.parse(i), c)
  },
  {
    name: 'set_status',
    description: 'Change an application status (draft, submitted, interviewing, rejected, offer).',
    inputSchema: zodToJsonSchema(setStatusInput),
    run: (i, c) => setStatus(setStatusInput.parse(i), c)
  },
  {
    name: 'add_note',
    description: 'Append a note to an application (e.g., "recruiter emailed back").',
    inputSchema: zodToJsonSchema(addNoteInput),
    run: (i, c) => addNote(addNoteInput.parse(i), c)
  },
  {
    name: 'list_pipeline',
    description: 'List your application pipeline with company + job context. Filter by status if desired.',
    inputSchema: zodToJsonSchema(listPipelineInput),
    run: (i, c) => listPipeline(listPipelineInput.parse(i), c)
  },
  {
    name: 'schedule_workflow',
    description: 'Schedule a recurring non-sampling workflow (e.g., refresh job cache every Monday). Run via cron + `crosswalk-mcp run-scheduled`.',
    inputSchema: zodToJsonSchema(scheduleWorkflowInput),
    run: (i, c) => scheduleWorkflow(scheduleWorkflowInput.parse(i), c)
  },
  {
    name: 'run_workflow',
    description: 'Manually run a previously scheduled workflow now.',
    inputSchema: zodToJsonSchema(runWorkflowInput),
    run: (i, c) => runWorkflow(runWorkflowInput.parse(i), c)
  }
```

- [ ] **Step 4: Update README**

In `README.md`, change `## What it does (M2)` → `## What it does (M3)`. Replace the existing 8-row tool table with the full 14-row version:

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
| `draft_application` | Build a complete application bundle (tailored resume + cover letter + deep link), persisted as a tracked draft. Anti-spam guardrail enforces a weekly cap and refuses obvious duplicates. |
| `submit_application` | Mark an application submitted after you click Apply in your browser. |
| `set_status` | Update an application status (interviewing, rejected, offer, etc.). |
| `add_note` | Append a free-text note to an application's event log. |
| `list_pipeline` | List your applications with company + job context, optionally filtered by status. |
| `schedule_workflow` | Schedule a non-sampling recurring workflow (job-cache refresh, old-job pruning) via cron expression. |
| `run_workflow` | Manually run a scheduled workflow now. |
```

Update the Roadmap table:

```markdown
| Version | Headline |
|---|---|
| M1 | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| **M3 (this release)** | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 7 more ATS adapters; registry to 200+ companies; install polish |
| v2 | Autonomous apply via Playwright in a sandbox |
```

Add a new section to the README, placed right before the "## Development" section:

````markdown
## Scheduled workflows (optional)

Crosswalk can run **non-sampling** workflows (job cache refresh, old-job pruning) on a schedule. These don't need the AI host to be running — Crosswalk pokes the ATS APIs directly.

Schedule one in chat:

> *"Schedule a workflow to refresh PM jobs at H-1B sponsors every Monday at 9 AM."*

Then add a single line to your crontab to actually invoke them:

```
* * * * * /usr/local/bin/crosswalk-mcp run-scheduled >> ~/.crosswalk/scheduler.log 2>&1
```

Sampling-driven workflows (e.g., "tailor the top 3 fits") are a v2 feature — they need a live AI host.

````

- [ ] **Step 5: Bump version**

In `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 6: Final test + lint + build**

```bash
npm test && npm run lint && npm run build
```
Expected: all green; `dist/server.js` and `dist/cli.js` produced.

- [ ] **Step 7: Smoke run**

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; wait $SVR 2>/dev/null; echo "ok"
```
Expected: `ok`.

- [ ] **Step 8: Commit**

```bash
git add src/tools/index.ts tests/server.tools.test.ts README.md package.json
git commit -m "feat(server): register 6 M3 tools; bump 0.2.0"
```

---

## Self-review checklist (before declaring M3 done)

- [ ] All 15 tasks completed; all tests passing.
- [ ] Build clean, smoke run boots cleanly.
- [ ] Tool registry reports 14 tools (`tools/list` MCP request returns 14 entries).
- [ ] Anti-spam guardrail blocks duplicates and weekly-cap, with `allowDuplicate` override exposed.
- [ ] `schedule_workflow` accepts a valid cron expression and rejects invalid ones.
- [ ] `crosswalk-mcp run-scheduled` runs due workflows and exits cleanly.
- [ ] No model-provider keys in repo. Sampling is still the only LLM path.

---

**End of M3 plan.**
