import { XMLParser } from 'fast-xml-parser';
import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type PersonioPosition = {
  id: string | number;
  name: string;
  departmentExternalName?: string;
  office?: string;
  employmentType?: string;
  createdAt?: string;
  jobDescriptions?: {
    jobDescription?:
      | { name?: string; value?: string }
      | Array<{ name?: string; value?: string }>;
  };
};

type PersonioParsed = {
  'workzag-jobs'?: {
    position?: PersonioPosition | PersonioPosition[];
  };
};

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true
});

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

function extractDescription(p: PersonioPosition): string | undefined {
  const sections = asArray(p.jobDescriptions?.jobDescription);
  if (sections.length === 0) return undefined;
  const parts = sections
    .map(s => {
      const heading = s.name ? `## ${s.name}\n\n` : '';
      const body = s.value ?? '';
      return body ? `${heading}${body}` : '';
    })
    .filter(p => p.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

export const personio: ATSAdapter = {
  name: 'personio',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const slug = encodeURIComponent(orgSlug);
    const url = `https://${slug}.jobs.personio.de/xml`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`personio ${orgSlug}: HTTP ${res.status}`);
    const xml = await res.text();
    const parsed = parser.parse(xml) as PersonioParsed;
    const positions = asArray(parsed['workzag-jobs']?.position);

    const all: NormalizedJob[] = positions.map(p => ({
      externalId: String(p.id),
      title: p.name,
      dept: p.departmentExternalName,
      location: p.office,
      locationType: inferLocationType(p.office),
      url: `https://${slug}.jobs.personio.de/job/${encodeURIComponent(String(p.id))}`,
      descriptionMd: extractDescription(p),
      postedAt: p.createdAt,
      raw: p as unknown as Record<string, unknown>
    }));
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(personio);
