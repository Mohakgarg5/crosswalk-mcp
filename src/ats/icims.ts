import * as cheerio from 'cheerio';
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function parsePostdate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const m = slash[1].padStart(2, '0');
    const d = slash[2].padStart(2, '0');
    return `${slash[3]}-${m}-${d}T00:00:00.000Z`;
  }
  const longForm = Date.parse(trimmed);
  if (!Number.isNaN(longForm)) return new Date(longForm).toISOString();
  return undefined;
}

function extractJobIdFromUrl(url: string): string | undefined {
  const m = url.match(/\/jobs\/(\d+)\//);
  return m ? m[1] : undefined;
}

export const icims: ATSAdapter = {
  name: 'icims',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://careers-${encodeURIComponent(orgSlug)}.icims.com/jobs/intro?in_iframe=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`icims ${orgSlug}: HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const all: NormalizedJob[] = [];
    $('.row.job-listing').each((_, el) => {
      const $el = $(el);
      const titleEl = $el.find('a.title').first();
      const title = titleEl.text().trim();
      const jobUrl = titleEl.attr('href') ?? '';
      const externalId = extractJobIdFromUrl(jobUrl) ?? jobUrl;
      const location = $el.find('.location').first().text().trim() || undefined;
      const dept = $el.find('.department').first().text().trim() || undefined;
      const postdate = $el.find('.postdate').first().text().trim() || undefined;

      if (!title) return;
      all.push({
        externalId,
        title,
        dept,
        location,
        locationType: inferLocationType(location),
        url: jobUrl,
        postedAt: parsePostdate(postdate),
        raw: { title, jobUrl, location, dept, postdate } as Record<string, unknown>
      });
    });

    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(icims);
