import type { Db } from '../store/db.ts';
import { upsertCompany } from '../store/company.ts';
import { upsertJobs } from '../store/job.ts';

/**
 * Role-based discovery across thousands of companies via The Muse's public,
 * keyless jobs API — independent of the per-company ATS registry. Results are
 * normalized and persisted as regular jobs (ats 'themuse'), so the rest of the
 * pipeline (draft, auto-apply, pipeline) works on them uniformly.
 */

const MUSE_API = 'https://www.themuse.com/api/public/jobs';
const MAX_PAGES = 20;

export type RoleSearchOptions = {
  /** Free-text role filter applied to job titles (e.g. "product manager"). */
  query?: string;
  /** The Muse category, e.g. "Software Engineering", "Data and Analytics". */
  category?: string;
  /** Location substring, e.g. "New York" or "Flexible / Remote". */
  location?: string;
  /** Pages to pull (each ~20 jobs). More pages = more to apply to. */
  pages?: number;
};

export type RoleSearchJob = {
  id: string;
  company: string;
  companyId: string;
  title: string;
  location?: string;
  locationType?: string;
  url: string;
  postedAt?: string;
  category?: string;
};

export type RoleSearchResult = {
  jobs: RoleSearchJob[];
  meta: { fetched: number; afterFilters: number; total: number; pagesFetched: number };
};

type MuseJob = {
  id: number;
  name: string;
  contents?: string;
  publication_date?: string;
  refs?: { landing_page?: string };
  locations?: Array<{ name: string }>;
  categories?: Array<{ name: string }>;
  company?: { id?: number; name?: string; short_name?: string };
};

type MuseResponse = { results?: MuseJob[]; page_count?: number; total?: number };

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

/** Map a free-text role query to a Muse category so the API does the heavy
 * filtering server-side. Without this, we fetch N pages of *all* categories
 * and a title grep leaves almost nothing (the "1 result" bug). Order matters:
 * more specific patterns first. */
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/product\s*(manager|management|owner)|(^|\s)pm($|\s)/i, 'Product Management'],
  [/project\s*manager|program\s*manager|scrum/i, 'Project Management'],
  [/data\s*scien|machine\s*learning|(^|\s)ml($|\s)|(^|\s)ai($|\s)/i, 'Data Science'],
  [/data\b|analytics|analyst/i, 'Data and Analytics'],
  [/design|(^|\s)ux($|\s)|(^|\s)ui($|\s)/i, 'Design and UX'],
  [/software|developer|engineer|swe|frontend|backend|full[\s-]?stack/i, 'Software Engineering'],
  [/marketing|growth|seo|content/i, 'Advertising and Marketing'],
  [/sales|account\s*executive|business\s*development/i, 'Sales'],
  [/recruit|talent|people\s*ops|(^|\s)hr($|\s)/i, 'Recruiting'],
  [/customer\s*(success|support|service)/i, 'Customer Service'],
  [/finance|accounting|controller/i, 'Accounting and Finance']
];

export function deriveCategory(query?: string): string | undefined {
  if (!query) return undefined;
  for (const [re, cat] of CATEGORY_PATTERNS) if (re.test(query)) return cat;
  return undefined;
}

function normalize(r: MuseJob): RoleSearchJob {
  const companyName = r.company?.name ?? 'Unknown';
  const companySlug = r.company?.short_name ?? slugify(companyName);
  const locationName = r.locations?.[0]?.name;
  const remote = (r.locations ?? []).some(l => /flexible|remote/i.test(l.name));
  return {
    id: `themuse:${r.id}`,
    company: companyName,
    companyId: `themuse:${companySlug}`,
    title: r.name,
    location: locationName,
    locationType: remote ? 'remote' : undefined,
    url: r.refs?.landing_page ?? `https://www.themuse.com/jobs/${companySlug}`,
    postedAt: r.publication_date,
    category: r.categories?.[0]?.name
  };
}

export async function searchRoles(
  db: Db,
  opts: RoleSearchOptions,
  fetchImpl: typeof fetch = fetch
): Promise<RoleSearchResult> {
  const pages = Math.min(Math.max(opts.pages ?? 1, 1), MAX_PAGES);
  // Explicit category wins; otherwise derive one from the query so the API
  // filters server-side instead of us grepping titles out of random pages.
  const category = opts.category ?? deriveCategory(opts.query);
  const raw: MuseJob[] = [];
  let total = 0;
  let pagesFetched = 0;

  for (let p = 1; p <= pages; p++) {
    const url = new URL(MUSE_API);
    url.searchParams.set('page', String(p));
    if (category) url.searchParams.set('category', category);
    if (opts.location) url.searchParams.set('location', opts.location);

    const res = await fetchImpl(url.toString());
    if (!res.ok) break;
    const data = (await res.json()) as MuseResponse;
    pagesFetched++;
    total = data.total ?? total;
    for (const j of data.results ?? []) raw.push(j);
    if (p >= (data.page_count ?? p)) break;
  }

  const q = opts.query?.toLowerCase().trim();
  const valid = raw.filter(r => r && typeof r.name === 'string');
  // Muse categories are noisy ("Product Management" contains retail GMs and
  // scrum masters), so a query always narrows: every query token must appear
  // in the title. Exact-phrase matches rank first. An EXPLICIT category from
  // the caller is trusted as-is — no title narrowing.
  const tokens = (q ?? '').split(/[^a-z0-9]+/).filter(Boolean);
  const phraseMatch = (r: MuseJob) => !q || r.name.toLowerCase().includes(q);
  const tokenMatch = (r: MuseJob) => {
    const t = r.name.toLowerCase();
    return tokens.every(tok => t.includes(tok));
  };
  const narrowed = opts.category || !q ? valid : valid.filter(tokenMatch);
  const jobs = [...narrowed]
    .sort((a, b) => Number(phraseMatch(b)) - Number(phraseMatch(a)))
    .map(normalize);

  // Persist as regular jobs so draft/auto-apply/pipeline work on them.
  for (const j of jobs) {
    upsertCompany(db, { id: j.companyId, name: j.company, ats: 'themuse', atsOrgSlug: j.companyId.replace('themuse:', '') });
  }
  upsertJobs(db, jobs.map(j => ({
    id: j.id,
    companyId: j.companyId,
    title: j.title,
    location: j.location,
    locationType: j.locationType,
    url: j.url,
    postedAt: j.postedAt,
    raw: { source: 'themuse', category: j.category }
  })));

  return { jobs, meta: { fetched: raw.length, afterFilters: jobs.length, total, pagesFetched } };
}
