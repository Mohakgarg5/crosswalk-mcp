import { describe, it, expect } from 'vitest';
import { mdToDocxBuffer } from '../src/exporters/docx.ts';

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
});
