import { describe, expect, it } from 'vitest';
import { PAINT_ROLES, SOURCE_PALETTE_IDS } from '../domain/types';
import type { Palette, SourcePaletteId } from '../domain/types';
import { BUILTIN_PALETTES, DEFAULT_PALETTE_ID } from './builtins';
import { hexToOklab, oklabDistance } from './color';
import { createColorResolver, paperColor } from './resolve';
import { ROLE_INFO, SOURCE_PALETTES, classifyColor } from './roles';

function palette(id: string): Palette {
  const found = BUILTIN_PALETTES.find((p) => p.id === id);
  if (!found) throw new Error(id);
  return found;
}

const HEX = /^#[0-9a-f]{6}$/;

describe('built-in palettes', () => {
  it('are the three Figma palettes with exact swatches', () => {
    expect(BUILTIN_PALETTES.map((p) => p.id)).toEqual(['lavender', 'peach', 'mint']);
    expect(BUILTIN_PALETTES.map((p) => p.name)).toEqual(['Сирень', 'Персик', 'Мята']);
    expect(DEFAULT_PALETTE_ID).toBe('lavender');
    expect(palette('lavender').colors).toEqual({
      paper: '#ffffff',
      tint: '#d7cdf5',
      tone: '#aa9bf0',
      deep: '#7864d7',
      ink: '#181817',
      highlight: '#f9ecb0',
      accent: '#f9a3aa',
      accentSoft: '#ffe3e1',
      light: '#ffffff',
    });
    expect(palette('peach').colors.deep).toBe('#d27532');
    expect(palette('mint').colors.accent).toBe('#6d7bfc');
  });

  it('use their own plane, are built-in, and store lowercase hex', () => {
    for (const p of BUILTIN_PALETTES) {
      expect(p.plane).toBe(p.id);
      expect(p.builtIn).toBe(true);
      for (const role of PAINT_ROLES) expect(p.colors[role]).toMatch(HEX);
    }
  });

  it('do not alias the source palette objects', () => {
    expect(palette('lavender').colors).not.toBe(SOURCE_PALETTES.lavender.colors);
  });
});

describe('role info', () => {
  it('has a Russian label, description and group for every role', () => {
    for (const role of PAINT_ROLES) {
      const info = ROLE_INFO[role];
      expect(info.label).toMatch(/[а-яё]/i);
      expect(info.description).toMatch(/[а-яё]/i);
    }
    expect(ROLE_INFO.tint.label).toBe('Светлый фон');
    expect(ROLE_INFO.paper.group).toBe('artboard');
    expect(ROLE_INFO.accent.group).toBe('objects');
    expect(ROLE_INFO.deep.group).toBe('background');
  });
});

describe('classifyColor', () => {
  it('matches exact swatches to their role', () => {
    for (const id of SOURCE_PALETTE_IDS) {
      for (const role of PAINT_ROLES) {
        if (role === 'paper') continue;
        const hex = SOURCE_PALETTES[id].colors[role];
        const result = classifyColor(hex, id);
        expect(result.exact).toBe(true);
        expect(result.reference).toBe(hex);
        expect(SOURCE_PALETTES[id].colors[result.role]).toBe(hex);
      }
    }
  });

  it('is case-insensitive for exact matches', () => {
    expect(classifyColor('#D7CDF5', 'lavender')).toEqual({ role: 'tint', reference: '#d7cdf5', exact: true });
  });

  it('never returns paper; white is the light role', () => {
    expect(classifyColor('#ffffff', 'lavender').role).toBe('light');
    expect(classifyColor('#fefefe', 'mint').role).not.toBe('paper');
  });

  it('picks the nearest swatch for unknown colours', () => {
    const near = classifyColor('#7a66d8', 'lavender');
    expect(near).toEqual({ role: 'deep', reference: '#7864d7', exact: false });
    expect(classifyColor('#101010', 'peach').role).toBe('ink');
  });

  it('handles invalid input without throwing', () => {
    const result = classifyColor('nonsense', 'lavender');
    expect(result.exact).toBe(false);
  });
});

describe('paperColor', () => {
  it('returns the paper role', () => {
    expect(paperColor({ ...palette('peach'), colors: { ...palette('peach').colors, paper: '#fffaf0' } })).toBe('#fffaf0');
  });
});

describe('createColorResolver', () => {
  it('maps every swatch of every source palette to itself in the identical palette', () => {
    for (const id of SOURCE_PALETTE_IDS) {
      const resolve = createColorResolver(palette(id));
      for (const role of PAINT_ROLES) {
        if (role === 'paper') continue;
        const hex = SOURCE_PALETTES[id].colors[role];
        expect(resolve(hex, id)).toBe(hex);
      }
    }
  });

  it('lavender resolver keeps every lavender swatch', () => {
    const resolve = createColorResolver(palette('lavender'));
    for (const hex of Object.values(SOURCE_PALETTES.lavender.colors)) {
      expect(resolve(hex, 'lavender')).toBe(hex);
    }
  });

  it('maps by role across palettes', () => {
    expect(createColorResolver(palette('peach'))('#7864d7', 'lavender')).toBe('#d27532');
    expect(createColorResolver(palette('mint'))('#fdd7b9', 'peach')).toBe('#beebeb');
    expect(createColorResolver(palette('mint'))('#f9a3aa', 'lavender')).toBe('#6d7bfc');
  });

  it('never chains: the result depends only on the original source colour', () => {
    // Peach deep (#d27532) would classify as something else if fed back; resolving the lavender
    // source colour must still be a pure function of (source colour, source palette).
    const toPeach = createColorResolver(palette('peach'));
    const first = toPeach('#7864d7', 'lavender');
    expect(toPeach('#7864d7', 'lavender')).toBe(first);
    expect(toPeach('#7864d7', 'lavender')).toBe(palette('peach').colors.deep);
    // Same hex in different source palettes resolves independently.
    expect(toPeach('#80dada', 'mint')).toBe(palette('peach').colors.tone);
    expect(toPeach('#80dada', 'peach')).toBe(palette('peach').colors.accent);
  });

  it('keeps the offset of an unknown colour near a swatch', () => {
    const source = '#8470dc';
    const reference = '#7864d7';
    const resolve = createColorResolver(palette('peach'));
    const out = resolve(source, 'lavender');
    expect(out).not.toBe(palette('peach').colors.deep);
    const delta = (a: string, b: string): [number, number, number] => {
      const la = hexToOklab(a)!;
      const lb = hexToOklab(b)!;
      return [la.L - lb.L, la.a - lb.a, la.b - lb.b];
    };
    const sourceDelta = delta(source, reference);
    const outDelta = delta(out, palette('peach').colors.deep);
    for (let i = 0; i < 3; i += 1) {
      expect(outDelta[i]!).toBeCloseTo(sourceDelta[i]!, 1);
    }
    // And it stays perceptually close to the target swatch.
    expect(oklabDistance(hexToOklab(out)!, hexToOklab(palette('peach').colors.deep)!)).toBeLessThan(0.1);
  });

  it('always outputs lowercase #rrggbb, even for extreme offsets', () => {
    const resolvers = BUILTIN_PALETTES.map(createColorResolver);
    const samples = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#123456', '#FEDCBA', '#abc'];
    for (const resolve of resolvers) {
      for (const source of SOURCE_PALETTE_IDS) {
        for (const sample of samples) expect(resolve(sample, source)).toMatch(HEX);
      }
    }
  });

  it('returns invalid input lowercased instead of throwing', () => {
    const resolve = createColorResolver(palette('mint'));
    expect(resolve('NOT-A-COLOR', 'lavender')).toBe('not-a-color');
    expect(resolve('', 'peach')).toBe('');
    expect(resolve('url(#Gradient)', 'mint')).toBe('url(#gradient)');
  });

  it('works with user palettes and memoises consistently', () => {
    const custom: Palette = {
      ...palette('lavender'),
      id: 'custom',
      builtIn: false,
      colors: { ...palette('lavender').colors, accent: '#ff0000' },
    };
    const resolve = createColorResolver(custom);
    const a: SourcePaletteId = 'lavender';
    expect(resolve('#f9a3aa', a)).toBe('#ff0000');
    expect(resolve('#f9a3aa', a)).toBe('#ff0000');
    expect(resolve('#d7cdf5', a)).toBe('#d7cdf5');
  });
});
