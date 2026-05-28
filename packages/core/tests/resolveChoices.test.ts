import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addAnswer } from '../src/store/answerBank.ts';
import { resolveChoiceFields } from '../src/services/resolveChoices.ts';
import type { FormField } from '../src/services/browser/types.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

function sampling(reply = 'SKIP'): SamplingClient {
  return { complete: async () => reply, completeJson: async () => ({}) } as unknown as SamplingClient;
}

describe('resolveChoiceFields', () => {
  it('resolves select, radio, and checkbox from the answer bank', async () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'authorized to work', answer: 'Authorized' });
    addAnswer(db, { label: 'sponsorship', answer: 'No' });
    addAnswer(db, { label: 'agree to terms', answer: 'Yes' });

    const fields: FormField[] = [
      { name: 'work_auth', type: 'select', label: 'Are you authorized to work in the US?', required: true, options: ['Yes, authorized to work', 'No, require sponsorship'] },
      { name: 'sponsorship', type: 'radio', label: 'Yes', required: false, value: 'yes' },
      { name: 'sponsorship', type: 'radio', label: 'No', required: false, value: 'no' },
      { name: 'agree', type: 'checkbox', label: 'I agree to terms', required: true }
    ];

    const out = await resolveChoiceFields(db, sampling(), fields, 'A software engineer.');
    expect(out).toContainEqual({ kind: 'select_by_name', name: 'work_auth', value: 'Yes, authorized to work' });
    expect(out).toContainEqual({ kind: 'radio_by_name', name: 'sponsorship', value: 'no' });
    expect(out).toContainEqual({ kind: 'checkbox_by_name', name: 'agree', checked: true });
  });

  it('falls back to the model when the bank has no answer', async () => {
    const db = openDb(':memory:'); // empty bank
    const fields: FormField[] = [
      { name: 'experience', type: 'select', label: 'Years of experience', required: true, options: ['0-2', '3-5', '6+'] }
    ];
    const out = await resolveChoiceFields(db, sampling('3-5'), fields, 'Engineer with 4 years.');
    expect(out).toContainEqual({ kind: 'select_by_name', name: 'experience', value: '3-5' });
  });

  it('does not tick a checkbox without an affirmative bank answer', async () => {
    const db = openDb(':memory:');
    const fields: FormField[] = [{ name: 'marketing', type: 'checkbox', label: 'Send me marketing emails', required: false }];
    const out = await resolveChoiceFields(db, sampling(), fields, 'ctx');
    expect(out.find(f => f.kind === 'checkbox_by_name')).toBeUndefined();
  });
});
