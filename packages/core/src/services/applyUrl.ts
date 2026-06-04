/**
 * Aggregator listings (The Muse) have no application form on the page — the
 * real form lives behind an "Apply on company site" link embedded in the
 * page's Next.js data as `applyLink`. Filling the listing page instead
 * produces fake "submissions" (a random submit-shaped button gets clicked),
 * so the apply flow resolves the external URL first.
 */

// Matches both plain `"applyLink":"https://…"` and the escaped form
// `\"applyLink\":\"https://…\"` found inside the page's serialized JSON.
const APPLY_LINK_RE = /\\?"applyLink\\?":\\?"(https?:\/\/[^"\\]+)/;

export function extractApplyLink(html: string): string | undefined {
  const m = html.match(APPLY_LINK_RE);
  return m ? m[1] : undefined;
}

export async function resolveExternalApplyUrl(
  landingUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(landingUrl);
    if (!res.ok) return undefined;
    return extractApplyLink(await res.text());
  } catch {
    return undefined;
  }
}
