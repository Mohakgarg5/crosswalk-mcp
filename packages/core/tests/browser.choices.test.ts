import { describe, it, expect, vi } from 'vitest';
import { LazyPlaywrightBrowser } from '../src/services/browser/playwright.ts';
import type { FillField } from '../src/services/browser/types.ts';

// Builds a fake page whose $() returns purpose-built mock elements per selector.
function makePage(handlers: Record<string, unknown>) {
  return {
    goto: vi.fn(), title: vi.fn().mockResolvedValue('Apply'),
    url: vi.fn().mockReturnValue('https://x/'),
    screenshot: vi.fn().mockResolvedValue(Buffer.from([1])),
    evaluate: vi.fn().mockResolvedValue([]),
    $: vi.fn(async (sel: string) => {
      for (const [needle, el] of Object.entries(handlers)) {
        if (sel.includes(needle)) return el;
      }
      return null;
    }),
    close: vi.fn()
  };
}
function browserFor(page: unknown) {
  const ctx = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
  const pw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(ctx), close: vi.fn() }), launchPersistentContext: vi.fn() } };
  return new LazyPlaywrightBrowser({ importPlaywright: async () => pw as never });
}

describe('fillForm — select / radio / checkbox', () => {
  it('selects a dropdown option by label', async () => {
    const selectEl = { selectOption: vi.fn().mockResolvedValue(['v']) };
    const b = browserFor(makePage({ 'select[name="work_auth"]': selectEl }));
    const fields: FillField[] = [{ kind: 'select_by_name', name: 'work_auth', value: 'Authorized to work' }];
    const res = await b.fillForm('https://x', fields);
    expect(selectEl.selectOption).toHaveBeenCalledWith({ label: 'Authorized to work' });
    expect(res.filled).toContain('select_by_name:work_auth');
  });

  it('checks the matching radio in a group', async () => {
    const radioEl = { check: vi.fn().mockResolvedValue(undefined) };
    const b = browserFor(makePage({ 'input[type="radio"][name="sponsorship"][value="no"]': radioEl }));
    const fields: FillField[] = [{ kind: 'radio_by_name', name: 'sponsorship', value: 'no' }];
    const res = await b.fillForm('https://x', fields);
    expect(radioEl.check).toHaveBeenCalled();
    expect(res.filled).toContain('radio_by_name:sponsorship');
  });

  it('checks/unchecks a checkbox', async () => {
    const cbEl = { check: vi.fn().mockResolvedValue(undefined), uncheck: vi.fn().mockResolvedValue(undefined) };
    const b = browserFor(makePage({ 'input[type="checkbox"][name="agree"]': cbEl }));
    const res = await b.fillForm('https://x', [{ kind: 'checkbox_by_name', name: 'agree', checked: true }]);
    expect(cbEl.check).toHaveBeenCalled();
    expect(res.filled).toContain('checkbox_by_name:agree');
  });

  it('reports unmatched choice fields as skipped', async () => {
    const b = browserFor(makePage({}));
    const res = await b.fillForm('https://x', [{ kind: 'select_by_name', name: 'nope', value: 'x' }]);
    expect(res.skipped).toContain('select_by_name:nope');
  });
});
