import type { Db } from './db.ts';

export type Resume = {
  id: string;
  label: string;
  sourcePath?: string;
  rawText: string;
  parsed: Record<string, unknown>;
  createdAt: string;
};

export type ResumeInput = Omit<Resume, 'createdAt'>;

export function addResume(db: Db, input: ResumeInput): Resume {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO resume (id, label, source_path, raw_text, parsed_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.label, input.sourcePath ?? null, input.rawText,
         JSON.stringify(input.parsed), createdAt);
  return { ...input, createdAt };
}

export function listResumes(db: Db): Resume[] {
  return (db.prepare(`
    SELECT id, label, source_path AS sourcePath, raw_text AS rawText,
           parsed_json, created_at AS createdAt
    FROM resume ORDER BY created_at DESC, rowid DESC
  `).all() as Array<Resume & { parsed_json: string }>).map(r => ({
    id: r.id, label: r.label, sourcePath: r.sourcePath ?? undefined,
    rawText: r.rawText, parsed: JSON.parse(r.parsed_json) as Record<string, unknown>,
    createdAt: r.createdAt
  }));
}

// Cascade-delete a résumé and everything that references it (applications,
// application_event rows, fit-score cache entries). FK enforcement is on, so
// dependents must go first.
export function deleteResume(db: Db, id: string): { deleted: boolean } {
  const exists = db.prepare('SELECT 1 FROM resume WHERE id = ?').get(id);
  if (!exists) return { deleted: false };
  const tx = db.transaction(() => {
    db.prepare(`
      DELETE FROM application_event
      WHERE application_id IN (SELECT id FROM application WHERE resume_id = ?)
    `).run(id);
    db.prepare('DELETE FROM application WHERE resume_id = ?').run(id);
    db.prepare('DELETE FROM fit_score_cache WHERE resume_id = ?').run(id);
    db.prepare('DELETE FROM resume WHERE id = ?').run(id);
  });
  tx();
  return { deleted: true };
}

export function getResume(db: Db, id: string): Resume | null {
  const r = db.prepare(`
    SELECT id, label, source_path AS sourcePath, raw_text AS rawText,
           parsed_json, created_at AS createdAt
    FROM resume WHERE id = ?
  `).get(id) as (Resume & { parsed_json: string }) | undefined;
  if (!r) return null;
  return {
    id: r.id, label: r.label, sourcePath: r.sourcePath ?? undefined,
    rawText: r.rawText, parsed: JSON.parse(r.parsed_json) as Record<string, unknown>,
    createdAt: r.createdAt
  };
}
