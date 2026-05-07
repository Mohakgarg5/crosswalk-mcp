import { describe, it, expect } from 'vitest';
import { isPlaywrightImportable } from '../src/cli.ts';

describe('cli/installBrowser', () => {
  it('isPlaywrightImportable returns boolean', async () => {
    const result = await isPlaywrightImportable();
    expect(typeof result).toBe('boolean');
  });
});
