'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Textarea } from '@/components/ui';
import { runTool, saveSettings } from '@/lib/api';

/* ---------- small building blocks ---------- */

function Segmented<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[]; value: T | null; onChange: (k: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--panel-2)] p-1">
      {options.map(o => {
        const on = o.key === value;
        return (
          <button key={o.key} onClick={() => onChange(o.key)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              on ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-sm)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function OptionGrid<T extends string>({ options, value, onChange }: {
  options: T[]; value: T | null; onChange: (k: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {options.map(o => {
        const on = o === value;
        return (
          <button key={o} onClick={() => onChange(o)}
            className={`rounded-xl border px-4 py-3 text-left text-sm font-medium transition-all ${
              on ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-sm)]'
                 : 'border-[var(--border)] bg-[var(--panel)] text-[var(--text)] hover:border-[var(--border-strong)]'
            }`}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-[var(--border)] last:border-0">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

/* ---------- the wizard ---------- */

const STATUSES = ['US Citizen', 'Permanent Resident', 'H-1B', 'F-1 (Student)', 'OPT', 'CPT', 'J-1', 'L-1', 'O-1', 'TN', 'E-3', 'Other'] as const;
type Status = typeof STATUSES[number];
type YN = 'yes' | 'no';
// The standard ATS degree list (Greenhouse et al.) — answers picked here fill
// those dropdowns verbatim.
const DEGREES = ["Bachelor's Degree", "Master's Degree", 'Master of Business Administration (M.B.A.)', 'Doctor of Philosophy (Ph.D.)', "Associate's Degree", "Engineer's Degree", 'Doctor of Medicine (M.D.)', 'Juris Doctor (J.D.)', 'High School', 'Other'] as const;
type Degree = typeof DEGREES[number];
const GENDERS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'] as const;
const HISPANIC = ['Yes', 'No', 'Prefer not to say'] as const;
const RACES = ['American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Other Pacific Islander', 'Two or More Races', 'White', 'Prefer not to say'] as const;
const VETERAN = ['I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', "I don't wish to answer"] as const;
const DISABILITY = ['No, I do not have a disability', 'Yes, I have a disability (or previously had one)', "I don't wish to answer"] as const;
const WORK_STYLES = ['Remote', 'Hybrid', 'Onsite'] as const;
type WorkStyle = typeof WORK_STYLES[number];
const TOTAL = 9;

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // collected state
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [authorized, setAuthorized] = useState<YN | null>(null);
  const [sponsorship, setSponsorship] = useState<YN | null>(null);
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
  const [resume, setResume] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultsLoaded, setDefaultsLoaded] = useState<number | null>(null);
  const [submitPolicy, setSubmitPolicy] = useState<'review' | 'auto'>('review');
  const [weeklyCap, setWeeklyCap] = useState('10');

  async function postJSON(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok && d.ok !== undefined) throw new Error(d.error || 'save failed');
    return d;
  }

  // Persist the current step, then advance. Each step is independent so partial
  // setup survives a refresh.
  async function next() {
    setErr(''); setBusy(true);
    try {
      if (step === 0) {
        await postJSON('/api/profile', {
          first_name: first, last_name: last,
          name: [first, last].filter(Boolean).join(' '),
          email, phone
        });
      } else if (step === 1) {
        await postJSON('/api/profile', { location, linkedin, website, links: { linkedin, website } });
      } else if (step === 2) {
        await postJSON('/api/profile', {
          work_authorization: status, authorized_to_work: authorized === 'yes', needs_sponsorship: sponsorship === 'yes'
        });
        if (authorized) await postJSON('/api/answers', { label: 'Are you legally authorized to work in the US?', answer: authorized === 'yes' ? 'Yes' : 'No' });
        if (sponsorship) await postJSON('/api/answers', { label: 'Will you now or in the future require sponsorship?', answer: sponsorship === 'yes' ? 'Yes' : 'No' });
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
        // "Prefer not to say" maps to the same decline strings the
        // load-defaults path uses, so both stay consistent on forms.
        const DECLINE = 'Decline to self-identify';
        const save = (label: string, v: string | null, decline: string) =>
          v ? postJSON('/api/answers', { label, answer: v.startsWith('Prefer not') || v.startsWith("I don't wish") ? decline : v }) : Promise.resolve();
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
      setStep(s => s + 1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const steps: { eyebrow: string; title: string; blurb: string; body: ReactNode; canSkip?: boolean }[] = [
    {
      eyebrow: 'WELCOME', title: 'Let’s set you up.',
      blurb: 'Answer a handful of questions once — Crosswalk reuses them on every application.',
      body: (
        <div className="grid grid-cols-2 gap-4">
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">First name</label><Input value={first} onChange={e => setFirst(e.target.value)} placeholder="Mohak" /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Last name</label><Input value={last} onChange={e => setLast(e.target.value)} placeholder="Garg" /></div>
          <div className="col-span-2"><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Email</label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></div>
          <div className="col-span-2"><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Phone</label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 123 4567" /><p className="mt-1.5 text-[12px] text-[var(--faint)]">Include a country code — most forms want it.</p></div>
        </div>
      )
    },
    {
      eyebrow: 'LOCATION & LINKS', title: 'Where are you, and where can they find you?',
      blurb: 'Location and LinkedIn show up on nearly every application.',
      body: (
        <div className="space-y-4">
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Location</label><Input value={location} onChange={e => setLocation(e.target.value)} placeholder="San Francisco, CA" /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">LinkedIn</label><Input value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…" /></div>
          <div><label className="mb-1.5 block text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Website / portfolio <span className="normal-case text-[var(--faint)]">(optional)</span></label><Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://…" /></div>
        </div>
      )
    },
    {
      eyebrow: 'WORK ELIGIBILITY', title: 'What’s your work status?',
      blurb: 'Used to fill the authorization questions and skip jobs you can’t apply to.',
      body: (
        <div className="space-y-6">
          <OptionGrid options={[...STATUSES]} value={status} onChange={setStatus} />
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4">
            <Row label="Are you legally authorized to work in the US?">
              <Segmented options={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]} value={authorized} onChange={setAuthorized} />
            </Row>
            <Row label="Will you now, or in the future, require sponsorship?">
              <Segmented options={[{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }]} value={sponsorship} onChange={setSponsorship} />
            </Row>
          </div>
        </div>
      )
    },
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
            <OptionGrid options={[...GENDERS]} value={gender} onChange={setGender} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Hispanic or Latino?</div>
            <OptionGrid options={[...HISPANIC]} value={hispanic} onChange={setHispanic} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Race / ethnicity</div>
            <OptionGrid options={[...RACES]} value={race} onChange={setRace} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Veteran status</div>
            <OptionGrid options={[...VETERAN]} value={veteran} onChange={setVeteran} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Disability status</div>
            <OptionGrid options={[...DISABILITY]} value={disability} onChange={setDisability} />
          </div>
        </div>
      )
    },
    {
      eyebrow: 'RÉSUMÉ', title: 'Paste your résumé.',
      blurb: 'Crosswalk tailors a copy per job from this — your original is never changed.', canSkip: true,
      body: (
        <Textarea value={resume} onChange={e => setResume(e.target.value)} rows={12} placeholder="Paste the full text of your résumé…" />
      )
    },
    {
      eyebrow: 'AI BRAIN', title: 'Add your AI key.',
      blurb: 'Used to tailor résumés and answer application questions. Finding & tracking jobs works without it.', canSkip: true,
      body: (
        <div className="space-y-3">
          <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-…" />
          <p className="text-[13px] text-[var(--muted)]">Get a key at <span className="text-[var(--accent)]">console.anthropic.com</span>. It’s stored only in <code className="text-[var(--accent)]">~/.crosswalk</code> and never leaves your machine.</p>
        </div>
      )
    },
    {
      eyebrow: 'HOW TO APPLY', title: 'How should Crosswalk apply?',
      blurb: 'You can change these anytime in Settings.',
      body: (
        <div className="space-y-5">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Submit policy</div>
            <Segmented
              options={[{ key: 'review', label: 'Review first' }, { key: 'auto', label: 'Auto-submit' }]}
              value={submitPolicy} onChange={setSubmitPolicy}
            />
            <p className="mt-3 text-[13px] text-[var(--muted)]">
              {submitPolicy === 'review' ? 'Crosswalk fills the form and waits for your OK before submitting. Recommended to start.' : 'Crosswalk fills and submits on its own. Turn this on once you trust the output.'}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[var(--faint)]">Weekly cap</div>
            <div className="flex items-center gap-3">
              <Input value={weeklyCap} onChange={e => setWeeklyCap(e.target.value.replace(/[^0-9]/g, ''))} className="w-28" />
              <span className="text-[13px] text-[var(--muted)]">applications / week ( 0 = unlimited )</span>
            </div>
          </div>
        </div>
      )
    }
  ];

  const s = steps[step];
  const pct = Math.round(((step + 1) / TOTAL) * 100);

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid max-w-5xl gap-10 px-6 py-12 lg:grid-cols-[260px_1fr]">
        {/* Left rail */}
        <aside className="hidden lg:block">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="m15 9-3 3-3-3 3 8z" fill="currentColor" /></svg>
            </span>
            <span className="font-display text-[17px] font-semibold">Crosswalk</span>
          </div>
          <div className="mt-8">
            <div className="flex items-center justify-between text-[12px] uppercase tracking-wide text-[var(--faint)]">
              <span>Setup</span><span>Step {step + 1} of {TOTAL}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="mt-8 space-y-4 text-[13px] leading-relaxed text-[var(--muted)]">
            <div>
              <div className="font-medium text-[var(--text)]">Why we ask</div>
              <p className="mt-1">Every application repeats these questions. Answer once here and Crosswalk fills the forms for you.</p>
            </div>
            <div className="flex items-center gap-2 text-[12px] text-[var(--faint)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" /> Saved locally to ~/.crosswalk
            </div>
          </div>
        </aside>

        {/* Main */}
        <main key={step} className="cw-rise">
          <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--accent)]">{s.eyebrow}</div>
          <h1 className="font-display mt-2 text-[34px] font-semibold leading-[1.1] tracking-tight">{s.title}</h1>
          <p className="mt-3 max-w-xl text-[15px] text-[var(--muted)]">{s.blurb}</p>

          <div className="mt-8">{s.body}</div>

          {err && <div className="mt-5 rounded-xl border border-[var(--bad)]/30 bg-[var(--bad-bg)] px-3.5 py-2.5 text-sm text-[var(--bad)]">{err}</div>}

          <div className="mt-8 flex items-center gap-4">
            <Button onClick={next} disabled={busy}>
              {busy ? 'Saving…' : step === TOTAL - 1 ? 'Finish — go to dashboard' : 'Continue'}
              {!busy && step !== TOTAL - 1 && <span className="opacity-70">↵</span>}
            </Button>
            {step > 0 && <button onClick={() => { setErr(''); setStep(s => s - 1); }} className="text-[13px] font-medium text-[var(--muted)] hover:text-[var(--text)]">← Back</button>}
            {s.canSkip && <button onClick={next} disabled={busy} className="ml-auto text-[13px] font-medium text-[var(--faint)] hover:text-[var(--muted)]">Skip for now</button>}
          </div>

          {/* answer defaults helper on the résumé/key steps' sibling — offered on the work step */}
          {step === 2 && (
            <button
              onClick={async () => { try { const d = await postJSON('/api/answers', { action: 'load-defaults' }); setDefaultsLoaded(d.added ?? 0); } catch {} }}
              className="mt-5 text-[13px] font-medium text-[var(--accent)] hover:underline"
            >
              {defaultsLoaded === null ? '+ Load common answer defaults (work auth, EEO, etc.)' : `✓ Loaded ${defaultsLoaded} common answers`}
            </button>
          )}
        </main>
      </div>
    </div>
  );
}
