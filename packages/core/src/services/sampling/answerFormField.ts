import type { SamplingClient } from '../../sampling/client.ts';
import type { FormField } from '../browser/types.ts';
import { stripEmDashes } from '../humanize.ts';

export type SampleAnswerOpts = {
  sampling: SamplingClient;
  formField: FormField;
  jobContext: string;
  applicantContext: string;
};

const SYSTEM = `You are helping a job applicant fill out a form question. Return ONLY the answer text — no preamble, no markdown, no quotes.

Answer length rules (PICK THE RIGHT FORMAT — getting this wrong leaves the form unfilled):
- Yes/No questions ("Are you...", "Do you...", "Have you ever...", "Will you...", "Can you...", "Is...") → answer with just "Yes" or "No". One word.
- Consent / policy / agreement questions ("AI Policy for Application", "Terms of Service", "I agree...", "I confirm...", "I have read...") → answer with just "Yes". One word.
- Address/location asks → answer with just the city/state/address. One line.
- Phone/email/URL → just the value. One line.
- Multiple-choice intent (the question implies picking from a known list like Male/Female, Asian/Black/Hispanic, etc.) → answer with just the single best matching option word/phrase. No explanation.
- Open-ended essay questions ("Why this company", "Tell us about a time", "Describe your...") → 2-4 sentences, sincere, in the applicant's voice.

Voice rules for open-ended answers (the answer must read like the applicant typed it, not like AI wrote it):
- NEVER use an em dash (—) or semicolon. Use commas and periods instead.
- Plain, direct, first-person sentences. Vary sentence length. A little informal is fine.
- Ban the AI tells: "I'm excited by", "genuinely", "deeply", "exactly the kind of", "That combination of", "resonates with me", "I'm drawn to", "category-defining", "the intersection of".
- Be concrete: name one specific thing (a product, a project, a number) instead of stacking adjectives.
- Don't restate the question and don't end with a grand summary sentence.

Critical content rules:
- The job_context describes the target job the applicant is APPLYING TO. It is NOT their current or past employer.
- For questions about "your current/previous employer", "your last company", "where do you work now", "your most recent job title" — pull ONLY from the applicant's actual work history in applicant_context (their cover letter / résumé). NEVER use the company from job_context as their employer. NEVER fabricate a job at the target company.
- For questions about location/city/state — use the applicant's stated location, not the job's location.
- For very specific past experiences not present in applicant_context (e.g. "tell us about a time you led a 200-person team" when no such experience exists), respond with exactly the word "SKIP" and nothing else. NEVER skip a Yes/No/consent question — those always have a sensible default ("Yes" for consent, the candidate's typical answer for Y/N from context).
- Conditional follow-up questions ("If yes, ...", "If so, ...", "If applicable, ...") depend on an earlier answer you cannot see. Unless the context clearly answers them, respond with exactly "SKIP". NEVER comment on the question itself.
- Keep answers truthful. If the candidate has 4 years of experience, don't say "10+ years".`;

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
  // The model sometimes talks ABOUT the question instead of answering it
  // ("I need to see the full question..."). Typing that into a real form is
  // the worst outcome — treat any meta-commentary as a skip.
  const META_COMMENTARY = /\b(i need (?:to see|more)|i can(?:no|')t\b|i cannot\b|as an ai|the question (?:appears|seems|is cut)|without (?:seeing|more|knowing)|please provide|unable to (?:answer|determine))\b/i;
  if (META_COMMENTARY.test(trimmed)) return null;
  return stripEmDashes(trimmed);
}
