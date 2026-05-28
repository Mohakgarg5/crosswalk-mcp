import type { SamplingClient } from '../../sampling/client.ts';

export type ChooseOptionArgs = {
  sampling: SamplingClient;
  label: string;
  options: string[];
  context: string;
};

const SYSTEM = `You help a job applicant pick the best option for a multiple-choice application field. Choose the single option that best fits the applicant and copy it EXACTLY as written. If no option is clearly appropriate, or it needs information you don't have, reply with exactly "SKIP".`;

/**
 * Ask the model to pick one of the given options for a select/radio question.
 * Returns the exact option string (guaranteed to be one of `options`) or null.
 */
export async function chooseFormOption(args: ChooseOptionArgs): Promise<string | null> {
  const { sampling, label, options, context } = args;
  if (options.length === 0) return null;

  const prompt = [
    `Question: ${label}`,
    'Options:',
    ...options.map(o => `- ${o}`),
    '',
    `Applicant: ${context}`,
    '',
    'Reply with the exact text of the chosen option, or SKIP.'
  ].join('\n');

  let raw: string;
  try {
    raw = await sampling.complete({ prompt, system: SYSTEM, maxTokens: 60, temperature: 0.2 });
  } catch {
    return null;
  }

  const t = raw.trim();
  if (!t || t === 'SKIP') return null;

  const exact = options.find(o => o.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  // Model may paraphrase slightly — accept a clear containment match.
  const contained = options.find(o => o.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(o.toLowerCase()));
  return contained ?? null;
}
