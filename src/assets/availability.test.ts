import { describe, expect, it } from 'vitest';
import {
  MOTIF_IDS,
  SOURCE_PALETTE_IDS,
  type AssetFileMeta,
  type Detail,
  type MotifId,
  type PlaneFileMeta,
  type SourcePaletteId,
  type Variant,
} from '../domain/types';
import {
  availableMotifs,
  isBundledFileName,
  motifAvailability,
  parseAssetFileName,
  parsePlaneFileName,
  resolveAsset,
  resolvePlane,
  variantForLayer,
} from './availability';

const DETAILS: readonly Detail[] = ['s', 'l'];
const VARIANTS: readonly Variant[] = ['main', 'background'];

const BOX = { x: 0, y: 0, width: 10, height: 10 };

function asset(motif: MotifId, detail: Detail, variant: Variant): AssetFileMeta {
  return { file: `${motif}-${detail}-${variant}.svg`, motif, detail, variant, viewBox: BOX, bounds: BOX, colors: [], bytes: 1, warnings: [] };
}

/** `['l-main', 's-background']` → metas for a motif. */
function assetsOf(motif: MotifId, ...combos: `${Detail}-${Variant}`[]): AssetFileMeta[] {
  return combos.map((combo) => {
    const [detail, variant] = combo.split('-') as [Detail, Variant];
    return asset(motif, detail, variant);
  });
}

function plane(palette: SourcePaletteId, detail: Detail): PlaneFileMeta {
  return { file: `plane-${palette}-${detail}.svg`, palette, detail, viewBox: BOX, bounds: BOX, colors: [], bytes: 1, warnings: [] };
}

describe('file name parsing', () => {
  it('accepts every documented object name', () => {
    for (const motif of MOTIF_IDS) {
      for (const detail of DETAILS) {
        for (const variant of VARIANTS) {
          expect(parseAssetFileName(`${motif}-${detail}-${variant}.svg`)).toEqual({ motif, detail, variant });
        }
      }
    }
  });

  it.each([
    ['uppercase motif', 'Book-s-main.svg'],
    ['uppercase detail', 'book-S-main.svg'],
    ['uppercase variant', 'book-s-Main.svg'],
    ['uppercase extension', 'book-s-main.SVG'],
    ['fully uppercase', 'BOOK-S-MAIN.SVG'],
    ['unknown motif id (pencil)', 'pencil-s-main.svg'],
    ['prefix of a motif id', 'boo-s-main.svg'],
    ['longer than a motif id', 'bookk-s-main.svg'],
    ['missing variant', 'book-s.svg'],
    ['missing detail', 'book-main.svg'],
    ['unknown detail', 'book-m-main.svg'],
    ['unknown variant', 'book-s-mono.svg'],
    ['path traversal', '../book-s-main.svg'],
    ['nested path', 'assets/book-s-main.svg'],
    ['absolute path', '/book-s-main.svg'],
    ['windows path traversal', '..\\book-s-main.svg'],
    ['double extension', 'book-s-main.svg.png'],
    ['no extension', 'book-s-main'],
    ['trailing characters', 'book-s-main.svgx'],
    ['trailing newline', 'book-s-main.svg\n'],
    ['surrounding spaces', ' book-s-main.svg '],
    ['empty string', ''],
    ['a plane name', 'plane-lavender-s.svg'],
  ])('rejects %s (%s)', (_label, name) => {
    expect(parseAssetFileName(name)).toBeNull();
  });

  it('accepts every documented plane name', () => {
    for (const palette of SOURCE_PALETTE_IDS) {
      for (const detail of DETAILS) {
        expect(parsePlaneFileName(`plane-${palette}-${detail}.svg`)).toEqual({ palette, detail });
      }
    }
  });

  it.each([
    ['uppercase palette', 'plane-Lavender-s.svg'],
    ['uppercase detail', 'plane-mint-L.svg'],
    ['unknown palette', 'plane-coral-s.svg'],
    ['missing detail', 'plane-lavender.svg'],
    ['unknown detail', 'plane-mint-xl.svg'],
    ['path traversal', '../plane-mint-s.svg'],
    ['double extension', 'plane-mint-s.svg.png'],
    ['an object name', 'book-s-main.svg'],
    ['empty string', ''],
  ])('rejects plane name: %s (%s)', (_label, name) => {
    expect(parsePlaneFileName(name)).toBeNull();
  });

  it('isBundledFileName is true exactly for object and plane names', () => {
    expect(isBundledFileName('book-s-main.svg')).toBe(true);
    expect(isBundledFileName('pen-l-background.svg')).toBe(true);
    expect(isBundledFileName('plane-peach-l.svg')).toBe(true);

    for (const name of [
      'source-manifest.json',
      'BOOK-S-MAIN.SVG',
      'pencil-s-main.svg',
      '../plane-mint-s.svg',
      '../book-s-main.svg',
      'book-s-main.svg.png',
      'plane-lavender.svg',
      '',
    ]) {
      expect(isBundledFileName(name), name).toBe(false);
    }
  });
});

describe('resolveAsset', () => {
  it('returns the exact file with exact = true', () => {
    const files = assetsOf('book', 's-main', 's-background', 'l-main', 'l-background');
    for (const detail of DETAILS) {
      for (const variant of VARIANTS) {
        const resolved = resolveAsset(files, 'book', detail, variant);
        expect(resolved?.meta.file).toBe(`book-${detail}-${variant}.svg`);
        expect(resolved?.exact).toBe(true);
      }
    }
  });

  it('falls back to the same variant in the other detail first', () => {
    // l-main is missing; s-main (same variant) beats l-background (same detail).
    const files = assetsOf('book', 's-main', 'l-background', 's-background');
    const resolved = resolveAsset(files, 'book', 'l', 'main');
    expect(resolved?.meta.file).toBe('book-s-main.svg');
    expect(resolved?.exact).toBe(false);
  });

  it('then tries the other variant in the same detail', () => {
    // No main files at all: l-background (same detail) beats s-background (other detail).
    const files = assetsOf('book', 's-background', 'l-background');
    const resolved = resolveAsset(files, 'book', 'l', 'main');
    expect(resolved?.meta.file).toBe('book-l-background.svg');
    expect(resolved?.exact).toBe(false);
  });

  it('finally takes the other variant in the other detail', () => {
    const files = assetsOf('book', 's-background');
    const resolved = resolveAsset(files, 'book', 'l', 'main');
    expect(resolved?.meta.file).toBe('book-s-background.svg');
    expect(resolved?.exact).toBe(false);
  });

  it('mirrors the order for other requests (s-background, l-main)', () => {
    expect(resolveAsset(assetsOf('coin', 'l-background', 's-main'), 'coin', 's', 'background')?.meta.file).toBe('coin-l-background.svg');
    expect(resolveAsset(assetsOf('coin', 's-main', 'l-main'), 'coin', 's', 'background')?.meta.file).toBe('coin-s-main.svg');
    expect(resolveAsset(assetsOf('coin', 'l-main'), 'coin', 's', 'background')?.meta.file).toBe('coin-l-main.svg');
    expect(resolveAsset(assetsOf('coin', 's-background', 'l-background'), 'coin', 'l', 'main')?.meta.file).toBe('coin-l-background.svg');
  });

  it('marks every non-exact result with exact = false', () => {
    const combos = ['s-main', 's-background', 'l-main', 'l-background'] as const;
    for (const present of combos) {
      const files = assetsOf('lamp', present);
      for (const detail of DETAILS) {
        for (const variant of VARIANTS) {
          const resolved = resolveAsset(files, 'lamp', detail, variant);
          expect(resolved?.meta.file).toBe(`lamp-${present}.svg`);
          expect(resolved?.exact).toBe(present === `${detail}-${variant}`);
        }
      }
    }
  });

  it('never borrows files of another motif and returns null for a motif without files', () => {
    const files = [...assetsOf('book', 'l-main', 's-main'), ...assetsOf('coin', 'l-background')];
    expect(resolveAsset(files, 'pen', 'l', 'main')).toBeNull();
    expect(resolveAsset(files, 'pen', 's', 'background')).toBeNull();
    expect(resolveAsset([], 'book', 'l', 'main')).toBeNull();
  });
});

describe('variantForLayer', () => {
  it('echoes always use the background file', () => {
    expect(variantForLayer('background', 'color')).toBe('background');
    expect(variantForLayer('background', 'mono')).toBe('background');
  });

  it('objects use main in colour mode and background in mono mode', () => {
    expect(variantForLayer('object', 'color')).toBe('main');
    expect(variantForLayer('object', 'mono')).toBe('background');
  });
});

describe('resolvePlane', () => {
  it('returns the exact palette and detail', () => {
    const planes = [plane('lavender', 's'), plane('lavender', 'l'), plane('mint', 's'), plane('mint', 'l')];
    const resolved = resolvePlane(planes, 'mint', 'l');
    expect(resolved?.meta.file).toBe('plane-mint-l.svg');
    expect(resolved?.exact).toBe(true);
  });

  it('prefers the same palette in the other detail over lavender', () => {
    const planes = [plane('lavender', 's'), plane('peach', 'l')];
    const resolved = resolvePlane(planes, 'peach', 's');
    expect(resolved?.meta.file).toBe('plane-peach-l.svg');
    expect(resolved?.exact).toBe(false);
  });

  it('falls back to lavender in the same detail, then lavender in the other detail', () => {
    const both = [plane('lavender', 'l'), plane('lavender', 's')];
    expect(resolvePlane(both, 'mint', 's')?.meta.file).toBe('plane-lavender-s.svg');
    expect(resolvePlane(both, 'mint', 'l')?.meta.file).toBe('plane-lavender-l.svg');

    const resolved = resolvePlane([plane('lavender', 'l')], 'mint', 's');
    expect(resolved?.meta.file).toBe('plane-lavender-l.svg');
    expect(resolved?.exact).toBe(false);
  });

  it('falls back to any plane, preferring the requested detail', () => {
    const planes = [plane('peach', 'l'), plane('peach', 's')];
    expect(resolvePlane(planes, 'mint', 's')?.meta.file).toBe('plane-peach-s.svg');
    expect(resolvePlane(planes, 'mint', 'l')?.meta.file).toBe('plane-peach-l.svg');

    const onlyOther = resolvePlane([plane('peach', 'l')], 'mint', 's');
    expect(onlyOther?.meta.file).toBe('plane-peach-l.svg');
    expect(onlyOther?.exact).toBe(false);
  });

  it('takes the first plane when nothing else matches and returns null for no planes', () => {
    expect(resolvePlane([plane('mint', 's')], 'lavender', 'l')?.meta.file).toBe('plane-mint-s.svg');
    expect(resolvePlane([], 'lavender', 's')).toBeNull();
  });
});

describe('availableMotifs / motifAvailability', () => {
  it('keeps MOTIF_IDS order, deduplicates and omits motifs without files', () => {
    const files = [
      ...assetsOf('pen', 's-main'),
      ...assetsOf('book', 'l-main', 's-main', 'l-background'),
      ...assetsOf('lamp', 'l-background'),
      ...assetsOf('coin', 's-background'),
    ];
    expect(availableMotifs(files)).toEqual(['book', 'coin', 'lamp', 'pen']);
    expect(availableMotifs([])).toEqual([]);
  });

  it('reports exactly the four combination keys for a motif', () => {
    const files = [...assetsOf('book', 'l-main', 's-background'), ...assetsOf('coin', 's-main', 'l-background')];
    const availability = motifAvailability(files, 'book');
    expect(Object.keys(availability).sort()).toEqual(['l-background', 'l-main', 's-background', 's-main']);
    expect(availability).toEqual({ 's-main': false, 's-background': true, 'l-main': true, 'l-background': false });
  });

  it('reports all-false for a motif without files and ignores other motifs', () => {
    const files = assetsOf('coin', 's-main', 's-background', 'l-main', 'l-background');
    expect(motifAvailability(files, 'pen')).toEqual({ 's-main': false, 's-background': false, 'l-main': false, 'l-background': false });
    expect(motifAvailability(files, 'coin')).toEqual({ 's-main': true, 's-background': true, 'l-main': true, 'l-background': true });
  });
});
