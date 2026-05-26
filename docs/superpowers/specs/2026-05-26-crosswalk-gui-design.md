# Crosswalk GUI — Design & Spec

**Date:** 2026-05-26 · **Theme:** v3.0 — "GUI + standalone runtime" (M18+)
**Status:** Design approved, pending implementation plan

This spec describes adding a **local web GUI** to Crosswalk so it can be used by people who don't live inside an MCP host — *without* breaking, forking, or degrading the existing zero-API-key MCP server. The product runs **both ways**: as the MCP server it is today, and as a standalone local web app, both sharing one engine and one SQLite database.

Read [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) first. This spec extends it; it does not replace it.

---

## 1. Why

Crosswalk today is excellent infrastructure with one hard ceiling: **you must install an MCP host that supports sampling (effectively Claude Desktop) to use it at all.** That excludes everyone who wants a "download it, open it, it works" product — which is the entire addressable market of tools like Tsenta and jobos.us.

The comparison that motivated this work:

| Capability | Crosswalk today | Tsenta | This spec |
|---|---|---|---|
| Discover / score / tailor / cover-letter / autofill / submit / track | ✅ | ✅ | keep |
| Usable without an AI host (a real GUI) | ❌ | ✅ | **add** |
| Live on-screen automation | ⚠️ headless + screenshot | ✅ | add (Phase C) |
| Recruiter-email routing | ❌ | ✅ | add (Phase E) |
| Discovery scale + fresh alerts | 115 cos / on-demand | "50k+ / seconds" | widen (Phase D) |
| Zero API keys / local-first / anti-spam / Open Job Graph | ✅ (we're ahead) | ❌ | **preserve** |

The bet: we already built the engine. We add a *surface*, not a second product.

## 2. Goals & non-goals

**Goals**
- A local web GUI (`localhost`) that drives the existing engine end-to-end: profile, resumes, discovery, fit, tailoring, drafting, autofill/submit, pipeline tracking, workflows.
- The MCP server keeps working **unchanged** — zero regression to the 216 existing tests, still zero-key via sampling.
- Both surfaces share **one** `~/.crosswalk/state.db` and **one** core. No logic is duplicated.
- The GUI gets model access via an **opt-in API key** (Anthropic by default), wrapped in the *existing* `SamplingClient` so no service changes.
- Preserve the structural bets: local-first, no telemetry, Open Job Graph, applications-as-PRs, anti-spam (now user-configurable).

**Non-goals (for this spec)**
- No hosted/cloud multi-tenant version. Everything stays on the user's machine.
- No mobile app, iMessage, or Chrome-extension surface (possible later; out of scope).
- No rewrite of services, store, ATS adapters, or tools. We add an LLM backend and a web app; we touch core only to extract a shared package and to make the anti-spam cap configurable.

## 3. The core insight — the seam already exists

Three facts in the current code make this a *surface addition*, not a rebuild:

1. **LLM access is injected through one interface.** `SamplingClient` (`src/sampling/client.ts`) wraps any object shaped like:
   ```ts
   { createMessage(req): Promise<{ content: { type: 'text'; text: string } }> }
   ```
   Today that object is the MCP `Server`. Provide a *different* implementation backed by the Anthropic API and every service works unchanged.

2. **Every capability is a `run(input, ctx)`.** `toolDefinitions` (`src/tools/index.ts`) exposes all 18 tools as `{ name, inputSchema, run(input, ctx) }` where `ctx: ToolCtx = { db, sampling, browser }`. The web app can invoke the exact same tools **in-process** — no stdio, no reimplementation.

3. **`ARCHITECTURE.md` already anticipates this.** §"MCP sampling" documents a "BYOK fallback (user-supplied AI key in `~/.crosswalk/config.json`)" as opt-in. The GUI is that fallback, made first-class for the web surface.

So the new code is small and well-bounded:
- one **API sampling backend** (implements `createMessage`),
- one **web app** (Next.js) whose API routes are a thin bridge to `toolDefinitions[].run(...)`,
- the **genuinely new features** (live browser view, email ingestion, wider discovery) layered on top.

## 4. Architecture

```
            ┌──────────────────── @crosswalk/core (today's src/) ─────────────────────┐
            │  store · services · ats · exporters · parsers · resources               │
            │  tools/(toolDefinitions: run(input, ctx))  ·  SamplingClient            │
            └───────────────▲────────────────────────────────────────▲────────────────┘
       ctx={db,sampling,     │                                        │  ctx={db,sampling,
            browser}         │                                        │       browser}
   ┌─────────────────────────┴───────────┐         ┌──────────────────┴───────────────────────┐
   │ apps/mcp  (today's server.ts/cli.ts)│         │ apps/web  (NEW — Next.js @ localhost:3000)│
   │ sampling = MCP host  →  zero key     │         │ sampling = ApiSamplingBackend (API key)   │
   │ surface = stdio tools/resources      │         │ surface = REST/stream routes + React UI   │
   └──────────────────────────────────────┘         │ extras  = live browser view, email, feed  │
                                                     └────────────────────────────────────────────┘
                         both read/write   ~/.crosswalk/state.db   (WAL SQLite)
```

### 4.1 LLM backend abstraction

New file `packages/core/src/sampling/apiBackend.ts` (or `src/sampling/apiBackend.ts` pre-extraction):

```ts
// Implements the SdkServer shape that SamplingClient already expects.
export class ApiSamplingBackend {
  constructor(opts: { apiKey: string; model?: string; baseURL?: string }) {}
  async createMessage(req: {
    messages: { role: 'user'|'assistant'; content: { type:'text'; text:string } }[];
    maxTokens: number; systemPrompt?: string; temperature?: number;
  }): Promise<{ content: { type: 'text'; text: string } }> { /* Anthropic SDK call */ }
}
```

- Default provider: **Anthropic** (`@anthropic-ai/sdk`), default model `claude-sonnet-4-6` for cost, `claude-opus-4-7` selectable for quality. Configurable `baseURL` lets advanced users point at the **Vercel AI Gateway** or a compatible proxy.
- **Prompt caching**: the master profile + base résumé text are large and reused across every tailoring/scoring call — mark them as cache breakpoints to cut cost (see the `claude-api` skill when implementing).
- Wrapped by the **existing** `SamplingClient`, so `complete()` / `completeJson<T>()` retry + JSON-mode behavior is identical to the MCP path.
- The MCP path does **not** use this backend; it keeps using host sampling. The two are independent constructors of the same `ctx`.

### 4.2 Repo structure (npm workspaces, minimal churn)

The current package is `crosswalk-mcp` with everything under `src/`. We convert to a small workspace so two apps can share one core without copy-paste, while keeping the published MCP package and its build intact.

```
crosswalk/                      (repo root; private workspace root)
├── package.json                ("workspaces": ["packages/*","apps/*"])
├── packages/core/              ← today's src/ moves here, published as crosswalk-mcp
│   ├── package.json            (name: crosswalk-mcp, bin: dist/cli.js — unchanged)
│   └── src/ … (store, services, ats, exporters, tools, sampling, + apiBackend.ts)
└── apps/web/                   ← NEW Next.js app (private, not published)
    └── …
```

**Migration safety:** moving `src/` → `packages/core/src/` is a path move; the existing `tsup`/`vitest` config, imports, and 216 tests must stay green after the move (this is the *first* task of the plan, gated on a full green test run). Internal relative imports are unaffected; only the workspace wiring is new. If the move proves disruptive, the fallback is to keep `src/` at root and have `apps/web` import it via a `file:` dependency — decided during Phase A task 1, not now.

### 4.3 The web app (`apps/web`)

- **Next.js (App Router) + TypeScript**, **Tailwind + shadcn/ui**.
- Runs **Node runtime** route handlers (not Edge) because it imports `better-sqlite3` (native) and drives Playwright. Binds to `localhost` only.
- **API routes are a thin bridge**: each builds `ctx = { db: openDb(), sampling: new SamplingClient(new ApiSamplingBackend(cfg)), browser: new LazyPlaywrightBrowser() }` and calls the relevant `toolDefinitions[].run(input, ctx)` — or a service directly for streaming. No business logic in the web layer.
- **Streaming**: long AI ops (tailor, cover letter, explain) stream tokens to the UI. Because the existing `SamplingClient.complete()` is non-streaming, Phase B adds an optional `completeStream()` to the backend used only by the web surface; the MCP path is untouched.
- **Pages (Phase A baseline):** Onboarding/Settings (API key, model, anti-spam cap, submit policy) · Profile · Résumés · Job feed (fetch + filters incl. H-1B) · Fit (score/explain) · Pipeline board.

### 4.4 Single-DB concurrency

Both surfaces may open the DB; SQLite WAL handles concurrent readers + a single writer. The MCP server and the web app are separate processes pointed at the same file. Risk and mitigation in §9.

## 5. Data-model additions

All additive migrations (the store uses a `migrations` table; never edit shipped migrations).

- **Migration 4 — `app_config`** (single-row, like `profile`): stores GUI settings — selected model, anti-spam weekly cap (default keeps 10), default submit policy (`review` | `auto`), feature flags. API key is **not** stored here by default (see §8).
- **Migration 5 — `saved_search`** (Phase D): persisted discovery filters that power the background poller + alerts feed.
- **Migration 6 — `notification`** (Phase D): new-match / status-change events surfaced in the GUI.
- **Migration 7 — `inbound_email` + `email_account`** (Phase E): ingested recruiter emails and their link to an `application`.

Existing tables are unchanged. The anti-spam cap becomes a read from `app_config` (falling back to the constant 10) inside `guardrail.ts` — the one small core change, fully test-covered.

## 6. Phases (each independently usable)

Numbered as milestones continuing the existing sequence (current = M17 / v2.0).

| Phase | Milestone | Ships | Closes |
|---|---|---|---|
| **A** | M18 / v3.0 | Workspace split; `ApiSamplingBackend`; Next.js shell; Settings; Profile/Résumés/Job-feed/Fit/Pipeline pages driving existing tools. **Both ways work; MCP untouched.** | No-GUI (#1) |
| **B** | M19 | In-UI authoring + apply: tailor/draft/preview/apply with **streaming**, résumé diff view, DOCX/HTML download, autofill + opt-in submit from buttons | usability |
| **C** | M20 | Live on-screen automation: headed/streamed Playwright (CDP screencast) shown in the browser; step-through review | live-view transparency |
| **D** | M21 | Discovery scale + alerts: `saved_search`, background poller (extends the workflow engine), new-match feed + notifications, registry expansion | discovery scale (#2) |
| **E** | M22 | Recruiter email + interviews: Gmail/IMAP ingest, auto-route to applications, parse interview invites | email routing (#3) |
| **F** | M23 | Packaging: optional desktop shell (Tauri/Electron) wrapping `localhost`, one-command launch | product polish |

**Phase A is the milestone that makes it real.** This spec's implementation plan covers **Phase A only**; B–F get their own plans (matching how M1–M17 were built).

## 7. Phase A — definition of done

1. Workspace split complete; `npm test` green (all 216 existing tests), `npm run lint` clean, `npm run build` still emits the MCP `dist/`.
2. `ApiSamplingBackend` implemented + unit-tested (mocked Anthropic client; verifies it satisfies the `SamplingClient` contract and that `completeJson` parses).
3. `guardrail.ts` reads the configurable cap from `app_config` with the 10 default; covered by tests for both default and overridden values.
4. Next.js app boots on `localhost:3000`, talks to the same DB, and can: set the API key, set up a profile, add a résumé, fetch + filter jobs (incl. H-1B), score/explain fit, and view the pipeline — each via the existing tool through the API bridge.
5. The MCP server still installs and runs (smoke test unchanged).
6. README + ARCHITECTURE updated with the dual-surface diagram and a "Run the GUI" quick start.

## 8. Security & privacy (preserve the local-first ethos)

- **Localhost only.** The web server binds to `127.0.0.1`; it is a personal tool, not a hosted service. No auth layer in Phase A beyond that (single local user); revisit if Phase F ships a shareable shell.
- **API key handling.** Read from `ANTHROPIC_API_KEY` env or `~/.crosswalk/config.json` (gitignored, `chmod 600`). Never written to `state.db`, never logged, never sent anywhere except the model provider. Shown masked in Settings.
- **No telemetry / phone-home** — unchanged. The only egress remains ATS APIs, the model provider, and (Phase E) the user's own email provider.
- **Auto-submit stays opt-in** and honestly labeled, with the ToS caveat surfaced in the UI.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Workspace move breaks the 216 tests / MCP build | First plan task; gated on full green test + build + boot smoke before any feature work. Fallback: keep `src/` at root, `file:` dep. |
| `better-sqlite3` (native) under Next.js bundling | Node-runtime route handlers + mark as external / `serverExternalPackages`; validate in Phase A task 1. |
| Two processes writing one SQLite file | WAL + `busy_timeout`; writes are short. Document "GUI or MCP as the primary writer"; revisit a single-writer broker only if contention appears. |
| API-key path undermines "zero-key" identity | MCP path stays key-free and is the documented default; the key is required *only* for the standalone GUI and is clearly opt-in. |
| ATS ToS / anti-bot / captcha on auto-submit | Keep review-then-submit default; surface ToS caveat; captcha detection is already on the v2.1 roadmap and slots into Phase B/C. |
| Scope ("everything") sprawl | Strict phase gates; only Phase A is planned now; B–F are roadmap with their own specs/plans. |

## 10. Testing approach

- **Core/back-end:** continue vitest + in-memory SQLite + mocked sampling. `ApiSamplingBackend` tested against a mocked Anthropic client. Guardrail config tested both ways. Keep the "every change is TDD'd" discipline from M1–M17.
- **Web:** component tests for critical UI; a thin set of Playwright e2e happy-paths (the app already depends on Playwright) against a seeded in-memory/temp DB and a stubbed model backend — no live LLM or ATS calls in CI.
- **Regression gate:** the existing 216 tests must stay green at every task boundary.

## 11. Decisions made (so the plan needn't re-litigate)

- Web framework: **Next.js App Router** (Node runtime), Tailwind + shadcn/ui.
- LLM for GUI: **Anthropic API** default, key opt-in, `baseURL`-swappable for AI Gateway; prompt caching on the profile/résumé.
- Repo: **npm workspaces**, core stays `crosswalk-mcp`, web is private `apps/web`.
- Reuse path: web API routes call **existing `toolDefinitions[].run()`**; no logic duplication.
- Anti-spam cap: **configurable via `app_config`**, default unchanged (10/week).
- Scope: implement **Phase A** now; B–F are roadmap.

## 12. Open questions (non-blocking; resolve during the plan)

- Exact workspace layout vs. `file:`-dep fallback — decided empirically in Phase A task 1 by whichever keeps tests/build green with least churn.
- Whether the web app reuses `LazyPlaywrightBrowser` as-is or needs a headed variant — deferred to Phase C; Phase A doesn't drive the browser.
