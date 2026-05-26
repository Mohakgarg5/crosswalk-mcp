import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mdToDocxBuffer } from '../../exporters/docx.ts';

async function writeDocxToTemp(md: string, prefix: string, applicationId: string): Promise<string> {
  const buf = await mdToDocxBuffer(md);
  const filename = `crosswalk-${prefix}-${applicationId}-${Date.now()}.docx`;
  const filepath = path.join(os.tmpdir(), filename);
  await fs.writeFile(filepath, buf);
  return filepath;
}

/**
 * Write a tailored resume Markdown to a temp DOCX file and return its absolute path.
 * The file lives in os.tmpdir() and is left for the OS to reap.
 */
export async function writeResumeDocxToTemp(resumeMd: string, applicationId: string): Promise<string> {
  return writeDocxToTemp(resumeMd, 'resume', applicationId);
}

/**
 * Write a cover-letter Markdown to a temp DOCX file and return its absolute path.
 * The file lives in os.tmpdir() and is left for the OS to reap.
 */
export async function writeCoverLetterDocxToTemp(coverLetterMd: string, applicationId: string): Promise<string> {
  return writeDocxToTemp(coverLetterMd, 'cover-letter', applicationId);
}
