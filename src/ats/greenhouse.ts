import type { ATSAdapter, NormalizedJob } from './types.ts';
import { registerAdapter } from './adapter.ts';
import { withinSinceDays } from './util.ts';

type GhRaw = {
  jobs: Array<{
    id: number;
    title: string;
    updated_at?: string;
    location?: { name?: string };
    departments?: Array<{ name?: string }>;
    offices?: Array<unknown>;
    absolute_url: string;
    content?: string;
  }>;
};

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function inferLocationType(loc: string | undefined): NormalizedJob['locationType'] {
  if (!loc) return 'unknown';
  const l = loc.toLowerCase();
  if (l.includes('remote')) return 'remote';
  if (l.includes('hybrid')) return 'hybrid';
  return 'onsite';
}

export const greenhouse: ATSAdapter = {
  name: 'greenhouse',
  async listJobs(orgSlug: string, opts?: { sinceDays?: number }): Promise<NormalizedJob[]> {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(orgSlug)}/jobs?content=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`greenhouse ${orgSlug}: HTTP ${res.status}`);
    const data = (await res.json()) as GhRaw;
    const all: NormalizedJob[] = data.jobs.map(j => ({
      externalId: String(j.id),
      title: j.title,
      dept: j.departments?.[0]?.name,
      location: j.location?.name,
      locationType: inferLocationType(j.location?.name),
      url: j.absolute_url,
      descriptionMd: j.content ? htmlToMarkdown(j.content) : undefined,
      postedAt: j.updated_at,
      raw: j as unknown as Record<string, unknown>
    }));
    return all.filter(j => withinSinceDays(j.postedAt, opts?.sinceDays));
  }
};

registerAdapter(greenhouse);
