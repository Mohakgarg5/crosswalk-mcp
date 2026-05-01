import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type LvRaw = Array<{
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  categories?: { team?: string; location?: string; commitment?: string };
  descriptionPlain?: string;
}>;

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

export const lever: ATSAdapter = {
  name: 'lever',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(orgSlug)}?mode=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`lever ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as LvRaw;
    const all: NormalizedJob[] = data.map(j => ({
      externalId: j.id,
      title: j.text,
      dept: j.categories?.team,
      location: j.categories?.location,
      locationType: inferLocationType(j.categories?.location),
      url: j.hostedUrl,
      descriptionMd: j.descriptionPlain,
      postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      raw: j as unknown as Record<string, unknown>
    }));
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(lever);
