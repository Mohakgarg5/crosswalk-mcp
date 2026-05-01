import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('imports the server module without throwing', async () => {
    const mod = await import('../src/server.ts');
    expect(mod).toBeDefined();
  });
});
