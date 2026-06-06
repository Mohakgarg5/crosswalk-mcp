# Onboarding questionnaire expansion — design

**Date**: 2026-06-06
**Status**: approved by user (verbal, this session)

## Problem

The 2026-06-06 Koalafi application exposed gaps that all trace to one cause:
the engine had to guess answers the user could have provided once up front.
Work authorization picked "Yes - US Citizen" for a CPT visa holder, EEO
dropdowns sat empty until `load-defaults` was run manually, and the School
typeahead had nothing to type until education entries were hand-seeded into
the answer bank.

The onboarding wizard (`apps/web/app/onboarding/page.tsx`) already collects
name, links, work status, résumé, API key, and apply policy across 6 steps —
but not education, EEO answers, or work preferences.

## Goal

Every question category that appeared on a real ATS form today gets asked
once during onboarding, deterministically seeding the profile and answer
bank, so no application depends on the model guessing personal facts.

## Design

### 3 new wizard steps (6 → 9 total)

Each step persists independently on Continue (existing wizard pattern:
`postJSON` per step, partial setup survives refresh). New steps reuse the
existing `OptionGrid`, `Segmented`, `Row`, `Input` building blocks — no new
UI primitives.

**Step 4 — Education** (inserted after Work eligibility)
- Fields: School (text), Degree (OptionGrid of the 10 standard ATS options:
  Associate's / Bachelor's / Master's / MBA / PhD / MD / JD / Engineer's /
  High School / Other), Discipline (text), Start year, End year (optional).
- Saves to profile: `education: [{ school, degree, discipline, start_year,
  end_year }]`.
- Saves to answer bank: `school` → X, `university` → X, `degree` → Y,
  `discipline` → Z.
- Skippable (canSkip).

**Step 5 — Work preferences**
- Fields: Work style preference (Segmented: Remote / Hybrid / Onsite),
  Willing to relocate (Y/N), Earliest start date (text, e.g. "2 weeks
  notice" or "June 2026"), How did you hear about jobs (text, default
  "LinkedIn").
- Saves to profile: `wants.work_style`, `wants.relocate`, `wants.start_date`.
- Saves to answer bank: `preferred office location` → Remote (only when
  Remote picked), `relocate` → Yes/No, `start date` → value, `how did you
  hear` → value.
- Skippable.

**Step 6 — Voluntary self-identification (EEO)**
- Fields (each an OptionGrid, each including a decline option):
  - Gender: Male / Female / Non-binary / Prefer not to say
  - Hispanic or Latino: Yes / No / Prefer not to say
  - Race/ethnicity: the 7 standard EEO-1 categories / Prefer not to say
  - Veteran status: "I am not a protected veteran" / "I identify as one or
    more of the classifications of a protected veteran" / "I don't wish to
    answer"
  - Disability: Yes / No / "I don't wish to answer"
- Saves to answer bank only (not profile): labels `gender`, `hispanic`,
  `race`, `ethnicity`, `veteran`, `disability`. "Prefer not to say" saves
  the same decline strings as `COMMON_DEFAULTS` so the two paths stay
  consistent.
- Skippable, with copy explaining answers are voluntary and stored locally.

Renumber `TOTAL` 6 → 9; later steps (résumé, AI key, apply policy) shift.

### Answer bank upsert (supporting fix)

`addAnswer` currently always INSERTs — the user's bank had "legally
authorized → Yes" three times from re-running setup. Change `addAnswer` in
`packages/core/src/store/answerBank.ts` to delete any existing row with the
same label (case-insensitive) before inserting. Re-running onboarding then
updates answers instead of piling up duplicates. `loadDefaults` keeps its
existing skip-if-present behavior so it never overwrites user-chosen values.

### README

Add a "Tell it about yourself once" section to the repo README documenting:
what the onboarding wizard asks and why, what the answer bank is, how
answers are reused on applications, how to edit them later (Settings →
Saved answers, or re-run `/onboarding`), and that EEO answers are optional
with decline defaults.

## Out of scope

- Multiple education entries (one row covers the common case; "Add another"
  exists on ATS forms but the bank only needs the primary/most recent).
- Settings-page mirror of the new steps (Settings already lists and edits
  all bank answers generically).
- Conditioning work-auth bank answers on visa status (the 2026-06-06
  ambiguity fix already routes generic "Yes" through the model with profile
  context).

## Error handling

Same as existing steps: per-step try/catch surfaces the error inline and
keeps the user on the step; skips never write partial data.

## Testing

- TDD (core): `addAnswer` upsert — same-label save replaces, different
  label appends, `loadDefaults` still skips existing labels.
- Wizard: no web test harness exists; verify by driving `/onboarding` in
  the browser end-to-end and inspecting the resulting `answer_bank` and
  `profile` rows in `~/.crosswalk/state.db`.
- Regression: full core suite stays green.
