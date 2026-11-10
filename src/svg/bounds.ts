/**
 * Painted-geometry bounds of a (sanitised) SVG tree.
 * Reads presentation values from attributes only — run `sanitizeSvg` first so that `style` is folded in.
 */
import type { Box } from '../domain/types.ts';
import { parseColor } from './colors.ts';
import {
  IDENTITY,
  boxFromPoints,
  ellipseBounds,
  expandBox,
  intersectBox,
  multiply,
  parsePathData,
  parseTransform,
  segmentsBounds,
  transformBox,
  translateMatrix,
  unionBox,
  type Matrix,
} from './geometry.ts';
import { getAttr, type XmlElement } from './xml.ts';

/* ------------------------------------------------------------------ */
/* Lengths and viewBox                                                 */
/* ------------------------------------------------------------------ */

const UNIT_TO_PX: Record<string, number> = { '': 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };

/** Parses `12`, `1.5e2px`, `10%` (relative to `reference`). Returns null when it is not a length. */
export function parseLength(value: string | undefined, reference = 0): number | null {
  if (value === undefined) return null;
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  if (unit === '%') return (n * reference) / 100;
  return n * (UNIT_TO_PX[unit] ?? 1);
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(n) ? n : fallback;
}

/** Root viewBox, falling back to width/height. Throws a Russian `Error` when neither is usable. */
export function parseViewBox(root: XmlElement): Box {
  const raw = getAttr(root, 'viewBox');
  if (raw !== undefined) {
    const parts = raw.trim().split(/[\s,]+/).map(Number);
    const [x, y, width, height] = parts;
    if (
      parts.length === 4 &&
      parts.every(Number.isFinite) &&
      width !== undefined &&
      height !== undefined &&
      width > 0 &&
      height > 0
    ) {
      return { x: x ?? 0, y: y ?? 0, width, height };
    }
    throw new Error(`Некорректный viewBox: «${raw}»`);
  }
  const widthAttr = getAttr(root, 'width');
  const heightAttr = getAttr(root, 'height');
  if (widthAttr === undefined || heightAttr === undefined) {
    throw new Error('У SVG нет ни viewBox, ни width и height — размер холста неизвестен');
  }
  const width = widthAttr.includes('%') ? null : parseLength(widthAttr);
  const height = heightAttr.includes('%') ? null : parseLength(heightAttr);
  if (width === null || height === null || width <= 0 || height <= 0) {
    throw new Error(`Некорректные размеры SVG: width=«${widthAttr}», height=«${heightAttr}»`);
  }
  return { x: 0, y: 0, width, height };
}

/** viewBox → viewport mapping (`preserveAspectRatio`). */
function viewBoxMatrix(vb: Box, width: number, height: number, par: string | undefined): Matrix {
  const parts = (par ?? '').trim().split(/\s+/).filter((p) => p !== '' && p !== 'defer');
  const align = parts[0] ?? 'xMidYMid';
  if (align === 'none') {
    const sx = width / vb.width;
    const sy = height / vb.height;
    return [sx, 0, 0, sy, -vb.x * sx, -vb.y * sy];
  }
  const scale = parts.includes('slice') ? Math.max(width / vb.width, height / vb.height) : Math.min(width / vb.width, height / vb.height);
  const fractionX = align.includes('xMin') ? 0 : align.includes('xMax') ? 1 : 0.5;
  const fractionY = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
  const tx = (width - vb.width * scale) * fractionX - vb.x * scale;
  const ty = (height - vb.height * scale) * fractionY - vb.y * scale;
  return [scale, 0, 0, scale, tx, ty];
}

/* ------------------------------------------------------------------ */
/* Style                                                               */
/* ------------------------------------------------------------------ */

interface PaintStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  visible: boolean;
}

const INITIAL_STYLE: PaintStyle = {
  fill: 'black',
  fillOpacity: 1,
  stroke: 'none',
  strokeOpacity: 1,
  strokeWidth: 1,
  visible: true,
};

function inheritedPaint(el: XmlElement, name: string, parent: string): string {
  const value = getAttr(el, name)?.trim();
  return value === undefined || value === '' || value === 'inherit' ? parent : value;
}

function inheritedNumber(el: XmlElement, name: string, parent: number): number {
  const value = getAttr(el, name);
  if (value === undefined || value.trim() === 'inherit') return parent;
  const n = value.trim().endsWith('%') ? parseNumber(value.trim().slice(0, -1), NaN) / 100 : parseNumber(value, NaN);
  return Number.isFinite(n) ? n : parent;
}

function computeStyle(el: XmlElement, parent: PaintStyle): PaintStyle {
  const visibility = getAttr(el, 'visibility')?.trim();
  const strokeWidth = getAttr(el, 'stroke-width');
  return {
    fill: inheritedPaint(el, 'fill', parent.fill),
    fillOpacity: inheritedNumber(el, 'fill-opacity', parent.fillOpacity),
    stroke: inheritedPaint(el, 'stroke', parent.stroke),
    strokeOpacity: inheritedNumber(el, 'stroke-opacity', parent.strokeOpacity),
    strokeWidth: strokeWidth === undefined ? parent.strokeWidth : (parseLength(strokeWidth) ?? parent.strokeWidth),
    visible: visibility === undefined || visibility === 'inherit' ? parent.visible : visibility === 'visible',
  };
}

function paintVisible(paint: string, opacity: number): boolean {
  const p = paint.trim().toLowerCase();
  if (p === 'none' || p === 'transparent' || opacity <= 0) return false;
  const color = parseColor(p);
  return !(color && color.alpha === 0);
}

/* ------------------------------------------------------------------ */
/* Walk                                                                */
/* ------------------------------------------------------------------ */

const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

interface WalkContext {
  viewBox: Box;
  ids: Map<string, XmlElement>;
  warnings: Set<string>;
  /** Elements currently being expanded through <use> (cycle guard). */
  active: Set<XmlElement>;
}

function collectIds(el: XmlElement, ids: Map<string, XmlElement>): void {
  const id = getAttr(el, 'id');
  if (id !== undefined && !ids.has(id)) ids.set(id, el);
  for (const child of el.children) if (child.kind === 'element') collectIds(child, ids);
}

function referencedId(value: string | undefined): string | null {
  if (!value) return null;
  const m = /url\(\s*['"]?\s*#([^)'"\s]+)/.exec(value);
  return m?.[1] ?? null;
}

function localReference(el: XmlElement): string | null {
  const href = (getAttr(el, 'href') ?? getAttr(el, 'xlink:href'))?.trim();
  return href && href.startsWith('#') && href.length > 1 ? href.slice(1) : null;
}

function elementMatrix(el: XmlElement, parent: Matrix, ctx: WalkContext): Matrix {
  const raw = getAttr(el, 'transform');
  if (raw === undefined) return parent;
  try {
    return multiply(parent, parseTransform(raw));
  } catch {
    ctx.warnings.add(`Не удалось разобрать transform «${raw}» — он проигнорирован`);
    return parent;
  }
}

function lengthAttr(el: XmlElement, name: string, reference: number): number {
  return parseLength(getAttr(el, name), reference) ?? 0;
}

function pointsOf(raw: string | undefined): [number, number][] {
  const numbers = (raw ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i] ?? 0, numbers[i + 1] ?? 0]);
  return points;
}

/** Geometry box of a basic shape in root space, without stroke. Null when the shape has no extent. */
function shapeBox(el: XmlElement, m: Matrix, ctx: WalkContext): Box | null {
  const vb = ctx.viewBox;
  switch (el.name) {
    case 'rect': {
      const width = lengthAttr(el, 'width', vb.width);
      const height = lengthAttr(el, 'height', vb.height);
      if (width <= 0 || height <= 0) return null;
      return transformBox({ x: lengthAttr(el, 'x', vb.width), y: lengthAttr(el, 'y', vb.height), width, height }, m);
    }
    case 'circle': {
      const r = lengthAttr(el, 'r', Math.hypot(vb.width, vb.height) / Math.SQRT2);
      if (r <= 0) return null;
      return ellipseBounds(lengthAttr(el, 'cx', vb.width), lengthAttr(el, 'cy', vb.height), r, r, m);
    }
    case 'ellipse': {
      const rx = lengthAttr(el, 'rx', vb.width);
      const ry = lengthAttr(el, 'ry', vb.height);
      if (rx <= 0 || ry <= 0) return null;
      return ellipseBounds(lengthAttr(el, 'cx', vb.width), lengthAttr(el, 'cy', vb.height), rx, ry, m);
    }
    case 'line': {
      const x1 = lengthAttr(el, 'x1', vb.width);
      const y1 = lengthAttr(el, 'y1', vb.height);
      const x2 = lengthAttr(el, 'x2', vb.width);
      const y2 = lengthAttr(el, 'y2', vb.height);
      return segmentsBounds(
        [
          { type: 'M', x: x1, y: y1 },
          { type: 'L', x: x2, y: y2 },
        ],
        m,
      );
    }
    case 'polyline':
    case 'polygon': {
      const points = pointsOf(getAttr(el, 'points'));
      if (points.length < 2) return null;
      return boxFromPoints(points.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const));
    }
    case 'path': {
      const parsed = parsePathData(getAttr(el, 'd') ?? '');
      if (parsed.error) ctx.warnings.add(`Ошибка в данных пути: ${parsed.error}`);
      return segmentsBounds(parsed.segments, m);
    }
    default:
      return null;
  }
}

function strokeExtent(el: XmlElement, style: PaintStyle, m: Matrix): [number, number] {
  const half = style.strokeWidth / 2;
  if (getAttr(el, 'vector-effect')?.includes('non-scaling-stroke')) return [half, half];
  return [half * Math.hypot(m[0], m[2]), half * Math.hypot(m[1], m[3])];
}

function paintedShapeBox(el: XmlElement, m: Matrix, style: PaintStyle, ctx: WalkContext): Box | null {
  if (!style.visible) return null;
  const fills = el.name !== 'line' && paintVisible(style.fill, style.fillOpacity);
  const strokes = style.strokeWidth > 0 && paintVisible(style.stroke, style.strokeOpacity);
  if (!fills && !strokes) return null;
  const box = shapeBox(el, m, ctx);
  if (!box) return null;
  if (!strokes) return box;
  const [dx, dy] = strokeExtent(el, style, m);
  return expandBox(box, dx, dy);
}

/** Union of clipPath children geometry. `undefined` — no clipping applies (missing / objectBoundingBox). */
function clipBox(id: string, m: Matrix, ctx: WalkContext): Box | null | undefined {
  const clip = ctx.ids.get(id);
  if (!clip || clip.name !== 'clipPath') return undefined;
  if (getAttr(clip, 'clipPathUnits') === 'objectBoundingBox') {
    ctx.warnings.add('clipPath в objectBoundingBox не учитывается при расчёте границ');
    return undefined;
  }
  const clipMatrix = elementMatrix(clip, m, ctx);
  let result: Box | null = null;
  for (const child of clip.children) {
    if (child.kind !== 'element') continue;
    if (getAttr(child, 'display')?.trim() === 'none') continue;
    let target = child;
    let childMatrix = elementMatrix(child, clipMatrix, ctx);
    if (child.name === 'use') {
      const ref = localReference(child);
      const found = ref ? ctx.ids.get(ref) : undefined;
      if (!found || !SHAPES.has(found.name)) continue;
      childMatrix = multiply(childMatrix, translateMatrix(lengthAttr(child, 'x', 0), lengthAttr(child, 'y', 0)));
      childMatrix = elementMatrix(found, childMatrix, ctx);
      target = found;
    }
    if (!SHAPES.has(target.name) || target.name === 'line') continue;
    result = unionBox(result, shapeBox(target, childMatrix, ctx));
  }
  return result;
}

function walkChildren(el: XmlElement, m: Matrix, style: PaintStyle, ctx: WalkContext): Box | null {
  let result: Box | null = null;
  for (const child of el.children) {
    if (child.kind === 'element') result = unionBox(result, walkElement(child, m, style, ctx, false));
  }
  return result;
}

function walkUse(el: XmlElement, m: Matrix, style: PaintStyle, ctx: WalkContext): Box | null {
  const ref = localReference(el);
  const target = ref ? ctx.ids.get(ref) : undefined;
  if (!target || ctx.active.has(target)) return null;
  const useMatrix = multiply(m, translateMatrix(lengthAttr(el, 'x', ctx.viewBox.width), lengthAttr(el, 'y', ctx.viewBox.height)));
  ctx.active.add(target);
  try {
    if (target.name === 'symbol') {
      return walkChildren(target, elementMatrix(target, useMatrix, ctx), computeStyle(target, style), ctx);
    }
    return walkElement(target, useMatrix, style, ctx, true);
  } finally {
    ctx.active.delete(target);
  }
}

function walkNestedSvg(el: XmlElement, m: Matrix, style: PaintStyle, ctx: WalkContext): Box | null {
  const x = lengthAttr(el, 'x', ctx.viewBox.width);
  const y = lengthAttr(el, 'y', ctx.viewBox.height);
  const width = parseLength(getAttr(el, 'width'), ctx.viewBox.width) ?? ctx.viewBox.width;
  const height = parseLength(getAttr(el, 'height'), ctx.viewBox.height) ?? ctx.viewBox.height;
  let inner = multiply(m, translateMatrix(x, y));
  const rawViewBox = getAttr(el, 'viewBox');
  if (rawViewBox !== undefined) {
    try {
      const vb = parseViewBox(el);
      inner = multiply(inner, viewBoxMatrix(vb, width, height, getAttr(el, 'preserveAspectRatio')));
    } catch {
      ctx.warnings.add('Вложенный <svg> с некорректным viewBox учтён без масштабирования');
    }
  }
  const content = walkChildren(el, inner, style, ctx);
  if (getAttr(el, 'overflow')?.trim() === 'visible') return content;
  return intersectBox(content, transformBox({ x, y, width, height }, m));
}

function walkElement(el: XmlElement, parent: Matrix, parentStyle: PaintStyle, ctx: WalkContext, isRoot: boolean): Box | null {
  if (getAttr(el, 'display')?.trim() === 'none') return null;
  if (parseNumber(getAttr(el, 'opacity'), 1) <= 0) return null;

  const m = elementMatrix(el, parent, ctx);
  const style = computeStyle(el, parentStyle);
  let box: Box | null;

  if (el.name === 'g') box = walkChildren(el, m, style, ctx);
  else if (el.name === 'svg') box = isRoot ? walkChildren(el, m, style, ctx) : walkNestedSvg(el, m, style, ctx);
  else if (el.name === 'use') box = walkUse(el, m, style, ctx);
  else if (SHAPES.has(el.name)) box = paintedShapeBox(el, m, style, ctx);
  else if (el.name === 'text') {
    ctx.warnings.add('Текст не учитывается в границах: размер глифов без шрифта неизвестен');
    return null;
  } else return null; // defs, clipPath, mask, symbol, pattern, gradients, filters…

  const clipId = referencedId(getAttr(el, 'clip-path'));
  if (clipId && box) {
    const clip = clipBox(clipId, m, ctx);
    if (clip !== undefined) box = intersectBox(box, clip);
  }
  return box;
}

export interface PaintedBounds {
  /** Painted geometry clipped to the viewBox (the viewBox itself when nothing is painted). */
  bounds: Box;
  /** Painted geometry before the final viewBox clip, or null when nothing is painted. */
  unclipped: Box | null;
  warnings: string[];
}

export function paintedBounds(root: XmlElement): PaintedBounds {
  const viewBox = parseViewBox(root);
  const ids = new Map<string, XmlElement>();
  collectIds(root, ids);
  const ctx: WalkContext = { viewBox, ids, warnings: new Set(), active: new Set() };

  const unclipped = walkElement(root, IDENTITY, INITIAL_STYLE, ctx, true);
  const clipped = intersectBox(unclipped, viewBox);
  const warnings = [...ctx.warnings];
  if (!clipped) {
    warnings.push('Видимой геометрии не найдено — границы взяты по viewBox');
    return { bounds: viewBox, unclipped: null, warnings };
  }
  return { bounds: clipped, unclipped, warnings };
}
