import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export type AnswerEntry = {
  id: string;
  /** Keyword/phrase to match against a form question (case-insensitive). */
  label: string;
  /** The canonical answer to fill (text, or an option to pick for a select/radio). */
  answer: string;
  createdAt: string;
};

type Row = { id: string; label: string; answer: string; created_at: string };

export function addAnswer(db: Db, input: { label: string; answer: string }): AnswerEntry {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const label = input.label.trim();
  // Upsert: re-running onboarding/setup must update an answer, not stack
  // duplicates (the bank once held "legally authorized → Yes" three times).
  db.prepare(`DELETE FROM answer_bank WHERE lower(label) = lower(?)`).run(label);
  db.prepare(`INSERT INTO answer_bank (id, label, answer, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, label, input.answer, createdAt);
  return { id, label, answer: input.answer, createdAt };
}

export function listAnswers(db: Db): AnswerEntry[] {
  return (db.prepare(`SELECT * FROM answer_bank ORDER BY length(label) DESC, created_at DESC`).all() as Row[])
    .map(r => ({ id: r.id, label: r.label, answer: r.answer, createdAt: r.created_at }));
}

export function deleteAnswer(db: Db, id: string): void {
  db.prepare(`DELETE FROM answer_bank WHERE id = ?`).run(id);
}

/**
 * Find the canonical answer for a form question. Matches the longest bank
 * label that appears as a whole word/phrase in the question. Returns null if
 * none.
 *
 * Word-boundary check prevents a label like "relocate" from matching the side
 * clause "...if you would need to relocate..." in an unrelated long question.
 * Short labels (≤6 chars) additionally require a short question to fire, so
 * "no"/"yes" only answer obvious direct questions.
 */
export function matchAnswer(db: Db, question: string): string | null {
  const q = question.toLowerCase();
  // Only consider the MAIN question (up to first "?" or first "." or first
  // newline). The clarifying sentence after ("If you would need to relocate,
  // please type 'relocating'") was wrongly triggering bank matches like
  // "relocate" → "Yes" for an address field.
  const mainQuestionEnd = Math.min(
    ...[q.indexOf('?'), q.indexOf('. '), q.indexOf('\n')].filter(i => i > 0)
      .concat([q.length])
  );
  const mainQ = q.slice(0, mainQuestionEnd === Infinity ? q.length : mainQuestionEnd + 1);
  let best: string | null = null;
  let bestScore = 0;
  for (const entry of listAnswers(db)) {
    const key = entry.label.toLowerCase().trim();
    if (!key) continue;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundary = new RegExp(`(^|\\W)${escaped}(\\W|$)`);
    if (!wordBoundary.test(mainQ)) continue;
    const isShortKey = key.length <= 6;
    if (isShortKey && mainQ.length > 80) continue;
    const score = key.length + (isShortKey && mainQ.length <= 40 ? 5 : 0);
    if (score > bestScore) {
      best = entry.answer;
      bestScore = score;
    }
  }
  return best;
}

/** Safe, near-universal defaults a user can load with one click. EEO questions
 *  default to "decline"; work-authorization defaults to authorized. */
export const COMMON_DEFAULTS: Array<{ label: string; answer: string }> = [
  { label: 'gender', answer: 'Decline to self-identify' },
  { label: 'race', answer: 'Decline to self-identify' },
  { label: 'ethnicity', answer: 'Decline to self-identify' },
  { label: 'hispanic', answer: 'Decline to self-identify' },
  { label: 'veteran', answer: 'I am not a protected veteran' },
  { label: 'disability', answer: 'I do not wish to answer' },
  { label: 'how did you hear', answer: 'LinkedIn' },
  { label: 'legally authorized', answer: 'Yes' },
  { label: 'authorized to work', answer: 'Yes' }
];

export function loadDefaults(db: Db): number {
  const existing = new Set(listAnswers(db).map(a => a.label.toLowerCase()));
  let added = 0;
  for (const d of COMMON_DEFAULTS) {
    if (!existing.has(d.label.toLowerCase())) { addAnswer(db, d); added++; }
  }
  return added;
}
