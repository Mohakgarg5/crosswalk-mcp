import { describe, it, expect } from 'vitest';
import { mdToDocxBuffer, parseInline } from '../src/exporters/docx.ts';

// Walk a TextRun's internal tree and report what it actually contains —
// used to verify inline markdown becomes real DOCX bold/italic, not literal **.
function inspectRun(run: any): { text: string; bold: boolean; italics: boolean } {
  let text = '';
  let bold = false;
  let italics = false;
  const visit = (node: any) => {
    if (!node) return;
    if (typeof node === 'string') { text += node; return; }
    if (node.rootKey === 'w:b') bold = true;
    if (node.rootKey === 'w:i') italics = true;
    if (Array.isArray(node.root)) node.root.forEach(visit);
  };
  visit(run);
  return { text, bold, italics };
}

describe('exporters/docx', () => {
  it('produces a Buffer with valid DOCX magic bytes', async () => {
    const md = '# Mohak Garg\n\n## Experience\n\n- Acme Corp — APM\n- Globex — PM';
    const buf = await mdToDocxBuffer(md);
    expect(buf).toBeInstanceOf(Buffer);
    // DOCX is a ZIP — first 4 bytes are PK\x03\x04
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(buf.byteLength).toBeGreaterThan(500);
  });

  it('handles empty input without crashing', async () => {
    const buf = await mdToDocxBuffer('');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.byteLength).toBeGreaterThan(100);
  });

  it('converts **bold** markdown into real bold runs (no literal asterisks)', () => {
    const runs = parseInline('**Contact:** (773) 942-5233').map(inspectRun);
    expect(runs).toEqual([
      { text: 'Contact:', bold: true, italics: false },
      { text: ' (773) 942-5233', bold: false, italics: false }
    ]);
    // No raw ** anywhere — ATS scrapers would otherwise see it as literal text.
    expect(runs.map(r => r.text).join('')).not.toContain('**');
  });

  it('handles *italic*, _italic_, and __bold__ syntaxes', () => {
    expect(parseInline('Worked on *strategy* projects').map(inspectRun)).toEqual([
      { text: 'Worked on ', bold: false, italics: false },
      { text: 'strategy', bold: false, italics: true },
      { text: ' projects', bold: false, italics: false }
    ]);
    expect(parseInline('Made it _faster_ and __better__').map(inspectRun)).toEqual([
      { text: 'Made it ', bold: false, italics: false },
      { text: 'faster', bold: false, italics: true },
      { text: ' and ', bold: false, italics: false },
      { text: 'better', bold: true, italics: false }
    ]);
  });

  it('preserves URLs as plain text so ATS can scrape them', () => {
    const runs = parseInline('See [my portfolio](https://example.com)').map(inspectRun);
    expect(runs).toEqual([
      { text: 'See ', bold: false, italics: false },
      { text: 'my portfolio (https://example.com)', bold: false, italics: false }
    ]);
  });

  it('passes plain text through untouched', () => {
    expect(parseInline('Just plain text here.').map(inspectRun)).toEqual([
      { text: 'Just plain text here.', bold: false, italics: false }
    ]);
  });

  it('leaves unmatched/unbalanced markers alone instead of mangling them', () => {
    expect(parseInline('Half **broken markdown').map(inspectRun)).toEqual([
      { text: 'Half **broken markdown', bold: false, italics: false }
    ]);
  });
});
