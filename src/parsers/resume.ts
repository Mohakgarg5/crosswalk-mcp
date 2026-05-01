import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type ExtractInput = string | { rawText: string };

export async function extractResumeText(input: ExtractInput): Promise<string> {
  if (typeof input !== 'string') return input.rawText;

  const ext = path.extname(input).toLowerCase();
  if (ext === '.txt' || ext === '.md') return (await fs.readFile(input, 'utf8'));

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ path: input });
    return value;
  }

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const buf = await fs.readFile(input);
    const out = await pdfParse(buf);
    return out.text;
  }

  throw new Error(`unsupported resume format: ${ext}`);
}
