# Crosswalk GUI — Phase A (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-package MCP server into a workspace whose engine is consumable by a second surface, add an API-key LLM backend (so the engine can run without an MCP host), and make the anti-spam cap user-configurable — all without changing MCP behavior or breaking the 216 existing tests.

**Architecture:** Convert the repo to npm workspaces with the existing package at `packages/core` (still published as `crosswalk-mcp`). Add `ApiSamplingBackend`, which implements the exact `createMessage` shape the existing `SamplingClient` already expects, so every service works unchanged with either an MCP host or a direct Anthropic key. Add an `app_config` table + `runtime.ts` library entry (`crosswalk-mcp/runtime`) that the future web app imports. No services, tools, ATS adapters, or migrations are rewritten — only additive.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`, `.ts`-extension imports), better-sqlite3, tsup, vitest, `@anthropic-ai/sdk`, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-26-crosswalk-gui-design.md` (this plan = Phase A foundation; the Next.js UI is a separate follow-up plan).

---

## File Structure

**Created:**
- `package.json` (repo root) — workspace root, `private`, `workspaces: ["packages/*","apps/*"]`.
- `packages/core/src/sampling/apiBackend.ts` — Anthropic-backed `createMessage` implementation.
- `packages/core/src/store/appConfig.ts` — typed single-row config store (`getConfig`/`setConfig`).
- `packages/core/src/runtime.ts` — library entry re-exporting the engine surface + self-registering adapters.
- `packages/core/tests/sampling.apiBackend.test.ts`
- `packages/core/tests/store.appConfig.test.ts`
- `packages/core/tests/guardrail.config.test.ts`
- `packages/core/tests/runtime.test.ts`

**Moved (Task 1, structural — path change only):**
- `src/`, `tests/`, `registry/`, `tsconfig.json`, `vitest.config.ts`, package `package.json` → under `packages/core/`.

**Modified:**
- `packages/core/package.json` — add `@anthropic-ai/sdk` dep, `runtime` build entry, `exports` map.
- `packages/core/src/store/migrations.ts` — add migration id **5** (`app_config`).
- `packages/core/src/services/guardrail.ts` — read weekly cap from `app_config`.

**Untouched at repo root:** `.git`, `.gitignore`, `LICENSE`, `README.md`, `docs/`.

---

### Task 1: Convert to npm workspaces (no behavior change)

**Files:**
- Create: `package.json` (repo root)
- Move: `src/ tests/ registry/ tsconfig.json vitest.config.ts package.json` → `packages/core/`

- [ ] **Step 1: Move the existing package into `packages/core/`**

Run from repo root (`/Users/mohakgarg/Desktop/Job-Os`):
```bash
mkdir -p packages/core
git mv src tests registry tsconfig.json vitest.config.ts package.json packages/core/
# build artifacts + lockfile regenerate under the workspace; remove the old root copies
git rm -r --quiet --ignore-unmatch dist 2>/dev/null; rm -rf dist node_modules package-lock.json
```

- [ ] **Step 2: Create the workspace root `package.json`**

Create `package.json` (repo root):
```json
{
  "name": "crosswalk-monorepo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test -w crosswalk-mcp",
    "lint": "npm run lint -w crosswalk-mcp",
    "build:core": "npm run build -w crosswalk-mcp"
  }
}
```

- [ ] **Step 3: Install and verify the existing suite is green from the new location**

Run:
```bash
npm install
npm test
```
Expected: vitest runs from `packages/core` and reports **216 passed**. (`paths.registryDir()` resolves to `packages/core/registry` because `config.ts` now lives at `packages/core/src/config.ts` and resolves `../registry`.)

- [ ] **Step 4: Verify lint and the MCP build still work**

Run:
```bash
npm run lint
npm run build:core
ls packages/core/dist/server.js packages/core/dist/cli.js
```
Expected: `tsc --noEmit` clean; `dist/server.js` and `dist/cli.js` emitted.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: convert to npm workspaces; move package to packages/core"
```

---

### Task 2: `ApiSamplingBackend` (run the engine without an MCP host)

**Files:**
- Create: `packages/core/src/sampling/apiBackend.ts`
- Test: `packages/core/tests/sampling.apiBackend.test.ts`
- Modify: `packages/core/package.json` (add dependency)

- [ ] **Step 1: Add the Anthropic SDK dependency**

Run:
```bash
npm install @anthropic-ai/sdk -w crosswalk-mcp
```
Expected: `@anthropic-ai/sdk` appears under `dependencies` in `packages/core/package.json`.

- [ ] **Step 2: Write the failing test**

Create `packages/core/tests/sampling.apiBackend.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ApiSamplingBackend } from '../src/sampling/apiBackend.ts';
import { SamplingClient } from '../src/sampling/client.ts';

function fakeClient(reply: string, sink?: unknown[]) {
  return {
    messages: {
      create: async (body: unknown) => {
        sink?.push(body);
        return { content: [{ type: 'text', text: reply }] };
      }
    }
  };
}

describe('ApiSamplingBackend', () => {
  it('maps the sampling request to the Anthropic Messages API and extracts text', async () => {
    const calls: any[] = [];
    const backend = new ApiSamplingBackend({ client: fakeClient('HELLO', calls), model: 'claude-sonnet-4-6' });
    const out = await backend.createMessage({
      messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
      systemPrompt: 'sys',
      maxTokens: 100,
      temperature: 0.2
    });
    expect(out).toEqual({ content: { type: 'text', text: 'HELLO' } });
    expect(calls[0].model).toBe('claude-sonnet-4-6');
    expect(calls[0].max_tokens).toBe(100);
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(calls[0].system[0]).toMatchObject({ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } });
  });

  it('satisfies the SamplingClient contract (complete + completeJson)', async () => {
    const sc = new SamplingClient(new ApiSamplingBackend({ client: fakeClient('{"a":1}') }));
    expect(await sc.complete({ prompt: 'x', maxTokens: 50 })).toBe('{"a":1}');
    expect(await sc.completeJson<{ a: number }>({ prompt: 'x', maxTokens: 50 })).toEqual({ a: 1 });
  });

  it('throws fast when no api key and no injected client', () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new ApiSamplingBackend({})).toThrow(/api key/i);
    if (prev) process.env.ANTHROPIC_API_KEY = prev;
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- sampling.apiBackend`
Expected: FAIL — cannot find module `../src/sampling/apiBackend.ts`.

- [ ] **Step 4: Implement `ApiSamplingBackend`**

Create `packages/core/src/sampling/apiBackend.ts`:
```ts
/**
 * An SdkServer-shaped LLM backend backed by the Anthropic API.
 * Wrapped by the existing SamplingClient so every service works unchanged
 * whether the model comes from an MCP host (sampling) or a direct API key.
 */

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

type CreateBody = {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export interface AnthropicLike {
  messages: {
    create(body: CreateBody): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

export type ApiSamplingBackendOpts = {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  /** Inject a client in tests. */
  client?: AnthropicLike;
  /** Mark the system prompt as an ephemeral cache breakpoint (default true). */
  cacheSystemPrompt?: boolean;
};

export class ApiSamplingBackend {
  private readonly model: string;
  private readonly baseURL?: string;
  private readonly apiKey?: string;
  private readonly cacheSystemPrompt: boolean;
  private readonly injected?: AnthropicLike;
  private clientPromise: Promise<AnthropicLike> | null = null;

  constructor(opts: ApiSamplingBackendOpts = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseURL = opts.baseURL;
    this.cacheSystemPrompt = opts.cacheSystemPrompt ?? true;
    this.injected = opts.client;
    if (!this.injected) {
      this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!this.apiKey) {
        throw new Error('ApiSamplingBackend: no API key (set ANTHROPIC_API_KEY or pass { apiKey }).');
      }
    }
  }

  private async getClient(): Promise<AnthropicLike> {
    if (this.injected) return this.injected;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const mod = (await import('@anthropic-ai/sdk')) as unknown as { default: new (o: unknown) => AnthropicLike };
        const Anthropic = mod.default;
        return new Anthropic({ apiKey: this.apiKey, baseURL: this.baseURL });
      })();
    }
    return this.clientPromise;
  }

  async createMessage(req: {
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
    maxTokens: number;
    systemPrompt?: string;
    temperature?: number;
  }): Promise<{ content: { type: 'text'; text: string } }> {
    const client = await this.getClient();
    const system = req.systemPrompt
      ? (this.cacheSystemPrompt
          ? [{ type: 'text' as const, text: req.systemPrompt, cache_control: { type: 'ephemeral' as const } }]
          : req.systemPrompt)
      : undefined;
    const res = await client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      system,
      messages: req.messages.map(m => ({ role: m.role, content: m.content.text }))
    });
    const text = res.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('');
    return { content: { type: 'text', text } };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- sampling.apiBackend`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sampling/apiBackend.ts packages/core/tests/sampling.apiBackend.test.ts packages/core/package.json package-lock.json
git commit -m "feat(sampling): ApiSamplingBackend — run the engine with a direct API key"
```

---

### Task 3: `app_config` table + store (migration 5)

**Files:**
- Modify: `packages/core/src/store/migrations.ts`
- Create: `packages/core/src/store/appConfig.ts`
- Test: `packages/core/tests/store.appConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/store.appConfig.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { getConfig, setConfig, DEFAULT_APP_CONFIG } from '../src/store/appConfig.ts';

describe('app_config store', () => {
  it('returns defaults when unset', () => {
    const db = openDb(':memory:');
    expect(getConfig(db)).toEqual(DEFAULT_APP_CONFIG);
  });

  it('merges partial updates and persists across reads', () => {
    const db = openDb(':memory:');
    setConfig(db, { weeklyCap: 50 });
    expect(getConfig(db).weeklyCap).toBe(50);
    expect(getConfig(db).submitPolicy).toBe('review'); // untouched default
    setConfig(db, { submitPolicy: 'auto' });
    expect(getConfig(db)).toMatchObject({ weeklyCap: 50, submitPolicy: 'auto' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- store.appConfig`
Expected: FAIL — cannot find module `../src/store/appConfig.ts`.

- [ ] **Step 3: Add migration id 5**

In `packages/core/src/store/migrations.ts`, append a new object to the `migrations` array (after the `fit_score_cache` migration, id 4):
```ts
  ,
  {
    id: 5,
    name: 'app_config',
    sql: `
      CREATE TABLE app_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  }
```

- [ ] **Step 4: Implement the config store**

Create `packages/core/src/store/appConfig.ts`:
```ts
import type { Db } from './db.ts';

export type SubmitPolicy = 'review' | 'auto';

export type AppConfig = {
  /** Model id used by the API-key (GUI) sampling path. */
  model: string;
  /** Anti-spam weekly application cap. */
  weeklyCap: number;
  /** Default auto-submit posture for the apply flow. */
  submitPolicy: SubmitPolicy;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  model: 'claude-sonnet-4-6',
  weeklyCap: 10,
  submitPolicy: 'review'
};

export function getConfig(db: Db): AppConfig {
  const row = db.prepare(`SELECT data_json FROM app_config WHERE id = 1`).get() as
    | { data_json: string }
    | undefined;
  if (!row) return { ...DEFAULT_APP_CONFIG };
  const stored = JSON.parse(row.data_json) as Partial<AppConfig>;
  return { ...DEFAULT_APP_CONFIG, ...stored };
}

export function setConfig(db: Db, patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(db), ...patch };
  db.prepare(`
    INSERT INTO app_config (id, data_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(next), new Date().toISOString());
  return next;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- store.appConfig`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the full suite to confirm the new migration didn't break anything**

Run: `npm test -w crosswalk-mcp`
Expected: all previous tests + 2 new = **218 passed**.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/store/migrations.ts packages/core/src/store/appConfig.ts packages/core/tests/store.appConfig.test.ts
git commit -m "feat(store): app_config table + typed getConfig/setConfig (migration 5)"
```

---

### Task 4: Make the anti-spam weekly cap configurable

**Files:**
- Modify: `packages/core/src/services/guardrail.ts`
- Test: `packages/core/tests/guardrail.config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/guardrail.config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { setConfig } from '../src/store/appConfig.ts';
import { checkGuardrail } from '../src/services/guardrail.ts';

describe('guardrail weekly cap is configurable', () => {
  it('blocks immediately when weeklyCap is 0', () => {
    const db = openDb(':memory:');
    setConfig(db, { weeklyCap: 0 });
    const res = checkGuardrail(db, { jobId: 'j1', resumeId: 'r1' });
    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.reason).toMatch(/0\/0/);
  });

  it('defaults to cap 10 (no config, no applications => allowed)', () => {
    const db = openDb(':memory:');
    const res = checkGuardrail(db, { jobId: 'j1', resumeId: 'r1' });
    expect(res.allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- guardrail.config`
Expected: FAIL — the `weeklyCap: 0` case still returns `allowed: true` because the current code uses the hardcoded `WEEKLY_CAP` constant.

- [ ] **Step 3: Read the configurable cap inside `checkGuardrail`**

In `packages/core/src/services/guardrail.ts`:

Add the import at the top (after the existing imports):
```ts
import { getConfig } from '../store/appConfig.ts';
```

Replace the weekly-cap block. Change:
```ts
  // 1. Weekly cap
  const cutoff = new Date(Date.now() - WEEKLY_WINDOW_MS).toISOString();
  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM application
     WHERE created_at >= ?
       AND status IN ('submitted', 'interviewing', 'rejected', 'offer')`
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
```
to:
```ts
  // 1. Weekly cap (configurable via app_config; defaults to WEEKLY_CAP)
  const cap = getConfig(db).weeklyCap;
  const cutoff = new Date(Date.now() - WEEKLY_WINDOW_MS).toISOString();
  const count = (db.prepare(
    `SELECT COUNT(*) AS n FROM application
     WHERE created_at >= ?
       AND status IN ('submitted', 'interviewing', 'rejected', 'offer')`
  ).get(cutoff) as { n: number }).n;
  if (count >= cap) {
    return {
      allowed: false,
      reason: `weekly cap reached (${count}/${cap} in the last 7 days). Quality > quantity — review your pipeline before adding more.`
    };
  }
  if (count >= Math.floor(cap * 0.8)) {
    warnings.push(`approaching weekly cap (${count}/${cap})`);
  }
```
Leave the `export const WEEKLY_CAP = 10;` line in place — it documents the default and may be imported elsewhere.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- guardrail.config`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite (existing guardrail tests must still pass with the default cap)**

Run: `npm test -w crosswalk-mcp`
Expected: **220 passed** (no regression — existing guardrail tests use no config row, so `cap` resolves to the default 10).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/services/guardrail.ts packages/core/tests/guardrail.config.test.ts
git commit -m "feat(guardrail): read weekly cap from app_config (default unchanged at 10)"
```

---

### Task 5: `runtime.ts` library entry

**Files:**
- Create: `packages/core/src/runtime.ts`
- Test: `packages/core/tests/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/runtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import * as runtime from '../src/runtime.ts';
import { listRegisteredAdapters } from '../src/ats/adapter.ts';

describe('runtime library entry', () => {
  it('exposes the engine surface the web app needs', () => {
    expect(typeof runtime.openDb).toBe('function');
    expect(typeof runtime.SamplingClient).toBe('function');
    expect(typeof runtime.ApiSamplingBackend).toBe('function');
    expect(typeof runtime.LazyPlaywrightBrowser).toBe('function');
    expect(typeof runtime.seedRegistryIfEmpty).toBe('function');
    expect(typeof runtime.getConfig).toBe('function');
    expect(typeof runtime.setConfig).toBe('function');
    expect(runtime.paths).toBeDefined();
    expect(Array.isArray(runtime.toolDefinitions)).toBe(true);
    expect(runtime.toolDefinitions.length).toBe(18);
  });

  it('self-registers all 10 ATS adapters on import', () => {
    expect(listRegisteredAdapters().length).toBe(10);
  });
});
```
(Note: `listRegisteredAdapters` is the registry accessor in `src/ats/adapter.ts` per `docs/ARCHITECTURE.md`. If the exported name differs, open that file and use the actual accessor.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w crosswalk-mcp -- runtime`
Expected: FAIL — cannot find module `../src/runtime.ts`.

- [ ] **Step 3: Implement the runtime entry**

Create `packages/core/src/runtime.ts`:
```ts
/**
 * Library entry consumed by the web surface (apps/web) via `crosswalk-mcp/runtime`.
 * Importing this module self-registers every ATS adapter (side-effect imports),
 * mirroring what src/server.ts does for the MCP surface.
 */
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';
import './ats/workable.ts';
import './ats/smartrecruiters.ts';
import './ats/bamboohr.ts';
import './ats/recruitee.ts';
import './ats/personio.ts';
import './ats/workday.ts';
import './ats/icims.ts';

export { openDb } from './store/db.ts';
export type { Db } from './store/db.ts';
export { seedRegistryIfEmpty } from './registryBoot.ts';
export { SamplingClient } from './sampling/client.ts';
export type { CompleteOpts } from './sampling/client.ts';
export { ApiSamplingBackend, DEFAULT_MODEL } from './sampling/apiBackend.ts';
export type { AnthropicLike, ApiSamplingBackendOpts } from './sampling/apiBackend.ts';
export { LazyPlaywrightBrowser } from './services/browser/playwright.ts';
export { toolDefinitions } from './tools/index.ts';
export type { ToolCtx } from './tools/index.ts';
export { paths } from './config.ts';
export { getConfig, setConfig, DEFAULT_APP_CONFIG } from './store/appConfig.ts';
export type { AppConfig, SubmitPolicy } from './store/appConfig.ts';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w crosswalk-mcp -- runtime`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/tests/runtime.test.ts
git commit -m "feat(runtime): library entry re-exporting the engine surface for the web app"
```

---

### Task 6: Build the runtime entry + `exports` map

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add the runtime build entry and exports map**

In `packages/core/package.json`:

Update the `build` script to include `src/runtime.ts` and externalize the native dep:
```json
    "build": "tsup src/server.ts src/cli.ts src/runtime.ts --format esm --clean --external playwright --external better-sqlite3"
```

Add an `exports` map (keep the existing `main` and `bin` as-is). Insert after `"main"`:
```json
  "exports": {
    ".": "./dist/server.js",
    "./runtime": "./dist/runtime.js"
  },
```

- [ ] **Step 2: Build and verify the runtime bundle is emitted**

Run:
```bash
npm run build -w crosswalk-mcp
ls packages/core/dist/runtime.js
```
Expected: `packages/core/dist/runtime.js` exists alongside `server.js` and `cli.js`.

- [ ] **Step 3: Smoke-test that the built runtime is importable through the package export**

Run from repo root:
```bash
node -e "import('crosswalk-mcp/runtime').then(m => { console.log('tools:', m.toolDefinitions.length); }).catch(e => { console.error(e); process.exit(1); })"
```
Expected: prints `tools: 18` (resolves via the workspace symlink + `exports` map; `better-sqlite3` loads as an external runtime require).

- [ ] **Step 4: Final regression — full suite, lint, and MCP boot smoke**

Run:
```bash
npm test -w crosswalk-mcp
npm run lint -w crosswalk-mcp
node packages/core/dist/cli.js < /dev/null & SVR=$!; sleep 1; kill $SVR 2>/dev/null; echo "mcp boot ok"
```
Expected: **220 passed**; lint clean; `mcp boot ok` printed (MCP server still starts).

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json
git commit -m "build(core): emit dist/runtime.js + add exports map for crosswalk-mcp/runtime"
```

---

## Self-Review

**1. Spec coverage (Phase A foundation portion):**
- "MCP server keeps working unchanged / no regression to 216 tests" → Task 1 (move, suite green), Task 6 Step 4 (boot smoke + suite). ✓
- "API-key LLM backend wrapped by existing SamplingClient" → Task 2. ✓
- "Both surfaces share one core" → Task 5 + Task 6 (`crosswalk-mcp/runtime` consumable). ✓
- "Configurable anti-spam cap, default unchanged" → Tasks 3 + 4. ✓
- "Additive migration for app_config" → Task 3 (id 5, corrects the spec's nominal "Migration 4" since 4 = `fit_score_cache`). ✓
- The Next.js app, Settings/Profile/Job-feed/Fit/Pipeline pages, and README/ARCHITECTURE updates from the spec's Phase A are **deferred to the follow-up UI plan** (separate subsystem — see handoff). This plan delivers the foundation those pages stand on.

**2. Placeholder scan:** No TBD/TODO. Every code step shows complete code; every run step shows the exact command and expected output. ✓

**3. Type consistency:** `ApiSamplingBackend` (Task 2) is re-exported in Task 5; `getConfig`/`setConfig`/`AppConfig`/`SubmitPolicy`/`DEFAULT_APP_CONFIG` (Task 3) are used in Tasks 4 and 5 with identical names; `createMessage`'s return shape `{ content: { type:'text'; text } }` matches what `SamplingClient` consumes. ✓

**4. One known external reference:** `listRegisteredAdapters` (Task 5 test) is sourced from `docs/ARCHITECTURE.md`; flagged inline to check `src/ats/adapter.ts` if the name differs.
