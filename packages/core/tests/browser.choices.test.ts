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

  it('clicks Ashby Yes/No option buttons with a real handle click, not an in-page click()', async () => {
    // The in-page evaluate only LOCATES the button and stamps a marker —
    // react-aria buttons ignore synthetic DOM click(). The real click must
    // come from the Playwright handle (trusted pointer events).
    const btnEl = { click: vi.fn().mockResolvedValue(undefined) };
    const page = makePage({ 'data-cw-marker="__cw_btnopt__"': btnEl });
    page.evaluate = vi.fn(async (_fn: unknown, arg?: unknown) => {
      if (arg && typeof arg === 'object' && 'q' in (arg as Record<string, unknown>)) return '__cw_btnopt__';
      return [];
    }) as never;
    const b = browserFor(page);
    const name = '__btnopt__Are you able to come into the office four days per week?';
    const res = await b.fillForm('https://x', [{ kind: 'radio_by_name', name, value: 'Yes' }]);
    expect(btnEl.click).toHaveBeenCalled();
    expect(res.filled).toContain(`radio_by_name:${name}`);
  });

  it('clicks the async typeahead suggestion once it loads (Greenhouse school picker)', async () => {
    // Remote suggestion lists load AFTER typing; the old fixed 1.5s wait +
    // blind Enter committed nothing. The fill must poll the menu and click
    // the real suggestion.
    let menuCalls = 0;
    const optEl = { click: vi.fn().mockResolvedValue(undefined) };
    const inputEl = {
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(true) // widget shows a committed value
    };
    const page = makePage({
      'input[role="combobox"][id="school--0"]': inputEl,
      ':has-text("Northwestern University")': optEl
    });
    page.evaluate = vi.fn(async () => {
      menuCalls += 1;
      // Menu empty on the first look (suggestions still loading), present after.
      return menuCalls <= 1 ? [] : [{ index: 0, text: 'Northwestern University' }];
    }) as never;
    const b = browserFor(page);
    const res = await b.fillForm('https://x', [{ kind: 'select_by_name', name: 'school--0', value: 'Northwestern University' }]);
    expect(optEl.click).toHaveBeenCalled();
    expect(res.filled).toContain('select_by_name:school--0');
  });

  it('reports the typeahead as skipped when nothing actually commits (no false positives)', async () => {
    const inputEl = {
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(false) // widget still shows Select...
    };
    const page = makePage({ 'input[role="combobox"][id="school--0"]': inputEl });
    page.evaluate = vi.fn(async () => []) as never; // menu never loads
    const b = browserFor(page);
    const res = await b.fillForm('https://x', [{ kind: 'select_by_name', name: 'school--0', value: 'Northwestern University' }]);
    expect(res.skipped).toContain('select_by_name:school--0');
  }, 20_000); // the suggestion poll alone takes 5s by design

  it('reports the button-option group as skipped when no button matches', async () => {
    const page = makePage({});
    page.evaluate = vi.fn(async (_fn: unknown, arg?: unknown) => {
      if (arg && typeof arg === 'object' && 'q' in (arg as Record<string, unknown>)) return null;
      return [];
    }) as never;
    const b = browserFor(page);
    const name = '__btnopt__Some question?';
    const res = await b.fillForm('https://x', [{ kind: 'radio_by_name', name, value: 'Yes' }]);
    expect(res.skipped).toContain(`radio_by_name:${name}`);
  });
});
