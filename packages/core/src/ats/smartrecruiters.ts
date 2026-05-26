import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type SrRaw = {
  content: Array<{
    id: string;
    name: string;
    ref: string;
    releasedDate?: string;
    location?: { city?: string; country?: string; fullLocation?: string };
    department?: { label?: string };
    jobAd?: {
      sections?: {
        jobDescription?: { text?: string };
        qualifications?: { text?: string };
      };
    };
  }>;
};

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function combineDescription(desc?: string, quals?: string): string | undefined {
  const parts = [desc, quals].filter((p): p is string => !!p && p.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export const smartrecruiters: ATSAdapter = {
  name: 'smartrecruiters',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(orgSlug)}/postings`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`smartrecruiters ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as SrRaw;
    const all: NormalizedJob[] = data.content.map(j => {
      const fullLoc = j.location?.fullLocation;
      return {
        externalId: j.id,
        title: j.name,
        dept: j.department?.label,
        location: fullLoc,
        locationType: inferLocationType(fullLoc),
        url: j.ref,
        descriptionMd: combineDescription(
          j.jobAd?.sections?.jobDescription?.text,
          j.jobAd?.sections?.qualifications?.text
        ),
        postedAt: j.releasedDate,
        raw: j as unknown as Record<string, unknown>
      };
    });
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(smartrecruiters);
