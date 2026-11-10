import { describe, expect, it } from 'vitest';
import type { Box } from '../domain/types';
import {
  applyToPoint,
  intersectBox,
  multiply,
  parsePathData,
  parseTransform,
  pathBounds,
  transformBox,
  unionBox,
  type Matrix,
} from './geometry';

function expectBox(box: Box | null, expected: [number, number, number, number], digits = 6): void {
  if (!box) throw new Error('expected a box, got null');
  expect(box.x).toBeCloseTo(expected[0], digits);
  expect(box.y).toBeCloseTo(expected[1], digits);
  expect(box.width).toBeCloseTo(expected[2], digits);
  expect(box.height).toBeCloseTo(expected[3], digits);
}

function expectPoint(point: [number, number], x: number, y: number): void {
  expect(point[0]).toBeCloseTo(x, 9);
  expect(point[1]).toBeCloseTo(y, 9);
}

describe('parseTransform', () => {
  it('parses each function', () => {
    expect(parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    expect(parseTransform('translate(5)')).toEqual([1, 0, 0, 1, 5, 0]);
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(parseTransform('scale(2, 3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(parseTransform('matrix(1,2,3,4,5,6)')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseTransform('')).toEqual([1, 0, 0, 1, 0, 0]);
    const skewX = parseTransform('skewX(45)');
    expect(skewX[2]).toBeCloseTo(1, 9);
    const skewY = parseTransform('skewY(45)');
    expect(skewY[1]).toBeCloseTo(1, 9);
  });

  it('chains left to right (rightmost applies first)', () => {
    const m = parseTransform('translate(10,0) scale(2)');
    expectPoint(applyToPoint(m, 1, 1), 12, 2);
    const m2 = parseTransform('scale(2) translate(10,0)');
    expectPoint(applyToPoint(m2, 1, 1), 22, 2);
    expect(parseTransform('translate(1 2),scale(3)')).toEqual(multiply([1, 0, 0, 1, 1, 2], [3, 0, 0, 3, 0, 0]));
  });

  it('rotates about a point', () => {
    const m = parseTransform('rotate(90 10 10)');
    expectPoint(applyToPoint(m, 20, 10), 10, 20);
    expectPoint(applyToPoint(m, 10, 10), 10, 10);
    expectPoint(applyToPoint(parseTransform('rotate(90)'), 1, 0), 0, 1);
  });

  it('throws on malformed input', () => {
    expect(() => parseTransform('translate(')).toThrow();
    expect(() => parseTransform('foo(1)')).toThrow();
    expect(() => parseTransform('matrix(1 2 3)')).toThrow();
    expect(() => parseTransform('translate(1 2) junk')).toThrow();
  });
});

describe('boxes', () => {
  it('transformBox returns the AABB of the rotated corners', () => {
    const rotated = transformBox({ x: 0, y: 0, width: 10, height: 10 }, parseTransform('rotate(45 5 5)'));
    expectBox(rotated, [5 - 5 * Math.SQRT2, 5 - 5 * Math.SQRT2, 10 * Math.SQRT2, 10 * Math.SQRT2]);
  });

  it('rotated rect: 100×20 rotated 90° about its centre', () => {
    const box = transformBox({ x: 0, y: 0, width: 100, height: 20 }, parseTransform('rotate(90 50 10)'));
    expectBox(box, [40, -40, 20, 100]);
  });

  it('unionBox and intersectBox', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 5, y: 5, width: 10, height: 10 };
    expectBox(unionBox(a, b), [0, 0, 15, 15]);
    expectBox(unionBox(null, b), [5, 5, 10, 10]);
    expect(unionBox(null, null)).toBeNull();
    expectBox(intersectBox(a, b), [5, 5, 5, 5]);
    expect(intersectBox(a, { x: 20, y: 20, width: 1, height: 1 })).toBeNull();
    expect(intersectBox(a, null)).toBeNull();
    expectBox(intersectBox(a, { x: 10, y: 0, width: 5, height: 5 }), [10, 0, 0, 5]);
  });
});

describe('pathBounds', () => {
  it('handles lines and relative commands', () => {
    expectBox(pathBounds('M10 10 L20 5 h5 v20 l-10 -10 z'), [10, 5, 15, 20]);
    expectBox(pathBounds('m10 10 5 5 5 -5'), [10, 10, 10, 5]);
    expectBox(pathBounds('M0 0 H10 V10 H0 Z'), [0, 0, 10, 10]);
  });

  it('keeps the current point after Z for relative commands', () => {
    // After Z the pen returns to (10,10); l 5 5 ends at (15,15).
    expectBox(pathBounds('M10 10 l10 0 l0 10 z l5 5'), [10, 10, 10, 10]);
    // Without honouring the return to the subpath start, l5 5 would end at (25,25).
  });

  it('parses compact numbers and exponents', () => {
    expectBox(pathBounds('M1.5.5L-1-2'), [-1, -2, 2.5, 2.5]);
    expectBox(pathBounds('M0,0L1e1,2E0'), [0, 0, 10, 2]);
    expectBox(pathBounds('M.5.5.5.5'), [0.5, 0.5, 0, 0]);
  });

  it('treats extra pairs after M as lineto (and after m as relative lineto)', () => {
    expectBox(pathBounds('M0 0 10 0 10 10'), [0, 0, 10, 10]);
    expectBox(pathBounds('m1 1 1 0 0 1'), [1, 1, 1, 1]);
  });

  it('computes exact cubic extrema for overshooting control points', () => {
    // y(t) = 3(1-t)²t·100 + 3(1-t)t²·100 peaks at t=0.5: 75
    expectBox(pathBounds('M0 0 C0 100 100 100 100 0'), [0, 0, 100, 75]);
    // S reflects the previous control point: symmetric S-curve.
    const s = pathBounds('M0 0 C0 100 50 100 50 0 S100 -100 100 0');
    expect(s?.y).toBeCloseTo(-75, 6);
    expect(s?.height).toBeCloseTo(150, 6);
  });

  it('computes exact quadratic extrema (Q and T)', () => {
    // y(t) = 2(1-t)t·100 → max 50 at t=0.5
    expectBox(pathBounds('M0 0 Q50 100 100 0'), [0, 0, 100, 50]);
    // T reflects: second arc mirrors the first below the axis.
    expectBox(pathBounds('M0 0 Q50 100 100 0 T200 0'), [0, -50, 200, 100]);
    expectBox(pathBounds('M0 0 q50 100 100 0 t100 0'), [0, -50, 200, 100]);
  });

  it('applies the matrix before computing extrema, so rotated paths are tight', () => {
    const m = parseTransform('rotate(90)'); // (x,y) → (-y, x)
    // Curve bulges up to y=75 before rotation → after: x ranges -75..0, y 0..100.
    expectBox(pathBounds('M0 0 C0 100 100 100 100 0', m), [-75, 0, 75, 100]);
    // A 45° rotation: bounds of the curve's real extent, not of the rotated untransformed bbox.
    const m45 = parseTransform('rotate(45)');
    const tight = pathBounds('M0 0 C0 100 100 100 100 0', m45);
    const loose = transformBox({ x: 0, y: 0, width: 100, height: 75 }, m45);
    expect(tight).not.toBeNull();
    expect(tight!.width * tight!.height).toBeLessThan(loose.width * loose.height);
    // Brute-force check against dense sampling.
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i <= 10000; i++) {
      const t = i / 10000;
      const u = 1 - t;
      const x = 3 * u * t * t * 100 + t * t * t * 100;
      const y = 3 * u * u * t * 100 + 3 * u * t * t * 100;
      const [rx] = applyToPoint(m45, x, y);
      minX = Math.min(minX, rx);
      maxX = Math.max(maxX, rx);
    }
    expect(tight!.x).toBeCloseTo(minX, 3);
    expect(tight!.x + tight!.width).toBeCloseTo(maxX, 3);
  });

  it('computes exact bounds for arcs', () => {
    // Half circle of radius 50 above the x axis (sweep=1 goes clockwise in screen coords → up here).
    expectBox(pathBounds('M0 0 A50 50 0 0 1 100 0'), [0, -50, 100, 50]);
    expectBox(pathBounds('M0 0 A50 50 0 0 0 100 0'), [0, 0, 100, 50]);
    // Full circle as two arcs.
    expectBox(pathBounds('M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50'), [0, 0, 100, 100]);
    // Quarter arc: only the endpoints and one extreme.
    expectBox(pathBounds('M50 0 A50 50 0 0 1 100 50'), [50, 0, 50, 50]);
    // Relative arc.
    expectBox(pathBounds('M0 0 a50 50 0 0 1 100 0'), [0, -50, 100, 50]);
  });

  it('corrects too-small radii and supports compact arc flags', () => {
    // Radii 10 are too small for a 100-wide chord: scaled up to 50 → half circle.
    expectBox(pathBounds('M0 0 A10 10 0 0 1 100 0'), [0, -50, 100, 50]);
    expectBox(pathBounds('M0 0a50 50 0 01100 0'), [0, -50, 100, 50]);
  });

  it('handles rotated ellipse arcs under transforms', () => {
    const arc = 'M0 0 A50 25 0 1 0 100 0 A50 25 0 1 0 0 0';
    expectBox(pathBounds(arc), [0, -25, 100, 50]);
    expectBox(pathBounds(arc, parseTransform('rotate(90 50 0)')), [25, -50, 50, 100]);
    expectBox(pathBounds(arc, parseTransform('scale(2 1)')), [0, -25, 200, 50]);
  });

  it('degenerate arcs: zero radius is a line, identical endpoints draw nothing extra', () => {
    expectBox(pathBounds('M0 0 A0 10 0 0 1 10 10'), [0, 0, 10, 10]);
    expectBox(pathBounds('M5 5 A10 10 0 0 1 5 5'), [5, 5, 0, 0]);
  });

  it('returns null for empty or bare-moveto paths; stops at the first error but keeps earlier geometry', () => {
    expect(pathBounds('')).toBeNull();
    expect(pathBounds('M10 10')).toBeNull();
    expectBox(pathBounds('M0 0 L10 10 L'), [0, 0, 10, 10]);
    expect(parsePathData('M0 0 L10').error).toMatch(/аргумент/);
    expect(parsePathData('L0 0').error).toMatch(/M/);
    expect(parsePathData('M0 0 L10 10').error).toBeNull();
  });

  it('is invariant to multiplication order: bounds under m1·m2 equal bounds under sequential application', () => {
    const m1: Matrix = parseTransform('translate(10 20) rotate(30)');
    const m2: Matrix = parseTransform('scale(2 0.5)');
    const d = 'M0 0 C10 40 60 40 70 0 Q35 -30 0 0 Z';
    const combined = pathBounds(d, multiply(m1, m2));
    const inner = pathBounds(d, m2);
    expect(combined).not.toBeNull();
    expect(inner).not.toBeNull();
    // Transforming the already-tight inner box can only be looser than the exact result.
    const loose = transformBox(inner as Box, m1);
    expect(combined!.width).toBeLessThanOrEqual(loose.width + 1e-9);
    expect(combined!.height).toBeLessThanOrEqual(loose.height + 1e-9);
  });
});
