import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addResume, listResumes, getResume } from '../src/store/resume.ts';

describe('store/resume', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); });

  it('lists empty initially', () => {
    expect(listResumes(db)).toEqual([]);
  });

  it('adds and lists resumes ordered by created_at desc', () => {
    addResume(db, { id: 'r1', label: 'Generic PM', rawText: 'hello', parsed: { skills: ['ai'] } });
    addResume(db, { id: 'r2', label: 'Senior IC PM', rawText: 'world', parsed: { skills: ['ml'] } });
    const all = listResumes(db);
    expect(all.map(r => r.id)).toEqual(['r2', 'r1']);
    expect(getResume(db, 'r1')?.label).toBe('Generic PM');
  });
});
