import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type RtRaw = {
  offers: Array<{
    id: number;
    title: string;
    description?: string;
    requirements?: string;
    location?: string;
    city?: string;
    country?: string;
    department?: string;
    careers_url: string;
    created_at?: string;
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

function combineDescription(desc?: string, reqs?: string): string | undefined {
  const parts = [desc, reqs].filter((p): p is string => !!p && p.length > 0).map(htmlToMarkdown);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function pickLocation(o: { location?: string; city?: string; country?: string }): string | undefined {
  if (o.location && o.location.length > 0) return o.location;
  const parts = [o.city, o.country].filter((p): p is string => !!p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export const recruitee: ATSAdapter = {
  name: 'recruitee',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://${encodeURIComponent(orgSlug)}.recruitee.com/api/offers/`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`recruitee ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as RtRaw;
    const all: NormalizedJob[] = data.offers.map(j => {
      const loc = pickLocation(j);
      return {
        externalId: String(j.id),
        title: j.title,
        dept: j.department,
        location: loc,
        locationType: inferLocationType(loc),
        url: j.careers_url,
        descriptionMd: combineDescription(j.description, j.requirements),
        postedAt: j.created_at,
        raw: j as unknown as Record<string, unknown>
      };
    });
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(recruitee);
