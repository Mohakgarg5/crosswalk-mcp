# Crosswalk — Fully Autonomous Apply Loop (Design)

**Date:** 2026-06-11
**Status:** Approved for planning
**Goal:** Make Crosswalk run 99% autonomously — continuously find the best-fit jobs for the user's skills, tailor and submit applications reliably, and flag *only* the applications that genuinely need a human (captcha, account wall, unconfirmed submit). Everything tunable per role-track.

---

## 1. Problem statement

The user reports the system "isn't working properly" and wants it end-to-end autonomous. Investigation of the live state DB (`~/.crosswalk/state.db`) and code found three structural gaps plus a reliability tail:

1. **No real fit-matching in the autonomous path.** `refreshSavedSearch` matches new jobs by a `LIKE '%title%'` filter only (`services/savedSearchEngine.ts`). It never scores the job against a résumé, so the watcher auto-applies to anything sharing a title keyword — not "the best jobs for my skills."
2. **No per-track configuration.** A `saved_search` ("watch") carries only an `autoApply` boolean (`store/savedSearch.ts`). The résumé is auto-guessed per job, and submit policy / weekly cap are *global* (`store/appConfig.ts`). The user wants multiple tracks (e.g. "Product Manager" → product résumé, "Project Manager" → project résumé), each with its own knobs.
3. **No unified "needs you" queue.** Blocked applications scatter across event kinds (`submit_unconfirmed` ×87, `nothing_filled` ×7, `verification_pending` ×6, `listing_expired` ×2 in the live DB). There's no single surface that says "these 4 need your hand, here are the links."
4. **Reliability tail.** Lever submissions silently dropped (invisible bot-check); Ashby location-combobox and date-picker gaps; Workday account walls; no pre-submit guard against submitting an empty form.

## 2. Scope

**In scope**
- Résumé-aware, fit-gated watches (the targeting brain).
- Per-watch configuration (résumé, min-fit, weekly cap, auto-submit) overriding global defaults.
- A unified **Needs-You queue**: every application that can't finish autonomously lands here with the reason + direct link, instead of a false "submitted" or a silent drop.
- Always-on background runner on macOS (launchd) with one-click install/uninstall — survives reboot, runs whether or not the app/browser is open.
- Reliability fixes: pre-submit empty-form guard, Ashby location/date, Lever silent-drop detection → Needs-You, Workday account create-once-and-reuse via persistent profile.
- Human-in-the-loop gating for captcha/bot-check and account walls: pause that one application, keep the filled form, surface it in the queue; everything else proceeds.

**Out of scope (explicit, honest)**
- **Captcha / bot-detection *evasion*** — no paid solver services, no fingerprint spoofing, no stealth-driver patches. Invisible bot-checks exist precisely to stop automated submission; defeating them is detection evasion and a losing arms race. Instead: detect → pause → flag for the human's 5-second step.
- **Cloud deployment (Vercel/VPS).** Crosswalk drives a long-lived local browser with a persistent logged-in profile, keeps all data in local SQLite, and benefits from a residential IP. Serverless can't host a persistent browser, would force user data into the cloud (breaking the local-first guarantee), and datacenter IPs get blocked harder. The always-on launchd service delivers the same "runs all the time" outcome correctly.
- **Blind mass account creation across every Workday tenant.** Too brittle. We do create-on-first-encounter + reuse-saved-login only.

## 3. Architecture

The autonomous loop becomes: **watch → fit-score → gate → tailor → fill → (submit | queue)**, repeated every interval by the always-on runner.

```
launchd service (boot-survivable)
  └─ scripts/watch.mjs  (every CROSSWALK_WATCH_INTERVAL_MIN)
       └─ runWatch()                       services/watchEngine.ts   [MODIFY]
            ├─ searchRoles()  (web sources, per watch query)
            ├─ refreshSavedSearch()        services/savedSearchEngine.ts  [unchanged matching]
            ├─ scoreAndGate()  NEW         services/fitGate.ts        [NEW]
            │     └─ scoreFit() per job vs the watch's résumé; keep ≥ minFit
            └─ autoApply({ jobIds, resumeId, submit, cap })  services/autoApplyEngine.ts  [MODIFY]
                   └─ buildApplication() → applyApplication()
                          └─ on block → enqueueNeedsAction()  store/needsAction (notification)  [NEW kind]
```

### 3.1 Components

- **`store/savedSearch.ts` [MODIFY]** — extend `SavedSearch` with optional per-watch overrides:
  `resumeId?: string` (the track's résumé; if absent, auto-pick as today), `minFit?: number` (0..1, default from config, e.g. 0.6), `weeklyCap?: number` (overrides global), `autoSubmit?: boolean` (overrides global submit policy). New migration adds the columns (nullable; existing rows keep current behavior).
- **`services/fitGate.ts` [NEW]** — `scoreAndGate(db, sampling, jobIds, { resumeId, minFit })` → returns the subset of `jobIds` scoring ≥ `minFit`, using `scoreFit()` (already exists, `tools/score_fit.ts`) against the watch's résumé, reading the fit-score cache to avoid re-scoring. This is the "best jobs for my skills" gate.
- **`services/watchEngine.ts` [MODIFY]** — between `refreshSavedSearch` and `autoApply`, call `scoreAndGate` with the watch's `resumeId`/`minFit`; pass `resumeId`, per-watch `submit`, and per-watch `cap` into `autoApply`.
- **`services/autoApplyEngine.ts` [MODIFY]** — accept `resumeId` (thread into `buildApplication`) and an effective `cap`; on any non-finishing outcome (drafted/skipped due to block) call the new `enqueueNeedsAction`.
- **`store/notification.ts` [MODIFY]** — add a `needs_action` notification kind with `reason` (`captcha` | `account_wall` | `submit_unconfirmed` | `nothing_filled` | `verification_timeout` | `listing_expired`) and the direct apply link. This is the **Needs-You queue** (a query over notifications, not a new table).
- **`apps/web` [MODIFY]** — (a) Watch editor gains résumé picker + min-fit slider + per-watch cap + auto-submit toggle; (b) a **"Needs You"** panel listing `needs_action` items with reason badges and "Open & finish" buttons; (c) Settings → "Run in background" install/uninstall button.
- **`scripts/install-service.mjs` [NEW]** — writes/loads/unloads a `~/Library/LaunchAgents/com.crosswalk.watch.plist` that runs `node scripts/watch.mjs` on login with the configured interval and `CROSSWALK_BROWSER_PROFILE`/`CROSSWALK_BROWSER_HEADED` env for logged-in ATSes. Idempotent install + clean uninstall.
- **ATS reliability [MODIFY]**: `ats/ashby.ts` (location combobox + date picker), `ats/workday.ts` (account create-once + reuse via persistent profile), `services/browser/*` (pre-submit empty-required-field guard → never submit a blank form; route to `nothing_filled` needs-action), `ats/lever.ts` (confirm silent-drop detection routes to `submit_unconfirmed` needs-action rather than a trusted submit).

### 3.2 Data flow — one watch pass

1. Watcher wakes (launchd interval). For each watch with `autoApply`:
2. `searchRoles` refreshes web results for the watch query → `refreshSavedSearch` returns genuinely-new `jobIds`.
3. `scoreAndGate` scores each new job vs the watch's résumé; drops anything below `minFit`. (Logged: how many considered vs kept.)
4. `autoApply` tailors + fills each survivor using the watch's résumé, honoring the effective weekly cap.
5. Outcome routing:
   - Confirmed submit (navigation/thank-you/email-verified) → `submitted`.
   - Filled, submit policy = review → `applied` (left for review).
   - Blocked (captcha, account wall, unconfirmed, empty, expired) → **Needs-You queue** with reason + link. Never marked submitted.

### 3.3 Error handling

- **Network/scoring hiccup** → that job is skipped this pass, retried next pass (idempotent; `last_checked_at` only advances on success of the match step, as today).
- **Browser unavailable / login wall** → application stays `drafted` AND a `needs_action` (`account_wall`) is queued — both, so it's recoverable and visible.
- **AI key missing** → finding/scoring still works; apply step queues a clear "add your key" action rather than crashing the pass.
- **Pre-submit guard**: if required fields are empty after fill, do NOT click submit; queue `nothing_filled` with the link.
- **Cap reached** → remaining survivors are left as `applied`/`drafted` (not dropped), so nothing is lost when the cap resets.

## 4. Configuration (all user-tunable)

Global defaults (`store/appConfig.ts`, existing + new): `submitPolicy`, `weeklyCap`, `applyMaxSteps`, `verificationTimeoutMs`, **new** `defaultMinFit` (default 0.6).
Per-watch overrides (new columns): `resumeId`, `minFit`, `weeklyCap`, `autoSubmit`. A null override falls back to the global default — so the user can run everything globally *or* tune each track independently.

## 5. Testing

- **`fitGate.test.ts`** — given mocked `scoreFit` returns, only jobs ≥ `minFit` survive; cache hits avoid re-scoring; missing résumé falls back to auto-pick.
- **`watchEngine.test.ts` [extend]** — per-watch résumé/cap/submit are threaded through; below-threshold jobs are not applied.
- **`autoApplyEngine.test.ts` [extend]** — blocked outcomes enqueue `needs_action` with the right reason + link; cap is honored.
- **`savedSearch.test.ts` [extend]** — new columns round-trip; existing rows (null overrides) behave as before (migration back-compat).
- **`install-service.test.ts`** — plist content is well-formed; install/uninstall is idempotent (no Playwright; assert file + `launchctl` command construction, mock exec).
- **ATS adapters** — Ashby location/date fill against saved fixtures; pre-submit guard blocks an empty form in a mocked page.
- Full suite (`npm test`, currently 303 tests) stays green; `npm run lint` clean.

## 6. Build sequence (phases)

Each phase is independently shippable and verifiable.

- **Phase 1 — Targeting brain (highest value):** `fitGate.ts`, savedSearch columns + migration, watchEngine wiring, watch-editor UI (résumé + min-fit + cap + auto-submit). Outcome: the watcher applies to *best-fit* jobs per track, not title-keyword matches.
- **Phase 2 — Needs-You queue:** `needs_action` notification kind, autoApply routing, web panel. Outcome: blocked applications surface in one place with links; nothing fake-submitted or silently dropped.
- **Phase 3 — Always-on runner:** `install-service.mjs` + Settings button. Outcome: hands-off across reboots.
- **Phase 4 — Reliability tail:** pre-submit empty guard, Ashby location/date, Workday account create+reuse, Lever silent-drop confirmation. Outcome: more applications finish autonomously; the rest route cleanly to Phase 2's queue.

Phase 1 will be the first implementation plan; later phases get their own plans.

## 7. Success criteria

- A watch with a chosen résumé + min-fit only auto-applies to jobs scoring ≥ threshold against *that* résumé.
- Per-watch submit/cap/résumé override globals; with no overrides, behavior is unchanged.
- Every application either: confirmed-submitted, left-for-review (policy), or in the Needs-You queue with a reason + link. No false "submitted", no silent drops.
- The watcher runs across a reboot with no terminal interaction after one-click install.
- `npm test` and `npm run lint` pass.
