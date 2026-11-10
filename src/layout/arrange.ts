import type { AssetFileMeta } from '../domain/types';
import { rotatedExtent } from './geometry';

/** Neighbours overlap by this share of the narrower width. */
const OVERLAP = 0.1;
/** Items shorter than this share of the tallest step forward. */
const SHORT_RATIO = 0.4;
/** Forward step as a share of the tallest height. */
const STEP_FORWARD = 0.05;
/**
 * Lift of tiers as a share of the item's own height, back tier first. Several variants per tier
 * count: higher lifts trade scale for less occlusion, and compose() scores both.
 */
const TIER_LIFT_VARIANTS: Record<2 | 3, readonly (readonly number[])[]> = {
  2: [
    [0.35, 0],
    [0.55, 0],
    [0.75, 0],
  ],
  3: [
    [0.4, 0.22, 0],
    [0.62, 0.34, 0],
  ],
};
/** Horizontal stagger of the column as a share of the widest item. */
const COLUMN_STAGGER = 0.12;

/** Unit-scale (source units) size of one object including its tilt. */
export interface Dim {
  index: number;
  w: number;
  h: number;
  rotation: number;
  /** Extent of the rotated bounds. */
  aw: number;
  ah: number;
}

/** Centre of an object in the arrangement's own coordinates (y grows down, baseline y = 0). */
export interface Slot {
  index: number;
  cx: number;
  cy: number;
}

export interface Arrangement {
  kind: 'row' | 'tiers' | 'column' | 'surface' | 'floor';
  tiers: number;
  slots: Slot[];
}

export function makeDims(metas: readonly AssetFileMeta[], rotations: readonly number[]): Dim[] {
  return metas.map((meta, index) => {
    const w = Math.max(meta.bounds.width, 1e-6);
    const h = Math.max(meta.bounds.height, 1e-6);
    const rotation = rotations[index] ?? 0;
    const ext = rotatedExtent(w, h, rotation);
    return { index, w, h, rotation, aw: ext.width, ah: ext.height };
  });
}

/** Ground-line order «…3, 1, 0, 2, 4…»: hero in the middle, odd ranks left, even ranks right. */
export function groundOrder(count: number): number[] {
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 1; i < count; i += 1) (i % 2 === 1 ? left : right).push(i);
  return [...left.reverse(), 0, ...right].filter((i) => i < count);
}

function packRow(order: readonly Dim[], bottomOf: (d: Dim) => number): Slot[] {
  const lefts: number[] = [];
  let cursor = 0;
  order.forEach((d, i) => {
    const prev = order[i - 1];
    if (prev) cursor -= OVERLAP * Math.min(prev.aw, d.aw);
    lefts.push(cursor);
    cursor += d.aw;
  });
  const shift = -cursor / 2;
  return order.map((d, i) => ({
    index: d.index,
    cx: (lefts[i] ?? 0) + shift + d.aw / 2,
    cy: bottomOf(d) - d.ah / 2,
  }));
}

function singleRow(dims: readonly Dim[], order: readonly number[]): Arrangement {
  const maxH = Math.max(...dims.map((d) => d.h));
  const drop = (d: Dim): number => (d.h < SHORT_RATIO * maxH ? STEP_FORWARD * maxH : 0);
  const ordered = order.map((i) => dims[i]).filter((d): d is Dim => d !== undefined);
  return { kind: 'row', tiers: 1, slots: packRow(ordered, drop) };
}

/** `groups` hold dim indices, back tier first. */
function tiered(
  dims: readonly Dim[],
  order: readonly number[],
  groups: readonly number[][],
  lifts: readonly number[],
): Arrangement {
  const maxH = Math.max(...dims.map((d) => d.h));
  const slots: Slot[] = [];
  groups.forEach((members, tier) => {
    const set = new Set(members);
    const lift = lifts[tier] ?? 0;
    const front = tier === groups.length - 1;
    const ordered = order.filter((i) => set.has(i)).map((i) => dims[i]).filter((d): d is Dim => d !== undefined);
    const bottomOf = (d: Dim): number => -lift * d.h + (front && d.h < SHORT_RATIO * maxH ? STEP_FORWARD * maxH : 0);
    slots.push(...packRow(ordered, bottomOf));
  });
  return { kind: 'tiers', tiers: groups.length, slots };
}

function column(dims: readonly Dim[], order: readonly number[]): Arrangement {
  const ordered = order.map((i) => dims[i]).filter((d): d is Dim => d !== undefined);
  const stagger = COLUMN_STAGGER * Math.max(...ordered.map((d) => d.aw));
  const tops: number[] = [];
  let cursor = 0;
  ordered.forEach((d, i) => {
    const prev = ordered[i - 1];
    if (prev) cursor -= OVERLAP * Math.min(prev.ah, d.ah);
    tops.push(cursor);
    cursor += d.ah;
  });
  const slots = ordered.map((d, i) => ({
    index: d.index,
    cx: (i % 2 === 0 ? -1 : 1) * stagger,
    cy: (tops[i] ?? 0) - cursor / 2 + d.ah / 2,
  }));
  return { kind: 'column', tiers: 1, slots };
}

/** Put the smaller object in front, offset to the left of the larger one. */
function diagonalPair(a: Dim, b: Dim): Arrangement {
  const [back, front] = a.aw * a.ah >= b.aw * b.ah ? [a, b] : [b, a];
  return {
    kind: 'tiers',
    tiers: 2,
    slots: [
      { index: back.index, cx: 0, cy: 0 },
      { index: front.index, cx: -0.34 * back.aw, cy: (back.ah + front.ah) / 2 - 0.22 * front.ah },
    ],
  };
}

/** Back-to-front groups after sorting by painted area (largest first), for each cut of `tiers` groups. */
function tierGroups(dims: readonly Dim[], tiers: 2 | 3): number[][][] {
  const byArea = dims
    .map((d) => d.index)
    .sort((a, b) => {
      const da = dims[a];
      const db = dims[b];
      return (db ? db.w * db.h : 0) - (da ? da.w * da.h : 0) || a - b;
    });
  const n = byArea.length;
  const result: number[][][] = [];
  if (tiers === 2) {
    for (let k = 1; k < n; k += 1) result.push([byArea.slice(0, k), byArea.slice(k)]);
  } else {
    for (let k1 = 1; k1 < n - 1; k1 += 1) {
      for (let k2 = k1 + 1; k2 < n; k2 += 1) {
        result.push([byArea.slice(0, k1), byArea.slice(k1, k2), byArea.slice(k2)]);
      }
    }
  }
  return result;
}

/** Lift between neighbouring tiers of a dense arrangement, as a share of the item's own height. */
const DENSE_TIER_STEP = 0.7;

/**
 * Compact family for big collections: equal-count tiers (largest drawings at the back), one arrangement per
 * tier count up to ~3·√n. `candidateArrangements` grows with n³ (three-tier cuts), this one with n·√n.
 */
export function denseArrangements(dims: readonly Dim[]): Arrangement[] {
  const n = dims.length;
  const order = groundOrder(n);
  const byArea = dims
    .map((d) => d.index)
    .sort((a, b) => {
      const da = dims[a] as Dim;
      const db = dims[b] as Dim;
      return db.w * db.h - da.w * da.h || a - b;
    });
  const result: Arrangement[] = [singleRow(dims, order)];
  const maxTiers = Math.min(n, Math.ceil(3 * Math.sqrt(n)));
  for (let tiers = 2; tiers <= maxTiers; tiers += 1) {
    const groups: number[][] = [];
    const lifts: number[] = [];
    for (let t = 0; t < tiers; t += 1) {
      groups.push(byArea.slice(Math.floor((t * n) / tiers), Math.floor(((t + 1) * n) / tiers)));
      lifts.push((tiers - 1 - t) * DENSE_TIER_STEP);
    }
    result.push(tiered(dims, order, groups, lifts));
  }
  return result;
}

/**
 * Smaller objects resting on a flat one (puzzle on a book, phone on a book), spread along the isometric
 * diagonal over its middle. `surface` is the index of the flat object.
 */
export function onSurface(dims: readonly Dim[], surface: number): Arrangement | null {
  const base = dims[surface];
  // The references rest exactly one small object on a flat one (phone on a book, puzzle on a book).
  if (!base || dims.length !== 2) return null;
  const others = dims.filter((d) => d.index !== surface);
  // Only objects clearly smaller than the surface can lie on it.
  if (others.some((d) => d.aw > 0.75 * base.aw || d.ah > 0.9 * base.ah)) return null;
  // …and small enough to lie on it without hanging off: a phone or a puzzle on a book, not headphones.
  if (others.some((d) => d.aw * d.ah > MAX_RESTING_SHARE * base.aw * base.ah)) return null;
  const spots: readonly (readonly [number, number])[] =
    others.length === 1 ? [[-0.08, -0.06]] : [[-0.2, -0.12], [0.16, 0.1]];
  const slots: Slot[] = [{ index: surface, cx: 0, cy: 0 }];
  others.forEach((d, i) => {
    const [fx, fy] = spots[i] as readonly [number, number];
    slots.push({ index: d.index, cx: fx * base.aw, cy: fy * base.ah });
  });
  return { kind: 'surface', tiers: 2, slots };
}

/** An object resting on a surface covers at most this share of its bounding box. */
const MAX_RESTING_SHARE = 0.33;

/** Screen directions of the isometric floor axes (30° below the horizontal). */
const DOWN_LEFT = { x: -Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
const DOWN_RIGHT = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
/** Neighbours on the floor may share this much of the smaller bounding box (isometric corners are empty). */
const FLOOR_OVERLAP = 0.06;
/** Gap between neighbours on the floor, as a share of the larger of the two heights. */
const FLOOR_GAP = 0.08;

function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const w = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const h = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Objects standing apart on one floor, like the reference still lifes: the largest at the back, the others
 * stepping towards the viewer along the isometric axes — down-left, then down-right, alternating — each just
 * clear of what is already there plus a small gap. `mirror` starts down-right instead.
 */
export function floorArrangement(dims: readonly Dim[], mirror = false): Arrangement | null {
  if (dims.length < 2 || dims.length > 4) return null;
  const order = dims
    .map((d) => d.index)
    .sort((a, b) => {
      const da = dims[a] as Dim;
      const db = dims[b] as Dim;
      return db.aw * db.ah - da.aw * da.ah || a - b;
    });
  const placed: { index: number; x: number; y: number; w: number; h: number }[] = [];
  order.forEach((index, k) => {
    const d = dims[index] as Dim;
    if (k === 0) {
      placed.push({ index, x: 0, y: 0, w: d.aw, h: d.ah });
      return;
    }
    const from = placed[k - 1] as (typeof placed)[number];
    const dir = (k % 2 === 1) !== mirror ? DOWN_LEFT : DOWN_RIGHT;
    const step = 0.02 * Math.max(d.aw, d.ah, from.w, from.h);
    let t = 0;
    const clash = (x: number, y: number): boolean =>
      placed.some((p) => overlapArea({ x, y, w: d.aw, h: d.ah }, p) > FLOOR_OVERLAP * Math.min(d.aw * d.ah, p.w * p.h));
    while (clash(from.x + dir.x * t, from.y + dir.y * t) && t < 200 * step) t += step;
    t += FLOOR_GAP * Math.max(d.ah, from.h);
    placed.push({ index, x: from.x + dir.x * t, y: from.y + dir.y * t, w: d.aw, h: d.ah });
  });
  return { kind: 'floor', tiers: 1, slots: placed.map((p) => ({ index: p.index, cx: p.x, cy: p.y })) };
}

/** All candidate arrangements; `allowColumn` adds the staggered column for tall zones. */
export function candidateArrangements(dims: readonly Dim[], allowColumn: boolean): Arrangement[] {
  const order = groundOrder(dims.length);
  const result: Arrangement[] = [singleRow(dims, order)];
  if (dims.length < 2) return result;
  const [first, second] = dims;
  if (dims.length === 2 && first && second) result.push(diagonalPair(first, second));
  for (const groups of tierGroups(dims, 2)) {
    for (const lifts of TIER_LIFT_VARIANTS[2]) result.push(tiered(dims, order, groups, lifts));
  }
  if (dims.length >= 5) {
    for (const groups of tierGroups(dims, 3)) {
      for (const lifts of TIER_LIFT_VARIANTS[3]) result.push(tiered(dims, order, groups, lifts));
    }
  }
  if (allowColumn) result.push(column(dims, order));
  return result;
}
