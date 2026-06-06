# Onboarding Questionnaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Education, Work-preferences, and EEO self-identification steps to the onboarding wizard so the answer bank and profile are seeded deterministically, plus answer-bank upsert and README docs.

**Architecture:** Three new steps inside the existing single-file wizard (`apps/web/app/onboarding/page.tsx`), each persisting independently via the existing `/api/profile` and `/api/answers` endpoints. `addAnswer` becomes an upsert (delete same label, case-insensitive, then insert). README gains a section documenting the questionnaire + answer bank.

**Tech Stack:** Next.js client component (existing wizard primitives `OptionGrid`/`Segmented`/`Row`/`Input`), better-sqlite3 store in `packages/core`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-onboarding-questionnaire-design.md`

**Deviation from spec (reasoned):** `saveProfile` does a SHALLOW top-level merge (`apps/web/lib/engine.ts:112`), so nesting under `wants` would clobber `wants.roles/locations`. Work preferences save as top-level profile keys `work_style_preference`, `willing_to_relocate`, `earliest_start_date` instead.

---

### Task 1: Answer-bank upsert

**Files:**
- Modify: `packages/core/src/store/answerBank.ts` (addAnswer)
- Test: `packages/core/tests/answerBank.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe` in `packages/core/tests/answerBank.test.ts`:

```ts
  it('replaces an existing answer with the same label, case-insensitively (upsert)', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'Gender', answer: 'Male' });
    addAnswer(db, { label: 'gender', answer: 'Decline to self-identify' });
    const matches = listAnswers(db).filter(a => a.label.toLowerCase() === 'gender');
    expect(matches).toHaveLength(1);
    expect(matches[0].answer).toBe('Decline to self-identify');
  });

  it('keeps answers with different labels independent', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'gender', answer: 'Male' });
    addAnswer(db, { label: 'veteran', answer: 'I am not a protected veteran' });
    expect(listAnswers(db)).toHaveLength(2);
  });

  it('loadDefaults still skips labels the user already set', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'gender', answer: 'Male' });
    loadDefaults(db);
    const gender = listAnswers(db).filter(a => a.label.toLowerCase() === 'gender');
    expect(gender).toHaveLength(1);
    expect(gender[0].answer).toBe('Male');
  });
```

(Ensure `loadDefaults` is imported in the test file's import list.)

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && npx vitest run tests/answerBank.test.ts`
Expected: upsert test FAILS (2 rows found, expected 1).

- [ ] **Step 3: Implement upsert** in `packages/core/src/store/answerBank.ts`:

```ts
export function addAnswer(db: Db, input: { label: string; answer: string }): AnswerEntry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const label = input.label.trim();
  // Upsert: re-running onboarding/setup must update an answer, not stack
  // duplicates (the bank once held "legally authorized → Yes" three times).
  db.prepare(`DELETE FROM answer_bank WHERE lower(label) = lower(?)`).run(label);
  db.prepare(`INSERT INTO answer_bank (id, label, answer, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, label, input.answer, createdAt);
  return { id, label, answer: input.answer, createdAt };
}
```

- [ ] **Step 4: Run full core suite**

Run: `cd packages/core && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/answerBank.ts packages/core/tests/answerBank.test.ts
git commit -m "fix(store): addAnswer upserts by label instead of stacking duplicates"
```

---

### Task 2: Wizard — state, constants, and step renumbering

**Files:**
- Modify: `apps/web/app/onboarding/page.tsx`

- [ ] **Step 1: Add constants + state.** After the `STATUSES` const (line ~62) add:

```tsx
const DEGREES = ["Bachelor's Degree", "Master's Degree", 'Master of Business Administration (M.B.A.)', 'Doctor of Philosophy (Ph.D.)', "Associate's Degree", "Engineer's Degree", 'Doctor of Medicine (M.D.)', 'Juris Doctor (J.D.)', 'High School', 'Other'] as const;
type Degree = typeof DEGREES[number];
const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'] as const;
const HISPANIC = ['Yes', 'No', 'Prefer not to say'] as const;
const RACES = ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'Two or More Races', 'White', 'Prefer not to say'] as const;
const VETERAN = ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', "I don't wish to answer"] as const;
const DISABILITY = ['No, I do not have a disability', 'Yes, I have a disability (or previously had one)', "I don't wish to answer"] as const;
const WORK_STYLES = ['Remote', 'Hybrid', 'Onsite'] as const;
type WorkStyle = typeof WORK_STYLES[number];
```

Change `const TOTAL = 6;` → `const TOTAL = 9;`.

Add state hooks after the existing collected state (line ~88):

```tsx
  // education
  const [school, setSchool] = useState('');
  const [degree, setDegree] = useState<Degree | null>(null);
  const [discipline, setDiscipline] = useState('');
  const [eduStart, setEduStart] = useState('');
  const [eduEnd, setEduEnd] = useState('');
  // work preferences
  const [workStyle, setWorkStyle] = useState<WorkStyle | null>(null);
  const [relocate, setRelocate] = useState<YN | null>(null);
  const [startDate, setStartDate] = useState('');
  const [heard, setHeard] = useState('LinkedIn');
  // EEO self-identification
  const [gender, setGender] = useState<string | null>(null);
  const [hispanic, setHispanic] = useState<string | null>(null);
  const [race, setRace] = useState<string | null>(null);
  const [veteran, setVeteran] = useState<string | null>(null);
  const [disability, setDisability] = useState<string | null>(null);
```

- [ ] **Step 2: Renumber the save chain in `next()`.** New step order: 0 welcome, 1 location, 2 work eligibility, **3 education, 4 preferences, 5 EEO**, 6 résumé, 7 AI key, 8 policy. Replace the `next()` if-chain branches `step === 3/4/5` with:

```tsx
      } else if (step === 3) {
        if (school.trim()) {
          await postJSON('/api/profile', { education: [{ school: school.trim(), degree, discipline: discipline.trim() || undefined, start_year: eduStart || undefined, end_year: eduEnd || undefined }] });
          await postJSON('/api/answers', { label: 'school', answer: school.trim() });
          await postJSON('/api/answers', { label: 'university', answer: school.trim() });
        }
        if (degree) await postJSON('/api/answers', { label: 'degree', answer: degree });
        if (discipline.trim()) await postJSON('/api/answers', { label: 'discipline', answer: discipline.trim() });
      } else if (step === 4) {
        await postJSON('/api/profile', {
          ...(workStyle ? { work_style_preference: workStyle } : {}),
          ...(relocate ? { willing_to_relocate: relocate === 'yes' } : {}),
          ...(startDate.trim() ? { earliest_start_date: startDate.trim() } : {})
        });
        if (workStyle === 'Remote') await postJSON('/api/answers', { label: 'preferred office location', answer: 'Remote' });
        if (relocate) await postJSON('/api/answers', { label: 'relocate', answer: relocate === 'yes' ? 'Yes' : 'No' });
        if (startDate.trim()) await postJSON('/api/answers', { label: 'start date', answer: startDate.trim() });
        if (heard.trim()) await postJSON('/api/answers', { label: 'how did you hear', answer: heard.trim() });
      } else if (step === 5) {
        const DECLINE = 'Decline to self-identify';
        const save = (label: string, v: string | null, decline: string) =>
          v ? postJSON('/api/answers', { label, answer: v.startsWith('Prefer not') ? decline : v }) : Promise.resolve();
        await save('gender', gender, DECLINE);
        await save('hispanic', hispanic, DECLINE);
        await save('race', race, DECLINE);
        await save('ethnicity', race, DECLINE);
        await save('veteran', veteran, "I don't wish to answer");
        await save('disability', disability, "I don't wish to answer");
      } else if (step === 6) {
        if (resume.trim()) await runTool('add_resume', { label: 'My résumé', rawText: resume.trim() });
      } else if (step === 7) {
        if (apiKey.trim()) await saveSettings({ apiKey: apiKey.trim() });
      } else if (step === 8) {
        await saveSettings({ submitPolicy, weeklyCap: Math.max(0, parseInt(weeklyCap || '0', 10)) });
        router.push('/');
        return;
      }
```

- [ ] **Step 3: Commit** (page won't render the new steps yet — bodies come next; commit after Task 3 instead if you prefer a always-green tree: in that case fold this commit into Task 3's. Recommended: complete Task 3 before committing.)

---

### Task 3: Wizard — the three step bodies

**Files:**
- Modify: `apps/web/app/onboarding/page.tsx` (the `steps` array)

- [ ] **Step 1: Insert three step objects** into the `steps` array between the work-eligibility entry (index 2) and the résumé entry:

```tsx
    {
      eyebrow: 'EDUCATION', title: 'Your most recent education.',
      blurb: 'School pickers are on nearly every form — answering once fills them everywhere.', canSkip: true,
      body: (
        <div className="space-y-5">
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">School</label><Input value={school} onChange={e => setSchool(e.target.value)} placeholder="Northwestern University" /></div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Degree</label>
            <OptionGrid options={[...DEGREES]} value={degree} onChange={setDegree} />
          </div>
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Discipline / major</label><Input value={discipline} onChange={e => setDiscipline(e.target.value)} placeholder="Engineering" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Start year</label><Input value={eduStart} onChange={e => setEduStart(e.target.value.replace(/[^0-9]/g, ''))} placeholder="2025" /></div>
            <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">End year (or expected)</label><Input value={eduEnd} onChange={e => setEduEnd(e.target.value.replace(/[^0-9]/g, ''))} placeholder="2026" /></div>
          </div>
        </div>
      )
    },
    {
      eyebrow: 'WORK PREFERENCES', title: 'How do you want to work?',
      blurb: 'Used for office-location, relocation, and start-date questions.', canSkip: true,
      body: (
        <div className="space-y-6">
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Preferred work style</div>
            <OptionGrid options={[...WORK_STYLES]} value={workStyle} onChange={setWorkStyle} />
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4">
            <Row label="Willing to relocate for the right role?">
              <Segmented options={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]} value={relocate} onChange={setRelocate} />
            </Row>
          </div>
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Earliest start date</label><Input value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="2 weeks after offer" /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">How did you hear about jobs? <span className="normal-case">(forms love this one)</span></label><Input value={heard} onChange={e => setHeard(e.target.value)} placeholder="LinkedIn" /></div>
        </div>
      )
    },
    {
      eyebrow: 'SELF-IDENTIFICATION', title: 'Voluntary self-identification.',
      blurb: 'US applications ask these. Every answer is optional — "Prefer not to say" is always respected, and everything stays on your machine.', canSkip: true,
      body: (
        <div className="space-y-6">
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Gender</div>
            <OptionGrid options={[...GENDERS]} value={gender as never} onChange={setGender as never} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Hispanic or Latino?</div>
            <OptionGrid options={[...HISPANIC]} value={hispanic as never} onChange={setHispanic as never} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Race / ethnicity</div>
            <OptionGrid options={[...RACES]} value={race as never} onChange={setRace as never} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Veteran status</div>
            <OptionGrid options={[...VETERAN]} value={veteran as never} onChange={setVeteran as never} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Disability status</div>
            <OptionGrid options={[...DISABILITY]} value={disability as never} onChange={setDisability as never} />
          </div>
        </div>
      )
    },
```

- [ ] **Step 2: Typecheck/build the web app**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head` (or `npm run build -w @crosswalk/web` if no tsconfig standalone)
Expected: no NEW errors attributable to onboarding/page.tsx.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/onboarding/page.tsx
git commit -m "feat(onboarding): education, work-preference, and EEO questionnaire steps"
```

---

### Task 4: README section

**Files:**
- Modify: `README.md` (insert a section after "How to use the app")

- [ ] **Step 1: Add the section:**

```markdown
## Tell it about yourself once (the questionnaire)

The first time you open the app you'll get a short **setup wizard** (you can re-run it anytime at `/onboarding`). Besides your name and résumé, it asks the questions that real applications repeat forever:

- **Work eligibility** — visa status, work authorization, sponsorship.
- **Education** — school, degree, discipline, years. (School pickers on Greenhouse-style forms fill from this.)
- **Work preferences** — remote/hybrid/onsite, relocation, earliest start date.
- **Voluntary self-identification (EEO)** — gender, ethnicity, veteran and disability status. Every question has a "prefer not to say" option, and that's exactly what gets put on forms if you choose it.

Your answers go into a local **answer bank** (plus your profile) in `~/.crosswalk`. When an application asks one of these questions — in any phrasing close enough to match — Crosswalk uses *your* saved answer instead of guessing. Anything not covered by the bank falls back to the AI, which only uses true facts from your résumé and profile.

You can see, add, and edit every saved answer under **Settings → Saved answers** — one-click "load common defaults" is there too (EEO declines, "authorized to work: yes", etc.). Saving an answer with the same question label **replaces** the old one.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document the onboarding questionnaire and answer bank"
```

---

### Task 5: Rebuild + live verification

**Files:** none (verification)

- [ ] **Step 1: Rebuild core** (store change) — `npm run build:core`
- [ ] **Step 2: Start the dev server** — `CROSSWALK_BROWSER_PROFILE=~/.crosswalk/chrome CROSSWALK_BROWSER_HEADED=1 npm run dev:web` (background)
- [ ] **Step 3: Drive `/onboarding` in a browser** (Playwright MCP): step through to the Education step, fill School "Northwestern University", pick "Master's Degree", Discipline "Engineering", Continue; fill Work preferences (Remote, relocate No, "2 weeks after offer", LinkedIn), Continue; EEO step pick "Prefer not to say"/"I don't wish to answer" for all, Continue; skip remaining steps.
- [ ] **Step 4: Verify rows** —
  `sqlite3 ~/.crosswalk/state.db "SELECT label, answer FROM answer_bank ORDER BY label"` shows single (no-duplicate) rows for school/university/degree/discipline/preferred office location/relocate/start date/how did you hear/gender/hispanic/race/ethnicity/veteran/disability;
  `sqlite3 ~/.crosswalk/state.db "SELECT data_json FROM profile"` contains `education`, `work_style_preference`, `willing_to_relocate`, `earliest_start_date`.
- [ ] **Step 5: Run full core suite once more** — `cd packages/core && npx vitest run` → all pass.
- [ ] **Step 6: Push** — `git push origin main`.
