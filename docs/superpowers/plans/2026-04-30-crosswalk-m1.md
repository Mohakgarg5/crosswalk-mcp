# Crosswalk M1 Implementation Plan — Shell + Discover + Match

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working MCP server (`crosswalk-mcp`) that a user can install into Claude Desktop and use to: store a profile, store one or more resumes, fetch live jobs from Greenhouse/Lever/Ashby, get a numeric fit score and a narrative explanation — all with zero AI keys (sampling) and a local SQLite state file.

**Architecture:** TypeScript / Node 24 / `@modelcontextprotocol/sdk` over stdio. Local-first SQLite via `better-sqlite3`. ATS adapters behind a common `ATSAdapter` interface. All LLM work via MCP sampling — no provider SDKs, no API keys in this repo. State lives in `~/.crosswalk/state.db`. Companies → ATS slug live in a checked-in JSON registry (Open Job Graph).

**Tech Stack:** TypeScript 5.6+, Node 24, `@modelcontextprotocol/sdk`, `better-sqlite3`, `zod`, `vitest`, `mammoth` (DOCX), `pdf-parse` (PDF), `tsx` (dev runtime), `tsup` (bundler).

**M1 ships these tools:** `setup_profile`, `add_resume`, `list_resumes`, `fetch_jobs`, `score_fit`, `explain_fit`. Plus resources: `crosswalk://registry/companies`, `crosswalk://profile/me`. Plus a `crosswalk-mcp install` CLI for Claude Desktop.

**Out of M1 (deferred):** `tailor_resume`, `draft_application`, pipeline tools, scheduler, anti-spam guardrail, autonomous applying. See spec §11.

---

## File structure (locked in before tasks)

```
crosswalk-mcp/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore                     # already exists
├── README.md
├── LICENSE                        # MIT
├── src/
│   ├── server.ts                  # MCP server entrypoint, tool registration
│   ├── cli.ts                     # `crosswalk-mcp install` CLI
│   ├── config.ts                  # paths, env, BYOK fallback config
│   ├── store/
│   │   ├── db.ts                  # SQLite open + migrate
│   │   ├── migrations.ts          # schema migrations
│   │   ├── profile.ts             # profile CRUD
│   │   ├── resume.ts              # resume CRUD
│   │   ├── company.ts             # company CRUD + registry seed
│   │   └── job.ts                 # job cache CRUD
│   ├── sampling/
│   │   └── client.ts              # MCP sampling wrapper (retry, JSON-mode)
│   ├── ats/
│   │   ├── types.ts               # Job, ATSAdapter, common schema
│   │   ├── adapter.ts             # registry of adapter factories
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   └── ashby.ts
│   ├── parsers/
│   │   └── resume.ts              # DOCX/PDF/text → text → structured
│   └── tools/
│       ├── setup_profile.ts
│       ├── add_resume.ts
│       ├── list_resumes.ts
│       ├── fetch_jobs.ts
│       ├── score_fit.ts
│       └── explain_fit.ts
├── registry/
│   ├── companies.json             # Open Job Graph
│   └── h1b.json                   # H-1B sponsor confidence (seed)
├── tests/
│   ├── store.test.ts
│   ├── ats.greenhouse.test.ts
│   ├── ats.lever.test.ts
│   ├── ats.ashby.test.ts
│   ├── parsers.resume.test.ts
│   ├── tools.setup_profile.test.ts
│   ├── tools.add_resume.test.ts
│   ├── tools.fetch_jobs.test.ts
│   ├── tools.score_fit.test.ts
│   ├── tools.explain_fit.test.ts
│   └── fixtures/
│       ├── resume.txt
│       ├── greenhouse-jobs.json
│       ├── lever-jobs.json
│       └── ashby-jobs.json
└── docs/superpowers/...           # already exists
```

Each file has a single responsibility. No file should exceed ~250 lines; if it does during implementation, split before continuing.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/server.ts` (stub), `tests/smoke.test.ts`
- Modify: `.gitignore` (already exists; verify)

- [ ] **Step 1: Write the failing smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('imports the server module without throwing', async () => {
    const mod = await import('../src/server.ts');
    expect(mod).toBeDefined();
  });
});
```

- [ ] **Step 2: Initialize package.json**

Create `package.json`:

```json
{
  "name": "crosswalk-mcp",
  "version": "0.0.1",
  "description": "An AI-native, MCP-first career copilot. Local-first, zero API keys.",
  "type": "module",
  "bin": {
    "crosswalk-mcp": "dist/cli.js"
  },
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx src/server.ts",
    "build": "tsup src/server.ts src/cli.ts --format esm --dts --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "engines": { "node": ">=24" },
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "mammoth": "^1.8.0",
    "pdf-parse": "^1.1.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/pdf-parse": "^1.1.4",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Initialize tsconfig.json**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Initialize vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000
  }
});
```

- [ ] **Step 5: Stub the server module**

Create `src/server.ts`:

```ts
export const SERVER_NAME = 'crosswalk-mcp';
export const SERVER_VERSION = '0.0.1';
```

- [ ] **Step 6: Install and run the smoke test**

```bash
npm install
npm test
```
Expected: 1 passing test.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/server.ts tests/smoke.test.ts
git commit -m "chore: scaffold TypeScript + vitest project"
```

---

## Task 2: Config and paths

**Files:**
- Create: `src/config.ts`, `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

describe('config', () => {
  const original = process.env.CROSSWALK_HOME;
  beforeEach(() => { delete process.env.CROSSWALK_HOME; });
  afterEach(() => {
    if (original === undefined) delete process.env.CROSSWALK_HOME;
    else process.env.CROSSWALK_HOME = original;
  });

  it('defaults to ~/.crosswalk for stateDir', async () => {
    const { paths } = await import('../src/config.ts');
    expect(paths.stateDir()).toBe(path.join(os.homedir(), '.crosswalk'));
    expect(paths.dbFile()).toBe(path.join(os.homedir(), '.crosswalk', 'state.db'));
  });

  it('honors CROSSWALK_HOME override', async () => {
    process.env.CROSSWALK_HOME = '/tmp/cw';
    const { paths } = await import('../src/config.ts');
    expect(paths.stateDir()).toBe('/tmp/cw');
    expect(paths.dbFile()).toBe('/tmp/cw/state.db');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- config
```
Expected: FAIL — `Cannot find module '../src/config.ts'`.

- [ ] **Step 3: Implement config module**

Create `src/config.ts`:

```ts
import * as os from 'node:os';
import * as path from 'node:path';

export const paths = {
  stateDir(): string {
    return process.env.CROSSWALK_HOME ?? path.join(os.homedir(), '.crosswalk');
  },
  dbFile(): string {
    return path.join(paths.stateDir(), 'state.db');
  },
  registryDir(): string {
    return path.resolve(import.meta.dirname, '..', 'registry');
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- config
```
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config module with state and registry paths"
```

---

## Task 3: SQLite store — open + migrate

**Files:**
- Create: `src/store/db.ts`, `src/store/migrations.ts`, `tests/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/store.test.ts`:

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
    expect(names).toContain('migrations');
  });

  it('is idempotent across repeat openings', () => {
    const db1 = openDb(':memory:');
    const db2 = openDb(':memory:');
    // No throw on either call
    expect(db1).toBeDefined();
    expect(db2).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- store
```
Expected: FAIL.

- [ ] **Step 3: Implement migrations**

Create `src/store/migrations.ts`:

```ts
import type Database from 'better-sqlite3';

export type Migration = { id: number; name: string; sql: string };

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
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
    `
  }
];

export function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare(`SELECT id FROM migrations`).all() as Array<{ id: number }>).map(r => r.id)
  );
  const insert = db.prepare(`INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)`);
  const tx = db.transaction((m: Migration) => {
    db.exec(m.sql);
    insert.run(m.id, m.name, new Date().toISOString());
  });
  for (const m of migrations) {
    if (!applied.has(m.id)) tx(m);
  }
}
```

- [ ] **Step 4: Implement db open**

Create `src/store/db.ts`:

```ts
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyMigrations } from './migrations.ts';
import { paths } from '../config.ts';

export type Db = Database.Database;

export function openDb(file?: string): Db {
  const target = file ?? paths.dbFile();
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new Database(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return db;
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- store
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/db.ts src/store/migrations.ts tests/store.test.ts
git commit -m "feat(store): SQLite open + initial schema migration"
```

---

## Task 4: Profile CRUD

**Files:**
- Create: `src/store/profile.ts`, `tests/store.profile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/store.profile.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { getProfile, upsertProfile } from '../src/store/profile.ts';

describe('store/profile', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('returns null when no profile is stored', () => {
    expect(getProfile(db)).toBeNull();
  });

  it('upserts and reads back', () => {
    upsertProfile(db, { name: 'Mohak Garg', headline: 'PM' });
    expect(getProfile(db)).toMatchObject({ name: 'Mohak Garg', headline: 'PM' });
  });

  it('overwrites on second upsert', () => {
    upsertProfile(db, { name: 'A' });
    upsertProfile(db, { name: 'B' });
    expect(getProfile(db)).toEqual({ name: 'B' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- profile
```
Expected: FAIL.

- [ ] **Step 3: Implement profile module**

Create `src/store/profile.ts`:

```ts
import type { Db } from './db.ts';

export type Profile = Record<string, unknown>;

export function getProfile(db: Db): Profile | null {
  const row = db
    .prepare(`SELECT data_json FROM profile WHERE id = 1`)
    .get() as { data_json: string } | undefined;
  return row ? (JSON.parse(row.data_json) as Profile) : null;
}

export function upsertProfile(db: Db, data: Profile): void {
  db.prepare(`
    INSERT INTO profile (id, data_json, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(data), new Date().toISOString());
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- profile
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/profile.ts tests/store.profile.test.ts
git commit -m "feat(store): profile CRUD"
```

---

## Task 5: Resume CRUD

**Files:**
- Create: `src/store/resume.ts`, `tests/store.resume.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/store.resume.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addResume, listResumes, getResume } from '../src/store/resume.ts';

describe('store/resume', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('lists empty initially', () => {
    expect(listResumes(db)).toEqual([]);
  });

  it('adds and lists resumes ordered by created_at desc', () => {
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'hello', parsed: { skills: ['ai'] } });
    addResume(db, { id: 'r2', label: 'Senior IC PM', rawText: 'world', parsed: { skills: ['ml'] } });
    const all = listResumes(db);
    expect(all.map(r => r.id)).toEqual(['r2', 'r1']);
    expect(getResume(db, 'r1')?.label).toBe('Generic PM');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- resume
```
Expected: FAIL.

- [ ] **Step 3: Implement resume module**

Create `src/store/resume.ts`:

```ts
import type { Db } from './db.ts';

export type Resume = {
  id: string;
  label: string;
  sourcePath?: string;
  rawText: string;
  parsed: Record<string, unknown>;
  createdAt: string;
};

export type ResumeInput = Omit<Resume, 'createdAt'>;

export function addResume(db: Db, input: ResumeInput): Resume {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO resume (id, label, source_path, raw_text, parsed_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.label, input.sourcePath ?? null, input.rawText,
         JSON.stringify(input.parsed), createdAt);
  return { ...input, createdAt };
}

export function listResumes(db: Db): Resume[] {
  return (db.prepare(`
    SELECT id, label, source_path AS sourcePath, raw_text AS rawText,
           parsed_json, created_at AS createdAt
    FROM resume ORDER BY created_at DESC, rowid DESC
  `).all() as Array<Resume & { parsed_json: string }>).map(r => ({
    id: r.id, label: r.label, sourcePath: r.sourcePath ?? undefined,
    rawText: r.rawText, parsed: JSON.parse(r.parsed_json) as Record<string, unknown>,
    createdAt: r.createdAt
  }));
}

export function getResume(db: Db, id: string): Resume | null {
  const r = db.prepare(`
    SELECT id, label, source_path AS sourcePath, raw_text AS rawText,
           parsed_json, created_at AS createdAt
    FROM resume WHERE id = ?
  `).get(id) as (Resume & { parsed_json: string }) | undefined;
  if (!r) return null;
  return {
    id: r.id, label: r.label, sourcePath: r.sourcePath ?? undefined,
    rawText: r.rawText, parsed: JSON.parse(r.parsed_json) as Record<string, unknown>,
    createdAt: r.createdAt
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- resume
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/resume.ts tests/store.resume.test.ts
git commit -m "feat(store): resume CRUD"
```

---

## Task 6: Company CRUD + registry seed

**Files:**
- Create: `src/store/company.ts`, `registry/companies.json`, `registry/h1b.json`, `tests/store.company.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/store.company.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany, listCompaniesByAts, seedCompaniesFrom } from '../src/store/company.ts';

describe('store/company', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('upserts and lists by ats', () => {
    upsertCompany(db, { id: 'c1', name: 'Acme', ats: 'greenhouse', atsOrgSlug: 'acme' });
    upsertCompany(db, { id: 'c2', name: 'Globex', ats: 'lever', atsOrgSlug: 'globex' });
    expect(listCompaniesByAts(db, 'greenhouse').map(c => c.name)).toEqual(['Acme']);
  });

  it('seeds from a registry array', () => {
    seedCompaniesFrom(db, [
      { id: 'c1', name: 'Acme', ats: 'greenhouse', atsOrgSlug: 'acme' },
      { id: 'c2', name: 'Globex', ats: 'lever', atsOrgSlug: 'globex' }
    ]);
    expect(listCompaniesByAts(db, 'greenhouse')).toHaveLength(1);
    expect(listCompaniesByAts(db, 'lever')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- company
```
Expected: FAIL.

- [ ] **Step 3: Create the registry seed (10 companies covering all 3 ATSs)**

Create `registry/companies.json`:

```json
[
  { "id": "stripe",        "name": "Stripe",        "ats": "greenhouse", "atsOrgSlug": "stripe" },
  { "id": "airbnb",        "name": "Airbnb",        "ats": "greenhouse", "atsOrgSlug": "airbnb" },
  { "id": "discord",       "name": "Discord",       "ats": "greenhouse", "atsOrgSlug": "discord" },
  { "id": "anthropic",     "name": "Anthropic",     "ats": "greenhouse", "atsOrgSlug": "anthropic" },
  { "id": "vercel",        "name": "Vercel",        "ats": "greenhouse", "atsOrgSlug": "vercel" },
  { "id": "netflix",       "name": "Netflix",       "ats": "lever",      "atsOrgSlug": "netflix" },
  { "id": "spotify",       "name": "Spotify",       "ats": "lever",      "atsOrgSlug": "spotify" },
  { "id": "shopify",       "name": "Shopify",       "ats": "lever",      "atsOrgSlug": "shopify" },
  { "id": "openai",        "name": "OpenAI",        "ats": "ashby",      "atsOrgSlug": "openai" },
  { "id": "ramp",          "name": "Ramp",          "ats": "ashby",      "atsOrgSlug": "ramp" }
]
```

Create `registry/h1b.json`:

```json
{
  "snapshotDate": "2026-01-15",
  "source": "USCIS H-1B Employer Data Hub (FY2025)",
  "companies": {
    "stripe":    { "confidence": 0.95, "lastSeen": "2025-09-30" },
    "airbnb":    { "confidence": 0.92, "lastSeen": "2025-09-30" },
    "discord":   { "confidence": 0.78, "lastSeen": "2025-09-30" },
    "anthropic": { "confidence": 0.88, "lastSeen": "2025-09-30" },
    "vercel":    { "confidence": 0.71, "lastSeen": "2025-09-30" },
    "netflix":   { "confidence": 0.96, "lastSeen": "2025-09-30" },
    "spotify":   { "confidence": 0.83, "lastSeen": "2025-09-30" },
    "shopify":   { "confidence": 0.42, "lastSeen": "2025-09-30" },
    "openai":    { "confidence": 0.93, "lastSeen": "2025-09-30" },
    "ramp":      { "confidence": 0.81, "lastSeen": "2025-09-30" }
  }
}
```

> The registry will grow to 200+ companies in M4. These 10 are enough to validate all three adapters end-to-end.

- [ ] **Step 4: Implement company module**

Create `src/store/company.ts`:

```ts
import type { Db } from './db.ts';

export type Company = {
  id: string;
  name: string;
  ats: 'greenhouse' | 'lever' | 'ashby';
  atsOrgSlug: string;
  h1bConfidence?: number;
  h1bLastSeen?: string;
};

export function upsertCompany(db: Db, c: Company): void {
  db.prepare(`
    INSERT INTO company (id, name, ats, ats_org_slug, h1b_confidence, h1b_last_seen, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, ats = excluded.ats, ats_org_slug = excluded.ats_org_slug,
      h1b_confidence = excluded.h1b_confidence, h1b_last_seen = excluded.h1b_last_seen,
      updated_at = excluded.updated_at
  `).run(c.id, c.name, c.ats, c.atsOrgSlug, c.h1bConfidence ?? null,
         c.h1bLastSeen ?? null, new Date().toISOString());
}

export function listCompaniesByAts(db: Db, ats: Company['ats']): Company[] {
  return (db.prepare(`
    SELECT id, name, ats, ats_org_slug AS atsOrgSlug,
           h1b_confidence AS h1bConfidence, h1b_last_seen AS h1bLastSeen
    FROM company WHERE ats = ? ORDER BY name
  `).all(ats) as Company[]);
}

export function listAllCompanies(db: Db): Company[] {
  return (db.prepare(`
    SELECT id, name, ats, ats_org_slug AS atsOrgSlug,
           h1b_confidence AS h1bConfidence, h1b_last_seen AS h1bLastSeen
    FROM company ORDER BY name
  `).all() as Company[]);
}

export function seedCompaniesFrom(db: Db, list: Company[]): void {
  const tx = db.transaction((arr: Company[]) => { for (const c of arr) upsertCompany(db, c); });
  tx(list);
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- company
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/company.ts registry/companies.json registry/h1b.json tests/store.company.test.ts
git commit -m "feat(store): company CRUD + Open Job Graph seed (10 companies)"
```

---

## Task 7: Job cache CRUD

**Files:**
- Create: `src/store/job.ts`, `tests/store.job.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/store.job.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs, listJobs } from '../src/store/job.ts';

describe('store/job', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
  });

  it('upserts jobs and filters by recency', () => {
    upsertJobs(db, [{
      id: 'g-1', companyId: 'stripe', title: 'PM, Payments', dept: 'Product',
      location: 'SF', locationType: 'hybrid', url: 'https://x', descriptionMd: 'desc',
      postedAt: '2026-04-25T00:00:00Z', raw: {}
    }]);
    expect(listJobs(db, { sinceDays: 30 })).toHaveLength(1);
    expect(listJobs(db, { sinceDays: 1 })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- job
```
Expected: FAIL.

- [ ] **Step 3: Implement job module**

Create `src/store/job.ts`:

```ts
import type { Db } from './db.ts';

export type StoredJob = {
  id: string;
  companyId: string;
  title: string;
  dept?: string;
  location?: string;
  locationType?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  descriptionMd?: string;
  url: string;
  postedAt?: string;
  raw: Record<string, unknown>;
};

export type JobFilters = {
  sinceDays?: number;
  titleContains?: string;
  companyIds?: string[];
  locationContains?: string;
  remoteOnly?: boolean;
  limit?: number;
};

export function upsertJobs(db: Db, jobs: StoredJob[]): void {
  const stmt = db.prepare(`
    INSERT INTO job (id, company_id, title, dept, location, location_type,
                     salary_min, salary_max, currency, description_md, url,
                     posted_at, last_seen_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, dept = excluded.dept, location = excluded.location,
      location_type = excluded.location_type, salary_min = excluded.salary_min,
      salary_max = excluded.salary_max, currency = excluded.currency,
      description_md = excluded.description_md, url = excluded.url,
      posted_at = excluded.posted_at, last_seen_at = excluded.last_seen_at,
      raw_json = excluded.raw_json
  `);
  const now = new Date().toISOString();
  const tx = db.transaction((arr: StoredJob[]) => {
    for (const j of arr) {
      stmt.run(j.id, j.companyId, j.title, j.dept ?? null, j.location ?? null,
        j.locationType ?? null, j.salaryMin ?? null, j.salaryMax ?? null,
        j.currency ?? null, j.descriptionMd ?? null, j.url, j.postedAt ?? null,
        now, JSON.stringify(j.raw));
    }
  });
  tx(jobs);
}

export function listJobs(db: Db, f: JobFilters = {}): StoredJob[] {
  const where: string[] = [];
  const args: unknown[] = [];

  if (f.sinceDays !== undefined) {
    const cutoff = new Date(Date.now() - f.sinceDays * 86400_000).toISOString();
    where.push(`(posted_at IS NULL OR posted_at >= ?)`);
    args.push(cutoff);
  }
  if (f.titleContains) {
    where.push(`title LIKE ?`);
    args.push(`%${f.titleContains}%`);
  }
  if (f.companyIds?.length) {
    where.push(`company_id IN (${f.companyIds.map(() => '?').join(',')})`);
    args.push(...f.companyIds);
  }
  if (f.locationContains) {
    where.push(`location LIKE ?`);
    args.push(`%${f.locationContains}%`);
  }
  if (f.remoteOnly) {
    where.push(`location_type = 'remote'`);
  }

  const limit = f.limit ?? 50;
  const sql = `
    SELECT id, company_id AS companyId, title, dept, location,
           location_type AS locationType, salary_min AS salaryMin,
           salary_max AS salaryMax, currency, description_md AS descriptionMd,
           url, posted_at AS postedAt, raw_json
    FROM job
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY posted_at DESC NULLS LAST
    LIMIT ?
  `;

  return (db.prepare(sql).all(...args, limit) as Array<StoredJob & { raw_json: string }>).map(r => ({
    id: r.id, companyId: r.companyId, title: r.title,
    dept: r.dept ?? undefined, location: r.location ?? undefined,
    locationType: r.locationType ?? undefined,
    salaryMin: r.salaryMin ?? undefined, salaryMax: r.salaryMax ?? undefined,
    currency: r.currency ?? undefined,
    descriptionMd: r.descriptionMd ?? undefined,
    url: r.url, postedAt: r.postedAt ?? undefined,
    raw: JSON.parse(r.raw_json) as Record<string, unknown>
  }));
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- job
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/job.ts tests/store.job.test.ts
git commit -m "feat(store): job cache CRUD with filters"
```

---

## Task 8: ATS adapter framework

**Files:**
- Create: `src/ats/types.ts`, `src/ats/adapter.ts`, `tests/ats.framework.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ats.framework.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAdapter, registerAdapter } from '../src/ats/adapter.ts';
import type { ATSAdapter, NormalizedJob } from '../src/ats/types.ts';

describe('ats/adapter', () => {
  it('throws for unknown adapter', () => {
    expect(() => getAdapter('unknown')).toThrow(/unknown ats/i);
  });

  it('registers and retrieves a fake adapter', () => {
    const fake: ATSAdapter = {
      name: 'fake',
      async listJobs(): Promise<NormalizedJob[]> { return []; }
    };
    registerAdapter(fake);
    expect(getAdapter('fake')).toBe(fake);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- ats.framework
```
Expected: FAIL.

- [ ] **Step 3: Implement types**

Create `src/ats/types.ts`:

```ts
export type NormalizedJob = {
  externalId: string;        // unique within (ats, orgSlug)
  title: string;
  dept?: string;
  location?: string;
  locationType?: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  descriptionMd?: string;
  url: string;
  postedAt?: string;
  raw: Record<string, unknown>;
};

export type ATSAdapter = {
  name: string;
  listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]>;
};
```

- [ ] **Step 4: Implement adapter registry**

Create `src/ats/adapter.ts`:

```ts
import type { ATSAdapter } from './types.ts';

const registry = new Map<string, ATSAdapter>();

export function registerAdapter(a: ATSAdapter): void {
  registry.set(a.name, a);
}

export function getAdapter(name: string): ATSAdapter {
  const a = registry.get(name);
  if (!a) throw new Error(`unknown ats: ${name}`);
  return a;
}

export function listRegisteredAdapters(): string[] {
  return [...registry.keys()];
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- ats.framework
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ats/types.ts src/ats/adapter.ts tests/ats.framework.test.ts
git commit -m "feat(ats): adapter framework + Job normalization types"
```

---

## Task 9: Greenhouse adapter

**Files:**
- Create: `src/ats/greenhouse.ts`, `tests/ats.greenhouse.test.ts`, `tests/fixtures/greenhouse-jobs.json`

API reference: `https://boards-api.greenhouse.io/v1/boards/{org}/jobs?content=true`. Returns `{ jobs: [{ id, title, location: { name }, content, absolute_url, updated_at, departments: [{ name }], offices: [...] }] }`.

- [ ] **Step 1: Capture a fixture**

Create `tests/fixtures/greenhouse-jobs.json`:

```json
{
  "jobs": [
    {
      "id": 5523112004,
      "title": "Product Manager, Payments",
      "updated_at": "2026-04-25T12:00:00Z",
      "location": { "name": "San Francisco, CA" },
      "departments": [{ "name": "Product" }],
      "offices": [{ "name": "San Francisco" }],
      "absolute_url": "https://boards.greenhouse.io/stripe/jobs/5523112004",
      "content": "<p>Help build the next generation of payments.</p>"
    },
    {
      "id": 5523112005,
      "title": "Senior Software Engineer, Connect",
      "updated_at": "2026-04-20T12:00:00Z",
      "location": { "name": "Remote, US" },
      "departments": [{ "name": "Engineering" }],
      "offices": [],
      "absolute_url": "https://boards.greenhouse.io/stripe/jobs/5523112005",
      "content": "<p>Stripe Connect is...</p>"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/ats.greenhouse.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { greenhouse } from '../src/ats/greenhouse.ts';
import fixture from './fixtures/greenhouse-jobs.json' with { type: 'json' };

describe('ats/greenhouse', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await greenhouse.listJobs('stripe');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: '5523112004',
      title: 'Product Manager, Payments',
      dept: 'Product',
      location: 'San Francisco, CA',
      url: 'https://boards.greenhouse.io/stripe/jobs/5523112004'
    });
    expect(jobs[1].locationType).toBe('remote');
    expect(jobs[0].descriptionMd).toContain('next generation of payments');
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(greenhouse.listJobs('nope')).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- greenhouse
```
Expected: FAIL.

- [ ] **Step 4: Implement adapter**

Create `src/ats/greenhouse.ts`:

```ts
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';

type GhRaw = {
  jobs: Array<{
    id: number;
    title: string;
    updated_at?: string;
    location?: { name?: string };
    departments?: Array<{ name?: string }>;
    offices?: Array<unknown>;
    absolute_url: string;
    content?: string;
  }>;
};

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function inferLocationType(loc: string | undefined): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

export const greenhouse: ATSAdapter = {
  name: 'greenhouse',
  async listJobs(orgSlug: string): Promise<NormalizedJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(orgSlug)}/jobs?content=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`greenhouse ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as GhRaw;
    return data.jobs.map(j => ({
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
  }
};

registerAdapter(greenhouse);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- greenhouse
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ats/greenhouse.ts tests/ats.greenhouse.test.ts tests/fixtures/greenhouse-jobs.json
git commit -m "feat(ats): Greenhouse adapter"
```

---

## Task 10: Lever adapter

**Files:**
- Create: `src/ats/lever.ts`, `tests/ats.lever.test.ts`, `tests/fixtures/lever-jobs.json`

API: `https://api.lever.co/v0/postings/{org}?mode=json`. Returns array: `[{ id, text, hostedUrl, categories: { team, location, commitment }, createdAt, descriptionPlain }]`.

- [ ] **Step 1: Capture a fixture**

Create `tests/fixtures/lever-jobs.json`:

```json
[
  {
    "id": "abc-123",
    "text": "Senior Backend Engineer",
    "hostedUrl": "https://jobs.lever.co/netflix/abc-123",
    "categories": { "team": "Engineering", "location": "Los Gatos, CA", "commitment": "Full-time" },
    "createdAt": 1745539200000,
    "descriptionPlain": "Join the Netflix backend team..."
  },
  {
    "id": "def-456",
    "text": "Staff Designer",
    "hostedUrl": "https://jobs.lever.co/netflix/def-456",
    "categories": { "team": "Design", "location": "Remote, US", "commitment": "Full-time" },
    "createdAt": 1745366400000,
    "descriptionPlain": "Design the future of streaming..."
  }
]
```

- [ ] **Step 2: Write the failing test**

Create `tests/ats.lever.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lever } from '../src/ats/lever.ts';
import fixture from './fixtures/lever-jobs.json' with { type: 'json' };

describe('ats/lever', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await lever.listJobs('netflix');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'abc-123',
      title: 'Senior Backend Engineer',
      dept: 'Engineering',
      location: 'Los Gatos, CA',
      url: 'https://jobs.lever.co/netflix/abc-123'
    });
    expect(jobs[1].locationType).toBe('remote');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- lever
```
Expected: FAIL.

- [ ] **Step 4: Implement adapter**

Create `src/ats/lever.ts`:

```ts
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';

type LvRaw = Array<{
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { team?: string; location?: string; commitment?: string };
  descriptionPlain?: string;
}>;

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

export const lever: ATSAdapter = {
  name: 'lever',
  async listJobs(orgSlug: string): Promise<NormalizedJob[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(orgSlug)}?mode=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`lever ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as LvRaw;
    return data.map(j => ({
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
  }
};

registerAdapter(lever);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- lever
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ats/lever.ts tests/ats.lever.test.ts tests/fixtures/lever-jobs.json
git commit -m "feat(ats): Lever adapter"
```

---

## Task 11: Ashby adapter

**Files:**
- Create: `src/ats/ashby.ts`, `tests/ats.ashby.test.ts`, `tests/fixtures/ashby-jobs.json`

API: `https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true`. Returns `{ jobs: [{ id, title, locationName, departmentName, employmentType, jobUrl, publishedDate, descriptionHtml, compensationTierSummary }] }`.

- [ ] **Step 1: Capture a fixture**

Create `tests/fixtures/ashby-jobs.json`:

```json
{
  "jobs": [
    {
      "id": "uuid-1",
      "title": "Member of Technical Staff",
      "departmentName": "Research",
      "locationName": "San Francisco",
      "employmentType": "FullTime",
      "jobUrl": "https://jobs.ashbyhq.com/openai/uuid-1",
      "publishedDate": "2026-04-28T00:00:00Z",
      "descriptionHtml": "<p>Push the frontier of AI research.</p>",
      "compensationTierSummary": "$300K – $500K • USD"
    },
    {
      "id": "uuid-2",
      "title": "Software Engineer, Infra",
      "departmentName": "Engineering",
      "locationName": "Remote (US)",
      "employmentType": "FullTime",
      "jobUrl": "https://jobs.ashbyhq.com/openai/uuid-2",
      "publishedDate": "2026-04-22T00:00:00Z",
      "descriptionHtml": "<p>Scale our training infra.</p>"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/ats.ashby.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ashby } from '../src/ats/ashby.ts';
import fixture from './fixtures/ashby-jobs.json' with { type: 'json' };

describe('ats/ashby', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('lists jobs and normalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => fixture
    }));
    const jobs = await ashby.listJobs('openai');
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'uuid-1',
      title: 'Member of Technical Staff',
      dept: 'Research',
      location: 'San Francisco',
      url: 'https://jobs.ashbyhq.com/openai/uuid-1'
    });
    expect(jobs[0].salaryMin).toBe(300000);
    expect(jobs[0].salaryMax).toBe(500000);
    expect(jobs[1].locationType).toBe('remote');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- ashby
```
Expected: FAIL.

- [ ] **Step 4: Implement adapter**

Create `src/ats/ashby.ts`:

```ts
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';

type AbRaw = {
  jobs: Array<{
    id: string;
    title: string;
    departmentName?: string;
    locationName?: string;
    jobUrl: string;
    publishedDate?: string;
    descriptionHtml?: string;
    compensationTierSummary?: string;
  }>;
};

function htmlToMarkdown(html: string): string {
  return html.replace(/<\s*\/p\s*>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
}

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function parseSalary(s?: string): { min?: number; max?: number; currency?: string } {
  if (!s) return {};
  // Match e.g. "$300K – $500K • USD" or "$120,000 - $160,000 USD"
  const m = s.match(/\$?\s*([\d,.]+)\s*(K|M)?\s*[–-]\s*\$?\s*([\d,.]+)\s*(K|M)?(?:.*?\b([A-Z]{3})\b)?/);
  if (!m) return {};
  const scale = (suf?: string) => suf === 'K' ? 1000 : suf === 'M' ? 1_000_000 : 1;
  const lo = Math.round(parseFloat(m[1].replace(/,/g, '')) * scale(m[2]));
  const hi = Math.round(parseFloat(m[3].replace(/,/g, '')) * scale(m[4] ?? m[2]));
  return { min: lo, max: hi, currency: m[5] ?? 'USD' };
}

export const ashby: ATSAdapter = {
  name: 'ashby',
  async listJobs(orgSlug: string): Promise<NormalizedJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(orgSlug)}?includeCompensation=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ashby ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as AbRaw;
    return data.jobs.map(j => {
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
  }
};

registerAdapter(ashby);
```

- [ ] **Step 5: Run tests**

```bash
npm test -- ashby
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ats/ashby.ts tests/ats.ashby.test.ts tests/fixtures/ashby-jobs.json
git commit -m "feat(ats): Ashby adapter"
```

---

## Task 12: Sampling client wrapper

**Files:**
- Create: `src/sampling/client.ts`, `tests/sampling.test.ts`

The MCP SDK exposes `Server.createMessage()` for sampling. We wrap it with retry, JSON-mode parsing, and a host-capability check.

- [ ] **Step 1: Write the failing test**

Create `tests/sampling.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SamplingClient } from '../src/sampling/client.ts';

describe('sampling/client', () => {
  it('returns text from a successful sampling call', async () => {
    const fakeServer = {
      createMessage: vi.fn().mockResolvedValue({
        content: { type: 'text', text: 'hello world' }
      })
    } as unknown as ConstructorParameters<typeof SamplingClient>[0];
    const c = new SamplingClient(fakeServer);
    const out = await c.complete({ prompt: 'say hi', maxTokens: 32 });
    expect(out).toBe('hello world');
  });

  it('parses JSON when asJson is set', async () => {
    const fakeServer = {
      createMessage: vi.fn().mockResolvedValue({
        content: { type: 'text', text: '```json\n{"score": 0.8}\n```' }
      })
    } as unknown as ConstructorParameters<typeof SamplingClient>[0];
    const c = new SamplingClient(fakeServer);
    const out = await c.completeJson<{ score: number }>({ prompt: 'score', maxTokens: 64 });
    expect(out.score).toBe(0.8);
  });

  it('retries once on transient failure', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ content: { type: 'text', text: 'ok' } });
    const fakeServer = { createMessage: create } as unknown as ConstructorParameters<typeof SamplingClient>[0];
    const c = new SamplingClient(fakeServer);
    expect(await c.complete({ prompt: 'x', maxTokens: 8 })).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- sampling
```
Expected: FAIL.

- [ ] **Step 3: Implement sampling client**

Create `src/sampling/client.ts`:

```ts
type SdkServer = {
  createMessage(req: {
    messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string } }>;
    maxTokens: number;
    systemPrompt?: string;
    temperature?: number;
  }): Promise<{ content: { type: 'text'; text: string } }>;
};

export type CompleteOpts = {
  prompt: string;
  system?: string;
  maxTokens: number;
  temperature?: number;
};

export class SamplingClient {
  constructor(private readonly server: SdkServer) {}

  async complete(opts: CompleteOpts): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.server.createMessage({
          messages: [{ role: 'user', content: { type: 'text', text: opts.prompt } }],
          systemPrompt: opts.system,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature ?? 0.2
        });
        return res.content.text;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('sampling failed');
  }

  async completeJson<T>(opts: CompleteOpts): Promise<T> {
    const text = await this.complete({
      ...opts,
      system: (opts.system ?? '') +
        '\n\nRespond ONLY with valid JSON. No prose, no code fences.'
    });
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned) as T;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- sampling
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sampling/client.ts tests/sampling.test.ts
git commit -m "feat(sampling): MCP sampling wrapper with retry + JSON-mode"
```

---

## Task 13: Resume parser

**Files:**
- Create: `src/parsers/resume.ts`, `tests/parsers.resume.test.ts`, `tests/fixtures/resume.txt`

For DOCX/PDF we extract raw text; structuring (skills, experience, education) is sampling-driven and tested separately in the `add_resume` tool.

- [ ] **Step 1: Add a text fixture**

Create `tests/fixtures/resume.txt`:

```
Mohak Garg
Product Manager · Northwestern University

EXPERIENCE
Acme Corp — APM (2024–2025)
  • Shipped feature X to 1M users.
  • Led roadmap for vertical Y.

SKILLS
Python, SQL, Figma, Mixpanel
```

- [ ] **Step 2: Write the failing test**

Create `tests/parsers.resume.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { extractResumeText } from '../src/parsers/resume.ts';

describe('parsers/resume', () => {
  it('reads a .txt file as-is', async () => {
    const p = path.resolve('tests/fixtures/resume.txt');
    const text = await extractResumeText(p);
    expect(text).toContain('Mohak Garg');
    expect(text).toContain('Acme Corp');
  });

  it('accepts a raw string', async () => {
    expect(await extractResumeText({ rawText: 'hello' })).toBe('hello');
  });

  it('rejects unknown extensions', async () => {
    await expect(extractResumeText('/tmp/nonexistent.xyz')).rejects.toThrow(/unsupported/i);
  });

  // .docx / .pdf parsing covered with real fixtures in the tool tests.
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- parsers
```
Expected: FAIL.

- [ ] **Step 4: Implement parser**

Create `src/parsers/resume.ts`:

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type ExtractInput = string | { rawText: string };

export async function extractResumeText(input: ExtractInput): Promise<string> {
  if (typeof input !== 'string') return input.rawText;

  const ext = path.extname(input).toLowerCase();
  if (ext === '.txt' || ext === '.md') return (await fs.readFile(input, 'utf8'));

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ path: input });
    return value;
  }

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const buf = await fs.readFile(input);
    const out = await pdfParse(buf);
    return out.text;
  }

  throw new Error(`unsupported resume format: ${ext}`);
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- parsers
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parsers/resume.ts tests/parsers.resume.test.ts tests/fixtures/resume.txt
git commit -m "feat(parsers): resume text extraction (txt/md/docx/pdf)"
```

---

## Task 14: MCP server wiring (boot, list registry seed, no tools yet)

**Files:**
- Modify: `src/server.ts`
- Create: `src/registryBoot.ts`, `tests/registryBoot.test.ts`

This task replaces the `src/server.ts` stub from Task 1 with a real MCP server that boots, applies migrations, seeds the registry on first run, and registers (no) tools yet. Tools come in Tasks 15–20.

- [ ] **Step 1: Write the failing test**

Create `tests/registryBoot.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listAllCompanies } from '../src/store/company.ts';
import { seedRegistryIfEmpty } from '../src/registryBoot.ts';
import companies from '../registry/companies.json' with { type: 'json' };

describe('registryBoot', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('seeds when empty', () => {
    seedRegistryIfEmpty(db);
    expect(listAllCompanies(db)).toHaveLength(companies.length);
  });

  it('does not double-seed', () => {
    seedRegistryIfEmpty(db);
    seedRegistryIfEmpty(db);
    expect(listAllCompanies(db)).toHaveLength(companies.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- registryBoot
```
Expected: FAIL.

- [ ] **Step 3: Implement registry bootstrapper**

Create `src/registryBoot.ts`:

```ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Db } from './store/db.ts';
import { listAllCompanies, seedCompaniesFrom, type Company } from './store/company.ts';
import { paths } from './config.ts';

type H1bRow = { confidence: number; lastSeen: string };
type H1bFile = { snapshotDate: string; source: string; companies: Record<string, H1bRow> };

export function seedRegistryIfEmpty(db: Db): void {
  if (listAllCompanies(db).length > 0) return;

  const companiesPath = path.join(paths.registryDir(), 'companies.json');
  const h1bPath = path.join(paths.registryDir(), 'h1b.json');

  const companies = JSON.parse(fs.readFileSync(companiesPath, 'utf8')) as Company[];
  const h1b = JSON.parse(fs.readFileSync(h1bPath, 'utf8')) as H1bFile;

  const enriched: Company[] = companies.map(c => ({
    ...c,
    h1bConfidence: h1b.companies[c.id]?.confidence,
    h1bLastSeen: h1b.companies[c.id]?.lastSeen
  }));

  seedCompaniesFrom(db, enriched);
}
```

- [ ] **Step 4: Replace `src/server.ts` with the real entrypoint**

Replace contents of `src/server.ts`:

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from './store/db.ts';
import { seedRegistryIfEmpty } from './registryBoot.ts';
import { SamplingClient } from './sampling/client.ts';
// Adapters self-register on import
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';

export const SERVER_NAME = 'crosswalk-mcp';
export const SERVER_VERSION = '0.0.1';

export function bootstrap() {
  const db = openDb();
  seedRegistryIfEmpty(db);
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } } // `sampling` is a CLIENT capability in MCP; servers consume it via createMessage
  );
  const sampling = new SamplingClient(server as unknown as ConstructorConstructorParameters<typeof SamplingClient>[0]);
  return { db, server, sampling };
}

export async function main() {
  const { server } = bootstrap();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: all passing.

- [ ] **Step 6: Smoke-run the dev server**

```bash
npx tsx src/server.ts < /dev/null
```
Expected: process starts, waits for stdin, exits cleanly on Ctrl-C. (No tool registration yet.)

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/registryBoot.ts tests/registryBoot.test.ts
git commit -m "feat: MCP server bootstrap with adapter and registry wiring"
```

---

## Task 15: Tool — `setup_profile`

**Files:**
- Create: `src/tools/setup_profile.ts`, `tests/tools.setup_profile.test.ts`

`setup_profile` accepts a free-form description of the user (or runs as a sampling-driven interview if `description` is empty), structures it into a profile JSON, and stores it.

- [ ] **Step 1: Write the failing test**

Create `tests/tools.setup_profile.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { getProfile } from '../src/store/profile.ts';
import { setupProfile } from '../src/tools/setup_profile.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/setup_profile', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('stores a structured profile from a free-form description', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        name: 'Mohak Garg',
        headline: 'Product Manager',
        years_experience: 2,
        skills: ['Python', 'SQL'],
        wants: { roles: ['PM'], locations: ['NYC', 'remote'] }
      })
    } as unknown as SamplingClient;

    const result = await setupProfile(
      { description: 'I am Mohak, a PM with 2 yrs at Acme. Want NYC/remote.' },
      { db, sampling }
    );
    expect(result.profile.name).toBe('Mohak Garg');
    expect(getProfile(db)?.name).toBe('Mohak Garg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- setup_profile
```
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `src/tools/setup_profile.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { upsertProfile, type Profile } from '../store/profile.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const setupProfileInput = z.object({
  description: z.string().min(1)
    .describe('Free-form description of the user: background, current role, what they want next.')
});

export type SetupProfileInput = z.infer<typeof setupProfileInput>;

export type SetupProfileCtx = {
  db: Db;
  sampling: SamplingClient;
};

const SYSTEM = `You are a structured-profile extractor for a job-search assistant.
Given a free-form description of a person, return a JSON object with:
- name (string)
- headline (string, e.g., "Senior PM, Marketplaces")
- years_experience (number)
- skills (string[])
- wants: { roles: string[], locations: string[], comp_min?: number, must_have?: string[], must_avoid?: string[] }
- notes (string, anything else worth remembering)

Be faithful to the input. Do not invent facts.`;

export async function setupProfile(
  input: SetupProfileInput,
  ctx: SetupProfileCtx
): Promise<{ profile: Profile }> {
  const profile = await ctx.sampling.completeJson<Profile>({
    system: SYSTEM,
    prompt: input.description,
    maxTokens: 1024
  });
  upsertProfile(ctx.db, profile);
  return { profile };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- setup_profile
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/setup_profile.ts tests/tools.setup_profile.test.ts
git commit -m "feat(tools): setup_profile via sampling-driven extraction"
```

---

## Task 16: Tool — `add_resume` and `list_resumes`

**Files:**
- Create: `src/tools/add_resume.ts`, `src/tools/list_resumes.ts`, `tests/tools.add_resume.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/tools.add_resume.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { listResumes } from '../src/store/resume.ts';
import { addResume } from '../src/tools/add_resume.ts';
import { listResumesTool } from '../src/tools/list_resumes.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/add_resume + list_resumes', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('extracts text from a path, structures it, and stores it', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        skills: ['python', 'sql'], experiences: [{ company: 'Acme', title: 'APM' }]
      })
    } as unknown as SamplingClient;

    const out = await addResume(
      { path: 'tests/fixtures/resume.txt', label: 'Generic PM' },
      { db, sampling }
    );
    expect(out.id).toBeTypeOf('string');
    expect(listResumes(db)).toHaveLength(1);

    const list = await listResumesTool({}, { db });
    expect(list.resumes[0].label).toBe('Generic PM');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- add_resume
```
Expected: FAIL.

- [ ] **Step 3: Implement `add_resume`**

Create `src/tools/add_resume.ts`:

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Db } from '../store/db.ts';
import { addResume as storeAddResume, type Resume } from '../store/resume.ts';
import { extractResumeText } from '../parsers/resume.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const addResumeInput = z.object({
  path: z.string().optional().describe('Filesystem path to a .txt/.md/.docx/.pdf resume.'),
  rawText: z.string().optional().describe('Raw resume text (alternative to path).'),
  label: z.string().min(1).describe('Human-readable label, e.g., "Generic PM" or "Senior IC PM".')
}).refine(d => d.path || d.rawText, { message: 'one of path or rawText is required' });

export type AddResumeInput = z.infer<typeof addResumeInput>;

const SYSTEM = `Extract a structured resume into JSON with:
- skills (string[])
- experiences ({ company, title, start, end?, summary }[])
- education ({ school, degree?, field?, year? }[])
- projects ({ name, summary }[])
- highlights (string[], 3–5 short bullets capturing the strongest signals)
Do not invent facts. Use null/empty arrays if a section is absent.`;

export async function addResume(
  input: AddResumeInput,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<{ id: string; label: string }> {
  const rawText = await extractResumeText(input.path ?? { rawText: input.rawText! });
  const parsed = await ctx.sampling.completeJson<Record<string, unknown>>({
    system: SYSTEM,
    prompt: rawText,
    maxTokens: 2048
  });
  const id = randomUUID();
  const stored: Resume = storeAddResume(ctx.db, {
    id, label: input.label, sourcePath: input.path, rawText, parsed
  });
  return { id: stored.id, label: stored.label };
}
```

- [ ] **Step 4: Implement `list_resumes`**

Create `src/tools/list_resumes.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listResumes } from '../store/resume.ts';

export const listResumesInput = z.object({});

export async function listResumesTool(
  _input: z.infer<typeof listResumesInput>,
  ctx: { db: Db }
): Promise<{ resumes: Array<{ id: string; label: string; createdAt: string }> }> {
  return {
    resumes: listResumes(ctx.db).map(r => ({
      id: r.id, label: r.label, createdAt: r.createdAt
    }))
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- add_resume
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/add_resume.ts src/tools/list_resumes.ts tests/tools.add_resume.test.ts
git commit -m "feat(tools): add_resume + list_resumes"
```

---

## Task 17: Tool — `fetch_jobs`

**Files:**
- Create: `src/tools/fetch_jobs.ts`, `tests/tools.fetch_jobs.test.ts`

`fetch_jobs` aggregates across all configured ATSs, persists results to the job cache, and applies filters before returning. Filters include `titleContains`, `locationContains`, `remoteOnly`, `sinceDays`, `companyIds`, `h1bSponsorOnly`, `limit`.

- [ ] **Step 1: Write the failing test**

Create `tests/tools.fetch_jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { seedRegistryIfEmpty } from '../src/registryBoot.ts';
import { fetchJobs } from '../src/tools/fetch_jobs.ts';
import ghFixture from './fixtures/greenhouse-jobs.json' with { type: 'json' };
import lvFixture from './fixtures/lever-jobs.json' with { type: 'json' };
import abFixture from './fixtures/ashby-jobs.json' with { type: 'json' };

function mockFetch() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('greenhouse.io')) return { ok: true, status: 200, json: async () => ghFixture };
    if (url.includes('lever.co')) return { ok: true, status: 200, json: async () => lvFixture };
    if (url.includes('ashbyhq.com')) return { ok: true, status: 200, json: async () => abFixture };
    return { ok: false, status: 404 };
  });
}

describe('tools/fetch_jobs', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    seedRegistryIfEmpty(db);
    vi.stubGlobal('fetch', mockFetch());
  });

  it('aggregates jobs from all ATSs', async () => {
    const out = await fetchJobs({}, { db });
    expect(out.jobs.length).toBeGreaterThan(0);
    const companies = new Set(out.jobs.map(j => j.company));
    expect(companies.size).toBeGreaterThan(1);
  });

  it('respects titleContains filter', async () => {
    const out = await fetchJobs({ titleContains: 'Engineer' }, { db });
    expect(out.jobs.every(j => j.title.toLowerCase().includes('engineer'))).toBe(true);
  });

  it('respects h1bSponsorOnly filter', async () => {
    const out = await fetchJobs({ h1bSponsorOnly: true, h1bMinConfidence: 0.9 }, { db });
    expect(out.jobs.every(j => (j.h1bConfidence ?? 0) >= 0.9)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- fetch_jobs
```
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `src/tools/fetch_jobs.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listAllCompanies, type Company } from '../store/company.ts';
import { upsertJobs, type StoredJob } from '../store/job.ts';
import { getAdapter } from '../ats/adapter.ts';
import type { NormalizedJob } from '../ats/types.ts';

export const fetchJobsInput = z.object({
  titleContains: z.string().optional(),
  locationContains: z.string().optional(),
  remoteOnly: z.boolean().optional(),
  sinceDays: z.number().int().positive().optional(),
  companyIds: z.array(z.string()).optional(),
  h1bSponsorOnly: z.boolean().optional(),
  h1bMinConfidence: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(200).optional()
});

export type FetchJobsInput = z.infer<typeof fetchJobsInput>;

export type FetchJobsResult = {
  jobs: Array<{
    id: string; company: string; companyId: string; title: string;
    dept?: string; location?: string; locationType?: string;
    salaryMin?: number; salaryMax?: number; currency?: string;
    url: string; postedAt?: string; h1bConfidence?: number;
  }>;
  meta: { fetched: number; afterFilters: number; companiesQueried: number; errors: string[] };
};

function jobIdFor(ats: string, orgSlug: string, externalId: string): string {
  return `${ats}:${orgSlug}:${externalId}`;
}

function passes(j: NormalizedJob, c: Company, f: FetchJobsInput): boolean {
  if (f.titleContains && !j.title.toLowerCase().includes(f.titleContains.toLowerCase())) return false;
  if (f.locationContains && !(j.location ?? '').toLowerCase().includes(f.locationContains.toLowerCase())) return false;
  if (f.remoteOnly && j.locationType !== 'remote') return false;
  if (f.sinceDays !== undefined && j.postedAt) {
    const cutoff = Date.now() - f.sinceDays * 86400_000;
    if (new Date(j.postedAt).getTime() < cutoff) return false;
  }
  if (f.h1bSponsorOnly) {
    const min = f.h1bMinConfidence ?? 0.5;
    if ((c.h1bConfidence ?? 0) < min) return false;
  }
  return true;
}

export async function fetchJobs(
  input: FetchJobsInput,
  ctx: { db: Db }
): Promise<FetchJobsResult> {
  const allCompanies = listAllCompanies(ctx.db);
  const companies = input.companyIds
    ? allCompanies.filter(c => input.companyIds!.includes(c.id))
    : allCompanies;

  const errors: string[] = [];
  let fetched = 0;
  const collected: Array<{ company: Company; job: NormalizedJob }> = [];

  await Promise.all(companies.map(async c => {
    try {
      const adapter = getAdapter(c.ats);
      const jobs = await adapter.listJobs(c.atsOrgSlug, { sinceDays: input.sinceDays });
      fetched += jobs.length;
      for (const j of jobs) collected.push({ company: c, job: j });
    } catch (e) {
      errors.push(`${c.name}: ${(e as Error).message}`);
    }
  }));

  // Persist before filtering so the cache always reflects truth.
  const storedJobs: StoredJob[] = collected.map(({ company, job }) => ({
    id: jobIdFor(company.ats, company.atsOrgSlug, job.externalId),
    companyId: company.id, title: job.title, dept: job.dept,
    location: job.location, locationType: job.locationType,
    salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency,
    descriptionMd: job.descriptionMd, url: job.url, postedAt: job.postedAt,
    raw: job.raw
  }));
  upsertJobs(ctx.db, storedJobs);

  const filtered = collected.filter(({ company, job }) => passes(job, company, input));
  const limit = input.limit ?? 25;
  const sliced = filtered.slice(0, limit);

  return {
    jobs: sliced.map(({ company, job }) => ({
      id: jobIdFor(company.ats, company.atsOrgSlug, job.externalId),
      company: company.name, companyId: company.id, title: job.title,
      dept: job.dept, location: job.location, locationType: job.locationType,
      salaryMin: job.salaryMin, salaryMax: job.salaryMax, currency: job.currency,
      url: job.url, postedAt: job.postedAt, h1bConfidence: company.h1bConfidence
    })),
    meta: {
      fetched, afterFilters: filtered.length,
      companiesQueried: companies.length, errors
    }
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- fetch_jobs
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/fetch_jobs.ts tests/tools.fetch_jobs.test.ts
git commit -m "feat(tools): fetch_jobs aggregates 3 ATSs with H-1B + filters"
```

---

## Task 18: Tool — `score_fit`

**Files:**
- Create: `src/tools/score_fit.ts`, `tests/tools.score_fit.test.ts`

`score_fit` takes a `jobId` (the `<ats>:<orgSlug>:<externalId>` from `fetch_jobs`) and an optional `resumeId`. If `resumeId` is missing it uses the most recent resume. It returns `{ score: number 0..1, top_strengths: string[], top_gaps: string[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/tools.score_fit.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { scoreFit } from '../src/tools/score_fit.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/score_fit', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'greenhouse:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://x', descriptionMd: 'Lead Payments product.', raw: {}
    }]);
    addResume(db, {
      id: 'r1', label: 'Generic PM', rawText: 'PM with payments experience',
      parsed: { skills: ['payments', 'sql'] }
    });
  });

  it('returns a structured score', async () => {
    const sampling = {
      completeJson: vi.fn().mockResolvedValue({
        score: 0.82, top_strengths: ['payments domain'], top_gaps: ['no Kafka']
      })
    } as unknown as SamplingClient;
    const out = await scoreFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });
    expect(out.score).toBe(0.82);
    expect(out.topStrengths).toEqual(['payments domain']);
    expect(out.topGaps).toEqual(['no Kafka']);
  });

  it('errors on unknown job', async () => {
    const sampling = { completeJson: vi.fn() } as unknown as SamplingClient;
    await expect(scoreFit({ jobId: 'nope' }, { db, sampling })).rejects.toThrow(/unknown job/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- score_fit
```
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `src/tools/score_fit.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listJobs } from '../store/job.ts';
import { listResumes, getResume, type Resume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const scoreFitInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional()
});

const SYSTEM = `You are a career-fit scoring engine.
Given a job description and a candidate's profile + resume, produce JSON with:
- score: a number 0..1 representing overall fit
- top_strengths: string[] (1–3 bullets, why this candidate is a strong fit)
- top_gaps: string[] (1–3 bullets, what's missing or weak)
Be calibrated. A 0.9+ score should be rare. 0.5 means "even odds of an interview".`;

export async function scoreFit(
  input: z.infer<typeof scoreFitInput>,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<{ score: number; topStrengths: string[]; topGaps: string[]; jobId: string; resumeId: string }> {
  const job = listJobs(ctx.db, { limit: 5000 }).find(j => j.id === input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  let resume: Resume | null = null;
  if (input.resumeId) {
    resume = getResume(ctx.db, input.resumeId);
    if (!resume) throw new Error(`unknown resume: ${input.resumeId}`);
  } else {
    const all = listResumes(ctx.db);
    if (all.length === 0) throw new Error('no resumes stored — call add_resume first');
    resume = all[0];
  }

  const profile = getProfile(ctx.db);

  const prompt = JSON.stringify({
    job: {
      title: job.title, dept: job.dept, location: job.location,
      description: job.descriptionMd?.slice(0, 6000)
    },
    profile,
    resume: { label: resume.label, parsed: resume.parsed }
  });

  const out = await ctx.sampling.completeJson<{
    score: number; top_strengths: string[]; top_gaps: string[];
  }>({ system: SYSTEM, prompt, maxTokens: 512 });

  return {
    score: out.score, topStrengths: out.top_strengths, topGaps: out.top_gaps,
    jobId: input.jobId, resumeId: resume.id
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- score_fit
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools/score_fit.ts tests/tools.score_fit.test.ts
git commit -m "feat(tools): score_fit via sampling"
```

---

## Task 19: Tool — `explain_fit`

**Files:**
- Create: `src/tools/explain_fit.ts`, `tests/tools.explain_fit.test.ts`

Where `score_fit` is a structured number, `explain_fit` is a markdown narrative — the human-readable "story" the user shows their AI to decide whether to apply.

- [ ] **Step 1: Write the failing test**

Create `tests/tools.explain_fit.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { upsertCompany } from '../src/store/company.ts';
import { upsertJobs } from '../src/store/job.ts';
import { addResume } from '../src/store/resume.ts';
import { explainFit } from '../src/tools/explain_fit.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('tools/explain_fit', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertCompany(db, { id: 'stripe', name: 'Stripe', ats: 'greenhouse', atsOrgSlug: 'stripe' });
    upsertJobs(db, [{
      id: 'greenhouse:stripe:1', companyId: 'stripe', title: 'PM, Payments',
      url: 'https://x', descriptionMd: 'Lead Payments product.', raw: {}
    }]);
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'PM', parsed: {} });
  });

  it('returns a markdown narrative', async () => {
    const sampling = {
      complete: vi.fn().mockResolvedValue('## Fit\n\n82% fit. Strong on payments. Gap: Kafka.')
    } as unknown as SamplingClient;
    const out = await explainFit({ jobId: 'greenhouse:stripe:1' }, { db, sampling });
    expect(out.narrativeMd).toContain('Fit');
    expect(out.narrativeMd).toContain('Kafka');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- explain_fit
```
Expected: FAIL.

- [ ] **Step 3: Implement the tool**

Create `src/tools/explain_fit.ts`:

```ts
import { z } from 'zod';
import type { Db } from '../store/db.ts';
import { listJobs } from '../store/job.ts';
import { listResumes, getResume } from '../store/resume.ts';
import { getProfile } from '../store/profile.ts';
import type { SamplingClient } from '../sampling/client.ts';

export const explainFitInput = z.object({
  jobId: z.string(),
  resumeId: z.string().optional()
});

const SYSTEM = `You are a career-fit narrator.
Given a job description and a candidate, produce a short markdown brief:
1. A single sentence with a percentage estimate of fit.
2. "Strengths" — 2–4 specific bullets (cite resume facts).
3. "Gaps" — 1–3 specific bullets.
4. "Positioning" — 1–2 sentences on how to frame the application.

Be honest and specific. No hedging. No filler.`;

export async function explainFit(
  input: z.infer<typeof explainFitInput>,
  ctx: { db: Db; sampling: SamplingClient }
): Promise<{ narrativeMd: string; jobId: string; resumeId: string }> {
  const job = listJobs(ctx.db, { limit: 5000 }).find(j => j.id === input.jobId);
  if (!job) throw new Error(`unknown job: ${input.jobId}`);

  const resume = input.resumeId
    ? getResume(ctx.db, input.resumeId)
    : (listResumes(ctx.db)[0] ?? null);
  if (!resume) throw new Error('no resumes stored — call add_resume first');

  const profile = getProfile(ctx.db);

  const prompt = JSON.stringify({
    job: { title: job.title, dept: job.dept, description: job.descriptionMd?.slice(0, 6000) },
    profile,
    resume: { label: resume.label, parsed: resume.parsed }
  });

  const narrativeMd = await ctx.sampling.complete({
    system: SYSTEM, prompt, maxTokens: 768
  });

  return { narrativeMd, jobId: input.jobId, resumeId: resume.id };
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- explain_fit
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/explain_fit.ts tests/tools.explain_fit.test.ts
git commit -m "feat(tools): explain_fit narrative via sampling"
```

---

## Task 20: Wire all tools into the MCP server

**Files:**
- Modify: `src/server.ts`
- Create: `src/tools/index.ts`, `tests/server.tools.test.ts`

This task plugs the 6 tools into the MCP `tools/list` and `tools/call` request handlers. The schemas come from each tool's exported zod object.

- [ ] **Step 1: Install the JSON-schema converter dependency**

```bash
npm install zod-to-json-schema
```
This is needed before the test can compile, because `tools/index.ts` imports it.

- [ ] **Step 2: Write the failing test**

Create `tests/server.tools.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('server tools registration', () => {
  it('exports all 6 v1 tools', async () => {
    const { toolDefinitions } = await import('../src/tools/index.ts');
    const names = toolDefinitions.map(t => t.name).sort();
    expect(names).toEqual([
      'add_resume', 'explain_fit', 'fetch_jobs',
      'list_resumes', 'score_fit', 'setup_profile'
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

- [ ] **Step 3: Run test to verify it fails**

```bash
npm test -- server.tools
```
Expected: FAIL — `Cannot find module '../src/tools/index.ts'`.

- [ ] **Step 4: Implement tool registration**

Create `src/tools/index.ts`:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';

import { setupProfile, setupProfileInput } from './setup_profile.ts';
import { addResume, addResumeInput } from './add_resume.ts';
import { listResumesTool, listResumesInput } from './list_resumes.ts';
import { fetchJobs, fetchJobsInput } from './fetch_jobs.ts';
import { scoreFit, scoreFitInput } from './score_fit.ts';
import { explainFit, explainFitInput } from './explain_fit.ts';

export type ToolCtx = { db: Db; sampling: SamplingClient };

type ToolDef = {
  name: string;
  description: string;
  inputSchema: ReturnType<typeof zodToJsonSchema>;
  run(input: unknown, ctx: ToolCtx): Promise<unknown>;
};

export const toolDefinitions: ToolDef[] = [
  {
    name: 'setup_profile',
    description: 'Store a structured profile from a free-form description of the user.',
    inputSchema: zodToJsonSchema(setupProfileInput),
    run: (i, c) => setupProfile(setupProfileInput.parse(i), c)
  },
  {
    name: 'add_resume',
    description: 'Parse a resume (path or rawText) and store a labeled version.',
    inputSchema: zodToJsonSchema(addResumeInput),
    run: (i, c) => addResume(addResumeInput.parse(i), c)
  },
  {
    name: 'list_resumes',
    description: 'List all stored resume versions.',
    inputSchema: zodToJsonSchema(listResumesInput),
    run: (i, c) => listResumesTool(listResumesInput.parse(i), c)
  },
  {
    name: 'fetch_jobs',
    description: 'Fetch live jobs across configured ATSs with filters (title, location, H-1B, etc).',
    inputSchema: zodToJsonSchema(fetchJobsInput),
    run: (i, c) => fetchJobs(fetchJobsInput.parse(i), c)
  },
  {
    name: 'score_fit',
    description: 'Score a job against a stored resume. Returns numeric score + structured strengths/gaps.',
    inputSchema: zodToJsonSchema(scoreFitInput),
    run: (i, c) => scoreFit(scoreFitInput.parse(i), c)
  },
  {
    name: 'explain_fit',
    description: 'Produce a markdown narrative explaining fit, strengths, gaps, and positioning.',
    inputSchema: zodToJsonSchema(explainFitInput),
    run: (i, c) => explainFit(explainFitInput.parse(i), c)
  }
];
```

- [ ] **Step 5: Wire request handlers in `src/server.ts`**

Replace `src/server.ts` with:

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { openDb } from './store/db.ts';
import { seedRegistryIfEmpty } from './registryBoot.ts';
import { SamplingClient } from './sampling/client.ts';
import { toolDefinitions, type ToolCtx } from './tools/index.ts';
// Adapters self-register on import
import './ats/greenhouse.ts';
import './ats/lever.ts';
import './ats/ashby.ts';

export const SERVER_NAME = 'crosswalk-mcp';
export const SERVER_VERSION = '0.0.1';

export function bootstrap() {
  const db = openDb();
  seedRegistryIfEmpty(db);
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } } // `sampling` is a CLIENT capability in MCP; servers consume it via createMessage
  );
  const sampling = new SamplingClient(server as unknown as ConstructorConstructorParameters<typeof SamplingClient>[0]);
  const ctx: ToolCtx = { db, sampling };

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefinitions.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as object
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async req => {
    const def = toolDefinitions.find(t => t.name === req.params.name);
    if (!def) throw new Error(`unknown tool: ${req.params.name}`);
    const result = await def.run(req.params.arguments ?? {}, ctx);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return { db, server, sampling };
}

export async function main() {
  const { server } = bootstrap();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```
Expected: all passing.

- [ ] **Step 7: Smoke-run the dev server**

```bash
npx tsx src/server.ts < /dev/null
```
Expected: process starts and listens on stdio without errors.

- [ ] **Step 8: Commit**

```bash
git add src/server.ts src/tools/index.ts tests/server.tools.test.ts package.json package-lock.json
git commit -m "feat(server): register all 6 v1 tools"
```

---

## Task 21: MCP resources

**Files:**
- Create: `src/resources/index.ts`, `tests/resources.test.ts`
- Modify: `src/server.ts`

Two resources: `crosswalk://registry/companies` (the Open Job Graph) and `crosswalk://profile/me` (the current profile).

- [ ] **Step 1: Write the failing test**

Create `tests/resources.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { seedRegistryIfEmpty } from '../src/registryBoot.ts';
import { upsertProfile } from '../src/store/profile.ts';
import { listResources, readResource } from '../src/resources/index.ts';

describe('resources', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); seedRegistryIfEmpty(db); });

  it('lists both resources', () => {
    const r = listResources();
    expect(r.map(x => x.uri).sort()).toEqual([
      'crosswalk://profile/me', 'crosswalk://registry/companies'
    ]);
  });

  it('reads the registry resource', async () => {
    const out = await readResource('crosswalk://registry/companies', { db });
    const parsed = JSON.parse(out.text) as Array<{ id: string }>;
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('reads the profile resource (null if unset)', async () => {
    const empty = await readResource('crosswalk://profile/me', { db });
    expect(JSON.parse(empty.text)).toBeNull();
    upsertProfile(db, { name: 'Mohak' });
    const set = await readResource('crosswalk://profile/me', { db });
    expect(JSON.parse(set.text)).toMatchObject({ name: 'Mohak' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- resources
```
Expected: FAIL.

- [ ] **Step 3: Implement resources module**

Create `src/resources/index.ts`:

```ts
import type { Db } from '../store/db.ts';
import { listAllCompanies } from '../store/company.ts';
import { getProfile } from '../store/profile.ts';

export type ResourceDef = { uri: string; name: string; mimeType: string; description: string };

export function listResources(): ResourceDef[] {
  return [
    {
      uri: 'crosswalk://registry/companies',
      name: 'Open Job Graph',
      mimeType: 'application/json',
      description: 'Registry of companies and their ATS slugs.'
    },
    {
      uri: 'crosswalk://profile/me',
      name: 'Current profile',
      mimeType: 'application/json',
      description: 'The profile stored via setup_profile. Null if unset.'
    }
  ];
}

export async function readResource(uri: string, ctx: { db: Db }): Promise<{ text: string }> {
  if (uri === 'crosswalk://registry/companies') {
    return { text: JSON.stringify(listAllCompanies(ctx.db), null, 2) };
  }
  if (uri === 'crosswalk://profile/me') {
    return { text: JSON.stringify(getProfile(ctx.db)) };
  }
  throw new Error(`unknown resource: ${uri}`);
}
```

- [ ] **Step 4: Wire resource handlers into the server**

Modify `src/server.ts`. Add imports near the top:

```ts
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { listResources, readResource } from './resources/index.ts';
```

Inside `bootstrap()`, after the existing tool handlers, add:

```ts
server.setRequestHandler(ListResourcesRequestSchema, () => ({
  resources: listResources()
}));

server.setRequestHandler(ReadResourceRequestSchema, async req => {
  const out = await readResource(req.params.uri, { db });
  return { contents: [{ uri: req.params.uri, mimeType: 'application/json', text: out.text }] };
});
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src/resources/index.ts src/server.ts tests/resources.test.ts
git commit -m "feat(server): registry + profile resources"
```

---

## Task 22: Install CLI for Claude Desktop

**Files:**
- Create: `src/cli.ts`, `tests/cli.test.ts`

`crosswalk-mcp install` writes the MCP server entry into Claude Desktop's `claude_desktop_config.json`. The CLI is also where future hosts (Cursor, Windsurf) get their installers.

- [ ] **Step 1: Write the failing test**

Create `tests/cli.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { installClaudeDesktop } from '../src/cli.ts';

describe('cli/install', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-cli-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('creates a fresh config when none exists', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await installClaudeDesktop({ configPath: cfg });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers['crosswalk-mcp']).toBeDefined();
    expect(json.mcpServers['crosswalk-mcp'].command).toBeTypeOf('string');
  });

  it('merges into an existing config', async () => {
    const cfg = path.join(tmp, 'claude_desktop_config.json');
    await fs.writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: 'x' } } }));
    await installClaudeDesktop({ configPath: cfg });
    const json = JSON.parse(await fs.readFile(cfg, 'utf8'));
    expect(json.mcpServers.other).toBeDefined();
    expect(json.mcpServers['crosswalk-mcp']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- cli
```
Expected: FAIL.

- [ ] **Step 3: Implement the CLI**

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

function defaultClaudeConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

export async function installClaudeDesktop(opts: { configPath?: string } = {}): Promise<{ configPath: string }> {
  const configPath = opts.configPath ?? defaultClaudeConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  let json: { mcpServers?: Record<string, unknown> } = {};
  try {
    json = JSON.parse(await fs.readFile(configPath, 'utf8')) as typeof json;
  } catch {
    // File missing or unreadable — start fresh.
  }
  json.mcpServers ??= {};

  // Use the local binary if running from a clone; npx if installed globally.
  const command = process.env.CROSSWALK_INSTALL_COMMAND ?? 'npx';
  const args = process.env.CROSSWALK_INSTALL_COMMAND
    ? []
    : ['-y', 'crosswalk-mcp@latest'];

  json.mcpServers['crosswalk-mcp'] = {
    command,
    args,
    env: process.env.CROSSWALK_HOME ? { CROSSWALK_HOME: process.env.CROSSWALK_HOME } : {}
  };

  await fs.writeFile(configPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
  return { configPath };
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'install') {
    const { configPath } = await installClaudeDesktop();
    console.log(`✓ Installed crosswalk-mcp into Claude Desktop at:\n  ${configPath}\n`);
    console.log(`Restart Claude Desktop to activate. State will live in ${process.env.CROSSWALK_HOME ?? '~/.crosswalk/'}.`);
    return;
  }
  console.log(`Usage:\n  crosswalk-mcp install   # add this MCP to Claude Desktop`);
  process.exit(cmd ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- cli
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat(cli): crosswalk-mcp install for Claude Desktop"
```

---

## Task 23: Build, README, LICENSE — ship-ready

**Files:**
- Create: `README.md`, `LICENSE`
- Modify: `package.json` (verify `bin` and `files` fields)

- [ ] **Step 1: Add MIT LICENSE**

Create `LICENSE`:

```
MIT License

Copyright (c) 2026 Mohak Garg

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Add README.md**

Create `README.md`:

````markdown
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
````

- [ ] **Step 3: Add the `files` field to `package.json`**

The `bin` field already exists from Task 1. Add a top-level `"files"` array so `npm publish` ships only the artifacts users need:

Edit `package.json` — locate the `"license": "MIT",` line and insert immediately after it:

```json
  "files": ["dist/", "registry/", "README.md", "LICENSE"],
```

The final shape of the top of `package.json` should look like:

```json
{
  "name": "crosswalk-mcp",
  "version": "0.0.1",
  "description": "...",
  "type": "module",
  "bin": { "crosswalk-mcp": "dist/cli.js" },
  "main": "dist/server.js",
  "scripts": { "...": "..." },
  "engines": { "node": ">=24" },
  "license": "MIT",
  "files": ["dist/", "registry/", "README.md", "LICENSE"],
  "dependencies": { "...": "..." },
  "devDependencies": { "...": "..." }
}
```

- [ ] **Step 4: Run a clean build**

```bash
npm run build
```
Expected: `dist/server.js` and `dist/cli.js` produced, no errors.

- [ ] **Step 5: Run full test suite once more**

```bash
npm test
```
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE package.json
git commit -m "chore: README, MIT LICENSE, package metadata for publish"
```

---

## Self-review checklist (before declaring M1 done)

- [ ] All 23 tasks completed; all tests passing.
- [ ] `npx tsx src/server.ts < /dev/null` boots without errors.
- [ ] `crosswalk-mcp install` (run from a checkout) writes a Claude Desktop config and the server appears in Claude after restart.
- [ ] In Claude Desktop, you can run an end-to-end flow in under 10 minutes: `setup_profile` → `add_resume` → `fetch_jobs` (returns >0 jobs from at least 2 ATSs) → `score_fit` (returns a number) → `explain_fit` (returns markdown).
- [ ] No model-provider API keys, no provider SDKs in `package.json` dependencies.
- [ ] Repo passes `npm run lint`.

When all of the above hold, M1 is complete and ready for the M2 plan.
