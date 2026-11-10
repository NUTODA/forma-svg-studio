import { describe, expect, it } from 'vitest';
import type { Box } from '../domain/types';
import { paintedBounds, parseLength, parseViewBox } from './bounds';
import { sanitizeSvg } from './sanitize';
import { parseXml } from './xml';

const svg = (attrs: string, body: string) => parseXml(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`);
const measure = (attrs: string, body: string) => paintedBounds(sanitizeSvg(svg(attrs, body)).root);

function expectBox(box: Box, expected: [number, number, number, number]): void {
  expect(box.x).toBeCloseTo(expected[0], 6);
  expect(box.y).toBeCloseTo(expected[1], 6);
  expect(box.width).toBeCloseTo(expected[2], 6);
  expect(box.height).toBeCloseTo(expected[3], 6);
}

describe('parseViewBox', () => {
  it('reads viewBox, with commas or spaces', () => {
    expect(parseViewBox(svg('viewBox="0 0 100 50"', ''))).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    expect(parseViewBox(svg('viewBox="-5,-5,10,20"', ''))).toEqual({ x: -5, y: -5, width: 10, height: 20 });
  });

  it('falls back to width/height', () => {
    expect(parseViewBox(svg('width="200" height="100px"', ''))).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('throws Russian errors when unusable', () => {
    expect(() => parseViewBox(svg('', ''))).toThrow(/viewBox/);
    expect(() => parseViewBox(svg('viewBox="0 0 0 10"', ''))).toThrow(/viewBox/);
    expect(() => parseViewBox(svg('viewBox="a b c d"', ''))).toThrow(/viewBox/);
    expect(() => parseViewBox(svg('width="50%" height="10"', ''))).toThrow(/размер/i);
  });

  it('parseLength understands units', () => {
    expect(parseLength('10')).toBe(10);
    expect(parseLength('1in')).toBe(96);
    expect(parseLength('50%', 200)).toBe(100);
    expect(parseLength('abc')).toBeNull();
  });
});

describe('paintedBounds', () => {
  it('defaults to a black fill and measures shapes', () => {
    const { bounds } = measure('viewBox="0 0 100 100"', '<rect x="10" y="20" width="30" height="40"/><circle cx="80" cy="80" r="10"/>');
    expectBox(bounds, [10, 20, 80, 70]);
  });

  it('skips elements that paint nothing: inherited fill none without stroke', () => {
    const { bounds, warnings } = measure('viewBox="0 0 100 100" fill="none"', '<rect width="30" height="30"/>');
    expectBox(bounds, [0, 0, 100, 100]);
    expect(warnings.some((w) => w.includes('viewBox'))).toBe(true);
  });

  it('includes strokes that inherit from ancestors and honours stroke width', () => {
    const { bounds } = measure(
      'viewBox="0 0 100 100" fill="none"',
      '<g stroke="#000" stroke-width="10"><rect x="20" y="20" width="30" height="30"/></g><rect x="70" y="70" width="10" height="10" stroke="red"/>',
    );
    // First rect: 20..50 + 5 each side; second: 70..80 with the default stroke width 1 (±0.5).
    expectBox(bounds, [15, 15, 65.5, 65.5]);
  });

  it('scales the stroke half-width by the matrix', () => {
    const { bounds } = measure(
      'viewBox="0 0 100 100" fill="none"',
      '<g transform="scale(2)"><rect x="10" y="10" width="10" height="10" stroke="#000" stroke-width="4"/></g>',
    );
    // geometry 20..40, stroke half-width 2 × 2 = 4 → 16..44
    expectBox(bounds, [16, 16, 28, 28]);
  });

  it('does not add stroke to fill-only shapes, and lines only paint with a stroke', () => {
    expectBox(measure('viewBox="0 0 100 100"', '<line x1="10" y1="10" x2="50" y2="10"/>').bounds, [0, 0, 100, 100]);
    expectBox(
      measure('viewBox="0 0 100 100"', '<line x1="10" y1="10" x2="50" y2="10" stroke="#000" stroke-width="2"/>').bounds,
      // Conservative: the half-width is added on every side (caps/joins are not modelled).
      [9, 9, 42, 2],
    );
  });

  it('applies chained transforms to béziers (tight bounds)', () => {
    const { bounds } = measure(
      'viewBox="-200 -200 400 400"',
      '<path transform="rotate(90)" d="M0 0 C0 100 100 100 100 0"/>',
    );
    expectBox(bounds, [-75, 0, 75, 100]);
  });

  it('skips display:none, opacity 0 and non-rendered subtrees (defs, clipPath, mask, gradients, symbol, pattern)', () => {
    const { bounds } = measure(
      'viewBox="0 0 100 100"',
      `<defs><rect id="r" width="100" height="100"/></defs>
       <clipPath id="c"><rect width="100" height="100"/></clipPath>
       <mask id="m"><rect width="100" height="100"/></mask>
       <symbol id="s"><rect width="100" height="100"/></symbol>
       <pattern id="p"><rect width="100" height="100"/></pattern>
       <g display="none"><rect width="100" height="100"/></g>
       <rect width="100" height="100" opacity="0"/>
       <rect x="5" y="5" width="10" height="10" visibility="hidden"/>
       <rect x="30" y="30" width="10" height="10"/>`,
    );
    expectBox(bounds, [30, 30, 10, 10]);
  });

  it('lets visibility:visible override a hidden ancestor', () => {
    const { bounds } = measure(
      'viewBox="0 0 100 100"',
      '<g visibility="hidden"><rect width="50" height="50"/><rect x="60" y="60" width="10" height="10" visibility="visible"/></g>',
    );
    expectBox(bounds, [60, 60, 10, 10]);
  });

  it('intersects with clip-path content (userSpaceOnUse)', () => {
    const { bounds } = measure(
      'viewBox="0 0 100 100"',
      `<defs><clipPath id="c"><rect x="10" y="10" width="20" height="20"/></clipPath></defs>
       <g clip-path="url(#c)"><rect width="100" height="100"/></g>`,
    );
    expectBox(bounds, [10, 10, 20, 20]);
  });

  it('evaluates the clip in the user space of the clipped element (its transform applies)', () => {
    const { bounds } = measure(
      'viewBox="0 0 100 100"',
      `<defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs>
       <g transform="translate(50 50)" clip-path="url(#c)"><rect width="100" height="100"/></g>`,
    );
    expectBox(bounds, [50, 50, 10, 10]);
  });

  it('a clip with no geometry hides the element; objectBoundingBox clips are ignored', () => {
    const empty = measure(
      'viewBox="0 0 100 100"',
      '<defs><clipPath id="c"></clipPath></defs><rect width="50" height="50" clip-path="url(#c)"/><rect x="60" y="60" width="10" height="10"/>',
    );
    expectBox(empty.bounds, [60, 60, 10, 10]);
    const obb = measure(
      'viewBox="0 0 100 100"',
      '<defs><clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="0.5"/></clipPath></defs><rect width="50" height="50" clip-path="url(#c)"/>',
    );
    expectBox(obb.bounds, [0, 0, 50, 50]);
  });

  it('clips to the viewBox and reports the unclipped box', () => {
    const result = measure('viewBox="0 0 100 100"', '<rect x="-20" y="10" width="200" height="30"/>');
    expectBox(result.bounds, [0, 10, 100, 30]);
    expect(result.unclipped).not.toBeNull();
    expectBox(result.unclipped as Box, [-20, 10, 200, 30]);
  });

  it('falls back to the viewBox (with a warning) when everything is outside', () => {
    const result = measure('viewBox="0 0 100 100"', '<rect x="500" y="500" width="10" height="10"/>');
    expectBox(result.bounds, [0, 0, 100, 100]);
    expect(result.unclipped).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('resolves <use href> with x/y translation and inherited style', () => {
    const { bounds } = measure(
      'viewBox="0 0 200 200" fill="none"',
      `<defs><rect id="r" width="10" height="10"/></defs>
       <use href="#r" x="50" y="60" fill="#f00"/>
       <use href="#r" transform="translate(100 100)" stroke="#000" stroke-width="2" />`,
    );
    expectBox(bounds, [50, 60, 111 + 0 - 50, 111 - 60]);
  });

  it('expands symbols through <use> and survives reference cycles', () => {
    const symbol = measure(
      'viewBox="0 0 100 100"',
      '<defs><symbol id="s"><rect width="10" height="10"/></symbol></defs><use href="#s" x="40" y="40"/>',
    );
    expectBox(symbol.bounds, [40, 40, 10, 10]);
    const cycle = measure(
      'viewBox="0 0 100 100"',
      '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/><rect width="5" height="5"/>',
    );
    expectBox(cycle.bounds, [0, 0, 5, 5]);
  });

  it('warns that text is not measured', () => {
    const { warnings } = measure('viewBox="0 0 100 100"', '<text x="1" y="1">hi</text><rect width="5" height="5"/>');
    expect(warnings.some((w) => w.includes('Текст'))).toBe(true);
  });

  it('measures ellipses and polygons under rotation exactly', () => {
    const e = measure('viewBox="-100 -100 200 200"', '<ellipse rx="40" ry="10" transform="rotate(90)"/>');
    expectBox(e.bounds, [-10, -40, 20, 80]);
    const p = measure('viewBox="0 0 100 100"', '<polygon points="10,10 50,10 30,40"/>');
    expectBox(p.bounds, [10, 10, 40, 30]);
  });
});
