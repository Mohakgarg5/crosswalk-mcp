import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';
import type { FormField, FillField } from './browser/types.ts';
import { matchAnswer } from '../store/answerBank.ts';
import { chooseFormOption } from './sampling/chooseOption.ts';

const ALIAS_GROUPS: string[][] = [
  ['united states', 'us', 'usa', 'u.s.', 'u.s.a.', 'united states of america'],
  ['united kingdom', 'uk', 'great britain', 'gb'],
  ['united arab emirates', 'uae']
];

function fuzzyPick(options: string[], answer: string): string | null {
  const a = answer.toLowerCase();
  const grp = ALIAS_GROUPS.find(g => g.includes(a));
  const exact = options.find(o => o.toLowerCase() === a);
  if (exact) return exact;
  if (grp) {
    const aliased = options.find(o => grp.includes(o.toLowerCase()));
    if (aliased) return aliased;
  }
  const contained = options.filter(o => o.toLowerCase().includes(a) || a.includes(o.toLowerCase()));
  // A generic answer ("Yes") that matches several options ("Yes - US Citizen",
  // "Yes - Green Card holder", "Yes - Visa holder") is ambiguous — taking the
  // first hit attested US citizenship for a CPT visa holder. Let the model
  // decide with the applicant's context instead.
  return contained.length === 1 ? contained[0] : null;
}

const AFFIRMATIVE = /^(yes|true|agree|i agree|i certify|accept|confirm|on)\b/i;

/**
 * Turn the choice fields (select / radio / checkbox) discovered on a form into
 * concrete fill instructions, using the answer bank first (deterministic) and
 * the model as a fallback. Checkboxes are only ticked when the bank has an
 * explicitly affirmative answer — never auto-agree to arbitrary boxes.
 */
export async function resolveChoiceFields(
  db: Db,
  sampling: SamplingClient,
  formFields: FormField[],
  context: string
): Promise<FillField[]> {
  const out: FillField[] = [];

  // <select> — plus custom comboboxes whose options were harvested at
  // preview time (type 'text' with a non-empty options list).
  for (const f of formFields) {
    const isChoice = f.type === 'select' || (f.type === 'text' && (f.options?.length ?? 0) > 0);
    if (!isChoice || !f.name || !f.options || f.options.length === 0) continue;
    const question = f.label || f.name;
    const bank = matchAnswer(db, question);
    let chosen = bank ? fuzzyPick(f.options, bank) : null;
    // 50+ harvested options means a paginated typeahead (school pickers) —
    // the list is one page of many, so accept an unlisted verbatim answer
    // and let the fill path type it into the live widget.
    const paginated = f.options.length >= 50;
    if (!chosen && bank && paginated) chosen = bank;
    if (!chosen) chosen = await chooseFormOption({ sampling, label: question, options: f.options, context, allowFreeText: paginated });
    // Required dropdown still empty (the model SKIPped a custom question like
    // "AI Policy for Application")? It blocks submit, so force a choice from the
    // options the form itself offers — never leave a required field blank.
    if (!chosen && f.required && !paginated) {
      chosen = await chooseFormOption({ sampling, label: question, options: f.options, context, mustChoose: true });
    }
    if (chosen) out.push({ kind: 'select_by_name', name: f.name, value: chosen });
  }

  // radio groups (one FormField per radio; value = the radio's value attribute)
  const groups = new Map<string, Array<{ label?: string; value?: string; groupLabel?: string }>>();
  for (const f of formFields) {
    if (f.type !== 'radio' || !f.name) continue;
    const arr = groups.get(f.name) ?? [];
    arr.push({ label: f.label, value: f.value, groupLabel: f.groupLabel });
    groups.set(f.name, arr);
  }
  for (const [name, opts] of groups) {
    const labels = opts.map(o => o.label || o.value || '').filter(Boolean);
    if (labels.length === 0) continue;
    const question = opts.find(o => o.groupLabel)?.groupLabel ?? name;
    const bank = matchAnswer(db, question) ?? matchAnswer(db, name) ?? matchAnswer(db, labels.join(' '));
    let chosenLabel = bank ? fuzzyPick(labels, bank) : null;
    if (!chosenLabel) chosenLabel = await chooseFormOption({ sampling, label: question, options: labels, context });
    if (!chosenLabel) continue;
    const opt = opts.find(o => (o.label || o.value) === chosenLabel) ?? opts.find(o => (o.label || '').includes(chosenLabel!));
    // Boards like Ashby give every radio value="on" — a value-attr selector
    // would always hit the first option. Pass the label through so the fill
    // path can target the radio by its visible text instead.
    const degenerateValues = opts.every(o => !o.value || o.value === 'on');
    const value = degenerateValues ? (opt?.label ?? chosenLabel) : (opt?.value ?? chosenLabel);
    if (value) out.push({ kind: 'radio_by_name', name, value });
  }

  // Standard consent / acknowledge patterns — universal "I agree to X" boxes
  // every candidate must tick to submit (privacy policy, AI-use policy,
  // demographic-data consent, etc.). Auto-tick when matched; refusing them =
  // the form refuses to submit. Marketing-style boxes ("Subscribe to our
  // newsletter", "Send me job alerts") don't match and stay unticked.
  const STANDARD_CONSENT = /\b(acknowledge|i agree|i confirm|i consent|i accept|i have read|terms (of|and)|privacy policy|disclaimer|certify that|attest that|understand that|authorize|consent to|confirm i have)\b/i;

  // Single-select checkbox groups — Lever renders one-of-N questions
  // ("Previously employed here?" No / Yes-Intern / Yes-FT) as checkboxes
  // sharing a name. Treat them like radio groups: pick one option and click
  // it by label (the radio fill path handles checkboxes too).
  const cbGroups = new Map<string, Array<{ label?: string; value?: string; groupLabel?: string }>>();
  for (const f of formFields) {
    if (f.type !== 'checkbox' || !f.name) continue;
    const arr = cbGroups.get(f.name) ?? [];
    arr.push({ label: f.label, value: f.value, groupLabel: f.groupLabel });
    cbGroups.set(f.name, arr);
  }
  const groupedCheckboxNames = new Set([...cbGroups.entries()].filter(([, o]) => o.length >= 2).map(([n]) => n));
  for (const [name, opts] of cbGroups) {
    if (opts.length < 2) continue;
    const labels = opts.map(o => o.label || '').filter(Boolean);
    if (labels.length < 2) continue;
    const question = opts.find(o => o.groupLabel)?.groupLabel ?? name;
    const bank = matchAnswer(db, question) ?? matchAnswer(db, name) ?? matchAnswer(db, labels.join(' '));
    let chosenLabel = bank ? fuzzyPick(labels, bank) : null;
    if (!chosenLabel) chosenLabel = await chooseFormOption({ sampling, label: question, options: labels, context });
    if (!chosenLabel) continue;
    out.push({ kind: 'radio_by_name', name, value: chosenLabel });
  }

  // checkboxes — tick when the bank gives an affirmative answer OR the label
  // is a standard consent/acknowledgement. (Skip members of single-select
  // groups handled above.)
  for (const f of formFields) {
    if (f.type !== 'checkbox' || !f.name || groupedCheckboxNames.has(f.name)) continue;
    const labelText = (f.label || f.name).toLowerCase();
    const bank = matchAnswer(db, f.label || f.name);
    const isStandardConsent = STANDARD_CONSENT.test(labelText);
    if ((bank && AFFIRMATIVE.test(bank.trim())) || isStandardConsent) {
      out.push({ kind: 'checkbox_by_name', name: f.name, checked: true });
    }
  }

  return out;
}
