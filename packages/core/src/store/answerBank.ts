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
  db.prepare(`INSERT INTO answer_bank (id, label, answer, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, input.label.trim(), input.answer, createdAt);
  return { id, label: input.label.trim(), answer: input.answer, createdAt };
}

export function listAnswers(db: Db): AnswerEntry[] {
  return (db.prepare(`SELECT * FROM answer_bank ORDER BY length(label) DESC, created_at DESC`).all() as Row[])
    .map(r => ({ id: r.id, label: r.label, answer: r.answer, createdAt: r.created_at }));
}

export function deleteAnswer(db: Db, id: string): void {
  db.prepare(`DELETE FROM answer_bank WHERE id = ?`).run(id);
}

/**
 * Find the canonical answer for a form question. Matches the most specific
 * (longest) bank label that appears in the question text. Returns null if none.
 */
export function matchAnswer(db: Db, question: string): string | null {
  const q = question.toLowerCase();
  let best: string | null = null;
  let bestLen = 0;
  for (const entry of listAnswers(db)) {
    const key = entry.label.toLowerCase();
    if (key && key.length > bestLen && q.includes(key)) {
      best = entry.answer;
      bestLen = key.length;
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
