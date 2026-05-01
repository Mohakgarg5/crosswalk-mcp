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

export function listApplications(db: Db): Application[] {
  const rows = db.prepare(`${SELECT} ORDER BY created_at DESC, rowid DESC`).all() as Row[];
  return rows.map(rowToApplication);
}
