import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('exports SERVER_NAME and SERVER_VERSION from the server module', async () => {
    const mod = await import('../src/server.ts');
    expect(mod.SERVER_NAME).toBe('crosswalk-mcp');
    expect(mod.SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
