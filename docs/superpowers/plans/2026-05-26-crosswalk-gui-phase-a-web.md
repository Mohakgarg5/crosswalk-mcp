# Crosswalk GUI — Phase A (Part 2: Next.js Web App) Plan

> **For agentic workers:** builds on the foundation plan (workspace + `crosswalk-mcp/runtime`). Execute task-by-task; verify build + browser before claiming done.

**Goal:** A local Next.js app at `localhost:3000` that drives the existing engine through `crosswalk-mcp/runtime`, so Crosswalk is usable without an MCP host. The MCP server stays untouched.

**Architecture:** `apps/web` (Next.js App Router, Node runtime). A thin server-only bridge (`lib/engine.ts`) builds the same `ToolCtx = { db, sampling, browser }` the MCP server uses, but with `ApiSamplingBackend` (Anthropic key) instead of host sampling. A generic `POST /api/tool` runs any of the 18 `toolDefinitions` in-process. Settings persist the API key to `~/.crosswalk/config.json` and config to `app_config`. Pages are client components calling the API.

**Tech Stack:** Next.js (App Router, Node runtime), React 19, Tailwind v4, `crosswalk-mcp/runtime`.

## Tasks
1. Scaffold `apps/web` (manual: package.json, next.config, tsconfig, tailwind/postcss, app shell). Boot a page. Configure `serverExternalPackages` for `crosswalk-mcp`, `better-sqlite3`, `@anthropic-ai/sdk`, `playwright`.
2. `lib/engine.ts` — `buildCtx()`, `runTool(name, input)`, `getApiKey()/setApiKey()`. No-key path uses a stub sampler that errors only when AI is actually invoked (non-AI tools work without a key).
3. `POST /api/tool` (generic tool runner) + `GET/POST /api/settings` (key + app_config).
4. App shell: sidebar nav + layout.
5. Settings page — API key, model, weekly cap, submit policy.
6. Profile page — `setup_profile` + view current profile.
7. Résumés page — `add_resume` (paste text) + `list_resumes`.
8. Jobs page — `fetch_jobs` with filters (title/location/H-1B) + results table.
9. Fit + Pipeline — `score_fit`/`explain_fit` for a job; `list_pipeline` board.
10. Verify: `next build` succeeds; boot `next dev` and exercise the app in a real browser (Playwright). Update README/ARCHITECTURE with "Run the GUI".

**Definition of done:** `next build` clean; app boots; with an API key set, the core loop (profile → fetch jobs → score fit → view pipeline) works in a browser; MCP server + 225 tests still green.
