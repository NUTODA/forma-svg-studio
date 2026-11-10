import type { AssetFileMeta, Box, Layer, PlacedLayer, Size } from '../domain/types';

export interface Extent {
  width: number;
  height: number;
}

/** Axis-aligned extent of a `width × height` rectangle rotated by `degrees` around its centre. */
export function rotatedExtent(width: number, height: number, degrees: number): Extent {
  const rad = (degrees * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return { width: width * c + height * s, height: width * s + height * c };
}

/** Width of the painted bounds for a given rendered height. */
export function renderedWidth(size: number, meta: AssetFileMeta): number {
  return (size * meta.bounds.width) / Math.max(meta.bounds.height, 1e-9);
}

/** Axis-aligned bounds (artboard units) of a placed layer's painted geometry, rotation included. */
export function layerBounds(layer: Pick<Layer | PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>, meta: AssetFileMeta): Box {
  const ext = rotatedExtent(renderedWidth(layer.size, meta), layer.size, layer.rotation);
  return { x: layer.x - ext.width / 2, y: layer.y - ext.height / 2, width: ext.width, height: ext.height };
}

/** Strict overlap (touching edges do not count). */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function boxRight(b: Box): number {
  return b.x + b.width;
}

export function boxBottom(b: Box): number {
  return b.y + b.height;
}

export function unionBox(boxes: readonly Box[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, boxRight(b));
    y1 = Math.max(y1, boxBottom(b));
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Per-axis shares (0..1) of `box` that lie inside the artboard. */
export function visibleAxes(box: Box, artboard: Size): { vx: number; vy: number } {
  if (box.width <= 0 || box.height <= 0) return { vx: 0, vy: 0 };
  return {
    vx: overlap1d(box.x, boxRight(box), 0, artboard.width) / box.width,
    vy: overlap1d(box.y, boxBottom(box), 0, artboard.height) / box.height,
  };
}

/** Share of `box` (0..1) that lies inside the artboard. */
export function visibleFraction(box: Box, artboard: Size): number {
  const { vx, vy } = visibleAxes(box, artboard);
  return vx * vy;
}

/** Share of `target` (0..1) not covered by any of `covers`, estimated on a regular sample grid. */
export function uncoveredFraction(target: Box, covers: readonly Box[], grid = 24): number {
  if (covers.length === 0) return 1;
  let free = 0;
  for (let i = 0; i < grid; i += 1) {
    const px = target.x + ((i + 0.5) / grid) * target.width;
    for (let j = 0; j < grid; j += 1) {
      const py = target.y + ((j + 0.5) / grid) * target.height;
      const covered = covers.some((c) => px >= c.x && px <= boxRight(c) && py >= c.y && py <= boxBottom(c));
      if (!covered) free += 1;
    }
  }
  return free / (grid * grid);
}
