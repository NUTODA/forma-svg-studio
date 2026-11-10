import type { AssetFileMeta, Box, MotifId, PlacedLayer, Size } from '../domain/types';
import { boxesIntersect, unionBox } from './geometry';

type Pose = Pick<PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>;

/**
 * Share of the background object, per axis, that stays inside the frame (the rest is cropped). The first
 * value is the reference look; smaller ones tuck it further into the corner when it would reach the headline.
 */
const SCENERY_VISIBLE = [0.62, 0.48, 0.36] as const;

/**
 * Which other object of the library makes a good background for a hero (reference sheets: headphones in
 * front of a vase, wallet and coin in front of a lamp, puzzle and pen on a book). First available wins.
 */
const SCENERY_FOR: Record<MotifId, readonly MotifId[]> = {
  headphones: ['bouquet', 'lamp', 'book'],
  wallet: ['lamp', 'folder', 'bouquet'],
  coin: ['lamp', 'folder', 'book'],
  puzzle: ['book', 'lamp', 'folder'],
  pen: ['book', 'folder', 'lamp'],
  phone: ['book', 'bouquet', 'lamp'],
  book: ['lamp', 'bouquet', 'folder'],
  lamp: ['book', 'folder', 'bouquet'],
  bouquet: ['book', 'lamp', 'folder'],
  folder: ['lamp', 'book', 'bouquet'],
};
const SCENERY_FALLBACK: readonly MotifId[] = ['lamp', 'bouquet', 'book', 'folder', 'phone', 'headphones', 'puzzle', 'pen', 'wallet', 'coin'];

/** Background motifs for a composition: objects not already in it, best suited to the hero first. */
export function sceneryCandidates(motifs: readonly MotifId[]): MotifId[] {
  const used = new Set(motifs);
  const hero = motifs[0];
  const preferred = hero === undefined ? [] : SCENERY_FOR[hero];
  const out: MotifId[] = [];
  for (const id of [...preferred, ...SCENERY_FALLBACK]) if (!used.has(id) && !out.includes(id)) out.push(id);
  return out;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Pose of a background object: same common scale as the scene (`scale` = rendered size per source unit, so
 * relative proportions stay those of the library), upright, tucked into the frame corner that leaves the
 * scene most readable and cropped by it. Corners whose box would touch `avoid` (headline zone) are skipped;
 * `taken` corners (other background objects) too. Null when no corner leaves the headline free.
 */
export function placeScenery(
  meta: AssetFileMeta,
  scale: number,
  objects: readonly Box[],
  artboard: Size,
  avoid: Box | null,
  taken: Set<string> = new Set(),
): (Pose & { corner: string }) | null {
  const size = scale * meta.bounds.height;
  const width = scale * meta.bounds.width;
  const group = objects.length > 0 ? unionBox(objects) : null;
  for (const visible of SCENERY_VISIBLE) {
    const hidden = 1 - visible;
    let best: { pose: Pose; corner: Corner; cost: number } | null = null;
    for (const corner of CORNERS) {
      if (taken.has(corner)) continue;
      const x = corner.endsWith('l') ? -hidden * width : artboard.width - visible * width;
      const y = corner.startsWith('t') ? -hidden * size : artboard.height - visible * size;
      const box: Box = { x, y, width, height: size };
      if (avoid && boxesIntersect(box, avoid)) continue;
      // Least covered by the scene; ties keep the corner order (top-left first, as in the references).
      const covered = objects.reduce((sum, b) => sum + overlapArea(box, b), 0);
      const far = group ? -Math.hypot(x + width / 2 - (group.x + group.width / 2), y + size / 2 - (group.y + group.height / 2)) : 0;
      const cost = covered / Math.max(width * size, 1e-9) + 1e-6 * far;
      if (!best || cost < best.cost - 1e-9) best = { pose: { x: x + width / 2, y: y + size / 2, rotation: 0, size }, corner, cost };
    }
    if (best) return { ...best.pose, corner: best.corner };
  }
  // Every corner would reach the headline: no background object rather than one over the text.
  return null;
}
