import type { SamplingClient } from '../../sampling/client.ts';

export type ChooseOptionArgs = {
  sampling: SamplingClient;
  label: string;
  options: string[];
  context: string;
  /** Paginated typeaheads (school pickers) harvest only the first page of
   * options — when set, an answer that isn't in `options` is returned
   * verbatim so the fill path can type it into the live typeahead. */
  allowFreeText?: boolean;
};

const SYSTEM = `You help a job applicant pick the best option for a multiple-choice application field. Choose the single option that best fits the applicant and copy it EXACTLY as written.

Willingness / logistics questions — working onsite or hybrid a set number of days per week, relocating to the job's city, start-date availability, notice periods: these ask about willingness, not facts, so never SKIP them. Pick the accommodating option (usually "Yes") unless the applicant's context clearly says otherwise.

Factual questions (work authorization, sponsorship, location, education): answer from the applicant's context when the fact is stated there — only SKIP when the needed fact is genuinely absent.

Voluntary demographic / EEO questions (gender, race/ethnicity, Hispanic/Latino, veteran status, disability): if the applicant's context doesn't state the fact, pick the "decline to answer" / "I don't wish to answer" style option instead of SKIP — a blank EEO section looks worse than a decline.

If the options list looks like one page of a longer list (e.g. universities) and the applicant's true value isn't shown, reply with the applicant's exact value verbatim instead of picking a wrong option.

Otherwise, if no option is clearly appropriate, or it needs personal facts you don't have (salary history, government IDs, specific certifications), reply with exactly "SKIP".`;

/**
 * Ask the model to pick one of the given options for a select/radio question.
 * Returns the exact option string (guaranteed to be one of `options`) or null.
 */
export async function chooseFormOption(args: ChooseOptionArgs): Promise<string | null> {
  const { sampling, label, options, context, allowFreeText } = args;
  if (options.length === 0) return null;

  const prompt = [
    `Question: ${label}`,
    'Options:',
    ...options.map(o => `- ${o}`),
    '',
    `Applicant: ${context}`,
    '',
    'Reply with ONLY the chosen option text (or the applicant\'s exact value for a partial list), on one line, with no explanation — or exactly "SKIP".'
  ].join('\n');

  let raw: string;
  try {
    raw = await sampling.complete({ prompt, system: SYSTEM, maxTokens: 60, temperature: 0.2 });
  } catch {
    return null;
  }

  const t0 = raw.trim();
  // "SKIP" plus trailing commentary is still a skip — the exact-equality
  // check let "SKIP\n\nThe applicant's résumé shows..." through as a value.
  if (!t0 || /^skip\b/i.test(t0)) return null;
  // Options are single-line: everything after the first line is commentary,
  // and markdown bold survives from résumé quotes.
  const t = t0.split('\n')[0].replace(/\*\*/g, '').trim();
  if (!t) return null;

  const exact = options.find(o => o.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  // Model may paraphrase slightly — accept a clear containment match.
  const contained = options.find(o => o.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(o.toLowerCase()));
  if (contained) return contained;
  // Paginated typeahead: the harvested options are incomplete, so trust the
  // model's verbatim value — the fill path types it into the live widget.
  return allowFreeText ? t : null;
}
