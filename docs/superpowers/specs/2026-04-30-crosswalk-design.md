# Crosswalk — Design Spec

**Status:** Draft v1 · **Date:** 2026-04-30 · **Author:** Mohak Garg

## 1. Pitch

**An AI-native career copilot that lives inside your AI, not on a website.**
Local-first, zero API keys, treats applications like pull requests, and tells you to apply *less*.

Crosswalk is an MCP server. The user installs it once into their AI client (Claude Desktop, Cursor, etc.). From then on, every interaction with their AI can pull live job listings, score fit against their stored profile, tailor a resume, draft a cover letter, and track the application — using the AI the user is already paying for. The MCP server itself ships with no model API keys.

## 2. Why this exists

Two products define the space today and both leave a wedge open:

- **jd-intel** (the LinkedIn-post MCP). Thin, read-only, stateless. 4 tools, ~66 companies, fetches Greenhouse/Lever/Ashby. Proves the MCP-into-AI hook works but does only the *discovery* slice.
- **jobos.us** (full web platform). 11 modules — Resume Studio, Chrome Extension, Visa Intelligence, Job Tracker, Interview Prep, Offer Intel, Career Coach, Network CRM, Answer Bank — at $0/$19/$49 tiers. Powerful but cloud-locked: you sign up, hand over your data, and use *their* Gemini key.

Crosswalk's wedge: **be MCP-first like jd-intel, and full-loop like jobos.us, but local-first and bring-your-own-AI.** The user keeps their data and their model; we provide the orchestration.

## 3. The 6 out-of-the-box bets

These are the structural decisions that make Crosswalk meaningfully different. Drop any one of them and the product collapses back into a worse jobos.us.

1. **Zero-API-key MCP.** All LLM work — resume parsing, fit scoring, tailoring, drafting — runs through **MCP sampling**, calling back into the host's model. The server has no AI bill, no rate limits, no data leaving the user's AI session. jobos.us cannot do this; jd-intel does not try.
2. **Local-first state.** Profile, resume versions, application history, recruiter notes — all in `~/.crosswalk/state.db` (SQLite). No signup, no cloud, `git`-friendly. Optional hosted tier later (same schema, remote MCP) for non-dev users.
3. **Applications-as-PRs.** Each application is a reviewable artifact: tailored resume + cover letter + answer pack + deep link, plus a *diff* against the user's base profile. The user reviews, edits, then either opens the live form (v1) or submits autonomously (v2). The tracker is a git-like log of these PRs.
4. **Anti-spam by design.** Hard cap on applications/week. Refuse to draft a cover letter for a sub-50% match without double-confirmation. Surface "your fit-score median is dropping; you're spraying" warnings. Marketing line: *"the only job tool that tells you to apply less."*
5. **Open Job Graph.** The company → ATS registry is an MIT-licensed JSON dataset in this repo with PRs welcomed. Goal: 1,000+ companies in 6 months. Becomes OSS infrastructure others build on.
6. **Scheduled agents.** A `schedule_workflow` tool that takes natural-language jobs ("every Monday 9am: find new senior PM roles at H-1B sponsors, score them, draft tailored CVs for the top 3") and runs them via local cron / launchd. Most MCPs are reactive; Crosswalk runs while the user sleeps.

## 4. v1 scope

**Deep A + B. Thin C + D.** Targeted ship: ~3–5 weeks of focused work.

| Step | v1 |
|---|---|
| **Discover** (A) | 10 ATS adapters: Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, BambooHR, iCIMS, Recruitee, Personio. Filters: title, location, recency, **H-1B sponsor flag**, comp range, remote/hybrid. |
| **Match** (A) | Numeric score + **narrative explanation** ("82% fit. Strength: 4yr PM at marketplaces. Gap: no Kafka. Position around X."). Uses MCP sampling. |
| **Tailor** (B) | Multi-resume aware — picks best base resume from stored versions, edits to match JD. Cover letter + recruiter DM drafts. Output: markdown, DOCX, PDF. |
| **Apply** (C, thin) | Generates an application "PR" — pre-filled answer pack + deep link. User submits manually. Logged on confirmation. |
| **Track** (D, thin) | Persistent pipeline. Status transitions, follow-up reminders. No CRM bells; just a clean log. |
| **Schedule** | `schedule_workflow` — local cron / launchd in v1. |

**Explicitly out of v1 (deferred to v2):** autonomous browser-driven applying, hosted multi-tenant tier, Chrome extension, structured interview prep, offer-intel CRM. All real, all distractions from shipping.

## 5. Architecture

```
[ Claude Desktop / Cursor / ChatGPT-with-MCP ]
              │  MCP stdio
              ▼
   ┌──────────────────────────────────┐
   │   crosswalk-mcp (Node 24)        │
   │  ┌────────────────────────┐      │
   │  │ Tools layer            │      │   tool handlers, validation, guardrails
   │  ├────────────────────────┤      │
   │  │ Sampling client        │──────┼──► host LLM (no keys here)
   │  ├────────────────────────┤      │
   │  │ ATS Adapter framework  │──────┼──► Greenhouse, Lever, Ashby, Workday, ...
   │  ├────────────────────────┤      │
   │  │ Open Job Graph loader  │──────┼──► registry/companies.json
   │  ├────────────────────────┤      │
   │  │ State store (SQLite)   │──────┼──► ~/.crosswalk/state.db
   │  ├────────────────────────┤      │
   │  │ Scheduler              │──────┼──► local cron / launchd
   │  └────────────────────────┘      │
   └──────────────────────────────────┘
```

### 5.1 Components (single-purpose units)

Each component below has one purpose, a typed interface, and dependencies it can name. Files are kept small enough that any one of them fits comfortably in a single read.

| Component | Purpose | Depends on |
|---|---|---|
| `server/` (entrypoint) | Boots MCP, registers tools/resources, wires sampling, runs stdio transport | sdk, tools, store |
| `tools/` (one file per tool) | Validates input, calls services, returns MCP response | services, store |
| `services/match.ts` | Score + narrative for (job, resume) via sampling | sampling, store |
| `services/tailor.ts` | Multi-resume pick + JD-aware edit + DOCX/PDF export | sampling, store, exporters |
| `services/draft.ts` | Build application PR (resume + letter + answer pack + link) | match, tailor, store |
| `services/pipeline.ts` | Append events; materialize current application state | store |
| `services/guardrail.ts` | Weekly cap, low-fit warning, dup detection | store |
| `services/schedule.ts` | Register/list/run workflows; manage cron entries | store, sampling |
| `ats/adapter.ts` | `ATSAdapter` interface + Job normalizer | — |
| `ats/<name>.ts` × 10 | Per-platform implementation of `ATSAdapter` | adapter |
| `registry/companies.json` | Open Job Graph: company → ATS slug | — |
| `registry/h1b.json` | H-1B sponsor confidence dataset (USCIS-derived) | — |
| `store/index.ts` | Typed CRUD over SQLite; migrations | better-sqlite3 |
| `sampling/index.ts` | Wraps MCP sampling with retry/timeout/JSON-mode helpers | sdk |
| `exporters/docx.ts`, `exporters/pdf.ts` | Markdown → DOCX/PDF | docx, puppeteer-core or md-to-pdf |
| `parsers/resume.ts` | DOCX/PDF/text → text → structured profile via sampling | mammoth, pdf-parse, sampling |

### 5.2 MCP tools (v1 surface)

| Tool | Purpose |
|---|---|
| `setup_profile` | Onboard via sampling-driven interview; writes `profile` row |
| `add_resume` | Parse a DOCX/PDF/text resume → store as a labeled version |
| `list_resumes` | List stored resume versions |
| `fetch_jobs` | Filtered listing across all configured ATSs |
| `score_fit` | Numeric score for (job, resume?) |
| `explain_fit` | Narrative reasoning + gap analysis |
| `tailor_resume` | Produce tailored markdown + optional DOCX/PDF export |
| `draft_application` | Build the application "PR" bundle |
| `submit_application` | Mark submitted (manual confirmation in v1) |
| `list_pipeline` | Filtered list of applications |
| `set_status` / `add_note` | Pipeline mutations |
| `schedule_workflow` | Natural-language → structured cron-driven workflow |
| `run_workflow` | Manual trigger |

### 5.3 MCP resources

- `crosswalk://registry/companies` — Open Job Graph
- `crosswalk://profile/me` — current profile
- `crosswalk://pipeline/active` — active applications

### 5.4 Data model (SQLite)

```
profile           (singleton row; JSON blob with structured fields)
resume            (id, label, source_path, parsed_json, created_at)
company           (id, name, ats, ats_org_slug, h1b_confidence, h1b_last_seen)
job               (id, company_id, title, dept, location, location_type,
                   salary_min, salary_max, currency, description_md, url,
                   posted_at, last_seen_at, raw_json)
application       (id, job_id, resume_id, status, fit_score, fit_narrative_md,
                   tailored_resume_md, cover_letter_md, answer_pack_json,
                   deep_link, created_at, submitted_at)
application_event (id, application_id, kind, payload_json, at)
workflow          (id, description, cron, prompt_template,
                   last_run_at, next_run_at)
setting           (key, value)
```

## 6. Distribution

- **OSS core (MIT):** `npm i -g crosswalk-mcp` and `npx crosswalk-mcp install` for Claude Desktop one-line setup. Manual config for Cursor/Windsurf.
- **Open Job Graph (MIT):** lives in this repo; community PRs.
- **Hosted tier (v1.5+):** same code deployed as remote MCP on Vercel Functions + Neon Postgres + Vercel Cron, with OIDC auth and BotID. Pricing TBD; benchmark $9/mo (undercut jobos.us $19).

## 7. Tech stack

- **Language / runtime:** TypeScript, Node 24 LTS
- **MCP:** `@modelcontextprotocol/sdk`
- **Storage:** `better-sqlite3` (local); Neon Postgres (hosted)
- **Validation:** `zod`
- **Resume parsing:** `mammoth` (DOCX), `pdf-parse` (PDF), sampling for structuring
- **Exports:** `docx` for DOCX; markdown→HTML→PDF for PDF
- **Scheduler:** `node-cron` for in-process; cron/launchd helper for OS-level
- **Browser (v2 only):** `playwright`, ideally inside a Vercel Sandbox

## 8. Compatibility matrix (sampling support)

Sampling is the keystone bet but is unevenly supported across MCP hosts. v1 ships with:

| Host | Sampling | Crosswalk behavior |
|---|---|---|
| Claude Desktop | Yes | Full feature set |
| Cursor | Partial | Full feature set; degrade gracefully on unsupported calls |
| ChatGPT (MCP) | Not yet | **BYOK fallback** — user supplies their own AI key in `~/.crosswalk/config.json`; documented as a temporary path |

The BYOK fallback is the *only* concession to non-sampling hosts; it is opt-in and never the default.

## 9. Risks and open questions

1. **Workday / iCIMS scraping.** Greenhouse, Lever, Ashby, Workable, SmartRecruiters, BambooHR, Recruitee, and Personio expose JSON APIs. Workday and iCIMS frequently do not. *Decision:* ship JSON-API adapters with full fidelity and mark Workday/iCIMS as "best-effort" with a known-good org list.
2. **H-1B data freshness.** USCIS H-1B Employer Data Hub updates quarterly. *Decision:* embed snapshot date as a field; show it in `explain_fit` so the user knows the staleness.
3. **DOCX export fidelity.** Generating editable DOCX from markdown is messy. *Decision:* ship a clean two-column template; document that pixel-perfect cloning of a user's existing DOCX is out of scope for v1.
4. **Sampling cost on user's side.** Heavy `tailor_resume` runs may consume meaningful tokens of the user's plan. *Decision:* every sampling call surfaces estimated token usage in the tool result; `setup_profile` warns users on first run.
5. **Anti-spam guardrail UX.** Refusal needs to feel helpful, not preachy. *Decision:* refusal messages always include the *specific* fix ("raise the gap on 'Kafka' or pick `senior-pm-marketplace.docx` as the base resume") rather than generic warnings.
6. **Naming.** `crosswalk-mcp` is available on npm (verified 2026-04-30). The bare `crosswalk` name is taken, so the package and CLI both use `crosswalk-mcp`. The product name is "Crosswalk"; the install command is `npx crosswalk-mcp install`. Domain (`crosswalk.dev` or alternative) still to claim. *Fallback product names if branding ever conflicts:* `Cohort`, `JDX`.

## 10. Success criteria for v1

v1 ships when all of the following hold:

- A new user runs `npx crosswalk-mcp install`, restarts Claude Desktop, and within 10 minutes has: a profile, ≥1 stored resume, 5 ranked roles with narratives, a tailored resume + cover letter, and a tracked application PR.
- All 10 ATS adapters return non-empty results from at least 3 known orgs each.
- Open Job Graph contains ≥200 companies at launch.
- Anti-spam guardrail correctly blocks the 11th application of the week and surfaces a low-fit warning at <50%.
- No model API keys live in the codebase; sampling is the only LLM path on supported hosts. BYOK is documented as a fallback only.
- README pitches the product in <60 seconds, including a 90-second demo GIF.

## 10a. v1 milestones (for the implementation plan)

The v1 scope above is large enough that the implementation plan should slice it into reviewable milestones:

| M | Theme | Includes |
|---|---|---|
| M1 | Shell + Discover | MCP server skeleton, store, sampling client, 3 ATS adapters (Greenhouse/Lever/Ashby), `setup_profile`, `add_resume`, `fetch_jobs`, `score_fit`, `explain_fit`, Open Job Graph seed. |
| M2 | Author | `tailor_resume`, `draft_application`, DOCX/PDF exporters, multi-resume picking. |
| M3 | Track + guard | `submit_application`, `list_pipeline`, `set_status`, `add_note`, anti-spam guardrail, `schedule_workflow`, `run_workflow`. |
| M4 | Reach | Remaining 7 ATS adapters, registry expansion to 200+, install scripts, README + demo GIF. |

Each milestone is independently shippable to early testers.

## 11. Roadmap beyond v1 (North Star)

| Version | Headline feature |
|---|---|
| v1.0 | Loop v1 (this spec) |
| v1.5 | Hosted remote MCP on Vercel; signup + billing; same schema |
| v2.0 | Autonomous apply via Playwright in Vercel Sandbox; per-step elicitation gates |
| v2.5 | Interview prep module (sampling-driven mock interviewer + question banks) |
| v3.0 | Network CRM + recruiter outreach automation |

The North Star — autonomous A→B→C→D in one fluid AI conversation — is reached at v2.0. v1 makes that future structurally easy; it does not paint into a corner.

---

**End of design spec.**
