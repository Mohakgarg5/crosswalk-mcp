import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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

  it('names the resume Applicant_Company.docx when names are known — recruiters see this filename', async () => {
    const p = await writeResumeDocxToTemp('# Resume', 'app-1', {
      applicantName: 'Mohak Garg',
      companyName: 'Perplexity'
    });
    expect(path.basename(p)).toBe('Mohak_Garg_Perplexity.docx');
    // No internal IDs or tool branding may leak into the visible filename.
    expect(path.basename(p)).not.toMatch(/crosswalk|app-1/i);
    await fs.unlink(p);
  });

  it('sanitizes punctuation and spaces in names', async () => {
    const p = await writeResumeDocxToTemp('# Resume', 'app-2', {
      applicantName: 'Mohak  Garg',
      companyName: 'Perplexity, Inc.'
    });
    expect(path.basename(p)).toBe('Mohak_Garg_Perplexity_Inc.docx');
    await fs.unlink(p);
  });

  it('returns distinct paths for two writes with identical names (no overwrite)', async () => {
    const a = await writeResumeDocxToTemp('# A', 'app-3', { applicantName: 'Jane Doe', companyName: 'Acme' });
    const b = await writeResumeDocxToTemp('# B', 'app-3', { applicantName: 'Jane Doe', companyName: 'Acme' });
    expect(a).not.toBe(b);
    expect(path.basename(a)).toBe('Jane_Doe_Acme.docx');
    expect(path.basename(b)).toBe('Jane_Doe_Acme.docx');
    await fs.unlink(a);
    await fs.unlink(b);
  });

  it('names the cover letter Applicant_Company_Cover_Letter.docx when names are known', async () => {
    const p = await writeCoverLetterDocxToTemp('Dear team', 'app-4', {
      applicantName: 'Mohak Garg',
      companyName: 'Perplexity'
    });
    expect(path.basename(p)).toBe('Mohak_Garg_Perplexity_Cover_Letter.docx');
    await fs.unlink(p);
  });

  it('falls back to applicant-only naming when the company is unknown', async () => {
    const p = await writeResumeDocxToTemp('# Resume', 'app-5', { applicantName: 'Mohak Garg' });
    expect(path.basename(p)).toBe('Mohak_Garg_Resume.docx');
    await fs.unlink(p);
  });
});
