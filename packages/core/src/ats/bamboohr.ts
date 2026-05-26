import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type BhRaw = {
  result: Array<{
    id: number;
    jobOpeningName: string;
    departmentLabel?: string;
    location?: { city?: string; state?: string; addressCountry?: string };
    employmentStatusLabel?: string;
    datePosted?: string;
    jobDescription?: string;
    hash: string;
  }>;
};

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function joinLocation(loc?: { city?: string; state?: string; addressCountry?: string }): string | undefined {
  if (!loc) return undefined;
  const parts = [loc.city, loc.state, loc.addressCountry].filter((p): p is string => !!p && p.length > 0);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export const bamboohr: ATSAdapter = {
  name: 'bamboohr',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const slug = encodeURIComponent(orgSlug);
    const url = `https://${slug}.bamboohr.com/jobs/embed2.php?json=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`bamboohr ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as BhRaw;
    const all: NormalizedJob[] = data.result.map(j => {
      const loc = joinLocation(j.location);
      return {
        externalId: j.hash,
        title: j.jobOpeningName,
        dept: j.departmentLabel,
        location: loc,
        locationType: inferLocationType(loc),
        url: `https://${slug}.bamboohr.com/jobs/view.php?id=${encodeURIComponent(j.hash)}`,
        descriptionMd: j.jobDescription,
        postedAt: j.datePosted,
        raw: j as unknown as Record<string, unknown>
      };
    });
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(bamboohr);
