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
import { submitApplication, submitApplicationInput } from './submit_application.ts';
import { setStatus, setStatusInput } from './set_status.ts';
import { addNote, addNoteInput } from './add_note.ts';
import { listPipeline, listPipelineInput } from './list_pipeline.ts';
import { scheduleWorkflow, scheduleWorkflowInput } from './schedule_workflow.ts';
import { runWorkflow, runWorkflowInput } from './run_workflow.ts';
import { listWorkflowsTool, listWorkflowsInput } from './list_workflows.ts';
import { deleteWorkflowTool, deleteWorkflowInput } from './delete_workflow.ts';

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
  },
  {
    name: 'submit_application',
    description: 'Mark an application as submitted (after the user clicks "Apply" in their browser).',
    inputSchema: zodToJsonSchema(submitApplicationInput),
    run: (i, c) => submitApplication(submitApplicationInput.parse(i), c)
  },
  {
    name: 'set_status',
    description: 'Change an application status (draft, submitted, interviewing, rejected, offer).',
    inputSchema: zodToJsonSchema(setStatusInput),
    run: (i, c) => setStatus(setStatusInput.parse(i), c)
  },
  {
    name: 'add_note',
    description: 'Append a note to an application (e.g., "recruiter emailed back").',
    inputSchema: zodToJsonSchema(addNoteInput),
    run: (i, c) => addNote(addNoteInput.parse(i), c)
  },
  {
    name: 'list_pipeline',
    description: 'List your application pipeline with company + job context. Filter by status if desired.',
    inputSchema: zodToJsonSchema(listPipelineInput),
    run: (i, c) => listPipeline(listPipelineInput.parse(i), c)
  },
  {
    name: 'schedule_workflow',
    description: 'Schedule a recurring non-sampling workflow (e.g., refresh job cache every Monday). Run via cron + `crosswalk-mcp run-scheduled`.',
    inputSchema: zodToJsonSchema(scheduleWorkflowInput),
    run: (i, c) => scheduleWorkflow(scheduleWorkflowInput.parse(i), c)
  },
  {
    name: 'run_workflow',
    description: 'Manually run a previously scheduled workflow now.',
    inputSchema: zodToJsonSchema(runWorkflowInput),
    run: (i, c) => runWorkflow(runWorkflowInput.parse(i), c)
  },
  {
    name: 'list_workflows',
    description: 'List all scheduled workflows.',
    inputSchema: zodToJsonSchema(listWorkflowsInput),
    run: (i, c) => listWorkflowsTool(listWorkflowsInput.parse(i), c)
  },
  {
    name: 'delete_workflow',
    description: 'Delete a scheduled workflow by id.',
    inputSchema: zodToJsonSchema(deleteWorkflowInput),
    run: (i, c) => deleteWorkflowTool(deleteWorkflowInput.parse(i), c)
  }
];
