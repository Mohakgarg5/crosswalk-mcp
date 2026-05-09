<div align="center">

# Crosswalk

**An AI-native career copilot that lives inside your AI, not on a website.**

Local-first. Zero API keys. Bring your own model.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](#requirements)
[![Tests](https://img.shields.io/badge/tests-181%20passing-brightgreen.svg)](#development)
[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](https://github.com/Mohakgarg5/crosswalk-mcp/releases)

[Quick start](#quick-start) ·
[Tools](#what-it-does) ·
[ATS coverage](#ats-coverage) ·
[Why it's different](#why-its-different) ·
[Architecture](docs/ARCHITECTURE.md)

</div>

---

## The pitch

Every AI-powered job board says the same thing: "Upload your resume, we'll do the rest." Then they match you against 5%-fit jobs because their AI doesn't know you. Your conversations, your projects, your taste — all on your machine, where the AI you're already paying for can already see them.

So why hand all that to one more job board?

**Crosswalk is an MCP server.** Install it once into your AI client (Claude Desktop, Cursor, etc.). Your AI gains 18 new tools to find jobs, score fit, tailor resumes, draft applications, track your pipeline, and run scheduled workflows — using the model **you** already pay for, with your data **on your machine**.

```
What you say to your AI:                   What Crosswalk does behind the scenes:
─────────────────────────────────────────  ──────────────────────────────────────────
"Set up my profile from this description"   stores a structured profile in SQLite
"Add my resume from ~/Documents/cv.pdf"      parses + structures via your AI
"Find PM roles at H-1B sponsors"             hits 8 ATSs in parallel, ranks by H-1B
"Why am I a fit for the Stripe role?"        narrative explanation via your AI
"Draft an application for that job"          tailored resume + cover letter, persisted
"Mark it submitted"                          status update + event log
"Show me my pipeline"                        every application with company context
"Refresh job cache every Monday at 9am"      cron-driven workflow, runs without you
```

---

## Quick start

```bash
npx crosswalk-mcp install
```

That installs into all detected hosts (Claude Desktop, Cursor, Windsurf). To target one:

```bash
npx crosswalk-mcp install --client cursor
```

Restart the affected app(s). Then ask your AI:

> *"Set up my profile: I'm a PM with 2 years at Acme, want NYC or remote, looking at AI infra."*
> *"Add my resume from ~/Documents/resume.pdf, label it 'Generic PM'."*
> *"Find PM roles at H-1B sponsors with 0.8+ confidence."*
> *"Why am I a fit for the Stripe Payments PM role?"*
> *"Tailor my resume for that role and give me the DOCX."*
> *"Draft an application for it."*

That's it. No signup. No API keys. Your data stays in `~/.crosswalk/`.

---

## Use with other MCP clients

Crosswalk is a stdio MCP server. The auto-installer above covers Claude Desktop, Cursor, and Windsurf. For other clients, drop a config snippet into the client's MCP config file and restart. (Replace `npx -y crosswalk-mcp@latest` with `node /absolute/path/to/crosswalk-mcp/dist/cli.js` if you've cloned from GitHub instead of installing from npm.)

### Claude Code (CLI)

```bash
claude mcp add crosswalk-mcp -- npx -y crosswalk-mcp@latest
```

### opencode

Add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "crosswalk-mcp": {
      "type": "local",
      "command": ["npx", "-y", "crosswalk-mcp@latest"]
    }
  }
}
```

### OpenAI Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.crosswalk-mcp]
command = "npx"
args = ["-y", "crosswalk-mcp@latest"]
```

### Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "crosswalk-mcp": {
      "command": "npx",
      "args": ["-y", "crosswalk-mcp@latest"]
    }
  }
}
```

### Any other MCP client

If your client supports stdio MCP servers, the recipe is always: command `npx`, args `["-y", "crosswalk-mcp@latest"]`, optional env `CROSSWALK_HOME=/custom/path`. State lives in `~/.crosswalk/state.db` regardless of which client invoked the server.

See [USER_GUIDE §1.4](docs/USER_GUIDE.md#14-using-crosswalk-with-various-mcp-clients) for full per-client details and source-only install instructions.

---

## What it does

**18 MCP tools across 5 surfaces.** v1.3.0 makes `apply_application` smart: before filling, it introspects the form and asks the LLM (via sampling) to answer any free-text question whose `name` doesn't match an existing answerPack key. v1.2.0 brought textarea fills via `text_by_name`; v1.1.0 added cover-letter inputs (file + text); v1.0.0 introduced the tool itself: open the form in a headless browser, auto-fill known fields, take a screenshot, and **stop** — you review and click Submit yourself. Combined with `preview_application`, Playwright remains an *optional* peer dep — base install stays light; opt in with `crosswalk-mcp install-browser`.

### Profile & resumes

| Tool | What it does |
|---|---|
| `setup_profile` | Store a structured profile from a free-form description. |
| `add_resume` | Parse and store a labeled resume version (DOCX/PDF/text). Multiple resumes supported. |
| `list_resumes` | List stored resume versions. |

### Discovery & matching

| Tool | What it does |
|---|---|
| `fetch_jobs` | Pull live roles from 8 ATSs. Filter by title, location, recency, **H-1B sponsor confidence**, comp range. |
| `score_fit` | Numeric 0–1 fit score plus structured strengths and gaps. |
| `explain_fit` | Markdown narrative — why you're a fit, where you're weak, how to position. |

### Authoring

| Tool | What it does |
|---|---|
| `tailor_resume` | Edits your best base resume for a specific JD. Returns markdown by default; optional **DOCX** (base64) or **print-ready HTML** on request. |
| `draft_application` | Builds a complete "application PR": tailored resume + cover letter + deep link, persisted. **Anti-spam guardrail** enforces a weekly cap, refuses obvious duplicates, and refuses drafts where cached fit < 0.50 (override with `confirmLowFit: true`). |

### Pipeline tracker

| Tool | What it does |
|---|---|
| `submit_application` | Mark an application submitted (after you click Apply in your browser). Stamps the timestamp, logs an event. |
| `set_status` | Change status: `draft → submitted → interviewing → rejected | offer`. |
| `add_note` | Append a free-text note to an application's event log ("recruiter emailed back"). |
| `list_pipeline` | List all applications with company + job context. Filter by status. |
| `preview_application` | Open the application's deep link in a headless browser; return a screenshot + visible form fields. Requires `crosswalk-mcp install-browser` first. |
| `apply_application` | Open the deep link in a headless browser, auto-fill known fields from your profile + tailored resume + cover letter + answer-pack textareas, sample the LLM for any unmatched textarea question, take a screenshot. Does **not** submit — you review and click Submit. Requires `crosswalk-mcp install-browser` first. |

### Scheduling

| Tool | What it does |
|---|---|
| `schedule_workflow` | Schedule a recurring **non-sampling** workflow (job-cache refresh, old-job pruning) via cron expression. |
| `run_workflow` | Manually run a scheduled workflow now. |
| `list_workflows` | List all scheduled workflows with their last-run status. |
| `delete_workflow` | Delete a scheduled workflow by id. |

---

## ATS coverage

Crosswalk fetches live jobs from **10 ATSs**, covering 115 seed companies. Each adapter is a small file in `src/ats/` — adding more is a one-PR change.

| ATS | Endpoint type | Seed coverage |
|---|---|---|
| [Greenhouse](https://www.greenhouse.io/) | JSON | Stripe, Airbnb, Anthropic, Vercel, Figma, Linear, DoorDash, Robinhood, Coinbase, Datadog, Snowflake, Twilio, +9 more (22 total) |
| [Lever](https://www.lever.co/) | JSON | Netflix, Spotify, Shopify, Brex, Lyft, GitHub, Atlassian, Canva, Uber, +2 more (11 total) |
| [Ashby](https://www.ashbyhq.com/) | JSON | OpenAI, Ramp, Notion, Perplexity, Cohere, Hugging Face, Cursor, Replit, Writer, Harvey, +6 more (16 total) |
| [Workable](https://www.workable.com/) | JSON | Miro, n8n, Remote.com, Wayfair, SumUp, +1 more (6 total) |
| [SmartRecruiters](https://www.smartrecruiters.com/) | JSON | Bosch, Siemens, Ubisoft, Celonis, Foodpanda, +1 more (6 total) |
| [BambooHR](https://www.bamboohr.com/) | JSON | Klaviyo, Buffer, Zapier, Amplitude, CrowdStrike, +1 more (6 total) |
| [Recruitee](https://recruitee.com/) | JSON | Mollie, MessageBird, HelloFresh, Wise, Babbel, Bolt, Kayak, +1 more (8 total) |
| [Personio](https://www.personio.com/) | XML | Personio, Clue, Trade Republic, N26, FreeNow, Doctolib, +2 more (8 total) |
| [Workday](https://www.workday.com/) | JSON POST | NVIDIA, Salesforce, JPMorgan, UnitedHealth, Deloitte, Accenture, GE Aerospace, P&G (8 total) |
| [iCIMS](https://www.icims.com/) | HTML | MongoDB, Fidelity, VMware, Cigna (4 total) |

**Want to add your favorite company?** Send a PR to [`registry/companies.json`](registry/companies.json) — the registry is MIT-licensed.

---

## Why it's different

### 1. Zero API keys

Every LLM call (resume parsing, fit scoring, tailoring, cover letters) runs through **MCP sampling** — a callback into your AI client's model. Crosswalk has no provider SDK, no `OPENAI_API_KEY`, no AI bill, no rate limits beyond your own plan's.

When jobos.us tailors your resume, they pay Gemini and bill you $19/month. When Crosswalk tailors your resume, your existing Claude/GPT/whatever subscription does the work and Crosswalk costs $0 to run.

### 2. Local-first

Profile, resumes, cached jobs, applications, notes, scheduled workflows — all in `~/.crosswalk/state.db`. SQLite. Your machine. No signup. No cloud. `git`-friendly.

```bash
cd ~/.crosswalk && git init && git add -A && git commit -m "snapshot before fall recruiting"
```

### 3. The Open Job Graph

The company → ATS registry is a checked-in JSON file. **51 companies** at v0.3, on a path to 200+ via community PRs. You can extend it, fork it, and other tools can use it as infrastructure.

### 4. Anti-spam by design

Crosswalk **refuses** to draft an 11th application in 7 days. It refuses duplicate applications. The user can override, but has to ask. We're the only job tool that tells you to apply *less*.

### 5. Applications-as-PRs

Each application is a reviewable artifact: tailored resume + cover letter + answer pack + deep link, persisted with a status (`draft → submitted → interviewing → rejected | offer`) and an event log. You review and edit before submitting. The tracker is a git-like log of these.

### 6. Scheduled background workflows

Add one line to your crontab and Crosswalk refreshes your job cache every Monday at 9 AM, prunes stale listings nightly, etc. — without the AI host needing to be open.

```
* * * * * /usr/local/bin/crosswalk-mcp run-scheduled >> ~/.crosswalk/scheduler.log 2>&1
```

---

## Scheduled workflows

Crosswalk can run **non-sampling** workflows (job cache refresh, old-job pruning) on a schedule. These don't need the AI host to be running — Crosswalk pokes the ATS APIs directly.

Schedule one in chat:

> *"Schedule a workflow to refresh PM jobs every Monday at 9 AM."*

Then add a single line to your crontab:

```
* * * * * /usr/local/bin/crosswalk-mcp run-scheduled >> ~/.crosswalk/scheduler.log 2>&1
```

Every minute, any due workflow runs. Long workflows are safe — Crosswalk uses an atomic claim pattern in SQLite so overlapping cron invocations don't double-run.

Sampling-driven workflows ("tailor the top 3 fits") are an M5+ feature — they need a live AI host connection.

---

## Privacy

- One file: `~/.crosswalk/state.db`. SQLite. Your machine.
- No telemetry. No phone-home. No analytics.
- ATS API calls go directly from your machine to the ATS (Greenhouse, Lever, etc.). No proxy.
- LLM calls go through your AI host (Claude Desktop, Cursor) to its provider. Crosswalk never sees a token of API key.
- Removing Crosswalk: `rm -rf ~/.crosswalk` and remove the entry from `claude_desktop_config.json`.

---

## Roadmap

| Version | Theme | Status |
|---|---|---|
| v0.0.1 — M1 | Discover + match + explain · 6 tools · 3 ATSs · 42 tests | Shipped |
| v0.1.0 — M2 | Tailor resume + draft application · 8 tools · 68 tests | Shipped |
| v0.2.0 — M3 | Pipeline tracker + anti-spam guardrail + scheduled workflows · 16 tools · 110 tests | Shipped |
| v0.3.0 — M4 | 5 more ATS adapters (8 total) · 51-company registry · M3 carry-overs · 124 tests | Shipped |
| v0.4.0 — M5 | Live-fit guardrail gate · uninstall + status CLI · 74-company registry · 146 tests | Shipped |
| v0.5.0 — M6 | Multi-host install · doctor diagnostic · 100-company registry · 165 tests | Shipped |
| v0.6.0 — M7 | Workday + iCIMS adapters · sampling_recipe workflows · 115-company registry · 175 tests | Shipped |
| v0.7.0 — M8 | preview_application · optional Playwright · browser-aware doctor · 181 tests | Shipped |
| v1.0.0 — M9 | apply_application · profile-driven auto-fill · review-before-submit safety · 18 tools | Shipped |
| v1.1.0 — M10 | Cover-letter fill (file + text) · richer Greenhouse/Lever selectors · 192 tests | Shipped |
| v1.2.0 — M11 | answerPack textarea fills (`text_by_name`) · multi-client install docs · 198 tests | Shipped |
| **v1.3.0 — M12** | **Smart fill: form-introspection-then-sample for unmatched textareas · 204 tests** | **Current** |
| v1.4.0 — M13 | Per-ATS selector packs (Greenhouse / Lever / Ashby / Workable) | Planned |
| v1.5.0 — M14 | Workday widget support (`data-automation-id` selectors) | Planned |
| v2.0.0 | Full submit-and-confirm autonomy with elicitation gates · captcha handling · multi-step wizards | Planned |

See [`docs/superpowers/plans/`](docs/superpowers/plans/) for the full TDD-ordered implementation plans for each milestone.

---

## Architecture

A high-level diagram lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Short version:

- **`src/server.ts`** boots the MCP server, opens SQLite, registers 18 tools and 2 resources.
- **`src/tools/`** — one file per MCP tool, each with a zod input schema.
- **`src/services/`** — pure business logic (resume picker, tailorer, cover-letter drafter, guardrail, workflow engine). Doesn't know about MCP.
- **`src/ats/`** — 8 self-registering adapters, all conforming to the `ATSAdapter` interface.
- **`src/store/`** — typed SQLite CRUD across 7 tables.
- **`src/sampling/client.ts`** — wraps MCP `createMessage` with retry + JSON-mode.
- **`src/exporters/`** — markdown → DOCX / print-styled HTML.

See the [full architecture document](docs/ARCHITECTURE.md) for component-by-component breakdown, data model, tool surface, and design rationale.

---

## Requirements

- **Node 24 LTS** (Node 22+ probably works but isn't tested)
- An MCP host that supports `sampling` — primarily **Claude Desktop**. Cursor and Windsurf have partial support; ChatGPT MCP doesn't ship sampling yet.

---

## Development

```bash
git clone https://github.com/Mohakgarg5/crosswalk-mcp.git
cd crosswalk-mcp
npm install
npm test           # 124 tests
npm run lint       # tsc --noEmit
npm run dev        # run the MCP server over stdio
npm run build      # bundle dist/server.js + dist/cli.js
```

The full development guide — including how to add a new ATS adapter, how to add a new MCP tool, and how the test fixtures work — lives in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#development-guide).

---

## Contributing

The fastest contribution path:

1. **Add a company to the Open Job Graph.** Find the company's ATS, get their slug, send a one-line PR to [`registry/companies.json`](registry/companies.json).
2. **File an issue** if an ATS adapter mis-parses a field on a real org you care about. Include the org slug.
3. **Send a PR** for new ATS adapters — the framework lives at `src/ats/adapter.ts` and existing adapters like `src/ats/greenhouse.ts` are good templates.

For larger changes, see the implementation plans at [`docs/superpowers/plans/`](docs/superpowers/plans/) for the project's working style (TDD, small PRs, frequent commits).

---

## Credits

- The H-1B confidence dataset is derived from the publicly-published USCIS H-1B Employer Data Hub (FY2025).
- Built with [Claude Code](https://claude.com/claude-code) (Opus 4.7, 1M context). Every commit is co-authored by the model that wrote it.

---

## License

[MIT](LICENSE) © 2026 Mohak Garg
