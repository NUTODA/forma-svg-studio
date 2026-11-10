import type {
  Box,
  ComposeInput,
  ComposeItem,
  ComposeResult,
  PlacedLayer,
} from '../domain/types';
import { candidateArrangements, denseArrangements, floorArrangement, makeDims, onSurface } from './arrange';
import type { Arrangement, Dim } from './arrange';
import { placeScenery } from './scenery';
import { layerBounds, uncoveredFraction, unionBox } from './geometry';
import { getZones } from './zones';

export { ARTBOARD_PRESETS, getZones, orientationOf } from './zones';
export { layerBounds } from './geometry';
export { placeScenery, sceneryCandidates } from './scenery';

/**
 * Scale over «the whole group just fits the art zone». Above 1 the scene is cropped by the frame like the
 * reference illustrations: strongly when the back object is a flat surface (a book or a folder running off
 * the frame), below 1 when the scene is compact objects the references show whole with room for the background (a wallet
 * and a coin, a puzzle and a pen).
 */
const BLEED = { single: 1.05, surface: 1.22, group: 0.94 } as const;
/**
 * The library is drawn at one physical scale (a book is five coins wide; S files are half the L size), and
 * the reference sheets show objects close to that native size on a 1080 px frame. A scene is never magnified
 * past this many rendered pixels per L source unit (scaled with the frame), so a lone coin stays a coin.
 */
const MAX_NATIVE_SCALE = 1.3;
const REFERENCE_FRAME = 1080;
/** Front objects may be cropped by the frame edges too, but keep at least this share per axis inside. */
const FRONT_VISIBLE = 0.9;
/** Gap between front objects and the headline side of the art zone, as a share of the shorter frame side. */
const FRONT_MARGIN = 0.03;
/** The back object keeps at least this share of its width and of its height inside the frame. */
const BACK_VISIBLE = 0.62;
/** Each retry shrinks the scale by this factor until every object fits its region. */
const SHRINK = 0.97;
/** Optical correction: the group sits slightly above the geometric centre. */
const OPTICAL_LIFT = 0.02;
/** Flat objects others can rest on (as in the reference sheets). */
const SURFACES = new Set(['book', 'folder']);
/** Objects resting on a surface: the reference look, preferred when it reads well. */
const SURFACE_BONUS = 1.35;
/** How hard overlapping objects (outside «resting on a surface») are penalised. */
const PILE_POWER = 3;
/** Objects apart on one floor along the isometric axes: the reference still life, preferred over piles. */
const FLOOR_BONUS = 1.4;
/** Mild preference of an arrangement kind for a zone shape. */
const SHAPE_BONUS = 1.08;
/** The hero keeps at least this share of its bounds uncovered. */
const HERO_FREE = 0.6;
/**
 * Every other object should keep this share of its bounds uncovered by objects drawn above it. Objects may
 * rest on one another (phone on a book), but none may be buried; bounds are conservative for isometric art.
 */
const MIN_UNCOVERED = 0.5;
const OCCLUSION_POWER = 3;
/**
 * Up to this many objects every arrangement is tried and scored against occlusion (the default brief has 1–8).
 * Beyond it a small deterministic family of tiered arrangements is scored by scale alone.
 */
const EXHAUSTIVE_MAX_ITEMS = 16;

export interface ComposeOptions {
  /**
   * `backgrounds` are candidates in order of preference; at most this many are placed (default: all).
   * A candidate that would dominate the frame or lie under the objects is skipped for the next one.
   */
  sceneryLimit?: number;
  /**
   * Preferred z-order of the objects as item indices, bottom first. It replaces the art-directed order (and
   * arrangements are scored against it); items it does not list go on top in index order.
   */
  stacking?: readonly number[];
}

/** Listed indices (valid, first occurrence), then the unlisted ones in index order; null for no preference. */
function normalizeStacking(stacking: readonly number[] | undefined, count: number): number[] | null {
  if (!stacking || stacking.length === 0) return null;
  const seen = new Set<number>();
  const order: number[] = [];
  for (const index of stacking) {
    if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) continue;
    seen.add(index);
    order.push(index);
  }
  for (let index = 0; index < count; index += 1) if (!seen.has(index)) order.push(index);
  return order;
}

type Pose = Pick<PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>;

interface Candidate {
  arrangement: Arrangement;
  /** Scale at which the whole group just fits the art zone. */
  scale: number;
  union: Box;
  unit: Pose[];
  minUncovered: number;
  /** Share of the objects' area that overlaps another object (bounding boxes). */
  pile: number;
}

function unitPoses(arrangement: Arrangement, dims: readonly Dim[]): Pose[] {
  const poses: Pose[] = [];
  for (const slot of arrangement.slots) {
    const d = dims[slot.index] as Dim;
    poses[slot.index] = { x: slot.cx, y: slot.cy, rotation: 0, size: d.h };
  }
  return poses;
}

/** Smallest share of any object's bounds left uncovered by the objects stacked above it. */
function minUncoveredShare(dims: readonly Dim[], boxes: readonly Box[], stacking: readonly number[] | null): number {
  const order = zOrder(dims, boxes, stacking);
  let min = 1;
  order.forEach((index, at) => {
    const above = order.slice(at + 1).map((i) => boxes[i] as Box);
    min = Math.min(min, uncoveredFraction(boxes[index] as Box, above, 16));
  });
  return min;
}

function evaluate(
  arrangement: Arrangement,
  dims: readonly Dim[],
  items: readonly ComposeItem[],
  zone: Box,
  stacking: readonly number[] | null,
  occlusion: boolean,
): Candidate {
  const unit = unitPoses(arrangement, dims);
  const boxes = unit.map((pose, i) => layerBounds(pose, (items[i] as ComposeItem).meta));
  const union = unionBox(boxes);
  const scale = Math.min(zone.width / union.width, zone.height / union.height);
  const minUncovered = occlusion ? minUncoveredShare(dims, boxes, stacking) : 1;
  let shared = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) shared += overlapOf(boxes[i] as Box, boxes[j] as Box);
  }
  const total = boxes.reduce((sum, b) => sum + b.width * b.height, 0);
  return { arrangement, scale, union, unit, minUncovered, pile: total > 0 ? shared / total : 0 };
}

function overlapOf(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function preference(arrangement: Arrangement, zone: Box, _count: number): number {
  const aspect = zone.width / zone.height;
  let bonus = 1;
  if (arrangement.kind === 'floor') bonus *= FLOOR_BONUS;
  if (arrangement.kind === 'surface') bonus *= SURFACE_BONUS;
  if (arrangement.kind === 'row' && aspect >= 1.2) bonus *= SHAPE_BONUS;
  if (arrangement.kind === 'column' && aspect <= 0.9) bonus *= SHAPE_BONUS;
  return bonus;
}

function candidateScore(c: Candidate, zone: Box, count: number, cap: number): number {
  const legibility = Math.min(1, c.minUncovered / MIN_UNCOVERED) ** OCCLUSION_POWER;
  // Objects piled on one another read as a heap; only «resting on a flat object» is meant to overlap.
  const tidiness = c.arrangement.kind === 'surface' ? 1 : (1 - Math.min(c.pile, 0.9)) ** PILE_POWER;
  // Above the native cap a bigger fit buys nothing: the scene is drawn at the cap anyway.
  return Math.min(c.scale, cap) * preference(c.arrangement, zone, count) * legibility * tidiness;
}

function pickCandidate(candidates: readonly Candidate[], zone: Box, count: number, cap: number): Candidate {
  let best = candidates[0] as Candidate;
  let bestScore = candidateScore(best, zone, count, cap);
  for (const c of candidates) {
    const score = candidateScore(c, zone, count, cap);
    if (score > bestScore + 1e-9) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** Painted area, largest first (back to front); equal areas keep later items behind. */
function byAreaDescending(dims: readonly Dim[]): number[] {
  return dims
    .map((d) => d.index)
    .sort((a, b) => {
      const da = dims[a] as Dim;
      const db = dims[b] as Dim;
      return db.w * db.h - da.w * da.h || b - a;
    });
}

/** Big sets: area order with the hero simply on top (no overlap sampling). */
function denseZOrder(dims: readonly Dim[]): number[] {
  return [...byAreaDescending(dims).filter((i) => i !== 0), 0];
}

/** Preferred stacking if given; otherwise larger painted area behind, smaller in front, the hero lifted until it is not buried. */
function zOrder(dims: readonly Dim[], boxes: readonly Box[], stacking: readonly number[] | null): number[] {
  if (stacking) return [...stacking];
  const order = byAreaDescending(dims);
  let at = order.indexOf(0);
  while (at < order.length - 1) {
    const above = order.slice(at + 1).map((i) => boxes[i] as Box);
    if (uncoveredFraction(boxes[0] as Box, above) >= HERO_FREE) break;
    [order[at], order[at + 1]] = [order[at + 1] as number, order[at] as number];
    at += 1;
  }
  return order;
}

interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Where each object may go. On frame edges the back object may be cropped down to BACK_VISIBLE and the front
 * ones down to FRONT_VISIBLE; the headline side of the art zone is a hard edge for everyone (plus `margin`).
 */
function regionFor(box: Box, back: boolean, zone: Box, artboard: { width: number; height: number }, margin: number): Region {
  const onLeft = zone.x <= 0;
  const onTop = zone.y <= 0;
  const onRight = zone.x + zone.width >= artboard.width;
  const onBottom = zone.y + zone.height >= artboard.height;
  const keep = back ? BACK_VISIBLE : FRONT_VISIBLE;
  const bx = (1 - keep) * box.width;
  const by = (1 - keep) * box.height;
  return {
    x0: onLeft ? zone.x - bx : zone.x + margin,
    y0: onTop ? zone.y - by : zone.y + margin,
    x1: onRight ? zone.x + zone.width + bx : zone.x + zone.width - margin,
    y1: onBottom ? zone.y + zone.height + by : zone.y + zone.height - margin,
  };
}

/** Largest scale a scene may be drawn at (see MAX_NATIVE_SCALE). */
function nativeCapFor(items: readonly ComposeItem[], artboard: { width: number; height: number }): number {
  const detailFactor = (items[0] as ComposeItem).meta.detail === 's' ? 2 : 1;
  return (MAX_NATIVE_SCALE * detailFactor * Math.min(artboard.width, artboard.height)) / REFERENCE_FRAME;
}

/**
 * Scale the arrangement up past «fits the zone» and translate it so every object stays in its region, the
 * group as close to the (optically lifted) zone centre as the regions allow. Shrinks until it fits.
 */
function fitScene(
  best: Candidate,
  items: readonly ComposeItem[],
  backIndex: number,
  zone: Box,
  artboard: { width: number; height: number },
  bleed: number,
): Pose[] {
  const margin = FRONT_MARGIN * Math.min(artboard.width, artboard.height);
  const unitBoxes = best.unit.map((pose, i) => layerBounds(pose, (items[i] as ComposeItem).meta));
  let scale = Math.min(best.scale * bleed, nativeCapFor(items, artboard));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const boxes = unitBoxes.map((b) => ({ x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale }));
    let lx = -Infinity;
    let hx = Infinity;
    let ly = -Infinity;
    let hy = Infinity;
    boxes.forEach((b, i) => {
      const r = regionFor(b, i === backIndex, zone, artboard, margin);
      lx = Math.max(lx, r.x0 - b.x);
      hx = Math.min(hx, r.x1 - (b.x + b.width));
      ly = Math.max(ly, r.y0 - b.y);
      hy = Math.min(hy, r.y1 - (b.y + b.height));
    });
    if (lx <= hx + 1e-9 && ly <= hy + 1e-9) {
      const u = unionBox(boxes);
      const cx = zone.x + zone.width / 2 - (u.x + u.width / 2);
      const cy = zone.y + zone.height / 2 - OPTICAL_LIFT * zone.height - (u.y + u.height / 2);
      const tx = Math.min(hx, Math.max(lx, cx));
      const ty = Math.min(hy, Math.max(ly, cy));
      return best.unit.map((p) => ({ x: tx + scale * p.x, y: ty + scale * p.y, rotation: 0, size: scale * p.size }));
    }
    scale *= SHRINK;
  }
  // Degenerate input (an object larger than the zone at any sensible scale): centre what we have.
  const u = unionBox(unitBoxes.map((b) => ({ x: b.x * scale, y: b.y * scale, width: b.width * scale, height: b.height * scale })));
  const tx = zone.x + zone.width / 2 - (u.x + u.width / 2);
  const ty = zone.y + zone.height / 2 - (u.y + u.height / 2);
  return best.unit.map((p) => ({ x: tx + scale * p.x, y: ty + scale * p.y, rotation: 0, size: scale * p.size }));
}

/**
 * Deterministic composition modelled on the reference sheets: upright objects (rotation would break the
 * isometric grid), one common scale (library proportions kept), built on the diagonal, large enough that the
 * frame crops the back object, background objects tucked into free frame corners behind the scene.
 */
export function compose(input: ComposeInput, options: ComposeOptions = {}): ComposeResult {
  const { items, backgrounds, artboard, mode } = input;
  const zones = getZones(artboard, mode);
  if (items.length === 0) return { ...zones, layers: [] };

  const zone = zones.artZone;
  const metas = items.map((it) => it.meta);
  const dims = makeDims(metas, metas.map(() => 0));
  const stacking = normalizeStacking(options.stacking, items.length);
  const dense = items.length > EXHAUSTIVE_MAX_ITEMS;
  const allowColumn = zone.width / zone.height <= 1;

  const arrangements = dense ? denseArrangements(dims) : candidateArrangements(dims, allowColumn);
  if (!dense) {
    const surface = items.findIndex((it) => SURFACES.has(it.motif));
    const resting = surface >= 0 ? onSurface(dims, surface) : null;
    if (resting) arrangements.push(resting);
    for (const mirror of [false, true]) {
      const floor = floorArrangement(dims, mirror);
      if (floor) arrangements.push(floor);
    }
  }
  const candidates = arrangements.map((arrangement) => evaluate(arrangement, dims, items, zone, stacking, !dense));
  const best = pickCandidate(candidates, zone, items.length, nativeCapFor(items, artboard));

  const backIndex = items.length === 1 ? 0 : (byAreaDescending(dims)[0] as number);
  const backIsSurface = SURFACES.has((items[backIndex] as ComposeItem).motif);
  const bleed = dense ? 1 : items.length === 1 ? BLEED.single : backIsSurface ? BLEED.surface : BLEED.group;
  const poses = fitScene(best, items, backIndex, zone, artboard, bleed);

  const boxes = poses.map((pose, i) => layerBounds(pose, (items[i] as ComposeItem).meta));
  const order = stacking ?? (dense ? denseZOrder(dims) : zOrder(dims, boxes, null));
  const objects: PlacedLayer[] = order.map((i) => {
    const pose = poses[i] as Pose;
    return { motif: (items[i] as ComposeItem).motif, role: 'object', ...pose, rank: i };
  });

  // Common scale of the scene: rendered size per source unit of height (identical for every object).
  const first = items[0] as ComposeItem;
  const scale = (poses[0] as Pose).size / Math.max(first.meta.bounds.height, 1e-9);
  const avoid = mode === 'title' ? zones.headlineZone : null;
  const taken = new Set<string>();
  const scenery: PlacedLayer[] = [];
  const limit = options.sceneryLimit ?? backgrounds.length;
  backgrounds.forEach((bg, rank) => {
    if (scenery.length >= limit) return;
    const placed = placeScenery(bg.meta, scale, boxes, artboard, avoid, taken);
    if (!placed) return;
    taken.add(placed.corner);
    scenery.push({ motif: bg.motif, role: 'background', x: placed.x, y: placed.y, rotation: 0, size: placed.size, rank });
  });

  return { ...zones, layers: [...scenery, ...objects] };
}
