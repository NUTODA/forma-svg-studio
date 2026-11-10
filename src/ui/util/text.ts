/** Replace the first case-insensitive occurrence of `token`; returns the text unchanged when absent. */
export function replaceFirstOccurrence(text: string, token: string, replacement: string): string {
  if (!token) return text;
  const index = text.toLowerCase().indexOf(token.toLowerCase());
  if (index < 0) return text;
  return text.slice(0, index) + replacement + text.slice(index + token.length);
}

/** Normalise an angle in degrees to the range (−180, 180]. */
export function normalizeAngle(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  const signed = wrapped > 180 ? wrapped - 360 : wrapped;
  return Math.round(signed * 1000) / 1000 + 0;
}

/** «Монета, Монета, Книга» → «Монета ×2, Книга» (first-seen order). */
export function formatCountedList(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
}

/** Distinct names in first-seen order, joined with commas. */
export function formatUniqueList(names: readonly string[]): string {
  return [...new Set(names)].join(', ');
}
