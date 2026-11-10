import type { AssetFileMeta, Box, MotifId, PlacedLayer, Size } from '../domain/types';
import { boxesIntersect, visibleAxes } from './geometry';

type Pose = Pick<PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>;

/** Keep most of the silhouette. Try cropping one edge before cropping two. */
const SCENERY_CROPS = [[1, 0.72], [0.72, 1], [0.78, 0.78], [0.68, 0.68], [0.64, 0.64]] as const;
/** The visible part of the background object may take at most this share of the frame: it sets the scene, it does not lead it. */
const MAX_FRAME_SHARE = 0.32;
/** A small gap keeps the background outline from appearing attached to a foreground object. */
const CLEARANCE = 0.018;

/**
 * Which other object of the library makes a good background for a hero (reference sheets: headphones in
 * front of a vase, wallet and coin in front of a lamp, puzzle and pen on a book). First available wins.
 */
const SCENERY_FOR: Record<MotifId, readonly MotifId[]> = {
  headphones: ['bouquet', 'lamp', 'book'],
  wallet: ['lamp', 'folder'],
  coin: ['lamp', 'folder', 'book'],
  puzzle: ['book', 'lamp', 'folder'],
  pen: ['book', 'folder', 'lamp'],
  phone: ['book', 'bouquet', 'lamp'],
  book: ['lamp', 'bouquet', 'folder'],
  lamp: ['book', 'folder', 'bouquet'],
  bouquet: ['book', 'lamp', 'folder'],
  folder: ['lamp', 'book', 'bouquet'],
};
/** Background motifs for a composition: objects not already in it, best suited to the hero first. */
export function sceneryCandidates(motifs: readonly MotifId[]): MotifId[] {
  const used = new Set(motifs);
  const hero = motifs[0];
  return hero === undefined ? [] : SCENERY_FOR[hero].filter((id) => !used.has(id));
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: readonly Corner[] = ['bl', 'br', 'tl', 'tr'];

/**
 * Pose of a background object: same common scale as the scene (`scale` = rendered size per source unit, so
 * relative proportions stay those of the library), upright, tucked into the frame corner that leaves the
 * scene most readable and cropped by it. Corners whose box would touch `avoid` (headline zone) are skipped;
 * `taken` corners (other background objects) too. It must stay secondary: its visible part is at most
 * MAX_FRAME_SHARE of the frame and it may not lie under the objects. Null when no corner satisfies that.
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
  const gap = CLEARANCE * Math.min(artboard.width, artboard.height);
  const frameArea = artboard.width * artboard.height;
  for (const [keepX, keepY] of SCENERY_CROPS) {
    for (const corner of CORNERS) {
      if (taken.has(corner)) continue;
      const x = corner.endsWith('l') ? (keepX - 1) * width : artboard.width - keepX * width;
      const y = corner.startsWith('t') ? (keepY - 1) * size : artboard.height - keepY * size;
      const box: Box = { x, y, width, height: size };
      const { vx, vy } = visibleAxes(box, artboard);
      if (vx < keepX - 1e-9 || vy < keepY - 1e-9) continue;
      if (avoid && boxesIntersect(box, avoid)) continue;
      if (vx * vy * width * size > MAX_FRAME_SHARE * frameArea) continue;
      const clearance = { x: x - gap, y: y - gap, width: width + 2 * gap, height: size + 2 * gap };
      if (objects.some((object) => boxesIntersect(clearance, object))) continue;
      return { x: x + width / 2, y: y + size / 2, rotation: 0, size, corner };
    }
  }
  // No corner keeps it modest, clear of the objects and of the headline: better none than one that dominates.
  return null;
}
