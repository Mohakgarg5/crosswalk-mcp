import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LazyPlaywrightBrowser } from '../src/services/browser/playwright.ts';
import { BrowserNotInstalledError } from '../src/services/browser/types.ts';

describe('services/browser/LazyPlaywrightBrowser', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('throws BrowserNotInstalledError when playwright import fails', async () => {
    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => {
        throw new Error('Cannot find module \'playwright\'');
      }
    });
    await expect(browser.preview('https://example.com')).rejects.toThrow(BrowserNotInstalledError);
  });

  it('uses injected playwright module to preview a page', async () => {
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Example Domain'),
      url: vi.fn().mockReturnValue('https://example.com/'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      evaluate: vi.fn().mockResolvedValue([
        { name: 'email', type: 'email', label: 'Email', required: true },
        { name: 'resume', type: 'file', label: 'Resume', required: true }
      ]),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = {
      chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) }
    };

    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => fakePw as never
    });
    const out = await browser.preview('https://example.com');
    expect(out.title).toBe('Example Domain');
    expect(out.resolvedUrl).toBe('https://example.com/');
    expect(out.screenshotPng).toBeInstanceOf(Buffer);
    expect(out.formFields).toHaveLength(2);
    expect(out.formFields[0]).toMatchObject({ name: 'email', type: 'email', required: true });

    await browser.close();
    expect(fakeBrowser.close).toHaveBeenCalled();
  });

  it('reuses the launched browser across multiple preview calls', async () => {
    const launchMock = vi.fn();
    const fakeContext = {
      newPage: vi.fn().mockResolvedValue({
        goto: vi.fn(), title: vi.fn().mockResolvedValue('t'),
        url: vi.fn().mockReturnValue('u'),
        screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
        evaluate: vi.fn().mockResolvedValue([]),
        close: vi.fn()
      }),
      close: vi.fn()
    };
    launchMock.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue(fakeContext),
      close: vi.fn()
    });
    const fakePw = { chromium: { launch: launchMock } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    await browser.preview('https://a.example');
    await browser.preview('https://b.example');
    expect(launchMock).toHaveBeenCalledTimes(1);
  });

  it('fillForm fills matching selectors and skips unmatched fields', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const setFilesCalls: Array<{ selector: string; files: string[] }> = [];

    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://apply.example.com/job/1'),
      // First selector candidate present for email; nothing for phone
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[type="email"]') {
          return {
            fill: async (value: string) => { fillCalls.push({ selector, value }); }
          };
        }
        if (selector === 'input[type="file"]') {
          return {
            setInputFiles: async (files: string[]) => { setFilesCalls.push({ selector, files }); }
          };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => fakePw as never
    });
    const result = await browser.fillForm('https://apply.example.com/job/1', [
      { kind: 'email', value: 'a@b.co' },
      { kind: 'phone', value: '+1-555-0100' },
      { kind: 'resume_file', path: '/tmp/resume.docx' }
    ]);

    expect(result.filled.sort()).toEqual(['email', 'resume_file']);
    expect(result.skipped).toEqual(['phone']);
    expect(fillCalls).toEqual([{ selector: 'input[type="email"]', value: 'a@b.co' }]);
    expect(setFilesCalls).toEqual([{ selector: 'input[type="file"]', files: ['/tmp/resume.docx'] }]);
    expect(result.title).toBe('Apply');
    expect(result.resolvedUrl).toBe('https://apply.example.com/job/1');
    expect(result.screenshotPng).toBeInstanceOf(Buffer);
  });

  it('fillForm throws BrowserNotInstalledError when playwright import fails', async () => {
    const browser = new LazyPlaywrightBrowser({
      importPlaywright: async () => { throw new Error('no playwright'); }
    });
    await expect(
      browser.fillForm('https://x', [{ kind: 'email', value: 'a@b.co' }])
    ).rejects.toThrow(BrowserNotInstalledError);
  });

  it('fillForm matches cover_letter_file via file selectors and cover_letter_text via textarea selectors', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const setFilesCalls: Array<{ selector: string; files: string[] }> = [];

    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        // Cover-letter file matches the *generic* file fallback (no resume/cv match)
        if (selector === 'input[type="file"][name*="cover" i]') {
          return {
            setInputFiles: async (files: string[]) => { setFilesCalls.push({ selector, files }); }
          };
        }
        // Cover-letter textarea via Greenhouse-shaped name (second candidate)
        if (selector === 'textarea[name="job_application[cover_letter]"]') {
          return {
            fill: async (value: string) => { fillCalls.push({ selector, value }); }
          };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [
      { kind: 'cover_letter_file', path: '/tmp/cover.docx' },
      { kind: 'cover_letter_text', value: 'Dear hiring team,' }
    ]);

    expect(result.filled.sort()).toEqual(['cover_letter_file', 'cover_letter_text']);
    expect(result.skipped).toEqual([]);
    expect(setFilesCalls).toEqual([
      { selector: 'input[type="file"][name*="cover" i]', files: ['/tmp/cover.docx'] }
    ]);
    expect(fillCalls).toEqual([
      { selector: 'textarea[name="job_application[cover_letter]"]', value: 'Dear hiring team,' }
    ]);
  });

  it('fillForm matches text_by_name via textarea[name="..."] and reports filled with qualified label', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'textarea[name="why_company"]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [
      { kind: 'text_by_name', name: 'why_company', value: 'I love your mission.' }
    ]);

    expect(result.filled).toEqual(['text_by_name:why_company']);
    expect(result.skipped).toEqual([]);
    expect(fillCalls).toEqual([
      { selector: 'textarea[name="why_company"]', value: 'I love your mission.' }
    ]);
  });

  it('fillForm reports text_by_name unmatched as skipped with qualified label', async () => {
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async () => null),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [
      { kind: 'text_by_name', name: 'unknown_field', value: 'foo' }
    ]);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual(['text_by_name:unknown_field']);
  });

  it('fillForm rejects text_by_name fields with unsafe names without attempting selector lookups', async () => {
    const dollarMock = vi.fn(async () => null);
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: dollarMock,
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [
      { kind: 'text_by_name', name: 'name with spaces"; injection', value: 'x' }
    ]);

    expect(result.filled).toEqual([]);
    expect(result.skipped).toEqual(['text_by_name:name with spaces"; injection']);
    // advanceToForm probes a small set of Apply-button selectors at the start;
    // none of them should reference the unsafe field name.
    const unsafeLookups = dollarMock.mock.calls.filter((call: unknown[]) => {
      const arg = call[0];
      return typeof arg === 'string' && arg.includes('injection');
    });
    expect(unsafeLookups).toEqual([]);
  });

  it('fillForm falls back to input[name*="email" i] when no specific selector matches', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[name*="email" i]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [
      { kind: 'email', value: 'a@b.co' }
    ]);
    expect(result.filled).toEqual(['email']);
    expect(fillCalls).toEqual([{ selector: 'input[name*="email" i]', value: 'a@b.co' }]);
  });

  it('fillForm with ats=workable matches input[name="firstName"] before generic candidates', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[name="firstName"]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm(
      'https://apply.workable.com/foo/j/123',
      [{ kind: 'first_name', value: 'Jane' }],
      { ats: 'workable' }
    );
    expect(result.filled).toEqual(['first_name']);
    expect(fillCalls).toEqual([{ selector: 'input[name="firstName"]', value: 'Jane' }]);
  });

  it('fillForm with ats=ashby matches input[data-testid*="email" i] for email kind', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[data-testid*="email" i]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm(
      'https://jobs.ashbyhq.com/foo/123',
      [{ kind: 'email', value: 'a@b.co' }],
      { ats: 'ashby' }
    );
    expect(result.filled).toEqual(['email']);
    expect(fillCalls).toEqual([{ selector: 'input[data-testid*="email" i]', value: 'a@b.co' }]);
  });

  it('fillForm without ats opt falls back to generic SELECTORS only', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[autocomplete="given-name"]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm(
      'https://x',
      [{ kind: 'first_name', value: 'Jane' }]
    );
    expect(result.filled).toEqual(['first_name']);
    expect(fillCalls).toEqual([{ selector: 'input[autocomplete="given-name"]', value: 'Jane' }]);
  });

  it('fillForm with ats=workday matches input[data-automation-id="email"] for email kind', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[data-automation-id="email"]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm(
      'https://acme.wd1.myworkdayjobs.com/careers/job/123',
      [{ kind: 'email', value: 'a@b.co' }],
      { ats: 'workday' }
    );
    expect(result.filled).toEqual(['email']);
    expect(fillCalls).toEqual([{ selector: 'input[data-automation-id="email"]', value: 'a@b.co' }]);
  });

  it('fillForm with ats=smartrecruiters matches input[name="firstName"] for first_name', async () => {
    const fillCalls: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'input[name="firstName"]') {
          return { fill: async (value: string) => { fillCalls.push({ selector, value }); } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm(
      'https://jobs.smartrecruiters.com/foo/123',
      [{ kind: 'first_name', value: 'Jane' }],
      { ats: 'smartrecruiters' }
    );
    expect(result.filled).toEqual(['first_name']);
    expect(fillCalls).toEqual([{ selector: 'input[name="firstName"]', value: 'Jane' }]);
  });

  it('fillForm with clickSubmit clicks the first matching submit button and reports postSubmit state', async () => {
    let submitClicked = false;
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValueOnce('Apply').mockResolvedValueOnce('Thank You'),
      url: vi.fn().mockReturnValueOnce('https://x').mockReturnValueOnce('https://x/thank-you'),
      $: vi.fn(async (selector: string) => {
        if (selector === 'button[type="submit"]') {
          return { click: async () => { submitClicked = true; } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm(
      'https://x',
      [],
      { clickSubmit: true }
    );

    expect(submitClicked).toBe(true);
    expect(result.submitClicked).toBe(true);
    expect(result.postSubmitUrl).toBe('https://x/thank-you');
    expect(result.postSubmitTitle).toBe('Thank You');
  }, 10000);

  it('fillForm with clickSubmit but no matching button reports submitClicked=false', async () => {
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async () => null),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [], { clickSubmit: true });

    expect(result.submitClicked).toBe(false);
    expect(result.postSubmitUrl).toBeUndefined();
    expect(result.postSubmitTitle).toBeUndefined();
  });

  it('fillForm runs resolveVerification when a code field is detected, types the code, and submits', async () => {
    const typed: Array<{ selector: string; value: string }> = [];
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Verify'),
      url: vi.fn().mockReturnValue('https://careers.acme.com/apply'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      $: vi.fn(async (selector: string) => {
        if (/one-time-code|otp|verif/i.test(selector)) {
          return { fill: async (v: string) => { typed.push({ selector, value: v }); } };
        }
        return null;
      }),
      evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) => {
        const src = String(fn);
        if (src.includes('VERIFICATION_PROBE')) return { kind: 'code' };
        return [];
      }),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn().mockReturnValue({ newPage: vi.fn() }),
      close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const resolveVerification = vi.fn().mockResolvedValue({ kind: 'code', code: '424242' });
    const res = await browser.fillForm('https://careers.acme.com/apply', [], { clickSubmit: true, resolveVerification });

    expect(resolveVerification).toHaveBeenCalledTimes(1);
    expect(typed.some(t => t.value === '424242')).toBe(true);
    expect(res.verificationRequired).toBe(true);
    expect(res.verificationResolved).toBe(true);
  });

  it('fillForm opens a magic link in a sibling page of the same context, then submits', async () => {
    const url = 'https://careers.acme.com/verify?t=abc';
    const verifyPage = { goto: vi.fn(), close: vi.fn(), url: vi.fn().mockReturnValue(url) };
    const newPage = vi.fn().mockResolvedValue(verifyPage);
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Verify'),
      url: vi.fn().mockReturnValue('https://careers.acme.com/apply'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (fn: unknown) => {
        const src = String(fn);
        if (src.includes('VERIFICATION_PROBE')) return 'link';
        return [];
      }),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn().mockReturnValue({ newPage }),
      close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const resolveVerification = vi.fn().mockResolvedValue({ kind: 'link', url });
    const res = await browser.fillForm('https://careers.acme.com/apply', [], { clickSubmit: true, resolveVerification });

    expect(newPage).toHaveBeenCalledTimes(1);
    expect(verifyPage.goto).toHaveBeenCalledWith(url, expect.anything());
    expect(verifyPage.close).toHaveBeenCalled();
    expect(res.verificationRequired).toBe(true);
    expect(res.verificationResolved).toBe(true);
  });

  it('fillForm does NOT trust a magic link that redirected off the allowlist (SSRF guard)', async () => {
    // goto follows a redirect that lands on an internal/disallowed host.
    const verifyPage = { goto: vi.fn(), close: vi.fn(), url: vi.fn().mockReturnValue('http://169.254.169.254/latest/meta-data') };
    const newPage = vi.fn().mockResolvedValue(verifyPage);
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Verify'),
      url: vi.fn().mockReturnValue('https://careers.acme.com/apply'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (fn: unknown) => (String(fn).includes('VERIFICATION_PROBE') ? 'link' : [])),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn().mockReturnValue({ newPage }),
      close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const resolveVerification = vi.fn().mockResolvedValue({ kind: 'link', url: 'https://careers.acme.com/verify?t=abc' });
    const res = await browser.fillForm('https://careers.acme.com/apply', [], { clickSubmit: true, resolveVerification });

    expect(verifyPage.close).toHaveBeenCalled();      // opened then abandoned
    expect(res.verificationRequired).toBe(true);
    expect(res.verificationResolved).toBe(false);     // landed off-allowlist → not trusted
  });

  it('fillForm reports verificationRequired but unresolved when the callback returns null', async () => {
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Verify'),
      url: vi.fn().mockReturnValue('https://careers.acme.com/apply'),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89])),
      $: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn(async (fn: unknown) => {
        const src = String(fn);
        if (src.includes('VERIFICATION_PROBE')) return { kind: 'code' };
        return [];
      }),
      frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(),
      context: vi.fn().mockReturnValue({ newPage: vi.fn() }),
      close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const resolveVerification = vi.fn().mockResolvedValue(null);
    const res = await browser.fillForm('https://careers.acme.com/apply', [], { clickSubmit: true, resolveVerification });

    expect(res.verificationRequired).toBe(true);
    expect(res.verificationResolved).toBe(false);
  });

  it('fillForm does not probe for verification when no callback is provided (unchanged behavior)', async () => {
    const evaluate = vi.fn().mockResolvedValue([]);
    const fakePage = {
      goto: vi.fn(), title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x/'), screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      $: vi.fn().mockResolvedValue(null), evaluate, frames: vi.fn().mockReturnValue([]),
      mainFrame: vi.fn(), context: vi.fn(), close: vi.fn()
    };
    fakePage.mainFrame.mockReturnValue(fakePage);
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue({ newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() }) } };
    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const res = await browser.fillForm('https://x/', []);
    expect(res.verificationRequired).toBeFalsy();
    expect(evaluate.mock.calls.every(c => !String(c[0]).includes('VERIFICATION_PROBE'))).toBe(true);
  });

  it('fillForm continues to next selector when fill() throws', async () => {
    let firstAttemptThrown = false;
    let secondCallCount = 0;
    const fakePage = {
      goto: vi.fn(),
      title: vi.fn().mockResolvedValue('Apply'),
      url: vi.fn().mockReturnValue('https://x'),
      $: vi.fn(async (selector: string) => {
        // First selector returns an element whose fill() always throws
        if (selector === 'input[type="email"]') {
          return { fill: async () => { firstAttemptThrown = true; throw new Error('detached'); } };
        }
        // Second selector works
        if (selector === 'input[name="email"]') {
          return { fill: async () => { secondCallCount++; } };
        }
        return null;
      }),
      screenshot: vi.fn().mockResolvedValue(Buffer.from([])),
      close: vi.fn()
    };
    const fakeContext = { newPage: vi.fn().mockResolvedValue(fakePage), close: vi.fn() };
    const fakeBrowser = { newContext: vi.fn().mockResolvedValue(fakeContext), close: vi.fn() };
    const fakePw = { chromium: { launch: vi.fn().mockResolvedValue(fakeBrowser) } };

    const browser = new LazyPlaywrightBrowser({ importPlaywright: async () => fakePw as never });
    const result = await browser.fillForm('https://x', [{ kind: 'email', value: 'a@b.co' }]);

    expect(firstAttemptThrown).toBe(true);
    expect(secondCallCount).toBe(1);
    expect(result.filled).toEqual(['email']);
    expect(result.skipped).toEqual([]);
  });
});
