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
});
