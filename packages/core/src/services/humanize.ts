/**
 * Belt and braces for model prose: models leak em dashes despite prompt bans.
 * Rewrite them (and en dashes used as clause joins) to commas, but keep en
 * dashes inside numeric ranges like 2019–2023.
 */
export function stripEmDashes(text: string): string {
  return text.replace(/(?<!\d)\s*[—–]\s*(?!\d)/g, ', ');
}
