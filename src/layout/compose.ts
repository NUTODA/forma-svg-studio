import type {
  AssetFileMeta,
  Box,
  ComposeInput,
  ComposeItem,
  ComposeResult,
  LayoutMode,
  PlacedLayer,
  Size,
} from '../domain/types';
import { candidateArrangements, makeDims } from './arrange';
import type { Arrangement, Dim } from './arrange';
import { placeEcho } from './echoes';
import { boxBottom, boxRight, layerBounds, uncoveredFraction, unionBox, visibleAxes } from './geometry';
import { getZones } from './zones';

export { ARTBOARD_PRESETS, getZones, orientationOf } from './zones';
export { layerBounds } from './geometry';
export { echoOffset, placeEcho } from './echoes';

/** Deterministic tilts for items 1, 2, 3… (the hero is never tilted). */
const TILTS = [-6, 5, -4, 7, -3, 6, -5] as const;
const SMALL_TILT_BOOST = 1.3;
const OFFSET_TILT_BOOST = 1.25;
const MAX_TILT = 10;
const SMALL_RATIO = 0.4;

const FILL: Record<LayoutMode, number> = { composed: 0.9, title: 0.94, offset: 0.96 };
const SINGLE_FILL: Record<LayoutMode, number> = { composed: 0.78, title: 0.78, offset: 0.96 };
/** Optical correction: group sits slightly above the geometric centre. */
const OPTICAL_LIFT = 0.02;
/** Mild preference of an arrangement kind for a zone shape. */
const SHAPE_BONUS = 1.08;
/** Share of an object that must stay on the artboard in the offset layout. */
const MIN_VISIBLE = 0.8;
/** The hero keeps at least this share of its bounds uncovered. */
const HERO_FREE = 0.6;
/**
 * Every other object should keep this share of its bounds uncovered by objects drawn above it.
 * Candidates below it are penalised steeply, so a slightly smaller but readable arrangement wins
 * over a larger one that buries an object (bounds are conservative: isometric drawings leave
 * empty corners, so 0.55 of the box reads as clearly visible).
 */
const MIN_UNCOVERED = 0.55;
const OCCLUSION_POWER = 3;

interface EchoLink {
  /** Index in `ComposeInput.backgrounds`. */
  background: number;
  /** Index of the object it sits behind. */
  object: number;
  /** Position among placed echoes (decides the shift direction). */
  order: number;
}

function tiltFor(index: number, small: boolean, mode: LayoutMode): number {
  if (index === 0) return 0;
  let tilt = TILTS[(index - 1) % TILTS.length] ?? 0;
  if (small) tilt *= SMALL_TILT_BOOST;
  if (mode === 'offset') tilt *= OFFSET_TILT_BOOST;
  return Math.round(Math.max(-MAX_TILT, Math.min(MAX_TILT, tilt)) * 10) / 10;
}

function rotationsFor(metas: readonly AssetFileMeta[], mode: LayoutMode): number[] {
  const tallest = Math.max(...metas.map((m) => m.bounds.height));
  return metas.map((m, i) => tiltFor(i, m.bounds.height < SMALL_RATIO * tallest, mode));
}

/** Each echo sits behind the first not yet matched object of the same motif. */
function linkEchoes(items: readonly ComposeItem[], backgrounds: readonly ComposeItem[]): EchoLink[] {
  const taken = new Set<number>();
  const links: EchoLink[] = [];
  backgrounds.forEach((bg, background) => {
    const object = items.findIndex((it, i) => !taken.has(i) && it.motif === bg.motif);
    if (object < 0) return;
    taken.add(object);
    links.push({ background, object, order: links.length });
  });
  return links;
}

type Pose = Pick<PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>;

/** Rotated bounds of every object and echo for objects posed by `poseOf`. */
function groupBoxes(
  items: readonly ComposeItem[],
  backgrounds: readonly ComposeItem[],
  links: readonly EchoLink[],
  mode: LayoutMode,
  poses: readonly Pose[],
  avoid: Box | null,
): { objects: Box[]; echoes: Box[] } {
  const objects = poses.map((pose, i) => layerBounds(pose, (items[i] as ComposeItem).meta));
  const echoes = links.map((link) => {
    const bg = backgrounds[link.background] as ComposeItem;
    const obj = items[link.object] as ComposeItem;
    const pose = placeEcho(poses[link.object] as Pose, obj.meta, bg.meta, link.order, mode, avoid);
    return layerBounds(pose, bg.meta);
  });
  return { objects, echoes };
}

interface Candidate {
  arrangement: Arrangement;
  scale: number;
  /** Union of everything at unit scale. */
  union: Box;
  /** Unit-scale object poses by item index. */
  unit: Pose[];
  /** Smallest uncovered share of any object under the final z-order (scale-invariant). */
  minUncovered: number;
}

/** Smallest share of any object's bounds left uncovered by the objects stacked above it. */
function minUncoveredShare(dims: readonly Dim[], boxes: readonly Box[]): number {
  const order = zOrder(dims, boxes);
  let min = 1;
  order.forEach((index, at) => {
    const above = order.slice(at + 1).map((i) => boxes[i] as Box);
    min = Math.min(min, uncoveredFraction(boxes[index] as Box, above, 16));
  });
  return min;
}

function unitPoses(arrangement: Arrangement, dims: readonly Dim[]): Pose[] {
  const poses: Pose[] = [];
  for (const slot of arrangement.slots) {
    const d = dims[slot.index] as Dim;
    poses[slot.index] = { x: slot.cx, y: slot.cy, rotation: d.rotation, size: d.h };
  }
  return poses;
}

function evaluate(
  arrangement: Arrangement,
  dims: readonly Dim[],
  items: readonly ComposeItem[],
  backgrounds: readonly ComposeItem[],
  links: readonly EchoLink[],
  mode: LayoutMode,
  zone: Box,
  fill: number,
): Candidate {
  const unit = unitPoses(arrangement, dims);
  const boxes = groupBoxes(items, backgrounds, links, mode, unit, null);
  const union = unionBox([...boxes.objects, ...boxes.echoes]);
  const scale = Math.min((fill * zone.width) / union.width, (fill * zone.height) / union.height);
  return { arrangement, scale, union, unit, minUncovered: minUncoveredShare(dims, boxes.objects) };
}

function preference(arrangement: Arrangement, zone: Box): number {
  const aspect = zone.width / zone.height;
  if (arrangement.kind === 'row' && arrangement.tiers === 1 && aspect >= 1.2) return SHAPE_BONUS;
  if (arrangement.kind === 'tiers' && aspect <= 0.9) return SHAPE_BONUS;
  return 1;
}

function candidateScore(c: Candidate, zone: Box): number {
  const legibility = Math.min(1, c.minUncovered / MIN_UNCOVERED) ** OCCLUSION_POWER;
  return c.scale * preference(c.arrangement, zone) * legibility;
}

function pickCandidate(candidates: readonly Candidate[], zone: Box): Candidate {
  let best = candidates[0] as Candidate;
  let bestScore = candidateScore(best, zone);
  for (const c of candidates) {
    const score = candidateScore(c, zone);
    if (score > bestScore + 1e-9) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Group origin so that the scaled union is centred (composed/title) or anchored bottom-right (offset). */
function placementOffset(c: Candidate, zone: Box, mode: LayoutMode): { x: number; y: number } {
  const { union, scale } = c;
  if (mode === 'offset') {
    return { x: boxRight(zone) - scale * boxRight(union), y: boxBottom(zone) - scale * boxBottom(union) };
  }
  const zoneCx = zone.x + zone.width / 2;
  const zoneCy = zone.y + zone.height / 2 - OPTICAL_LIFT * zone.height;
  return {
    x: zoneCx - scale * (union.x + union.width / 2),
    y: zoneCy - scale * (union.y + union.height / 2),
  };
}

/** Offset layout: move the whole group inward just enough that every object stays mostly visible. */
function keepVisible(poses: Pose[], items: readonly ComposeItem[], artboard: Size): void {
  const visibility = (): { vx: number; vy: number; total: number }[] =>
    poses.map((pose, i) => {
      const { vx, vy } = visibleAxes(layerBounds(pose, (items[i] as ComposeItem).meta), artboard);
      return { vx, vy, total: vx * vy };
    });
  for (let guard = 0; guard < 2000; guard += 1) {
    const worst = visibility().reduce((a, b) => (b.total < a.total ? b : a));
    if (worst.total >= MIN_VISIBLE) return;
    const axis = worst.vx < worst.vy ? 'x' : 'y';
    for (const pose of poses) pose[axis] -= 1;
  }
}

/** Larger painted area behind, smaller in front; the hero is lifted until it is not buried. */
function zOrder(dims: readonly Dim[], boxes: readonly Box[]): number[] {
  const order = dims
    .map((d) => d.index)
    .sort((a, b) => {
      const da = dims[a] as Dim;
      const db = dims[b] as Dim;
      return db.w * db.h - da.w * da.h || b - a;
    });
  let at = order.indexOf(0);
  while (at < order.length - 1) {
    const above = order.slice(at + 1).map((i) => boxes[i] as Box);
    if (uncoveredFraction(boxes[0] as Box, above) >= HERO_FREE) break;
    [order[at], order[at + 1]] = [order[at + 1] as number, order[at] as number];
    at += 1;
  }
  return order;
}

/** Deterministic art-directed composition (uniform common scale, source proportions preserved). */
export function compose(input: ComposeInput): ComposeResult {
  const { items, backgrounds, artboard, mode } = input;
  const zones = getZones(artboard, mode);
  if (items.length === 0) return { ...zones, layers: [] };

  const zone = zones.artZone;
  const metas = items.map((it) => it.meta);
  const dims = makeDims(metas, rotationsFor(metas, mode));
  const links = linkEchoes(items, backgrounds);
  const fill = items.length === 1 ? SINGLE_FILL[mode] : FILL[mode];
  const allowColumn = zone.width / zone.height <= 1;

  const candidates = candidateArrangements(dims, allowColumn).map((arrangement) =>
    evaluate(arrangement, dims, items, backgrounds, links, mode, zone, fill),
  );
  const best = pickCandidate(candidates, zone);

  const origin = placementOffset(best, zone, mode);
  const poses: Pose[] = best.unit.map((u) => ({
    x: origin.x + best.scale * u.x,
    y: origin.y + best.scale * u.y,
    rotation: u.rotation,
    size: best.scale * u.size,
  }));
  if (mode === 'offset') keepVisible(poses, items, artboard);

  const boxes = poses.map((pose, i) => layerBounds(pose, (items[i] as ComposeItem).meta));
  const objects: PlacedLayer[] = zOrder(dims, boxes).map((i) => {
    const pose = poses[i] as Pose;
    return { motif: (items[i] as ComposeItem).motif, role: 'object', ...pose, rank: i };
  });

  const avoid = mode === 'title' ? zones.headlineZone : null;
  const echoes: PlacedLayer[] = links.map((link) => {
    const bg = backgrounds[link.background] as ComposeItem;
    const obj = items[link.object] as ComposeItem;
    const pose = placeEcho(poses[link.object] as Pose, obj.meta, bg.meta, link.order, mode, avoid);
    return { motif: bg.motif, role: 'background', ...pose, rank: link.background };
  });

  return { ...zones, layers: [...echoes, ...objects] };
}
