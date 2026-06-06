import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mdToDocxBuffer } from '../../exporters/docx.ts';

/** Human names used to build the visible upload filename (recruiters see it). */
export type DocxFileNames = {
  applicantName?: string;
  companyName?: string;
};

/** Collapse a human name into a filename-safe part: "Perplexity, Inc." → "Perplexity_Inc". */
function sanitizePart(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Build the visible basename. Prefers Applicant_Company; never leaks app IDs
 * or tool branding when a human name is available. */
function buildBaseName(prefix: 'resume' | 'cover-letter', applicationId: string, names?: DocxFileNames): string {
  const applicant = names?.applicantName ? sanitizePart(names.applicantName) : '';
  const company = names?.companyName ? sanitizePart(names.companyName) : '';
  const isCover = prefix === 'cover-letter';
  if (applicant && company) return isCover ? `${applicant}_${company}_Cover_Letter` : `${applicant}_${company}`;
  if (applicant) return isCover ? `${applicant}_Cover_Letter` : `${applicant}_Resume`;
  if (company) return isCover ? `${company}_Cover_Letter` : `Resume_${company}`;
  return `crosswalk-${prefix}-${applicationId}-${Date.now()}`;
}

async function writeDocxToTemp(md: string, prefix: 'resume' | 'cover-letter', applicationId: string, names?: DocxFileNames): Promise<string> {
  const buf = await mdToDocxBuffer(md);
  // Each file gets its own temp dir so the clean basename (what the ATS
  // displays after upload) never collides with a previous write.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'crosswalk-docx-'));
  const filepath = path.join(dir, `${buildBaseName(prefix, applicationId, names)}.docx`);
  await fs.writeFile(filepath, buf);
  return filepath;
}

/**
 * Write a tailored resume Markdown to a temp DOCX file and return its absolute path.
 * The file lives in os.tmpdir() and is left for the OS to reap.
 */
export async function writeResumeDocxToTemp(resumeMd: string, applicationId: string, names?: DocxFileNames): Promise<string> {
  return writeDocxToTemp(resumeMd, 'resume', applicationId, names);
}

/**
 * Write a cover-letter Markdown to a temp DOCX file and return its absolute path.
 * The file lives in os.tmpdir() and is left for the OS to reap.
 */
export async function writeCoverLetterDocxToTemp(coverLetterMd: string, applicationId: string, names?: DocxFileNames): Promise<string> {
  return writeDocxToTemp(coverLetterMd, 'cover-letter', applicationId, names);
}
