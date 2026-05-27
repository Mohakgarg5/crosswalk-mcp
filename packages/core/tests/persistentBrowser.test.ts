import { describe, it, expect, vi } from 'vitest';
import { LazyPlaywrightBrowser } from '../src/services/browser/playwright.ts';

describe('LazyPlaywrightBrowser persistent (logged-in) profile', () => {
  it('uses launchPersistentContext when a profileDir is set (sessions persist)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const page = {
      goto: vi.fn(), title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x/'),
      screenshot: vi.fn().mockResolvedValue(png),
      evaluate: vi.fn().mockResolvedValue([]),
      $: vi.fn(), close: vi.fn()
    };
    const persistent = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
    const launchPersistentContext = vi.fn().mockResolvedValue(persistent);
    const launch = vi.fn();

    const browser = new LazyPlaywrightBrowser({
      profileDir: '/tmp/cw-profile',
      importPlaywright: async () => ({ chromium: { launch, launchPersistentContext } } as never)
    });

    await browser.preview('https://x');

    expect(launchPersistentContext).toHaveBeenCalledWith('/tmp/cw-profile', { headless: true });
    expect(launch).not.toHaveBeenCalled();
    expect(persistent.newPage).toHaveBeenCalled();
    // page is closed after use, but the persistent context stays alive for reuse
    expect(page.close).toHaveBeenCalled();
    expect(persistent.close).not.toHaveBeenCalled();
  });

  it('runs headed when headed=true', async () => {
    const launchPersistentContext = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(), title: vi.fn().mockResolvedValue('t'), url: vi.fn().mockReturnValue('u'),
        screenshot: vi.fn().mockResolvedValue(Buffer.from([1])), evaluate: vi.fn().mockResolvedValue([]),
        $: vi.fn(), close: vi.fn()
      }),
      close: vi.fn()
    });
    const browser = new LazyPlaywrightBrowser({
      profileDir: '/tmp/cw-profile', headed: true,
      importPlaywright: async () => ({ chromium: { launch: vi.fn(), launchPersistentContext } } as never)
    });
    await browser.preview('https://x');
    expect(launchPersistentContext).toHaveBeenCalledWith('/tmp/cw-profile', { headless: false });
  });
});
