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

## What it does (M1)

| Tool | Purpose |
|---|---|
| `setup_profile` | Store a structured profile from a free-form description. |
| `add_resume` | Parse and store a labeled resume version (DOCX/PDF/text). |
| `list_resumes` | List stored resumes. |
| `fetch_jobs` | Pull live roles from Greenhouse, Lever, and Ashby. |
| `score_fit` | Numeric fit score + structured strengths/gaps. |
| `explain_fit` | Markdown narrative — why fit, gap, positioning. |

## Why it's different

1. **Zero API keys.** All AI work runs through MCP sampling — calling back into your AI client's model. No keys in this repo, no AI bill on us, no rate limits beyond yours.
2. **Local-first.** Profile, resumes, and job cache live in `~/.crosswalk/state.db`. Your data never leaves your machine.
3. **Open Job Graph.** The company → ATS registry is a checked-in, MIT-licensed JSON dataset. Add your favorite companies via PR.

## Roadmap

| Version | Headline |
|---|---|
| **M1 (this release)** | Discover + match + explain |
| M2 | Tailor resume, draft cover letter, application "PR" bundle |
| M3 | Pipeline tracker, anti-spam guardrail, scheduled workflows |
| M4 | 7 more ATS adapters; registry to 200+ companies; install polish |
| v2 | Autonomous apply via Playwright in a sandbox |

See `docs/superpowers/specs/2026-04-30-crosswalk-design.md` for the full spec.

## Development

```bash
npm install
npm test           # run vitest
npm run dev        # run the MCP server over stdio
npm run build      # bundle dist/server.js + dist/cli.js
```

## License

MIT.
