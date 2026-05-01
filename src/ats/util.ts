export function withinSinceDays(postedAt: string | undefined, sinceDays: number | undefined): boolean {
  if (sinceDays === undefined) return true;
  if (!postedAt) return true;
  const cutoff = Date.now() - sinceDays * 86400_000;
  return new Date(postedAt).getTime() >= cutoff;
}
