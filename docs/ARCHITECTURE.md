# Crosswalk — Architecture & Design Document

**Version:** v0.3.0 (M4) · **Last updated:** 2026-05-01

This document explains how Crosswalk works, why it's built the way it is, and where every piece lives. Read the [README](../README.md) first for the pitch and quick start; this doc is the deep dive.

---

## Table of contents

1. [What Crosswalk is](#what-crosswalk-is)
2. [The problem it solves](#the-problem-it-solves)
3. [The six structural bets](#the-six-structural-bets)
4. [High-level architecture](#high-level-architecture)
5. [Component breakdown](#component-breakdown)
6. [Data model (SQLite)](#data-model-sqlite)
7. [The 16 MCP tools](#the-16-mcp-tools)
8. [The 8 ATS adapters](#the-8-ats-adapters)
9. [Anti-spam guardrail](#anti-spam-guardrail)
10. [Scheduled workflows](#scheduled-workflows)
11. [MCP sampling — the keystone bet](#mcp-sampling--the-keystone-bet)
12. [Privacy & local-first](#privacy--local-first)
13. [Build & distribution](#build--distribution)
14. [Testing approach](#testing-approach)
15. [Compatibility matrix](#compatibility-matrix)
16. [Development guide](#development-guide)
17. [Roadmap](#roadmap)
18. [File structure reference](#file-structure-reference)

---

## What Crosswalk is

Crosswalk is an **MCP server** — a small process that speaks the Model Context Protocol over stdio. You install it once into your AI client (Claude Desktop, Cursor, etc.), and your AI gains 16 new tools for finding jobs, scoring fit, tailoring resumes, drafting applications, tracking your pipeline, and scheduling background workflows.

Critically, **Crosswalk has no AI of its own.** Every prompt — fit scoring, resume tailoring, cover letter drafting — runs through the host AI client's model via [MCP sampling](#mcp-sampling--the-keystone-bet). The user's AI is the AI; Crosswalk is the orchestration.

---

## The problem it solves

The job-search market is broken in three ways at once:

1. **AI job boards keep your data and use it badly.** "Upload your resume, we'll match you" produces 5%-fit hits because their matchers don't know about your taste, history, or what you've already tried. Your conversations with your real AI assistant *do* know all of that — but the job board doesn't have access to them.

2. **Recruiter mass-spamming is winning.** Auto-apply tools fire 100–500 applications a day. Recruiters now match on increasingly buried criteria. Quality applications get drowned in noise.

3. **The actual data is hostile.** Career pages are JS-rendered; copy-pasting JDs into chat strips formatting and salaries; web search returns cached pages, 90% of which aren't live anymore.

Crosswalk's wedge: **let the AI you already pay for do the job hunting, with direct access to live ATS feeds, your stored profile, and your past applications — while keeping all of that data on your machine.**

---

## The six structural bets

Each of these is a deliberate architectural commitment. Drop any one of them and Crosswalk collapses into a worse jobos.us:

### 1. Zero-API-key MCP (sampling)

Every LLM call goes through MCP `sampling`, which the host AI client owns. Crosswalk has no provider SDK, no `OPENAI_API_KEY`, no rate limits, no AI bill.

**Why it matters:** the user already pays for their AI. Asking them to pay again, hand over data, and use a worse model than they prefer is the entire problem with AI job boards.

### 2. Local-first SQLite

Profile, resumes, cached jobs, applications, notes, scheduled workflows — all in `~/.crosswalk/state.db`. No signup. No cloud. No data exfil.

**Why it matters:** you can `git`-version it, back it up to your own backup tool, audit what's stored, or rip it out at will.

### 3. Applications-as-PRs

Each application is a reviewable artifact: tailored resume + cover letter + answer pack + deep link, all persisted with a status (`draft → submitted → interviewing → rejected | offer`) and an event log of changes.

**Why it matters:** "auto-apply" tools that fire and forget produce bad applications. Treating each application as a code-review-style artifact means the user *sees* what's being sent before submitting.

### 4. Anti-spam by design

Crosswalk *refuses* to draft an 11th application in 7 days, and refuses duplicates against the same job. The user can override with `allowDuplicate: true` but has to ask.

**Why it matters:** every other job tool optimizes for application count. The actual failure mode in the job market is recruiters drowning in low-quality drafts. Crosswalk leans the other direction.

### 5. Open Job Graph

The company → ATS registry is a checked-in, MIT-licensed JSON file at `registry/companies.json`. Anyone can PR a new company.

**Why it matters:** building proprietary registries is expensive and stale. An open dataset compounds via community contribution and serves as discoverable infrastructure for any other tool.

### 6. Scheduled non-sampling workflows

Crosswalk runs background jobs (refresh the cache, prune old listings) on a cron schedule via `crosswalk-mcp run-scheduled`. These don't need the AI host running — they directly hit ATS APIs and write to SQLite.

**Why it matters:** "while you sleep" automation is a big differentiator from chat-only tools. Sampling-driven workflows (which need the live host) are M5.

---

## High-level architecture

```
┌──────────────────────────────────────────────────────────────────┐
│   Claude Desktop / Cursor / any MCP-with-sampling host           │
│                                                                  │
│   ┌─────────────────┐    ┌──────────────────────────────────┐    │
│   │  Host LLM       │◄───┤  MCP `sampling` (createMessage)  │    │
│   │  (Sonnet 4.6,   │    └────────────┬─────────────────────┘    │
│   │   GPT-5, etc.)  │                 │                          │
│   └─────────────────┘                 │                          │
│                                       │ stdio                    │
└───────────────────────────────────────┼──────────────────────────┘
                                        │
                                        ▼
   ┌────────────────────────────────────────────────────────────┐
   │   crosswalk-mcp (Node 24 ESM, ~38 KB bundled)              │
   │                                                            │
   │   ┌──────────────────────────────────────────────────┐     │
   │   │  Tools (16)                                      │     │
   │   │  setup_profile · add_resume · list_resumes ·     │     │
   │   │  fetch_jobs · score_fit · explain_fit ·          │     │
   │   │  tailor_resume · draft_application ·             │     │
   │   │  submit_application · set_status · add_note ·    │     │
   │   │  list_pipeline · schedule_workflow ·             │     │
   │   │  run_workflow · list_workflows · delete_workflow │     │
   │   └────────────┬────────────────────────────┬────────┘     │
   │                │                            │              │
   │                ▼                            ▼              │
   │   ┌────────────────────┐         ┌─────────────────────┐   │
   │   │  Services          │         │  ATS adapters (8)   │   │
   │   │  resolveResume     │         │  greenhouse · lever │   │
   │   │  pickResume        │         │  ashby · workable   │   │
   │   │  tailorResume      │         │  smartrecruiters    │   │
   │   │  coverLetter       │         │  bamboohr · recru…  │   │
   │   │  buildApplication  │         │  personio (XML)     │   │
   │   │  guardrail         │         └──────────┬──────────┘   │
   │   │  workflowEngine    │                    │              │
   │   └─────────┬──────────┘                    ▼              │
   │             │                    Public ATS HTTP APIs      │
   │             ▼                                              │
   │   ┌────────────────────┐  ┌───────────────────────────┐    │
   │   │  Sampling client   │  │  Exporters                │    │
   │   │  (retry, JSON-mode)│  │  html (marked) · docx     │    │
   │   └────────────────────┘  └───────────────────────────┘    │
   │             │                                              │
   │             ▼                                              │
   │   ┌────────────────────────────────────────────────────┐   │
   │   │  SQLite store (~/.crosswalk/state.db, WAL)         │   │
   │   │  ┌─profile──┐  ┌─resume───┐  ┌─company──┐  ┌─job─┐ │   │
   │   │  └──────────┘  └──────────┘  └──────────┘  └─────┘ │   │
   │   │  ┌─application──┐  ┌─application_event──┐          │   │
   │   │  └──────────────┘  └────────────────────┘          │   │
   │   │  ┌─workflow─┐  ┌─migrations──┐                     │   │
   │   │  └──────────┘  └─────────────┘                     │   │
   │   └────────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────────┘
                                │
                                ▼
                     ┌────────────────────────┐
                     │  registry/             │
                     │   companies.json (51)  │
                     │   h1b.json             │
                     └────────────────────────┘
```

---

## Component breakdown

Every layer has one job. Files are kept small; nothing exceeds ~250 lines.

### `src/server.ts` — MCP server entry point

Boots the SQLite store, seeds the company registry on first run, instantiates the MCP `Server`, wires `tools/list`, `tools/call`, `resources/list`, `resources/read` request handlers, and connects over stdio. Imports each adapter for its self-registration side effect. Exports `bootstrap()` (used by tests) and `main()` (used when invoked directly).

### `src/cli.ts` — install + scheduler CLI

Three subcommands:

- `crosswalk-mcp` (no args) — runs the MCP server (this is what Claude Desktop spawns).
- `crosswalk-mcp install` — writes the `mcpServers.crosswalk-mcp` entry into `~/Library/Application Support/Claude/claude_desktop_config.json` (or the OS-equivalent path).
- `crosswalk-mcp run-scheduled` — claim-loops over due workflows, executes each one, advances `next_run_at` via cron-parser. Designed to be invoked from cron once a minute.
- `crosswalk-mcp --version` / `--help` — diagnostics.

The main-guard uses `pathToFileURL(process.argv[1]).href === import.meta.url` so it works on macOS paths with spaces (e.g., `~/Library/Application Support/...`).

### `src/config.ts` — paths

Tiny module that resolves `paths.stateDir()`, `paths.dbFile()`, `paths.registryDir()`. Reads `CROSSWALK_HOME` env var lazily so tests can override it without restarting the process.

### `src/store/` — SQLite persistence layer

- `db.ts` — opens the SQLite database, sets WAL + foreign-keys pragmas, runs migrations, exports `Db` type alias.
- `migrations.ts` — three migrations (init, application + application_event, workflow). Each runs inside a transaction so partial schema changes can't land.
- `profile.ts` — single-row CRUD for the user's profile (typed as `Record<string, unknown>` to accept any shape the LLM extracts).
- `resume.ts` — multi-row CRUD with `addResume`, `listResumes`, `getResume`. Ordering uses `created_at DESC, rowid DESC` so same-millisecond inserts stay deterministic.
- `company.ts` — `upsertCompany`, `listCompaniesByAts`, `listAllCompanies`, `getCompany`, `seedCompaniesFrom`. The `ats` field is a literal union of all 8 supported ATS slugs.
- `job.ts` — `upsertJobs`, `listJobs`, `getJob`. Filters: `sinceDays`, `titleContains`, `companyIds`, `locationContains`, `remoteOnly`, `limit`.
- `application.ts` — `createApplication`, `getApplication`, `listApplications` (filtered), `updateApplicationStatus`, `addEventForApplication` (with `randomUUID` ids), `listEventsForApplication`. Submission timestamps are stamped only when status transitions to `submitted`.
- `workflow.ts` — `createWorkflow`, `getWorkflow`, `listWorkflows`, `listDueWorkflows`, `claimDueWorkflow` (atomic), `recordWorkflowRun`, `deleteWorkflow`.

### `src/sampling/client.ts` — MCP sampling wrapper

Wraps `Server.createMessage()` with:

- **Retry once** on transient failure
- **JSON mode** via `completeJson<T>()` — appends "Respond ONLY with valid JSON" to the system prompt and strips code fences from the response

Exports `SamplingClient` class with two methods: `complete(opts)` for free-form text, `completeJson<T>(opts)` for typed JSON output.

### `src/ats/` — ATS adapter framework + 8 adapters

- `types.ts` — `NormalizedJob` (the canonical shape) and `ATSAdapter` (the interface).
- `adapter.ts` — runtime registry: `registerAdapter()`, `getAdapter()`, `listRegisteredAdapters()`. Module-level `Map<string, ATSAdapter>`. Adapters self-register on import.
- `util.ts` — shared `withinSinceDays` helper (DRY'd in M4 once we hit 4+ adapters).
- `greenhouse.ts`, `lever.ts`, `ashby.ts`, `workable.ts`, `smartrecruiters.ts`, `bamboohr.ts`, `recruitee.ts`, `personio.ts` — one file each. Greenhouse, Lever, Ashby, Ashby, Workable, SmartRecruiters, BambooHR, Recruitee return JSON; Personio returns XML (parsed via `fast-xml-parser`).

Each adapter:
1. Hits a single public endpoint
2. Normalizes the response to `NormalizedJob[]`
3. Filters by `opts.sinceDays`
4. Self-registers via `registerAdapter(...)`

### `src/services/` — business logic

These are pure functions that take a `Db` + `SamplingClient` and don't know about MCP. They're the layer that the tools call.

- `constants.ts` — `JD_CHARS_PICKER` (4000), `JD_CHARS_TAILOR` (6000), `JD_CHARS_LETTER` (6000), `RESUME_RAW_CHARS` (8000) — token-budget caps for sampling prompts.
- `pickResume.ts` — given a job + N candidate resumes, returns the best resume id + a one-sentence reason. Skips sampling when only one resume is stored.
- `tailorResume.ts` — given a base resume + JD, produces a tailored resume in markdown. Strict prompt rules: don't invent, preserve facts, output markdown only.
- `coverLetter.ts` — given a JD + tailored resume + profile, drafts a 200–300 word cover letter. No clichés.
- `resolveResume.ts` — DRY helper: either uses an explicit `resumeId` (validated) or calls `pickBestResume`. Used by `tailor_resume` and `buildApplication`.
- `buildApplication.ts` — orchestrator: guardrail check → resolve resume → tailor → cover letter → persist via `createApplication`. Returns the full PR bundle.
- `guardrail.ts` — `checkGuardrail()` returns `{ allowed: true, warnings: string[] } | { allowed: false, reason: string }`. Three checks: weekly cap (≤10 real submissions), duplicate detection (unless `allowDuplicate=true`), reserved low-fit gate (M5).
- `workflowEngine.ts` — `runWorkflowKind()` dispatches to `prune_old_jobs` or `fetch_jobs_refresh` (the two non-sampling workflow kinds). Catches `ZodError` and formats user-friendly error messages.

### `src/tools/` — 16 MCP tools

Each tool:
1. Defines a zod input schema with `.describe()` annotations
2. Validates input via `.parse()`
3. Calls into services or the store
4. Returns a typed result

Tool wiring lives in `src/tools/index.ts` — a `toolDefinitions` array consumed by the server's request handlers. Each entry has `name`, `description`, `inputSchema` (via `zodToJsonSchema`), and `run(input, ctx)`.

### `src/resources/index.ts` — MCP resources

Two resources:

- `crosswalk://registry/companies` — JSON of all companies in the Open Job Graph
- `crosswalk://profile/me` — JSON of the current profile (or `null` if unset)

Used by the AI to understand context without calling tools.

### `src/parsers/resume.ts` — resume text extraction

Dispatches by file extension: `.txt`/`.md` → `fs.readFile`, `.docx` → `mammoth`, `.pdf` → `pdf-parse`. Both heavy parsers are loaded via dynamic `await import(...)` so the cost is paid only when a DOCX/PDF is supplied.

### `src/exporters/` — markdown to deliverable formats

- `html.ts` — markdown → print-styled HTML using `marked` with a custom `Marked` instance that escapes raw HTML tokens AND strips `javascript:` URLs from link/image hrefs (XSS hardening). The user opens the HTML in a browser and prints to PDF.
- `docx.ts` — markdown subset (h1/h2/h3, paragraphs, bullets) → DOCX `Buffer` via the `docx` package. Returns a real ZIP-formatted DOCX (PK\x03\x04 magic bytes).

### `src/registryBoot.ts` — first-run seeding

`seedRegistryIfEmpty(db)` — joins `registry/companies.json` with `registry/h1b.json` (companies + their H-1B sponsor confidence) and bulk-inserts via `seedCompaniesFrom`. No-op if the company table already has rows.

---

## Data model (SQLite)

Three migrations have run by v0.3.0. The `migrations` table tracks which.

### Migration 1 — core entities

```sql
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE resume (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_path TEXT,
  raw_text TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE company (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ats TEXT NOT NULL,
  ats_org_slug TEXT NOT NULL,
  h1b_confidence REAL,
  h1b_last_seen TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_company_ats ON company(ats);
CREATE INDEX idx_company_name ON company(name);

CREATE TABLE job (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id),
  title TEXT NOT NULL,
  dept TEXT,
  location TEXT,
  location_type TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  currency TEXT,
  description_md TEXT,
  url TEXT NOT NULL,
  posted_at TEXT,
  last_seen_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);
CREATE INDEX idx_job_company ON job(company_id);
CREATE INDEX idx_job_last_seen ON job(last_seen_at);
```

The job `id` is `<ats>:<orgSlug>:<externalId>` so the same fixture across multiple companies stays unique.

### Migration 2 — applications

```sql
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
```

`status` values: `draft`, `submitted`, `interviewing`, `rejected`, `offer`. Event `kind` values include `status_changed` and `note`.

### Migration 3 — workflows

```sql
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
```

`kind` is currently `fetch_jobs_refresh` or `prune_old_jobs`.

---

## The 16 MCP tools

### Profile & resumes

| Tool | Input | Output | Sampling? |
|---|---|---|---|
| `setup_profile` | `{ description }` | `{ profile }` | yes |
| `add_resume` | `{ path? \| rawText, label }` | `{ id, label }` | yes |
| `list_resumes` | `{}` | `{ resumes: [...] }` | no |

### Discovery & matching

| Tool | Input | Output | Sampling? |
|---|---|---|---|
| `fetch_jobs` | filters | `{ jobs, meta }` | no |
| `score_fit` | `{ jobId, resumeId? }` | `{ score, topStrengths, topGaps }` | yes |
| `explain_fit` | `{ jobId, resumeId? }` | `{ narrativeMd }` | yes |

### Authoring

| Tool | Input | Output | Sampling? |
|---|---|---|---|
| `tailor_resume` | `{ jobId, resumeId?, format? }` | `{ tailoredMd, resumeId, pickedReason, docxBase64?, html? }` | yes |
| `draft_application` | `{ jobId, resumeId?, allowDuplicate?, confirmLowFit? }` | `{ applicationId, tailoredResumeMd, coverLetterMd, deepLink, ... }` | yes |

### Pipeline tracker

| Tool | Input | Output | Sampling? |
|---|---|---|---|
| `submit_application` | `{ applicationId }` | `{ status, submittedAt }` | no |
| `set_status` | `{ applicationId, status }` | `{ applicationId, status }` | no |
| `add_note` | `{ applicationId, text }` | `{ eventId }` | no |
| `list_pipeline` | `{ status? }` | `{ items: [...] }` | no |

### Scheduling

| Tool | Input | Output | Sampling? |
|---|---|---|---|
| `schedule_workflow` | `{ kind, cron, description, params }` | `{ workflowId, nextRunAt }` | no |
| `run_workflow` | `{ workflowId }` | `{ status, summary, nextRunAt }` | no |
| `list_workflows` | `{}` | `{ workflows: [...] }` | no |
| `delete_workflow` | `{ workflowId }` | `{ deleted }` | no |

---

## The 8 ATS adapters

| Adapter | Endpoint | Format | Notes |
|---|---|---|---|
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | JSON | Largest coverage |
| Lever | `https://api.lever.co/v0/postings/{slug}?mode=json` | JSON (array) | Response is a top-level array |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | JSON | Has structured comp |
| Workable | `https://apply.workable.com/api/v3/accounts/{slug}/jobs` | JSON | Combines `description` + `requirements` |
| SmartRecruiters | `https://api.smartrecruiters.com/v1/companies/{slug}/postings` | JSON | Sectioned descriptions |
| BambooHR | `https://{slug}.bamboohr.com/jobs/embed2.php?json=1` | JSON | Subdomain-based |
| Recruitee | `https://{slug}.recruitee.com/api/offers/` | JSON | EU-heavy |
| Personio | `https://{slug}.jobs.personio.de/xml` | **XML** | German market; multi-section descriptions |

All adapters share the same interface and go through `withinSinceDays` for recency filtering.

**Not supported:** Workday, iCIMS — neither exposes a public JSON endpoint. Both need a Playwright-sandbox scraping framework (planned for M5).

---

## Anti-spam guardrail

`checkGuardrail(db, input)` runs before any sampling work in `buildApplication`. It returns one of:

- `{ allowed: true, warnings: string[] }` — proceed, optionally show warnings (e.g., "approaching weekly cap")
- `{ allowed: false, reason: string }` — refuse with a specific reason

### Two checks active in v0.3:

1. **Weekly cap (10 real submissions)**: counts applications in the trailing 7 days where `status IN ('submitted','interviewing','rejected','offer')`. Drafts the user abandoned don't count.
2. **Duplicate detection**: refuses if any non-rejected application already exists for the same `jobId`. Override with `allowDuplicate: true`.

### Reserved for M5:

3. **Low-fit gate**: refuses drafts where the cached `score_fit` result is < 0.50 unless the user passes `confirmLowFit: true`. The `confirmLowFit` field is already in the schema; the cache table lands in M5.

---

## Scheduled workflows

Workflows are persistent, cron-scheduled, **non-sampling** background jobs. Two kinds in v0.3:

- `fetch_jobs_refresh` — runs the `fetch_jobs` tool with the user's saved filters. Refreshes the job cache without the AI host needing to be running.
- `prune_old_jobs` — deletes cached jobs whose `last_seen_at` is older than `params.olderThanDays` (default 60).

### Why non-sampling?

The MCP server only runs while the AI host (Claude Desktop) has it spawned. Sampling needs an active client connection. So a workflow that wants to call `tailor_resume` on the user's behalf at 9am Monday can only run if the user has Claude Desktop open at 9am Monday — which defeats the purpose of "while you sleep" automation.

For v0.3, we ship workflows that *don't* need sampling. The user runs `crosswalk-mcp run-scheduled` from cron once a minute; the CLI claims due workflows atomically and runs them. Sampling-based workflows are M5+.

### Atomic claim

`claimDueWorkflow(db)` does:

1. Inside a single `db.transaction(...)`:
2. SELECT the soonest-due workflow
3. UPDATE its `next_run_at` to `now + 1h` (placeholder), but only if `next_run_at = <original>`
4. If the UPDATE changed 0 rows, another claimer beat us — return null

This means two overlapping cron invocations can't double-run the same workflow. Once the workflow finishes, `recordWorkflowRun` writes the real next_run_at computed from the cron expression.

### Cron setup

Add one line to your crontab:

```
* * * * * /usr/local/bin/crosswalk-mcp run-scheduled >> ~/.crosswalk/scheduler.log 2>&1
```

Every minute, any due workflow runs. Long workflows that take 10 minutes are safe — the placeholder bump prevents re-entry.

---

## MCP sampling — the keystone bet

All AI work in Crosswalk goes through the MCP `sampling/createMessage` request, which the **client** (Claude Desktop) handles. The MCP server (Crosswalk) doesn't ship an OpenAI key, an Anthropic key, or any provider SDK.

### How it works mechanically

1. A tool like `tailor_resume` builds a prompt (system + user message)
2. It calls `samplingClient.complete({ prompt, system, maxTokens })`
3. The wrapper sends `sampling/createMessage` over the MCP stdio transport
4. The host (Claude Desktop) intercepts this, runs it against whatever LLM the user has configured (Sonnet 4.6, Opus 4.7, etc.), and sends the response back
5. The wrapper returns the response text to the tool
6. The tool persists the result and returns it to the AI

### Why this matters

| Property | Server-with-its-own-key | Sampling |
|---|---|---|
| User's existing AI subscription | Wasted | Used |
| Crosswalk's AI bill | Real cost per request | $0 |
| Rate limits | Crosswalk's | User's plan |
| Data path | Crosswalk → provider | User's host → provider |
| Provider lock-in | Yes | No |

### Compatibility caveat

Sampling support varies by host. Claude Desktop has full support as of late 2025; Cursor has partial; ChatGPT MCP doesn't ship sampling yet. For non-sampling hosts, the `BYOK` fallback (user-supplied AI key in `~/.crosswalk/config.json`) is documented but explicitly opt-in — never the default.

---

## Privacy & local-first

- `~/.crosswalk/state.db` is the only stateful artifact. It contains your profile, resumes, cached jobs, applications, notes, and scheduled workflows.
- `~/.crosswalk/` is `git`-friendly. You can `cd ~/.crosswalk && git init && git commit -am 'snapshot'` to version your job-search state.
- No network requests except: (1) ATS API calls when the user calls `fetch_jobs` or runs a `fetch_jobs_refresh` workflow, (2) MCP sampling round-trips through the host LLM, which the host owns.
- No telemetry. No phone-home. No analytics.
- Removing Crosswalk: delete `~/.crosswalk/` and remove the entry from `claude_desktop_config.json`.

---

## Build & distribution

### Tech stack

- TypeScript 5.6+ (strict, ESM)
- Node 24 LTS (default), Node 22+ supported
- `@modelcontextprotocol/sdk` for MCP server primitives
- `better-sqlite3` for the local store (synchronous, fast, no separate process)
- `zod` for tool input validation
- `cron-parser` for cron expression parsing
- `marked` for markdown → HTML
- `docx` for markdown → DOCX
- `fast-xml-parser` for the Personio XML feed
- `mammoth` (DOCX) and `pdf-parse` (PDF) for resume text extraction
- `vitest` for tests
- `tsup` for bundling

### Builds

`npm run build` produces:

- `dist/server.js` (~38 KB ESM bundle)
- `dist/cli.js` (~3.5 KB ESM bundle)
- Plus tree-shaken chunks

The `--dts` flag is intentionally OFF — Crosswalk is a runnable, not a library, so type declarations would be misleading.

### Distribution

- **OSS core (MIT):** `npm i -g crosswalk-mcp` and then `crosswalk-mcp install` for Claude Desktop.
- **Open Job Graph (MIT):** the `registry/companies.json` and `registry/h1b.json` files are checked-in datasets anyone can PR.
- **Hosted tier:** not shipped in v0.3. Could deploy as a remote MCP on Vercel Functions + Neon Postgres for non-dev users in the future.

---

## Testing approach

- **Vitest** runs all tests with `npm test`. 124 tests pass at v0.3.0.
- **In-memory SQLite** (`openDb(':memory:')`) for store tests — hermetic, no temp files.
- **Mocked sampling** — services and tools that use sampling get a stubbed `SamplingClient` in tests, so no real LLM calls.
- **Mocked fetch** — `vi.stubGlobal('fetch', ...)` for ATS adapter tests, with checked-in JSON/XML fixtures.
- **TDD discipline** — every task in M1–M4 wrote a failing test first, then the implementation. The plan files at `docs/superpowers/plans/` enforce this.
- **Lint as type-check** — `npm run lint` is `tsc --noEmit`. Strict mode catches the kind of subtle issues that runtime tests miss.

### What's NOT tested

- Real PDF resume parsing (no public-domain PDF fixture; the dynamic-import path is exercised but not the actual `pdf-parse` library)
- Real ATS API integration (would require live credentials and break in CI)
- Cross-process workflow concurrency (tested at the SQL level; not under real cron contention)

---

## Compatibility matrix

| Host | Sampling | Status |
|---|---|---|
| Claude Desktop (latest) | Yes | Full feature set |
| Cursor | Partial | Most tools work; sampling-heavy ones may degrade |
| Windsurf | Partial | Same as Cursor |
| ChatGPT MCP | No (yet) | BYOK fallback (opt-in) only |

---

## Development guide

```bash
git clone https://github.com/Mohakgarg5/crosswalk-mcp.git
cd crosswalk-mcp
npm install
npm test           # run vitest (124 tests)
npm run lint       # tsc --noEmit
npm run dev        # run the MCP server over stdio (for manual testing)
npm run build      # produce dist/
```

To install your local build into Claude Desktop:

```bash
npm run build
CROSSWALK_INSTALL_COMMAND=node node dist/cli.js install
# Then edit ~/Library/Application Support/Claude/claude_desktop_config.json
# so the args point to your dist/cli.js path.
```

To smoke-test the server boot:

```bash
node dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR; echo ok
```

To list all registered tools at runtime, send a `tools/list` MCP request over stdio. Vitest covers this assertion in `tests/server.tools.test.ts`.

### Adding a new ATS adapter

1. Create `src/ats/<name>.ts` exporting a `<name>: ATSAdapter` const that calls `registerAdapter`.
2. Add a fixture under `tests/fixtures/<name>-jobs.json` (or `.xml`).
3. Add `tests/ats.<name>.test.ts` mocking `fetch` against the fixture.
4. Add `import './ats/<name>.ts';` to both `src/server.ts` and `src/tools/fetch_jobs.ts` so it self-registers.
5. Expand `Company['ats']` in `src/store/company.ts` to include the new slug.
6. Add companies to `registry/companies.json` using the new slug.

### Adding a new MCP tool

1. Create `src/tools/<name>.ts` exporting a zod input schema and a handler function.
2. Add `tests/tools.<name>.test.ts`.
3. Register in `src/tools/index.ts` (`toolDefinitions` array).
4. Update `tests/server.tools.test.ts` to expect the new tool name.
5. Add a row to the README's tool table.

---

## Roadmap

| Version | Theme | Status |
|---|---|---|
| **v0.0.1 — M1** | Discover + match + explain (6 tools, 3 ATSs) | Shipped |
| **v0.1.0 — M2** | Tailor + draft application (8 tools) | Shipped |
| **v0.2.0 — M3** | Pipeline tracker + guardrail + workflows (16 tools) | Shipped |
| **v0.3.0 — M4** | 5 more ATS adapters (8 total), 51-company registry, M3 fixes | **Current** |
| v0.4.0 — M5 | Workday + iCIMS via Playwright sandbox; live-fit guardrail; registry to 200+; install polish | Planned |
| v1.0.0 — v2 | Autonomous apply via Playwright in a sandbox | Planned |

### Known limitations / known good-ideas-for-later

- The `sinceDays` adapter tests rely on the system clock — they'll flake if a runner's wall-clock drifts far from May 2026. `vi.useFakeTimers()` would harden them.
- DOCX exporter only handles headings, paragraphs, and bullets. Inline bold/italic/links fall through as raw markdown text. Acceptable for v1; nicer typography is a polish pass.
- `pdf-parse` has historical issues with its CommonJS entry. We only load it lazily, but a real PDF roundtrip test (with a public-domain fixture) would catch breakage.
- The `confirmLowFit` field in `draft_application` is reserved but inert until M5 ships the live-fit gate.
- Concurrent `claimDueWorkflow` is safe within one process (SQLite serialization); cross-process safety relies on SQLite's write locking.

---

## File structure reference

```
crosswalk-mcp/
├── README.md                                       — user-facing
├── LICENSE                                         — MIT
├── package.json                                    — name, version, deps, bin
├── tsconfig.json                                   — strict ESM TS
├── vitest.config.ts                                — test runner
├── src/
│   ├── server.ts                                   — MCP entry point
│   ├── cli.ts                                      — install + run-scheduled CLI
│   ├── config.ts                                   — paths
│   ├── registryBoot.ts                             — first-run seed
│   ├── store/
│   │   ├── db.ts                                   — open + WAL + migrate
│   │   ├── migrations.ts                           — 3 migrations
│   │   ├── profile.ts
│   │   ├── resume.ts
│   │   ├── company.ts
│   │   ├── job.ts
│   │   ├── application.ts                          — + event log
│   │   └── workflow.ts                             — + atomic claim
│   ├── sampling/
│   │   └── client.ts                               — retry + JSON-mode wrapper
│   ├── ats/
│   │   ├── types.ts
│   │   ├── adapter.ts                              — registry
│   │   ├── util.ts                                 — withinSinceDays
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   ├── ashby.ts
│   │   ├── workable.ts
│   │   ├── smartrecruiters.ts
│   │   ├── bamboohr.ts
│   │   ├── recruitee.ts
│   │   └── personio.ts                             — XML
│   ├── services/
│   │   ├── constants.ts                            — JD truncation caps
│   │   ├── pickResume.ts                           — sampling
│   │   ├── tailorResume.ts                         — sampling
│   │   ├── coverLetter.ts                          — sampling
│   │   ├── resolveResume.ts                        — DRY helper
│   │   ├── buildApplication.ts                     — orchestrator + guardrail
│   │   ├── guardrail.ts                            — weekly cap + dup check
│   │   └── workflowEngine.ts                       — non-sampling workflows
│   ├── parsers/
│   │   └── resume.ts                               — txt/md/docx/pdf
│   ├── exporters/
│   │   ├── html.ts                                 — marked + XSS-hardened
│   │   └── docx.ts                                 — docx package
│   ├── resources/
│   │   └── index.ts                                — MCP resources
│   └── tools/
│       ├── index.ts                                — toolDefinitions registry
│       ├── setup_profile.ts
│       ├── add_resume.ts
│       ├── list_resumes.ts
│       ├── fetch_jobs.ts
│       ├── score_fit.ts
│       ├── explain_fit.ts
│       ├── tailor_resume.ts
│       ├── draft_application.ts
│       ├── submit_application.ts
│       ├── set_status.ts
│       ├── add_note.ts
│       ├── list_pipeline.ts
│       ├── schedule_workflow.ts
│       ├── run_workflow.ts
│       ├── list_workflows.ts
│       └── delete_workflow.ts
├── registry/
│   ├── companies.json                              — 51 companies (Open Job Graph)
│   └── h1b.json                                    — H-1B sponsor confidence
├── tests/                                          — 124 tests across 49 files
└── docs/
    ├── ARCHITECTURE.md                             — this file
    └── superpowers/
        ├── specs/
        │   └── 2026-04-30-crosswalk-design.md
        └── plans/
            ├── 2026-04-30-crosswalk-m1.md
            ├── 2026-04-30-crosswalk-m2.md
            ├── 2026-05-01-crosswalk-m3.md
            └── 2026-05-01-crosswalk-m4.md
```

---

## Credits

- Inspired by [jd-intel](https://github.com/prPMDev/jd-intel) (the LinkedIn-post MCP that proved the discovery slice works)
- Antagonized by jobos.us (the cloud-locked alternative that motivated the local-first commitment)
- The H-1B confidence dataset is derived from the publicly-published USCIS H-1B Employer Data Hub (FY2025).
- Built with [Claude Code](https://claude.com/claude-code) (Opus 4.7, 1M context) — every commit is co-authored by the model that wrote it.

---

**License:** MIT.
