import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mdToDocxBuffer } from '../../exporters/docx.ts';

/**
 * Write a tailored resume Markdown to a temp DOCX file and return its absolute path.
 * The file lives in os.tmpdir() and is left for the OS to reap.
 */
export async function writeResumeDocxToTemp(resumeMd: string, applicationId: string): Promise<string> {
  const buf = await mdToDocxBuffer(resumeMd);
  const filename = `crosswalk-${applicationId}-${Date.now()}.docx`;
  const filepath = path.join(os.tmpdir(), filename);
  await fs.writeFile(filepath, buf);
  return filepath;
}
