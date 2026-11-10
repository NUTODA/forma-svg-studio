import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  formatHex,
  hexToOklab,
  mixHex,
  normalizeHex,
  oklabDistance,
  oklabToHex,
  oklabToRgb,
  parseHex,
  relativeLuminance,
} from './color';

describe('hex parsing', () => {
  it('parses long and short forms case-insensitively', () => {
    expect(parseHex('#FF8000')).toEqual({ r: 255, g: 128, b: 0 });
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0 });
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'ff8000', '#12', '#12345', '#gggggg', 'rgb(1,2,3)', '#ff8000ff', ' #ffffff']) {
      expect(parseHex(bad)).toBeNull();
    }
  });

  it('normalises to lowercase #rrggbb', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#D7CDF5')).toBe('#d7cdf5');
    expect(normalizeHex('violet')).toBeNull();
  });

  it('formats with clamping and rounding', () => {
    expect(formatHex({ r: -5, g: 127.6, b: 300 })).toBe('#0080ff');
  });
});

describe('OKLab', () => {
  it('round-trips every 17th grid colour through hex', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = formatHex({ r, g, b });
          const lab = hexToOklab(hex);
          expect(lab).not.toBeNull();
          expect(oklabToHex(lab!)).toBe(hex);
        }
      }
    }
  });

  it('matches reference values for white, black and red', () => {
    const white = hexToOklab('#ffffff')!;
    expect(white.L).toBeCloseTo(1, 3);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);
    expect(hexToOklab('#000000')!.L).toBeCloseTo(0, 6);
    const red = hexToOklab('#ff0000')!;
    expect(red.L).toBeCloseTo(0.628, 3);
    expect(red.a).toBeCloseTo(0.2249, 3);
    expect(red.b).toBeCloseTo(0.1258, 3);
  });

  it('measures distance', () => {
    const black = hexToOklab('#000000')!;
    const white = hexToOklab('#ffffff')!;
    expect(oklabDistance(black, white)).toBeCloseTo(1, 3);
    expect(oklabDistance(white, white)).toBe(0);
  });

  it('clamps out-of-gamut colours into valid channels', () => {
    const rgb = oklabToRgb({ L: 0.9, a: 0.4, b: 0.3 });
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect(oklabToHex({ L: 2, a: 0, b: 0 })).toBe('#ffffff');
    expect(oklabToHex({ L: -1, a: 0, b: 0 })).toBe('#000000');
  });
});

describe('WCAG', () => {
  it('computes relative luminance extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('gives 21:1 for black on white, symmetric, and 1:1 for equal colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#7864d7', '#7864d7')).toBe(1);
  });

  it('matches a known mid-grey value', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('mixHex', () => {
  it('returns endpoints and a midpoint between them', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    const mid = hexToOklab(mixHex('#000000', '#ffffff', 0.5))!;
    expect(mid.L).toBeCloseTo(0.5, 1);
  });

  it('clamps t and tolerates invalid input', () => {
    expect(mixHex('#102030', '#ffffff', -3)).toBe('#102030');
    expect(mixHex('#102030', '#ffffff', 9)).toBe('#ffffff');
    expect(mixHex('BAD', '#ffffff', 0.5)).toBe('bad');
  });
});
