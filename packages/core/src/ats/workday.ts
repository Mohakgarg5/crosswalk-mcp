import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type WdRaw = {
  total?: number;
  jobPostings: Array<{
    title: string;
    externalPath: string;
    locationsText?: string;
    postedOn?: string;
    bulletFields?: string[];
  }>;
};

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function parsePostedOn(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/posted\s+(\d+)\s+day/i);
  if (m) {
    const days = parseInt(m[1], 10);
    return new Date(Date.now() - days * 86400_000).toISOString();
  }
  if (/posted\s+today/i.test(s)) return new Date().toISOString();
  if (/posted\s+yesterday/i.test(s)) return new Date(Date.now() - 86400_000).toISOString();
  if (/posted\s+(\d+)\s+(month|year)/i.test(s)) {
    return new Date(Date.now() - 365 * 86400_000).toISOString();
  }
  return undefined;
}

function splitWorkdaySlug(slug: string): { host: string; orgPath: string } {
  const idx = slug.indexOf('/');
  if (idx < 0) throw new Error(`workday slug must include host/org/site: ${slug}`);
  return { host: slug.slice(0, idx), orgPath: slug.slice(idx) };
}

export const workday: ATSAdapter = {
  name: 'workday',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const { host, orgPath } = splitWorkdaySlug(orgSlug);
    const url = `https://${host}/wday/cxs${orgPath}/jobs`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' })
    });
    if (!res.ok) throw new Error(`workday ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as WdRaw;

    const all: NormalizedJob[] = data.jobPostings.map(j => {
      const externalId = j.bulletFields?.[0] ?? j.externalPath.split('/').pop() ?? j.title;
      return {
        externalId,
        title: j.title,
        location: j.locationsText,
        locationType: inferLocationType(j.locationsText),
        url: `https://${host}${j.externalPath}`,
        postedAt: parsePostedOn(j.postedOn),
        raw: j as unknown as Record<string, unknown>
      };
    });
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(workday);
