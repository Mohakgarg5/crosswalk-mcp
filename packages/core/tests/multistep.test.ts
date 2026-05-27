import { describe, it, expect, vi } from 'vitest';
import { LazyPlaywrightBrowser } from '../src/services/browser/playwright.ts';

function pwWith(page: unknown) {
  const ctx = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
  const browser = { newContext: vi.fn().mockResolvedValue(ctx), close: vi.fn() };
  return { chromium: { launch: vi.fn().mockResolvedValue(browser), launchPersistentContext: vi.fn() } };
}

describe('fillForm — multi-step wizard navigation', () => {
  it('fills each page, clicks Next between pages, then submits on the last page', async () => {
    let nextClicks = 0;
    const nextBtn = { click: vi.fn(async () => { nextClicks++; }) };
    const submitBtn = { click: vi.fn(async () => {}) };
    const emailEl = { fill: vi.fn(async () => {}) };
    const page = {
      goto: vi.fn(), title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x/'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      evaluate: vi.fn().mockResolvedValue([]),
      $: vi.fn(async (sel: string) => {
        if (/next|continue|bottom-navigation|pagefooter/i.test(sel)) return nextClicks < 2 ? nextBtn : null;
        if (/submit/i.test(sel)) return submitBtn;
        if (sel.includes('email')) return emailEl;
        return null;
      }),
      close: vi.fn()
    };
    const b = new LazyPlaywrightBrowser({ importPlaywright: async () => pwWith(page) as never });
    const res = await b.fillForm('https://x', [{ kind: 'email', value: 'a@b.com' }], { clickSubmit: true, maxSteps: 5 });

    expect(nextClicks).toBe(2);
    expect(res.stepsAdvanced).toBe(2);
    expect(submitBtn.click).toHaveBeenCalledTimes(1);
    expect(res.submitClicked).toBe(true);
    expect(res.filled).toContain('email');
  });

  it('single-page (maxSteps=1) never looks for Next and submits directly', async () => {
    const submitBtn = { click: vi.fn(async () => {}) };
    const nextSpy = vi.fn();
    const page = {
      goto: vi.fn(), title: vi.fn().mockResolvedValue('t'), url: vi.fn().mockReturnValue('u'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([1])), evaluate: vi.fn().mockResolvedValue([]),
      $: vi.fn(async (sel: string) => {
        if (/(?<!sub)\bnext\b|continue/i.test(sel)) { nextSpy(); return { click: vi.fn() }; }
        if (sel.includes('submit')) return submitBtn;
        return null;
      }),
      close: vi.fn()
    };
    const b = new LazyPlaywrightBrowser({ importPlaywright: async () => pwWith(page) as never });
    const res = await b.fillForm('u', [{ kind: 'email', value: 'a@b' }], { clickSubmit: true });

    expect(nextSpy).not.toHaveBeenCalled();
    expect(res.submitClicked).toBe(true);
    expect(res.stepsAdvanced).toBe(0);
  });
});
