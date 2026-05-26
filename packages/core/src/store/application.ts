import { randomUUID } from 'node:crypto';
import type { Db } from './db.ts';

export type Application = {
  id: string;
  jobId: string;
  resumeId: string;
  status: 'draft' | 'submitted' | 'interviewing' | 'rejected' | 'offer';
  fitScore?: number;
  fitNarrativeMd?: string;
  tailoredResumeMd: string;
  coverLetterMd: string;
  answerPack: Record<string, string>;
  deepLink: string;
  createdAt: string;
  submittedAt?: string;
};

export type ApplicationInput = {
  id: string;
  jobId: string;
  resumeId: string;
  fitScore?: number;
  fitNarrativeMd?: string;
  tailoredResumeMd: string;
  coverLetterMd: string;
  answerPack: Record<string, string>;
  deepLink: string;
};

export function createApplication(db: Db, input: ApplicationInput): Application {
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO application (
      id, job_id, resume_id, status, fit_score, fit_narrative_md,
      tailored_resume_md, cover_letter_md, answer_pack_json, deep_link,
      created_at, submitted_at
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    input.id, input.jobId, input.resumeId,
    input.fitScore ?? null, input.fitNarrativeMd ?? null,
    input.tailoredResumeMd, input.coverLetterMd,
    JSON.stringify(input.answerPack), input.deepLink, createdAt
  );
  return {
    ...input,
    status: 'draft',
    createdAt
  };
}

type Row = {
  id: string; jobId: string; resumeId: string; status: Application['status'];
  fitScore: number | null; fitNarrativeMd: string | null;
  tailoredResumeMd: string; coverLetterMd: string;
  answer_pack_json: string; deepLink: string;
  createdAt: string; submittedAt: string | null;
};

function rowToApplication(r: Row): Application {
  return {
    id: r.id, jobId: r.jobId, resumeId: r.resumeId, status: r.status,
    fitScore: r.fitScore ?? undefined,
    fitNarrativeMd: r.fitNarrativeMd ?? undefined,
    tailoredResumeMd: r.tailoredResumeMd, coverLetterMd: r.coverLetterMd,
    answerPack: JSON.parse(r.answer_pack_json) as Record<string, string>,
    deepLink: r.deepLink, createdAt: r.createdAt,
    submittedAt: r.submittedAt ?? undefined
  };
}

const SELECT = `
  SELECT id, job_id AS jobId, resume_id AS resumeId, status,
         fit_score AS fitScore, fit_narrative_md AS fitNarrativeMd,
         tailored_resume_md AS tailoredResumeMd,
         cover_letter_md AS coverLetterMd,
         answer_pack_json, deep_link AS deepLink,
         created_at AS createdAt, submitted_at AS submittedAt
  FROM application
`;

export function getApplication(db: Db, id: string): Application | null {
  const r = db.prepare(`${SELECT} WHERE id = ?`).get(id) as Row | undefined;
  return r ? rowToApplication(r) : null;
}

export type ApplicationStatus = Application['status'];

export type ApplicationFilters = {
  status?: ApplicationStatus;
};

export function listApplications(db: Db, filters: ApplicationFilters = {}): Application[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.status) {
    where.push('status = ?');
    args.push(filters.status);
  }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, rowid DESC`;
  const rows = db.prepare(sql).all(...args) as Row[];
  return rows.map(rowToApplication);
}

export function updateApplicationStatus(db: Db, id: string, status: ApplicationStatus): void {
  const stampSubmitted = status === 'submitted';
  const submittedAt = stampSubmitted ? new Date().toISOString() : null;

  const result = stampSubmitted
    ? db.prepare(`UPDATE application SET status = ?, submitted_at = ? WHERE id = ?`)
        .run(status, submittedAt, id)
    : db.prepare(`UPDATE application SET status = ? WHERE id = ?`)
        .run(status, id);

  if (result.changes === 0) throw new Error(`unknown application: ${id}`);
}

export type ApplicationEvent = {
  id: string;
  applicationId: string;
  kind: string;
  payload: Record<string, unknown>;
  at: string;
};

export function addEventForApplication(
  db: Db,
  applicationId: string,
  kind: string,
  payload: Record<string, unknown>
): ApplicationEvent {
  const id = randomUUID();
  const at = new Date().toISOString();
  db.prepare(`
    INSERT INTO application_event (id, application_id, kind, payload_json, at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, applicationId, kind, JSON.stringify(payload), at);
  return { id, applicationId, kind, payload, at };
}

type EventRow = {
  id: string;
  applicationId: string;
  kind: string;
  payload_json: string;
  at: string;
};

export function listEventsForApplication(db: Db, applicationId: string): ApplicationEvent[] {
  const rows = db.prepare(`
    SELECT id, application_id AS applicationId, kind, payload_json, at
    FROM application_event WHERE application_id = ?
    ORDER BY at ASC, rowid ASC
  `).all(applicationId) as EventRow[];
  return rows.map(r => ({
    id: r.id,
    applicationId: r.applicationId,
    kind: r.kind,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    at: r.at
  }));
}
