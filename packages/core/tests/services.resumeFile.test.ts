import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import { writeResumeDocxToTemp, writeCoverLetterDocxToTemp } from '../src/services/browser/resumeFile.ts';

describe('services/browser/resumeFile', () => {
  it('writes a tailored resume DOCX to a temp path and returns the path', async () => {
    const md = '# Jane Smith\n\n## Experience\n\n- Built things at Acme';
    const path = await writeResumeDocxToTemp(md, 'app-abc123');
    expect(path.endsWith('.docx')).toBe(true);
    expect(path.includes('app-abc123')).toBe(true);
    const bytes = await fs.readFile(path);
    // PKZIP magic — DOCX is a zip
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    await fs.unlink(path);
  });

  it('writes a cover-letter DOCX to a temp path with a cover prefix', async () => {
    const md = '# Dear Hiring Team\n\nI am writing to express interest...';
    const path = await writeCoverLetterDocxToTemp(md, 'app-xyz');
    expect(path.endsWith('.docx')).toBe(true);
    expect(path.includes('app-xyz')).toBe(true);
    expect(path.includes('cover-letter')).toBe(true);
    const bytes = await fs.readFile(path);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    await fs.unlink(path);
  });
});
