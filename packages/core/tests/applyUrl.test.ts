import { describe, it, expect } from 'vitest';
import { extractApplyLink, resolveExternalApplyUrl, resolveApplyTarget } from '../src/services/applyUrl.ts';

describe('services/applyUrl — external apply-link resolution for aggregator listings', () => {
  it('extracts an escaped applyLink from Muse Next.js page data', () => {
    const html = 'foo,\\"type\\":\\"external\\",\\"applyLink\\":\\"https://careers.gevernova.com/de/senior-technical-product-manager/job/R5042969\\",\\"postedDate\\"';
    expect(extractApplyLink(html)).toBe('https://careers.gevernova.com/de/senior-technical-product-manager/job/R5042969');
  });

  it('extracts a plain (unescaped) applyLink', () => {
    const html = '{"applyLink":"https://boards.greenhouse.io/acme/jobs/123","x":1}';
    expect(extractApplyLink(html)).toBe('https://boards.greenhouse.io/acme/jobs/123');
  });

  it('returns undefined when no applyLink is present', () => {
    expect(extractApplyLink('<html><body>no link here</body></html>')).toBeUndefined();
  });

  it('decodes \\u0026 escapes so query params survive (the truncated-Recruitics bug)', () => {
    const html = '\\"applyLink\\":\\"https://tracker.example.com/redirect?a=1\\u0026b=2\\u0026rx_jobId=99\\"';
    // No inner URL param here — keeps the tracker URL but with ALL params intact.
    expect(extractApplyLink(html)).toBe('https://tracker.example.com/redirect?a=1&b=2&rx_jobId=99');
  });

  it('unwraps tracking redirectors to the real destination in a URL param', () => {
    const html = '\\"applyLink\\":\\"https://jsv3.recruitics.com/redirect?rx_cid=3427\\u0026rx_jobId=200632069\\u0026rx_url=https%3A%2F%2Fjobs.apple.com%2Fen-us%2Fdetails%2F200632069%2Ftechnical-data-product-lead%3Fboard_id%3DJB006\\"';
    expect(extractApplyLink(html)).toBe('https://jobs.apple.com/en-us/details/200632069/technical-data-product-lead?board_id=JB006');
  });

  it('resolveExternalApplyUrl fetches the landing page and extracts the link', async () => {
    const f = (async () => ({
      ok: true,
      text: async () => '\\"applyLink\\":\\"https://jobs.lever.co/acme/abc\\"'
    })) as unknown as typeof fetch;
    expect(await resolveExternalApplyUrl('https://www.themuse.com/jobs/acme/pm', f)).toBe('https://jobs.lever.co/acme/abc');
  });

  it('resolveExternalApplyUrl returns undefined on fetch failure', async () => {
    const f = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await resolveExternalApplyUrl('https://www.themuse.com/jobs/acme/pm', f)).toBeUndefined();
  });

  it('resolveApplyTarget reports gone for 404/410 listings (expired jobs)', async () => {
    const f404 = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    expect(await resolveApplyTarget('https://www.themuse.com/jobs/gapinc/dead', f404)).toEqual({ gone: true });
    const f410 = (async () => ({ ok: false, status: 410 })) as unknown as typeof fetch;
    expect(await resolveApplyTarget('https://www.themuse.com/jobs/gapinc/dead', f410)).toEqual({ gone: true });
  });
});
