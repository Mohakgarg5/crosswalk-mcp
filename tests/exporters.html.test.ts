import { describe, it, expect } from 'vitest';
import { mdToPrintHtml } from '../src/exporters/html.ts';

describe('exporters/html', () => {
  it('wraps markdown in a print-styled HTML document', async () => {
    const md = '# Mohak Garg\n\nProduct Manager';
    const html = await mdToPrintHtml(md, { title: 'Resume' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Resume</title>');
    expect(html).toContain('<h1');
    expect(html).toContain('Mohak Garg');
    expect(html).toContain('@media print');
  });

  it('escapes HTML in raw text', async () => {
    const html = await mdToPrintHtml('A <script>alert(1)</script> B', { title: 'x' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('alert(1)');  // escaped form should still contain the text
  });
});
