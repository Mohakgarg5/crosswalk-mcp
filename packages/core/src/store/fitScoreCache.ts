import type { Db } from './db.ts';

export type CachedFit = {
  jobId: string;
  resumeId: string;
  score: number;
  topStrengths: string[];
  topGaps: string[];
  narrativeMd?: string;
  computedAt: string;
};

export type CachedFitInput = {
  jobId: string;
  resumeId: string;
  score: number;
  topStrengths: string[];
  topGaps: string[];
};

type Row = {
  jobId: string;
  resumeId: string;
  score: number;
  top_strengths_json: string;
  top_gaps_json: string;
  narrativeMd: string | null;
  computedAt: string;
};

const SELECT = `
  SELECT job_id AS jobId, resume_id AS resumeId, score,
         top_strengths_json, top_gaps_json,
         narrative_md AS narrativeMd, computed_at AS computedAt
  FROM fit_score_cache
`;

function rowToCachedFit(r: Row): CachedFit {
  return {
    jobId: r.jobId, resumeId: r.resumeId, score: r.score,
    topStrengths: JSON.parse(r.top_strengths_json) as string[],
    topGaps: JSON.parse(r.top_gaps_json) as string[],
    narrativeMd: r.narrativeMd ?? undefined,
    computedAt: r.computedAt
  };
}

export function setCachedFit(db: Db, input: CachedFitInput): void {
  const computedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO fit_score_cache (
      job_id, resume_id, score, top_strengths_json, top_gaps_json,
      narrative_md, computed_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(job_id, resume_id) DO UPDATE SET
      score = excluded.score,
      top_strengths_json = excluded.top_strengths_json,
      top_gaps_json = excluded.top_gaps_json,
      computed_at = excluded.computed_at
  `).run(
    input.jobId, input.resumeId, input.score,
    JSON.stringify(input.topStrengths),
    JSON.stringify(input.topGaps),
    computedAt
  );
}

export function getCachedFit(db: Db, jobId: string, resumeId: string): CachedFit | null {
  const r = db.prepare(`${SELECT} WHERE job_id = ? AND resume_id = ?`).get(jobId, resumeId) as Row | undefined;
  return r ? rowToCachedFit(r) : null;
}

export function setCachedNarrative(db: Db, jobId: string, resumeId: string, narrativeMd: string): void {
  db.prepare(`
    UPDATE fit_score_cache
    SET narrative_md = ?, computed_at = ?
    WHERE job_id = ? AND resume_id = ?
  `).run(narrativeMd, new Date().toISOString(), jobId, resumeId);
}

export function listCachedFits(db: Db): CachedFit[] {
  const rows = db.prepare(`${SELECT} ORDER BY computed_at DESC, rowid DESC`).all() as Row[];
  return rows.map(rowToCachedFit);
}
