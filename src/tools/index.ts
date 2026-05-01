import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Db } from '../store/db.ts';
import type { SamplingClient } from '../sampling/client.ts';

import { setupProfile, setupProfileInput } from './setup_profile.ts';
import { addResume, addResumeInput } from './add_resume.ts';
import { listResumesTool, listResumesInput } from './list_resumes.ts';
import { fetchJobs, fetchJobsInput } from './fetch_jobs.ts';
import { scoreFit, scoreFitInput } from './score_fit.ts';
import { explainFit, explainFitInput } from './explain_fit.ts';
import { tailorResumeTool, tailorResumeInput } from './tailor_resume.ts';
import { draftApplication, draftApplicationInput } from './draft_application.ts';

export type ToolCtx = { db: Db; sampling: SamplingClient };

type ToolDef = {
  name: string;
  description: string;
  inputSchema: ReturnType<typeof zodToJsonSchema>;
  run(input: unknown, ctx: ToolCtx): Promise<unknown>;
};

export const toolDefinitions: ToolDef[] = [
  {
    name: 'setup_profile',
    description: 'Store a structured profile from a free-form description of the user.',
    inputSchema: zodToJsonSchema(setupProfileInput),
    run: (i, c) => setupProfile(setupProfileInput.parse(i), c)
  },
  {
    name: 'add_resume',
    description: 'Parse a resume (path or rawText) and store a labeled version.',
    inputSchema: zodToJsonSchema(addResumeInput),
    run: (i, c) => addResume(addResumeInput.parse(i), c)
  },
  {
    name: 'list_resumes',
    description: 'List all stored resume versions.',
    inputSchema: zodToJsonSchema(listResumesInput),
    run: (i, c) => listResumesTool(listResumesInput.parse(i), c)
  },
  {
    name: 'fetch_jobs',
    description: 'Fetch live jobs across configured ATSs with filters (title, location, H-1B, etc).',
    inputSchema: zodToJsonSchema(fetchJobsInput),
    run: (i, c) => fetchJobs(fetchJobsInput.parse(i), c)
  },
  {
    name: 'score_fit',
    description: 'Score a job against a stored resume. Returns numeric score + structured strengths/gaps.',
    inputSchema: zodToJsonSchema(scoreFitInput),
    run: (i, c) => scoreFit(scoreFitInput.parse(i), c)
  },
  {
    name: 'explain_fit',
    description: 'Produce a markdown narrative explaining fit, strengths, gaps, and positioning.',
    inputSchema: zodToJsonSchema(explainFitInput),
    run: (i, c) => explainFit(explainFitInput.parse(i), c)
  },
  {
    name: 'tailor_resume',
    description: 'Tailor your stored resume for a specific job. Returns markdown by default; optional DOCX (base64) or print-ready HTML on request.',
    inputSchema: zodToJsonSchema(tailorResumeInput),
    run: (i, c) => tailorResumeTool(tailorResumeInput.parse(i), c)
  },
  {
    name: 'draft_application',
    description: 'Build a full application "PR" — tailored resume + cover letter + deep link to the form — and persist it. Returns the application id and bundle.',
    inputSchema: zodToJsonSchema(draftApplicationInput),
    run: (i, c) => draftApplication(draftApplicationInput.parse(i), c)
  }
];
