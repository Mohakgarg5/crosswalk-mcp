# Contributing to Crosswalk

Thanks for helping out! Contributions of every size are welcome — from adding one company to building a whole new ATS adapter. This guide explains how the project is laid out, how to set up, the conventions we follow, and step-by-step recipes for the most common contributions.

## Ways to contribute (easiest → most involved)

1. **Add a company** to the Open Job Graph — a one-line change to `registry/companies.json`.
2. **Add a common answer** to the answer-bank defaults.
3. **Report a bug** if an ATS adapter mis-parses a real posting (open an issue with the org slug).
4. **Add an ATS adapter** for a new applicant-tracking system.
5. **Add an MCP tool** or a GUI feature.

---

## Project layout

This is an **npm workspaces monorepo**:

```
packages/core   → the engine (published as `crosswalk-mcp`, the MCP server)
                  store/ services/ ats/ exporters/ tools/ sampling/ + runtime.ts
apps/web        → the Next.js GUI (private package `@crosswalk/web`)
scripts/        → watch.mjs (the always-on watcher daemon)
docs/           → ARCHITECTURE.md + superpowers/ (specs & implementation plans)
registry/       → companies.json + h1b.json (the Open Job Graph)
```

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the deep dive.

## Development setup

Requires **Node.js 24+**.

```bash
git clone https://github.com/Mohakgarg5/crosswalk-mcp.git
cd crosswalk-mcp
npm install

npm test              # run the test suite (vitest)
npm run lint          # type-check core + web (tsc --noEmit, strict)
npm run build:core    # build the engine
npm run gui           # build core + start the GUI at localhost:3000
npm run watch         # run the always-on watcher
```

Optional, for browser automation work:
```bash
npx crosswalk-mcp install-browser   # or: npm i playwright && npx playwright install chromium
```

## Conventions

- **TDD.** Write a failing test first, then the implementation. Every behavior change ships with a test.
- **Small PRs, frequent commits.** Keep changes focused and reviewable.
- **Strict TypeScript.** `npm run lint` is `tsc --noEmit`; it must be clean. No `any` unless unavoidable (prefer typed shapes).
- **ESM + `.ts` imports.** Source uses explicit `.ts` extensions (bundler resolution). Match the surrounding style.
- **Commit messages:** short, conventional-style prefix (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`), present tense.
- **Truthfulness & safety.** Résumé tailoring must never fabricate facts; auto-submit stays opt-in and clearly labeled.

### Before you open a PR — the checklist

```bash
npm test            # all green
npm run lint        # clean (core + web)
npm run build:core  # builds
```
Update `README.md` / `docs/ARCHITECTURE.md` if you changed behavior or commands.

---

## Recipes

### Add a company (1-line PR)

Append an entry to [`packages/core/registry/companies.json`](packages/core/registry/companies.json):

```json
{ "id": "acme", "name": "Acme", "ats": "greenhouse", "atsOrgSlug": "acme" }
```

- `ats` must be one of the supported adapters (greenhouse, lever, ashby, workable, smartrecruiters, bamboohr, recruitee, personio, workday, icims).
- `atsOrgSlug` is the company's identifier on that ATS (e.g. the token in its Greenhouse board URL).
- Optionally add an H-1B confidence in `registry/h1b.json`.

That's it — the registry is MIT-licensed and seeds on first run.

### Add an answer-bank default

Edit `COMMON_DEFAULTS` in [`packages/core/src/store/answerBank.ts`](packages/core/src/store/answerBank.ts). Keep EEO answers neutral ("decline to self-identify"). Add a case to `tests/answerBank.test.ts` if it's a new kind of match.

### Add an ATS adapter

1. Create `packages/core/src/ats/<name>.ts` exporting a const that calls `registerAdapter(...)` (copy `ats/greenhouse.ts` as a template; it conforms to the `ATSAdapter` interface in `ats/types.ts`).
2. Add a checked-in fixture under `packages/core/tests/fixtures/<name>-jobs.json` (or `.xml`).
3. Add `packages/core/tests/ats.<name>.test.ts` that mocks `fetch` against the fixture.
4. Register the side-effect import (`import './ats/<name>.ts';`) in every adapter list that enumerates them: `src/server.ts`, `src/runtime.ts`, `src/tools/fetch_jobs.ts`, and `src/cli.ts` (the doctor's adapter check). Tip: `grep -rl "ats/greenhouse" packages/core/src` shows the current set.
5. Add the new slug to `KNOWN_ATS` (and the `Company['ats']` union) in `src/store/company.ts`.
6. Add a few companies to `registry/companies.json` using the new slug.

### Add an MCP tool

1. Create `packages/core/src/tools/<name>.ts` exporting a zod input schema + handler.
2. Register it in `src/tools/index.ts` (`toolDefinitions`).
3. Add `tests/tools.<name>.test.ts`.
4. Update the expected tool list in `tests/server.tools.test.ts` and the count in `tests/cli.doctor.test.ts`.

### Add a database migration

Migrations are **append-only** in `packages/core/src/store/migrations.ts`:

1. Append a new object with the **next `id`** — never edit a shipped migration.
2. Update the expected id list in `packages/core/tests/store.test.ts`.
   (The `doctor` command derives the expected set from the migrations array, so it needs no change.)

---

## Testing notes

- Tests run with **vitest** and an **in-memory SQLite** (`openDb(':memory:')`) — hermetic, no temp files.
- **No live network/AI/browser calls in tests.** Mock `fetch` for adapters, stub the `SamplingClient` for AI, and inject a fake `Browser` (or `importPlaywright`) for browser logic. See existing tests for the patterns.
- If a test depends on the current date (recency filters), **pin the clock** with `vi.useFakeTimers()` + `vi.setSystemTime(...)` — except in the auto-apply path, where the `.docx` generator's timers don't like fake timers (use real timers + a small delay there).

## Reporting issues

Open a GitHub issue. For adapter parsing bugs, include the **org slug** and the field that's wrong. For app bugs, include what you did, what happened, and any console output.

## License

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
