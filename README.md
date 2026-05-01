# Crosswalk

**An AI-native career copilot that lives inside your AI, not on a website.**
Local-first. Zero API keys. Bring your own model.

Crosswalk is an MCP server. Install it once into Claude Desktop (or any MCP host that supports sampling). Your AI gains 6 tools to find roles, score fit, and tailor applications — using the model you already pay for.

## Quick start

```bash
npx crosswalk-mcp install
```

Restart Claude Desktop. Then say:

> *"Set up my profile: I'm a PM with 2 years at Acme, want NYC or remote, looking at AI infra."*
> *"Add my resume from ~/Documents/resume.pdf, label it 'Generic PM'."*
> *"Find PM roles at H-1B sponsors with 0.8+ confidence."*
> *"Why am I a fit for the Stripe Payments PM role?"*

## What it does (M3)

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
| `list_workflows` | List all scheduled workflows. |
| `delete_workflow` | Delete a scheduled workflow by id. |

## Why it's different

1. **Zero API keys.** All AI work runs through MCP sampling — calling back into your AI client's model. No keys in this repo, no AI bill on us, no rate limits beyond yours.
2. **Local-first.** Profile, resumes, and job cache live in `~/.crosswalk/state.db`. Your data never leaves your machine.
3. **Open Job Graph.** The company → ATS registry is a checked-in, MIT-licensed JSON dataset. Add your favorite companies via PR.

## Roadmap

| Version | Headline |
|---|---|
| M1 | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| **M3 (this release)** | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 7 more ATS adapters; registry to 200+ companies; install polish |
| v2 | Autonomous apply via Playwright in a sandbox |

See `docs/superpowers/specs/2026-04-30-crosswalk-design.md` for the full spec.

## Scheduled workflows (optional)

Crosswalk can run **non-sampling** workflows (job cache refresh, old-job pruning) on a schedule. These don't need the AI host to be running — Crosswalk pokes the ATS APIs directly.

Schedule one in chat:

> *"Schedule a workflow to refresh PM jobs at H-1B sponsors every Monday at 9 AM."*

Then add a single line to your crontab to actually invoke them:

```
* * * * * /usr/local/bin/crosswalk-mcp run-scheduled >> ~/.crosswalk/scheduler.log 2>&1
```

Sampling-driven workflows (e.g., "tailor the top 3 fits") are a v2 feature — they need a live AI host.

## Development

```bash
npm install
npm test           # run vitest
npm run dev        # run the MCP server over stdio
npm run build      # bundle dist/server.js + dist/cli.js
```

## License

MIT.
