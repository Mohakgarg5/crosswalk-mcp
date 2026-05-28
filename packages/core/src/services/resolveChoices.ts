import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';
import type { FormField, FillField } from './browser/types.ts';
import { matchAnswer } from '../store/answerBank.ts';
import { chooseFormOption } from './sampling/chooseOption.ts';

function fuzzyPick(options: string[], answer: string): string | null {
  const a = answer.toLowerCase();
  return options.find(o => o.toLowerCase() === a)
    ?? options.find(o => o.toLowerCase().includes(a) || a.includes(o.toLowerCase()))
    ?? null;
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

  // <select>
  for (const f of formFields) {
    if (f.type !== 'select' || !f.name || !f.options || f.options.length === 0) continue;
    const question = f.label || f.name;
    const bank = matchAnswer(db, question);
    let chosen = bank ? fuzzyPick(f.options, bank) : null;
    if (!chosen) chosen = await chooseFormOption({ sampling, label: question, options: f.options, context });
    if (chosen) out.push({ kind: 'select_by_name', name: f.name, value: chosen });
  }

  // radio groups (one FormField per radio; value = the radio's value attribute)
  const groups = new Map<string, Array<{ label?: string; value?: string }>>();
  for (const f of formFields) {
    if (f.type !== 'radio' || !f.name) continue;
    const arr = groups.get(f.name) ?? [];
    arr.push({ label: f.label, value: f.value });
    groups.set(f.name, arr);
  }
  for (const [name, opts] of groups) {
    const labels = opts.map(o => o.label || o.value || '').filter(Boolean);
    if (labels.length === 0) continue;
    const bank = matchAnswer(db, name) ?? matchAnswer(db, labels.join(' '));
    let chosenLabel = bank ? fuzzyPick(labels, bank) : null;
    if (!chosenLabel) chosenLabel = await chooseFormOption({ sampling, label: name, options: labels, context });
    if (!chosenLabel) continue;
    const opt = opts.find(o => (o.label || o.value) === chosenLabel) ?? opts.find(o => (o.label || '').includes(chosenLabel!));
    const value = opt?.value ?? chosenLabel;
    if (value) out.push({ kind: 'radio_by_name', name, value });
  }

  // checkboxes — only when the bank gives an affirmative answer
  for (const f of formFields) {
    if (f.type !== 'checkbox' || !f.name) continue;
    const bank = matchAnswer(db, f.label || f.name);
    if (bank && AFFIRMATIVE.test(bank.trim())) {
      out.push({ kind: 'checkbox_by_name', name: f.name, checked: true });
    }
  }

  return out;
}
