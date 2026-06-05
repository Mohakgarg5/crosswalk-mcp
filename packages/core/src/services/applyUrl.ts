/**
 * Aggregator listings (The Muse) have no application form on the page — the
 * real form lives behind an "Apply on company site" link embedded in the
 * page's Next.js data as `applyLink`. Filling the listing page instead
 * produces fake "submissions" (a random submit-shaped button gets clicked),
 * so the apply flow resolves the external URL first.
 */

// Matches both plain `"applyLink":"https://…"` and the escaped form
// `\"applyLink\":\"https://…\"` found inside the page's serialized JSON.
// The capture must allow \uXXXX escapes — Muse encodes `&` as `&`, and
// stopping at the backslash truncates the query string (broken redirects).
const APPLY_LINK_RE = /\\?"applyLink\\?":\\?"(https?:\/\/(?:[^"\\]|\\u[0-9a-fA-F]{4})+)/;

function decodeJsonEscapes(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Ad-tracking redirectors (Recruitics, Appcast, …) often carry the real
 * destination in a query param (`rx_url=https%3A%2F%2Fjobs.apple.com%2F…`).
 * Going straight there skips a hop that frequently 500s without the full
 * client-side context. */
function unwrapTracker(url: string): string {
  try {
    for (const [, v] of new URL(url).searchParams) {
      if (/^https?:\/\//.test(v)) return v;
    }
  } catch {
    /* not parseable — return as-is */
  }
  return url;
}

export function extractApplyLink(html: string): string | undefined {
  const m = html.match(APPLY_LINK_RE);
  return m ? unwrapTracker(decodeJsonEscapes(m[1])) : undefined;
}

export type ApplyTarget = {
  /** The external "Apply on company site" URL, when found. */
  url?: string;
  /** True when the listing itself is gone (404/410) — i.e. expired. */
  gone?: boolean;
};

export async function resolveApplyTarget(
  landingUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApplyTarget> {
  try {
    const res = await fetchImpl(landingUrl);
    if (res.status === 404 || res.status === 410) return { gone: true };
    if (!res.ok) return {};
    return { url: extractApplyLink(await res.text()) };
  } catch {
    return {};
  }
}

export async function resolveExternalApplyUrl(
  landingUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<string | undefined> {
  return (await resolveApplyTarget(landingUrl, fetchImpl)).url;
}
