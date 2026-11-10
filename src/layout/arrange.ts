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
  kind: 'row' | 'tiers' | 'column';
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
