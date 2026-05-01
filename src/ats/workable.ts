import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type WkRaw = {
  results: Array<{
    shortcode: string;
    title: string;
    full_title?: string;
    description?: string;
    requirements?: string;
    location?: { city?: string; country?: string };
    employment_type?: string;
    department?: string;
    application_url: string;
    published_on?: string;
  }>;
};

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function joinLocation(loc?: { city?: string; country?: string }): string | undefined {
  if (!loc) return undefined;
  const parts = [loc.city, loc.country].filter((p): p is string => !!p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function combineDescription(desc?: string, reqs?: string): string | undefined {
  const parts = [desc, reqs].filter((p): p is string => !!p && p.length > 0).map(htmlToMarkdown);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export const workable: ATSAdapter = {
  name: 'workable',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(orgSlug)}/jobs`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`workable ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as WkRaw;
    const all: NormalizedJob[] = data.results.map(j => ({
      externalId: j.shortcode,
      title: j.full_title ?? j.title,
      dept: j.department,
      location: joinLocation(j.location),
      locationType: inferLocationType(joinLocation(j.location)),
      url: j.application_url,
      descriptionMd: combineDescription(j.description, j.requirements),
      postedAt: j.published_on,
      raw: j as unknown as Record<string, unknown>
    }));
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(workable);
