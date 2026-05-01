import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { extractResumeText } from '../src/parsers/resume.ts';

describe('parsers/resume', () => {
  it('reads a .txt file as-is', async () => {
    const p = path.resolve('tests/fixtures/resume.txt');
    const text = await extractResumeText(p);
    expect(text).toContain('Mohak Garg');
    expect(text).toContain('Acme Corp');
  });

  it('accepts a raw string', async () => {
    expect(await extractResumeText({ rawText: 'hello' })).toBe('hello');
  });

  it('rejects unknown extensions', async () => {
    await expect(extractResumeText('/tmp/nonexistent.xyz')).rejects.toThrow(/unsupported/i);
  });

  // .docx / .pdf parsing covered with real fixtures in the tool tests.
});
