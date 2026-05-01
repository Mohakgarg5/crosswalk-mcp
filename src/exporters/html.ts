import { Marked } from 'marked';

export type HtmlOpts = { title: string };

// marked v9+ does not escape raw HTML by default. Use a local Marked instance
// with a renderer that escapes raw HTML tokens so untrusted markdown cannot
// inject <script> or other tags.
const ALLOWED_URL_PREFIX = /^(https?:\/\/|mailto:|\/|#|[^:]+$|[^:]+\/[^:]+)/i;

function safeUrl(href: string): string {
  // Reject anything that looks like a URI scheme we don't allow.
  // The regex above accepts http(s)://, mailto:, root-absolute (/...), fragment (#...),
  // or no-scheme paths (no colon before first slash). Everything else → '#'.
  return ALLOWED_URL_PREFIX.test(href) ? href : '#';
}

const markedInstance = new Marked({
  renderer: {
    html(token: { text: string }): string {
      return escapeHtml(token.text);
    },
    link(token: { href: string; title?: string | null; tokens?: unknown[]; text?: string }): string {
      const href = escapeHtml(safeUrl(token.href));
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      // Use the parser to render inner tokens; fall back to text.
      const inner = (this as unknown as { parser: { parseInline: (t: unknown[]) => string } })
        .parser.parseInline(token.tokens ?? []);
      return `<a href="${href}"${title}>${inner || escapeHtml(token.text ?? '')}</a>`;
    },
    image(token: { href: string; title?: string | null; text?: string }): string {
      const src = escapeHtml(safeUrl(token.href));
      const alt = escapeHtml(token.text ?? '');
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img src="${src}" alt="${alt}"${title}>`;
    }
  }
});

const PRINT_CSS = `
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 7.5in;
         margin: 0.75in auto; color: #111; line-height: 1.5; }
  h1, h2, h3 { line-height: 1.2; }
  h1 { font-size: 1.6rem; margin-bottom: 0.2rem; }
  h2 { font-size: 1.2rem; margin-top: 1.4rem; border-bottom: 1px solid #ddd;
       padding-bottom: 0.2rem; }
  h3 { font-size: 1.0rem; margin-top: 1.0rem; }
  ul { padding-left: 1.2rem; }
  li { margin-bottom: 0.2rem; }
  a { color: #0a4d8c; text-decoration: none; }
  @media print {
    body { margin: 0.5in; }
    a { color: #111; }
  }
`;

export async function mdToPrintHtml(md: string, opts: HtmlOpts): Promise<string> {
  const body = await markedInstance.parse(md, { async: true });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(opts.title)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
