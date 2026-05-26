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

  it('strips javascript: URLs from links and images', async () => {
    const link = await mdToPrintHtml('[click](javascript:alert(1))', { title: 'x' });
    expect(link).not.toContain('javascript:');
    expect(link).toContain('href="#"');

    const img = await mdToPrintHtml('![x](javascript:alert(2))', { title: 'x' });
    expect(img).not.toContain('javascript:');
    expect(img).toContain('src="#"');
  });

  it('preserves http(s) and mailto links', async () => {
    const out = await mdToPrintHtml(
      'visit [home](https://example.com) or [email](mailto:hi@example.com)',
      { title: 'x' }
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('href="mailto:hi@example.com"');
  });
});
