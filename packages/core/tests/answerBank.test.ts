import { describe, it, expect } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addAnswer, listAnswers, deleteAnswer, matchAnswer, loadDefaults } from '../src/store/answerBank.ts';

describe('answer bank', () => {
  it('adds, lists, and deletes answers', () => {
    const db = openDb(':memory:');
    const a = addAnswer(db, { label: 'work authorization', answer: 'Authorized to work in the US' });
    expect(listAnswers(db).length).toBe(1);
    deleteAnswer(db, a.id);
    expect(listAnswers(db).length).toBe(0);
  });

  it('matches the most specific (longest) label in a question', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'authorized', answer: 'GENERIC' });
    addAnswer(db, { label: 'legally authorized to work', answer: 'Yes' });
    expect(matchAnswer(db, 'Are you legally authorized to work in the United States?')).toBe('Yes');
  });

  it('returns null when nothing matches', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'gender', answer: 'Decline' });
    expect(matchAnswer(db, 'What is your favorite color?')).toBeNull();
  });

  it('replaces an existing answer with the same label, case-insensitively (upsert)', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'Gender', answer: 'Male' });
    addAnswer(db, { label: 'gender', answer: 'Decline to self-identify' });
    const matches = listAnswers(db).filter(a => a.label.toLowerCase() === 'gender');
    expect(matches).toHaveLength(1);
    expect(matches[0].answer).toBe('Decline to self-identify');
  });

  it('keeps answers with different labels independent', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'gender', answer: 'Male' });
    addAnswer(db, { label: 'veteran', answer: 'I am not a protected veteran' });
    expect(listAnswers(db)).toHaveLength(2);
  });

  it('loadDefaults still skips labels the user already set', () => {
    const db = openDb(':memory:');
    addAnswer(db, { label: 'gender', answer: 'Male' });
    loadDefaults(db);
    const gender = listAnswers(db).filter(a => a.label.toLowerCase() === 'gender');
    expect(gender).toHaveLength(1);
    expect(gender[0].answer).toBe('Male');
  });

  it('loadDefaults seeds EEO/work-auth answers idempotently', () => {
    const db = openDb(':memory:');
    expect(loadDefaults(db)).toBeGreaterThan(0);
    const n = listAnswers(db).length;
    expect(loadDefaults(db)).toBe(0); // no duplicates on second load
    expect(listAnswers(db).length).toBe(n);
    expect(matchAnswer(db, 'Gender (optional)')).toBe('Decline to self-identify');
    expect(matchAnswer(db, 'Are you a protected veteran?')).toMatch(/not a protected veteran/);
  });
});
