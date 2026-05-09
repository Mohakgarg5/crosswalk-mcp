import { describe, it, expect, vi } from 'vitest';
import { sampleAnswerForFormField } from '../src/services/sampling/answerFormField.ts';
import type { SamplingClient } from '../src/sampling/client.ts';
import type { FormField } from '../src/services/browser/types.ts';

function makeFakeSampling(text: string): SamplingClient {
  return { complete: vi.fn().mockResolvedValue(text) } as unknown as SamplingClient;
}

const baseField: FormField = {
  name: 'why_company',
  type: 'textarea',
  label: 'Why are you interested in this company?',
  required: true
};

describe('services/sampling/answerFormField', () => {
  it('returns the trimmed model answer when the model produces a real answer', async () => {
    const sampling = makeFakeSampling("  I love the product depth and the team's focus on quality.  ");
    const out = await sampleAnswerForFormField({
      sampling,
      formField: baseField,
      jobContext: 'PM at Stripe — Payments team',
      applicantContext: 'Jane Smith, PM with 6 years at Acme working on API products.'
    });
    expect(out).toBe("I love the product depth and the team's focus on quality.");
  });

  it('returns null when the model returns SKIP', async () => {
    const sampling = makeFakeSampling('SKIP');
    const out = await sampleAnswerForFormField({
      sampling,
      formField: baseField,
      jobContext: 'PM',
      applicantContext: 'Jane'
    });
    expect(out).toBeNull();
  });

  it('returns null when the model returns SKIP with surrounding whitespace', async () => {
    const sampling = makeFakeSampling('\n SKIP \n');
    const out = await sampleAnswerForFormField({
      sampling,
      formField: baseField,
      jobContext: 'PM',
      applicantContext: 'Jane'
    });
    expect(out).toBeNull();
  });

  it('returns null when the sampling call throws', async () => {
    const sampling: SamplingClient = {
      complete: vi.fn().mockRejectedValue(new Error('boom'))
    } as unknown as SamplingClient;
    const out = await sampleAnswerForFormField({
      sampling,
      formField: baseField,
      jobContext: 'PM',
      applicantContext: 'Jane'
    });
    expect(out).toBeNull();
  });

  it('passes the form field label, job context, and applicant context to sampling', async () => {
    const completeFn = vi.fn().mockResolvedValue('answer');
    const sampling = { complete: completeFn } as unknown as SamplingClient;
    await sampleAnswerForFormField({
      sampling,
      formField: { name: 'visa_status', type: 'textarea', label: 'Visa status?', required: true },
      jobContext: 'Senior PM at Foo',
      applicantContext: 'Mark, US citizen'
    });
    expect(completeFn).toHaveBeenCalledTimes(1);
    const call = completeFn.mock.calls[0][0] as { prompt: string; maxTokens: number };
    expect(call.prompt).toContain('Visa status?');
    expect(call.prompt).toContain('Senior PM at Foo');
    expect(call.prompt).toContain('Mark, US citizen');
    expect(call.maxTokens).toBeGreaterThan(0);
  });
});
