import { describe, it, expect } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };

describe('smoke', () => {
  it('exports SERVER_NAME and SERVER_VERSION from the server module', async () => {
    const mod = await import('../src/server.ts');
    expect(mod.SERVER_NAME).toBe('crosswalk-mcp');
    expect(mod.SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('SERVER_VERSION matches package.json version', async () => {
    const mod = await import('../src/server.ts');
    expect(mod.SERVER_VERSION).toBe(packageJson.version);
  });
});
