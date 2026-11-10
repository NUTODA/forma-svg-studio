/** Typo tolerance: Damerau–Levenshtein (optimal string alignment) with early exit. */

/**
 * Edit distance counting insertions, deletions, substitutions and adjacent transpositions.
 * Returns `maxDistance + 1` as soon as the distance is known to exceed `maxDistance`.
 */
export function damerauLevenshtein(a: string, b: string, maxDistance = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  const over = maxDistance + 1;
  if (Math.abs(a.length - b.length) > maxDistance) return over;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let twoAgo: number[] = [];
  let prevMin = 0;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (twoAgo[j - 2] ?? 0) + 1);
      }
      row.push(value);
      if (value < rowMin) rowMin = value;
    }
    // A transposition reads two rows back, so both recent rows must exceed the limit.
    if (Math.min(rowMin, prevMin) > maxDistance) return over;
    prevMin = rowMin;
    twoAgo = prev;
    prev = row;
  }
  const result = prev[b.length] ?? over;
  return result > maxDistance ? over : result;
}

/** Allowed typo distance by word length: ≤4 letters exact only, 5–7 → 1, ≥8 → 2. */
export function fuzzyThreshold(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

export interface Closest {
  candidate: string;
  index: number;
  distance: number;
}

/** Nearest candidate within `maxDistance` (first one wins ties), or null. */
export function closest(
  word: string,
  candidates: readonly string[],
  maxDistance: number,
): Closest | null {
  let best: Closest | null = null;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const limit = best === null ? maxDistance : best.distance - 1;
    if (limit < 0) break;
    const distance = damerauLevenshtein(word, candidate, limit);
    if (distance <= limit) best = { candidate, index, distance };
  }
  return best;
}
