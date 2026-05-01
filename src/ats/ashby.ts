import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';

type AbRaw = {
  jobs: Array<{
    id: string;
    title: string;
    departmentName?: string;
    locationName?: string;
    jobUrl: string;
    publishedDate?: string;
    descriptionHtml?: string;
    compensationTierSummary?: string;
  }>;
};

function htmlToMarkdown(html: string): string {
  return html.replace(/<\s*\/p\s*>/gi, '\n\n').replace(/<[^>]+>/g, '').trim();
}

function inferLocationType(loc?: string): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

function parseSalary(s?: string): { min?: number; max?: number; currency?: string } {
  if (!s) return {};
  // Match e.g. "$300K – $500K • USD" or "$120,000 - $160,000 USD"
  const m = s.match(/\$?\s*([\d,.]+)\s*(K|M)?\s*[–-]\s*\$?\s*([\d,.]+)\s*(K|M)?(?:.*?\b([A-Z]{3})\b)?/);
  if (!m) return {};
  const scale = (suf?: string) => suf === 'K' ? 1000 : suf === 'M' ? 1_000_000 : 1;
  const lo = Math.round(parseFloat(m[1].replace(/,/g, '')) * scale(m[2]));
  const hi = Math.round(parseFloat(m[3].replace(/,/g, '')) * scale(m[4] ?? m[2]));
  return { min: lo, max: hi, currency: m[5] ?? 'USD' };
}

export const ashby: ATSAdapter = {
  name: 'ashby',
  async listJobs(orgSlug: string): Promise<NormalizedJob[]> {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(orgSlug)}?includeCompensation=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ashby ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as AbRaw;
    return data.jobs.map(j => {
      const sal = parseSalary(j.compensationTierSummary);
      return {
        externalId: j.id,
        title: j.title,
        dept: j.departmentName,
        location: j.locationName,
        locationType: inferLocationType(j.locationName),
        url: j.jobUrl,
        descriptionMd: j.descriptionHtml ? htmlToMarkdown(j.descriptionHtml) : undefined,
        postedAt: j.publishedDate,
        salaryMin: sal.min,
        salaryMax: sal.max,
        currency: sal.currency,
        raw: j as unknown as Record<string, unknown>
      };
    });
  }
};

registerAdapter(ashby);
