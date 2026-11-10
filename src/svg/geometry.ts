/** Affine geometry and exact path bounds. Pure TS. */
import type { Box } from '../domain/types.ts';

/** [a, b, c, d, e, f] — maps (x, y) to (a·x + c·y + e, b·x + d·y + f), as in SVG `matrix()`. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `multiply(m1, m2)` applies `m2` first, then `m1` (same as chaining `m1 m2` in a transform list). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function translateMatrix(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty];
}

export function scaleMatrix(sx: number, sy: number = sx): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

export function applyToPoint(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const NUMBER = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const TRANSFORM_ITEM = /\s*,?\s*([a-zA-Z]+)\s*\(([^)]*)\)/y;
const NUMBER_RE = new RegExp(NUMBER, 'g');

function numbersIn(args: string, fn: string): number[] {
  const rest = args.replace(NUMBER_RE, '').replace(/[\s,]/g, '');
  if (rest !== '') throw new Error(`Некорректные аргументы transform: ${fn}(${args})`);
  return (args.match(NUMBER_RE) ?? []).map(Number);
}

function transformFunction(fn: string, args: string): Matrix {
  const n = numbersIn(args, fn);
  const need = (...counts: number[]): void => {
    if (!counts.includes(n.length)) throw new Error(`Неверное число аргументов в ${fn}(${args})`);
  };
  const at = (i: number): number => n[i] ?? 0;
  switch (fn) {
    case 'matrix':
      need(6);
      return [at(0), at(1), at(2), at(3), at(4), at(5)];
    case 'translate':
      need(1, 2);
      return translateMatrix(at(0), n.length > 1 ? at(1) : 0);
    case 'scale':
      need(1, 2);
      return scaleMatrix(at(0), n.length > 1 ? at(1) : at(0));
    case 'rotate': {
      need(1, 3);
      const rad = (at(0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
      if (n.length === 1) return rotation;
      return multiply(translateMatrix(at(1), at(2)), multiply(rotation, translateMatrix(-at(1), -at(2))));
    }
    case 'skewX':
      need(1);
      return [1, 0, Math.tan((at(0) * Math.PI) / 180), 1, 0, 0];
    case 'skewY':
      need(1);
      return [1, Math.tan((at(0) * Math.PI) / 180), 0, 1, 0, 0];
    default:
      throw new Error(`Неизвестная функция transform: ${fn}`);
  }
}

/** Parses an SVG transform list. Empty string → identity. Throws `Error` (Russian) on malformed input. */
export function parseTransform(value: string): Matrix {
  const text = value.trim();
  let result: Matrix = IDENTITY;
  let pos = 0;
  while (pos < text.length) {
    TRANSFORM_ITEM.lastIndex = pos;
    const m = TRANSFORM_ITEM.exec(text);
    if (!m) throw new Error(`Некорректный transform: «${value}»`);
    result = multiply(result, transformFunction(m[1] ?? '', m[2] ?? ''));
    pos = TRANSFORM_ITEM.lastIndex;
    if (/^\s*$/.test(text.slice(pos))) break;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Boxes                                                               */
/* ------------------------------------------------------------------ */

export function boxFromPoints(points: readonly (readonly [number, number])[]): Box | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned box of the four transformed corners. */
export function transformBox(box: Box, m: Matrix): Box {
  const { x, y, width, height } = box;
  const corners = [
    applyToPoint(m, x, y),
    applyToPoint(m, x + width, y),
    applyToPoint(m, x, y + height),
    applyToPoint(m, x + width, y + height),
  ];
  return boxFromPoints(corners) as Box;
}

export function unionBox(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Null when the boxes do not overlap (touching edges give a zero-size box). */
export function intersectBox(a: Box | null, b: Box | null): Box | null {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right < x || bottom < y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function expandBox(box: Box, dx: number, dy: number): Box {
  return { x: box.x - dx, y: box.y - dy, width: box.width + 2 * dx, height: box.height + 2 * dy };
}

/* ------------------------------------------------------------------ */
/* Path data                                                           */
/* ------------------------------------------------------------------ */

export type PathSegment =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; rotation: number; large: boolean; sweep: boolean; x: number; y: number }
  | { type: 'Z' };

export interface ParsedPath {
  /** Absolute segments (H/V/S/T are normalised to L/C/Q). */
  segments: PathSegment[];
  /** Russian description of the first syntax error; segments before it are still returned. */
  error: string | null;
}

const PATH_NUMBER = new RegExp(NUMBER, 'y');
const ARGUMENT_COUNT: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

class PathReader {
  pos = 0;
  constructor(readonly d: string) {}

  skipSeparators(): void {
    while (this.pos < this.d.length && /[\s,]/.test(this.d[this.pos] ?? '')) this.pos++;
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.pos >= this.d.length;
  }

  peekCommand(): string | null {
    this.skipSeparators();
    const ch = this.d[this.pos] ?? '';
    return /[a-zA-Z]/.test(ch) ? ch : null;
  }

  readNumber(): number | null {
    this.skipSeparators();
    PATH_NUMBER.lastIndex = this.pos;
    const m = PATH_NUMBER.exec(this.d);
    if (!m) return null;
    this.pos = PATH_NUMBER.lastIndex;
    return Number(m[0]);
  }

  readFlag(): boolean | null {
    this.skipSeparators();
    const ch = this.d[this.pos];
    if (ch !== '0' && ch !== '1') return null;
    this.pos++;
    return ch === '1';
  }
}

function readArguments(reader: PathReader, command: string): number[] | null {
  const args: number[] = [];
  const count = ARGUMENT_COUNT[command.toLowerCase()] ?? 0;
  for (let i = 0; i < count; i++) {
    const isFlag = command.toLowerCase() === 'a' && (i === 3 || i === 4);
    const value = isFlag ? reader.readFlag() : reader.readNumber();
    if (value === null) return null;
    args.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  return args;
}

/** Full SVG path grammar → absolute segments. Stops at the first error (like renderers do). */
export function parsePathData(d: string): ParsedPath {
  const reader = new PathReader(d);
  const segments: PathSegment[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  // Reflection anchors for S/T.
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let command: string | null = null;
  let first = true;

  const fail = (message: string): ParsedPath => ({ segments, error: message });

  while (!reader.atEnd()) {
    const next = reader.peekCommand();
    if (next) {
      reader.pos++;
      command = next;
      if (first && command !== 'M' && command !== 'm') return fail('Путь должен начинаться с команды M');
    } else if (command === null || command === 'z' || command === 'Z') {
      return fail(`Неожиданные данные в пути (позиция ${reader.pos})`);
    }
    first = false;
    const cmd: string = command as string;
    const lower = cmd.toLowerCase();
    if (!(lower in ARGUMENT_COUNT)) return fail(`Неизвестная команда пути «${cmd}»`);
    const rel = cmd === lower;
    if (lower === 'z') {
      segments.push({ type: 'Z' });
      cx = startX;
      cy = startY;
      lastCubic = null;
      lastQuad = null;
      continue;
    }
    const a = readArguments(reader, cmd);
    if (!a) return fail(`Не хватает аргументов команды «${cmd}»`);
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    const g = (i: number): number => a[i] ?? 0;
    let newCubic: [number, number] | null = null;
    let newQuad: [number, number] | null = null;

    switch (lower) {
      case 'm': {
        cx = ox + g(0);
        cy = oy + g(1);
        startX = cx;
        startY = cy;
        segments.push({ type: 'M', x: cx, y: cy });
        // Further coordinate pairs after M are implicit lineto commands.
        command = rel ? 'l' : 'L';
        break;
      }
      case 'l':
        cx = ox + g(0);
        cy = oy + g(1);
        segments.push({ type: 'L', x: cx, y: cy });
        break;
      case 'h':
        cx = rel ? cx + g(0) : g(0);
        segments.push({ type: 'L', x: cx, y: cy });
        break;
      case 'v':
        cy = rel ? cy + g(0) : g(0);
        segments.push({ type: 'L', x: cx, y: cy });
        break;
      case 'c': {
        const [x1, y1, x2, y2] = [ox + g(0), oy + g(1), ox + g(2), oy + g(3)];
        segments.push({ type: 'C', x1, y1, x2, y2, x: ox + g(4), y: oy + g(5) });
        newCubic = [x2, y2];
        cx = ox + g(4);
        cy = oy + g(5);
        break;
      }
      case 's': {
        const x1: number = lastCubic ? 2 * cx - lastCubic[0] : cx;
        const y1: number = lastCubic ? 2 * cy - lastCubic[1] : cy;
        const [x2, y2] = [ox + g(0), oy + g(1)];
        segments.push({ type: 'C', x1, y1, x2, y2, x: ox + g(2), y: oy + g(3) });
        newCubic = [x2, y2];
        cx = ox + g(2);
        cy = oy + g(3);
        break;
      }
      case 'q': {
        const [x1, y1] = [ox + g(0), oy + g(1)];
        segments.push({ type: 'Q', x1, y1, x: ox + g(2), y: oy + g(3) });
        newQuad = [x1, y1];
        cx = ox + g(2);
        cy = oy + g(3);
        break;
      }
      case 't': {
        const x1: number = lastQuad ? 2 * cx - lastQuad[0] : cx;
        const y1: number = lastQuad ? 2 * cy - lastQuad[1] : cy;
        segments.push({ type: 'Q', x1, y1, x: ox + g(0), y: oy + g(1) });
        newQuad = [x1, y1];
        cx = ox + g(0);
        cy = oy + g(1);
        break;
      }
      case 'a':
        segments.push({
          type: 'A',
          rx: Math.abs(g(0)),
          ry: Math.abs(g(1)),
          rotation: g(2),
          large: g(3) === 1,
          sweep: g(4) === 1,
          x: ox + g(5),
          y: oy + g(6),
        });
        cx = ox + g(5);
        cy = oy + g(6);
        break;
    }
    lastCubic = newCubic;
    lastQuad = newQuad;
  }
  return { segments, error: null };
}

/* ------------------------------------------------------------------ */
/* Bézier and arc extrema (after the affine transform)                 */
/* ------------------------------------------------------------------ */

type Point = readonly [number, number];

function quadraticExtrema(p0: number, p1: number, p2: number): number[] {
  const denominator = p0 - 2 * p1 + p2;
  if (Math.abs(denominator) < 1e-12) return [];
  const t = (p0 - p1) / denominator;
  return t > 0 && t < 1 ? [t] : [];
}

function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const d0 = p1 - p0;
  const d1 = p2 - p1;
  const d2 = p3 - p2;
  const a = d0 - 2 * d1 + d2;
  const b = 2 * (d1 - d0);
  const c = d0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sqrt = Math.sqrt(disc);
      roots.push((-b + sqrt) / (2 * a), (-b - sqrt) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function quadraticAt(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

interface ArcCentre {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  phi: number;
  theta1: number;
  delta: number;
}

/** SVG implementation notes F.6.5: endpoint → centre parameterisation (null for degenerate arcs). */
function arcCentre(from: Point, seg: Extract<PathSegment, { type: 'A' }>): ArcCentre | null {
  const [x1, y1] = from;
  const { x: x2, y: y2 } = seg;
  let { rx, ry } = seg;
  if (rx === 0 || ry === 0) return null;
  if (x1 === x2 && y1 === y2) return null;
  const phi = (seg.rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const numerator = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const denominator = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const sign = seg.large === seg.sweep ? -1 : 1;
  const coefficient = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(0, numerator / denominator));
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const theta1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const theta2 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
  let delta = theta2 - theta1;
  if (!seg.sweep && delta > 0) delta -= 2 * Math.PI;
  else if (seg.sweep && delta < 0) delta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta1, delta };
}

const TWO_PI = 2 * Math.PI;

function angleInSweep(theta: number, theta1: number, delta: number): boolean {
  const forward = delta >= 0;
  const offset = forward ? theta - theta1 : theta1 - theta;
  const wrapped = ((offset % TWO_PI) + TWO_PI) % TWO_PI;
  return wrapped <= Math.abs(delta);
}

/**
 * Points of an arc that bound it after the affine map `m`. The image of an elliptical arc is an
 * elliptical arc c' + A·cosθ + B·sinθ, so the extrema are at θ = atan2(Bk, Ak) (+π) — exact.
 */
function arcExtremePoints(arc: ArcCentre, m: Matrix): [number, number][] {
  const cosPhi = Math.cos(arc.phi);
  const sinPhi = Math.sin(arc.phi);
  // Linear part of m applied to the ellipse axes.
  const ux = arc.rx * cosPhi;
  const uy = arc.rx * sinPhi;
  const vx = -arc.ry * sinPhi;
  const vy = arc.ry * cosPhi;
  const ax = m[0] * ux + m[2] * uy;
  const ay = m[1] * ux + m[3] * uy;
  const bx = m[0] * vx + m[2] * vy;
  const by = m[1] * vx + m[3] * vy;
  const [centreX, centreY] = applyToPoint(m, arc.cx, arc.cy);
  const candidates = [Math.atan2(bx, ax), Math.atan2(by, ay)];
  const points: [number, number][] = [];
  for (const base of candidates) {
    for (const theta of [base, base + Math.PI]) {
      if (!angleInSweep(theta, arc.theta1, arc.delta)) continue;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      points.push([centreX + ax * cos + bx * sin, centreY + ay * cos + by * sin]);
    }
  }
  return points;
}

/** Tight bounds of parsed segments under `matrix` (control points are transformed first). */
export function segmentsBounds(segments: readonly PathSegment[], matrix: Matrix = IDENTITY): Box | null {
  const points: [number, number][] = [];
  const add = (x: number, y: number): void => {
    points.push(applyToPoint(matrix, x, y));
  };
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  let pendingMove = false;

  const beginDrawing = (): void => {
    if (pendingMove) {
      add(current[0], current[1]);
      pendingMove = false;
    }
  };

  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        current = [seg.x, seg.y];
        start = current;
        pendingMove = true;
        break;
      case 'Z':
        current = start;
        break;
      case 'L':
        beginDrawing();
        add(seg.x, seg.y);
        current = [seg.x, seg.y];
        break;
      case 'C': {
        beginDrawing();
        const [p0x, p0y] = applyToPoint(matrix, current[0], current[1]);
        const [p1x, p1y] = applyToPoint(matrix, seg.x1, seg.y1);
        const [p2x, p2y] = applyToPoint(matrix, seg.x2, seg.y2);
        const [p3x, p3y] = applyToPoint(matrix, seg.x, seg.y);
        points.push([p3x, p3y]);
        for (const t of cubicExtrema(p0x, p1x, p2x, p3x)) points.push([cubicAt(p0x, p1x, p2x, p3x, t), cubicAt(p0y, p1y, p2y, p3y, t)]);
        for (const t of cubicExtrema(p0y, p1y, p2y, p3y)) points.push([cubicAt(p0x, p1x, p2x, p3x, t), cubicAt(p0y, p1y, p2y, p3y, t)]);
        current = [seg.x, seg.y];
        break;
      }
      case 'Q': {
        beginDrawing();
        const [p0x, p0y] = applyToPoint(matrix, current[0], current[1]);
        const [p1x, p1y] = applyToPoint(matrix, seg.x1, seg.y1);
        const [p2x, p2y] = applyToPoint(matrix, seg.x, seg.y);
        points.push([p2x, p2y]);
        for (const t of quadraticExtrema(p0x, p1x, p2x)) points.push([quadraticAt(p0x, p1x, p2x, t), quadraticAt(p0y, p1y, p2y, t)]);
        for (const t of quadraticExtrema(p0y, p1y, p2y)) points.push([quadraticAt(p0x, p1x, p2x, t), quadraticAt(p0y, p1y, p2y, t)]);
        current = [seg.x, seg.y];
        break;
      }
      case 'A': {
        beginDrawing();
        add(seg.x, seg.y);
        const arc = arcCentre(current, seg);
        if (arc) points.push(...arcExtremePoints(arc, matrix));
        current = [seg.x, seg.y];
        break;
      }
    }
  }
  return boxFromPoints(points);
}

/** Tight bounds of path data `d` under `matrix` (null when the path draws nothing). */
export function pathBounds(d: string, matrix: Matrix = IDENTITY): Box | null {
  return segmentsBounds(parsePathData(d).segments, matrix);
}

/** Bounds of an axis-aligned ellipse (circle) under `matrix` — exact. */
export function ellipseBounds(cx: number, cy: number, rx: number, ry: number, matrix: Matrix = IDENTITY): Box {
  const [x, y] = applyToPoint(matrix, cx, cy);
  const hx = Math.hypot(matrix[0] * rx, matrix[2] * ry);
  const hy = Math.hypot(matrix[1] * rx, matrix[3] * ry);
  return { x: x - hx, y: y - hy, width: 2 * hx, height: 2 * hy };
}
