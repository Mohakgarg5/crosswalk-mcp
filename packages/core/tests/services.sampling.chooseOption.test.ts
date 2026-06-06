import { describe, it, expect, vi } from 'vitest';
import { chooseFormOption } from '../src/services/sampling/chooseOption.ts';
import type { SamplingClient } from '../src/sampling/client.ts';

describe('services/sampling/chooseOption', () => {
  it('instructs the model to favor the accommodating option for willingness/logistics questions instead of SKIP', async () => {
    const completeFn = vi.fn().mockResolvedValue('Yes');
    const sampling = { complete: completeFn } as unknown as SamplingClient;
    const out = await chooseFormOption({
      sampling,
      label: 'Are you able to come into the office four days per week?',
      options: ['Yes', 'No'],
      context: 'Jane Smith, PM in Chicago'
    });
    expect(out).toBe('Yes');
    const call = completeFn.mock.calls[0][0] as { system: string };
    // The system prompt must carry the willingness/logistics rule — these
    // questions (onsite days, relocation, start date) were being SKIPped
    // because the résumé never states them.
    expect(call.system).toMatch(/willingness|onsite|relocat/i);
  });

  it('returns the model\'s verbatim value for paginated typeaheads when allowFreeText is set', async () => {
    // Greenhouse school dropdowns harvest only the first page (~100 options);
    // "Northwestern University" isn't in it. The fill path types the value
    // into the typeahead, so an unlisted answer is still fillable.
    const sampling = { complete: vi.fn().mockResolvedValue('Northwestern University') } as unknown as SamplingClient;
    const out = await chooseFormOption({
      sampling,
      label: 'School',
      options: ['Aalto University', 'Abilene Christian University'],
      context: 'MS Engineering Management, Northwestern University',
      allowFreeText: true
    });
    expect(out).toBe('Northwestern University');
  });

  it('treats "SKIP" followed by commentary as a skip, even with allowFreeText', async () => {
    // Real leak: the model replied "SKIP\n\nThe applicant's résumé shows..."
    // and the whole blob was typed into a Greenhouse school typeahead.
    const sampling = { complete: vi.fn().mockResolvedValue("SKIP\n\nThe applicant's résumé shows education at Northwestern University.") } as unknown as SamplingClient;
    const out = await chooseFormOption({
      sampling, label: 'School', options: ['Aalto University'], context: 'ctx', allowFreeText: true
    });
    expect(out).toBeNull();
  });

  it('keeps only the first line of a free-text answer and strips markdown', async () => {
    const sampling = { complete: vi.fn().mockResolvedValue('**Northwestern University**\n\nThis is from the résumé.') } as unknown as SamplingClient;
    const out = await chooseFormOption({
      sampling, label: 'School', options: ['Aalto University'], context: 'ctx', allowFreeText: true
    });
    expect(out).toBe('Northwestern University');
  });

  it('still returns null for unlisted answers when allowFreeText is not set', async () => {
    const sampling = { complete: vi.fn().mockResolvedValue('Northwestern University') } as unknown as SamplingClient;
    const out = await chooseFormOption({
      sampling,
      label: 'School',
      options: ['Aalto University', 'Abilene Christian University'],
      context: 'ctx'
    });
    expect(out).toBeNull();
  });

  it('instructs the model to pick decline-to-answer for EEO questions with no facts, and to answer from context facts', async () => {
    const completeFn = vi.fn().mockResolvedValue('Decline To Self Identify');
    const sampling = { complete: completeFn } as unknown as SamplingClient;
    await chooseFormOption({
      sampling,
      label: 'Gender',
      options: ['Male', 'Female', 'Decline To Self Identify'],
      context: 'Jane'
    });
    const call = completeFn.mock.calls[0][0] as { system: string };
    expect(call.system).toMatch(/decline/i);
    // Work auth must be answered FROM context when present, not blanket-skipped.
    expect(call.system).toMatch(/from the applicant'?s context|context (?:already )?states|stated in the .*context/i);
  });
});
