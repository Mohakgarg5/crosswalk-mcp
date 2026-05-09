import type { SamplingClient } from '../../sampling/client.ts';
import type { FormField } from '../browser/types.ts';

export type SampleAnswerOpts = {
  sampling: SamplingClient;
  formField: FormField;
  jobContext: string;
  applicantContext: string;
};

const SYSTEM = `You are helping a job applicant fill out a form question. Write a concise, sincere 1-3 sentence answer in the applicant's voice. Return ONLY the answer text — no preamble, no markdown, no quotes. If the question cannot be reasonably answered from the provided context (for example, it asks about a specific past experience that wasn't shared), respond with exactly the word "SKIP" and nothing else.`;

export async function sampleAnswerForFormField(opts: SampleAnswerOpts): Promise<string | null> {
  const { sampling, formField, jobContext, applicantContext } = opts;
  const label = formField.label || formField.name;
  const prompt = [
    `Form question: ${label}`,
    `Required: ${formField.required ? 'yes' : 'no'}`,
    '',
    `Job context: ${jobContext}`,
    `Applicant context: ${applicantContext}`,
    '',
    'Write the answer.'
  ].join('\n');

  let raw: string;
  try {
    raw = await sampling.complete({
      prompt,
      system: SYSTEM,
      maxTokens: 250,
      temperature: 0.4
    });
  } catch {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === 'SKIP') return null;
  return trimmed;
}
