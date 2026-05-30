import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/store/db.ts';
import { addResume, listResumes, getResume, deleteResume } from '../src/store/resume.ts';

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

  it('deletes a résumé and removes it from listings', () => {
    addResume(db, { id: 'r1', label: 'Old', rawText: 'x', parsed: {} });
    addResume(db, { id: 'r2', label: 'New', rawText: 'y', parsed: {} });
    expect(deleteResume(db, 'r1')).toEqual({ deleted: true });
    expect(listResumes(db).map(r => r.id)).toEqual(['r2']);
    expect(getResume(db, 'r1')).toBeNull();
  });

  it('returns deleted:false for unknown ids', () => {
    expect(deleteResume(db, 'does-not-exist')).toEqual({ deleted: false });
  });

  it('cascades through applications and fit_score_cache that reference the résumé', () => {
    addResume(db, { id: 'r1', label: 'Old', rawText: 'x', parsed: {} });
    const now = new Date().toISOString();
    // Stub a company + job + application + event + fit cache row referencing r1.
    db.prepare(`
      INSERT INTO company (id, name, ats, ats_org_slug, updated_at)
      VALUES ('c1', 'Acme', 'greenhouse', 'acme', ?)
    `).run(now);
    db.prepare(`
      INSERT INTO job (id, company_id, title, url, last_seen_at, raw_json)
      VALUES ('j1', 'c1', 'PM', 'https://x', ?, '{}')
    `).run(now);
    db.prepare(`
      INSERT INTO application (id, job_id, resume_id, status, tailored_resume_md, cover_letter_md, answer_pack_json, deep_link, created_at)
      VALUES ('a1', 'j1', 'r1', 'draft', '', '', '{}', 'https://x', ?)
    `).run(now);
    db.prepare(`
      INSERT INTO application_event (id, application_id, kind, payload_json, at)
      VALUES ('e1', 'a1', 'drafted', '{}', ?)
    `).run(now);
    db.prepare(`
      INSERT INTO fit_score_cache (job_id, resume_id, score, top_strengths_json, top_gaps_json, computed_at)
      VALUES ('j1', 'r1', 0.8, '[]', '[]', ?)
    `).run(now);

    expect(deleteResume(db, 'r1')).toEqual({ deleted: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM application WHERE resume_id = ?').get('r1')).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM application_event WHERE application_id = ?').get('a1')).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM fit_score_cache WHERE resume_id = ?').get('r1')).toEqual({ n: 0 });
  });
});
