import { describe, expect, it } from 'vitest';
import type {
  ArtboardPresetId,
  ComposeInput,
  ComposeItem,
  ComposeResult,
  LayoutMode,
  MotifId,
  PlacedLayer,
} from '../domain/types';
import { ARTBOARD_PRESETS, compose, getZones, layerBounds, orientationOf } from './compose';
import { boxBottom, boxRight, boxesIntersect, uncoveredFraction, visibleFraction } from './geometry';
import { SAMPLE_MOTIFS, metaOf } from './testMetas';

const PRESET_IDS: ArtboardPresetId[] = ['square', 'portrait', 'og'];
const MODES: LayoutMode[] = ['composed', 'title', 'offset'];

function items(motifs: readonly MotifId[], detail: 's' | 'l' = 'l'): ComposeItem[] {
  return motifs.map((motif) => ({ motif, meta: metaOf(motif, detail, 'main') }));
}

function echoes(motifs: readonly MotifId[]): ComposeItem[] {
  return motifs.map((motif) => ({ motif, meta: metaOf(motif, 'l', 'background') }));
}

function input(preset: ArtboardPresetId, mode: LayoutMode, count: number, withEchoes = false): ComposeInput {
  const motifs = SAMPLE_MOTIFS.slice(0, count);
  const p = ARTBOARD_PRESETS[preset];
  return {
    items: items(motifs),
    backgrounds: withEchoes ? echoes(motifs.slice(0, count >= 3 ? 2 : 1)) : [],
    artboard: { width: p.width, height: p.height },
    mode,
  };
}

const objectsOf = (layers: PlacedLayer[]): PlacedLayer[] => layers.filter((l) => l.role === 'object');
const echoesOf = (layers: PlacedLayer[]): PlacedLayer[] => layers.filter((l) => l.role === 'background');

describe('artboard presets and zones', () => {
  it('defines the three presets', () => {
    expect(ARTBOARD_PRESETS.square).toMatchObject({ width: 1080, height: 1080, label: 'Квадрат' });
    expect(ARTBOARD_PRESETS.portrait).toMatchObject({ width: 1080, height: 1350 });
    expect(ARTBOARD_PRESETS.og).toMatchObject({ width: 1200, height: 630, label: 'Обложка' });
    expect(ARTBOARD_PRESETS.portrait.label).toContain('Портрет 4');
  });

  it('derives the orientation from the ratio', () => {
    expect(orientationOf({ width: 1200, height: 630 })).toBe('horizontal');
    expect(orientationOf({ width: 1080, height: 1350 })).toBe('vertical');
    expect(orientationOf({ width: 1080, height: 1080 })).toBe('square');
    expect(orientationOf({ width: 1150, height: 1000 })).toBe('square');
    expect(orientationOf({ width: 870, height: 1000 })).toBe('square');
  });

  it('composed: artboard inset by 7.5% of the short side', () => {
    const z = getZones({ width: 1200, height: 630 }, 'composed');
    expect(z.artZone).toEqual({ x: 47, y: 47, width: 1106, height: 536 });
    expect(z.headlineZone).toBeNull();
    expect(z.orientation).toBe('horizontal');
  });

  it('offset: anchored to the far corner at half margin, open space opposite', () => {
    const og = getZones({ width: 1200, height: 630 }, 'offset').artZone;
    expect(og.x).toBeCloseTo(480);
    expect(og.y).toBe(47);
    // edge = round(margin / 2)
    expect(boxRight(og)).toBe(1200 - 24);
    expect(boxBottom(og)).toBe(630 - 24);
    const portrait = getZones({ width: 1080, height: 1350 }, 'offset').artZone;
    expect(portrait.x).toBe(81);
    expect(portrait.y).toBeCloseTo(486);
    expect(boxRight(portrait)).toBe(1080 - 41);
    const square = getZones({ width: 1080, height: 1080 }, 'offset').artZone;
    expect(square.x).toBeCloseTo(324);
    expect(square.y).toBeCloseTo(324);
    expect(boxBottom(square)).toBe(1080 - 41);
  });

  it('title: horizontal reserves the left part for the headline', () => {
    const z = getZones({ width: 1200, height: 630 }, 'title');
    expect(z.headlineZone).toEqual({ x: 47, y: 47, width: 0.42 * 1200 - 47, height: 536 });
    expect(z.artZone).toEqual({ x: 576, y: 47, width: 0.52 * 1200 - 47, height: 536 });
  });

  it('title: vertical and square reserve the top part with a gap', () => {
    const v = getZones({ width: 1080, height: 1350 }, 'title');
    expect(v.headlineZone).toEqual({ x: 81, y: 81, width: 918, height: 0.3 * 1350 });
    expect(v.artZone.y).toBeCloseTo(81 + 405 + 41);
    expect(boxBottom(v.artZone)).toBeCloseTo(1350 - 81);
    const s = getZones({ width: 1080, height: 1080 }, 'title');
    expect(s.headlineZone?.height).toBeCloseTo(0.32 * 1080);
    expect(s.artZone.y).toBeCloseTo(81 + 345.6 + 32);
    expect(boxBottom(s.artZone)).toBeCloseTo(1080 - 81);
  });
});

describe('layerBounds', () => {
  const book = metaOf('book');
  it('unrotated: height = size, width follows the bounds ratio', () => {
    const b = layerBounds({ x: 500, y: 300, rotation: 0, size: 200 }, book);
    expect(b.height).toBeCloseTo(200);
    expect(b.width).toBeCloseTo((200 * book.bounds.width) / book.bounds.height);
    expect(b.x + b.width / 2).toBeCloseTo(500);
    expect(b.y + b.height / 2).toBeCloseTo(300);
  });

  it('rotated 90° swaps the dimensions', () => {
    const w = (200 * book.bounds.width) / book.bounds.height;
    const b = layerBounds({ x: 0, y: 0, rotation: 90, size: 200 }, book);
    expect(b.width).toBeCloseTo(200);
    expect(b.height).toBeCloseTo(w);
  });

  it('small tilt grows the box on both axes', () => {
    const flat = layerBounds({ x: 0, y: 0, rotation: 0, size: 200 }, book);
    const tilted = layerBounds({ x: 0, y: 0, rotation: 6, size: 200 }, book);
    expect(tilted.width).toBeGreaterThan(flat.width);
    expect(tilted.height).toBeGreaterThan(flat.height);
  });

  it('is symmetric for opposite angles', () => {
    const a = layerBounds({ x: 10, y: 20, rotation: 30, size: 100 }, book);
    const b = layerBounds({ x: 10, y: 20, rotation: -30, size: 100 }, book);
    expect(a.width).toBeCloseTo(b.width);
    expect(a.height).toBeCloseTo(b.height);
  });
});

describe('compose guarantees', () => {
  for (const preset of PRESET_IDS) {
    for (const mode of MODES) {
      for (let count = 1; count <= 8; count += 1) {
        it(`${preset} / ${mode} / ${count} item(s)`, () => {
          const inp = input(preset, mode, count, true);
          const result = compose(inp);
          const objects = objectsOf(result.layers);
          const echo = echoesOf(result.layers);
          const board = inp.artboard;
          expect(objects).toHaveLength(count);

          // Uniform common scale.
          const scales = objects.map((l) => l.size / (inp.items[l.rank] as ComposeItem).meta.bounds.height);
          for (const s of scales) expect(s).toBeCloseTo(scales[0] as number, 9);
          for (const e of echo) {
            const meta = (inp.backgrounds[e.rank] as ComposeItem).meta;
            expect(e.size / meta.bounds.height).toBeCloseTo(scales[0] as number, 9);
          }

          // Backgrounds first in z-order; ranks are source indices.
          const firstObject = result.layers.findIndex((l) => l.role === 'object');
          expect(result.layers.slice(0, firstObject).every((l) => l.role === 'background')).toBe(true);
          expect(objects.map((l) => l.rank).sort()).toEqual(Array.from({ length: count }, (_, i) => i));

          const boxOf = (l: PlacedLayer): ReturnType<typeof layerBounds> =>
            layerBounds(l, ((l.role === 'object' ? inp.items : inp.backgrounds)[l.rank] as ComposeItem).meta);

          // Real drawings are never cropped by the frame, in any layout.
          for (const l of objects) {
            const b = boxOf(l);
            expect(b.x).toBeGreaterThanOrEqual(-1);
            expect(b.y).toBeGreaterThanOrEqual(-1);
            expect(boxRight(b)).toBeLessThanOrEqual(board.width + 1);
            expect(boxBottom(b)).toBeLessThanOrEqual(board.height + 1);
          }
          if (mode === 'title') {
            const headline = result.headlineZone;
            expect(headline).not.toBeNull();
            for (const l of result.layers) expect(boxesIntersect(boxOf(l), headline!)).toBe(false);
          }
          if (mode === 'offset') {
            for (const l of objects) expect(visibleFraction(boxOf(l), board)).toBeGreaterThanOrEqual(0.7);
          }

          // Hero (rank 0) stays upright and is never buried.
          const hero = objects.find((l) => l.rank === 0)!;
          expect(hero.rotation).toBe(0);
          const heroIdx = result.layers.indexOf(hero);
          const above = result.layers.slice(heroIdx + 1).filter((l) => l.role === 'object').map(boxOf);
          expect(uncoveredFraction(boxOf(hero), above)).toBeGreaterThan(0.3);

          // No object is buried: each keeps a readable share of its bounds uncovered (up to 6 items).
          if (count <= 6) {
            objects.forEach((l) => {
              const idx = result.layers.indexOf(l);
              const covers = result.layers.slice(idx + 1).filter((o) => o.role === 'object').map(boxOf);
              expect(uncoveredFraction(boxOf(l), covers)).toBeGreaterThanOrEqual(0.45);
            });
          }

          // Tilts stay small.
          for (const l of objects) expect(Math.abs(l.rotation)).toBeLessThanOrEqual(10);
          expect(objectsOf(result.layers).every((l) => l.size > 0 && Number.isFinite(l.x) && Number.isFinite(l.y))).toBe(true);
        });
      }
    }
  }

  it('is deterministic', () => {
    for (const preset of PRESET_IDS) {
      for (const mode of MODES) {
        const a = compose(input(preset, mode, 5, true));
        const b = compose(input(preset, mode, 5, true));
        expect(b).toEqual(a);
      }
    }
  });

  it('handles 7 and 8 items (three tiers if needed) inside the zone', () => {
    for (const count of [7, 8]) {
      for (const mode of ['composed', 'title'] as const) {
        const inp = input('og', mode, count);
        const result = compose(inp);
        expect(objectsOf(result.layers)).toHaveLength(count);
        for (const l of result.layers) {
          const b = layerBounds(l, (inp.items[l.rank] as ComposeItem).meta);
          expect(b.x).toBeGreaterThanOrEqual(result.artZone.x - 1);
          expect(boxRight(b)).toBeLessThanOrEqual(boxRight(result.artZone) + 1);
          expect(b.y).toBeGreaterThanOrEqual(result.artZone.y - 1);
          expect(boxBottom(b)).toBeLessThanOrEqual(boxBottom(result.artZone) + 1);
        }
      }
    }
  });

  it('returns only zones for an empty brief', () => {
    const r = compose({ items: [], backgrounds: [], artboard: { width: 1080, height: 1080 }, mode: 'composed' });
    expect(r.layers).toEqual([]);
    expect(r.artZone.width).toBeGreaterThan(0);
  });

  it('keeps relative proportions of the source drawings', () => {
    const inp = input('square', 'composed', 2);
    const result = compose(inp);
    const book = result.layers.find((l) => l.motif === 'book')!;
    const coin = result.layers.find((l) => l.motif === 'coin')!;
    expect(book.size / coin.size).toBeCloseTo(
      metaOf('book').bounds.height / metaOf('coin').bounds.height,
      6,
    );
  });

  it('single item: 78% of the zone in composed/title, centred with an optical lift', () => {
    const inp = input('square', 'composed', 1);
    const result = compose(inp);
    const l = result.layers[0] as PlacedLayer;
    const b = layerBounds(l, (inp.items[0] as ComposeItem).meta);
    const zone = result.artZone;
    const fitW = b.width / zone.width;
    const fitH = b.height / zone.height;
    expect(Math.max(fitW, fitH)).toBeCloseTo(0.78, 3);
    expect(l.x).toBeCloseTo(zone.x + zone.width / 2);
    expect(l.y).toBeCloseTo(zone.y + zone.height / 2 - 0.02 * zone.height);
  });

  it('single item in offset mode fills the zone and sits bottom-right', () => {
    const inp = input('og', 'offset', 1);
    const result = compose(inp);
    const l = result.layers[0] as PlacedLayer;
    const b = layerBounds(l, (inp.items[0] as ComposeItem).meta);
    expect(visibleFraction(b, inp.artboard)).toBeGreaterThanOrEqual(0.7);
    expect(b.x + b.width / 2).toBeGreaterThan(inp.artboard.width / 2);
  });

  it('keeps the negative space on the opposite side in offset mode', () => {
    const inp = input('og', 'offset', 3);
    const result = compose(inp);
    for (const l of result.layers) {
      const b = layerBounds(l, (inp.items[l.rank] as ComposeItem).meta);
      expect(b.x).toBeGreaterThanOrEqual(0.4 * inp.artboard.width - 1);
    }
  });

  it('duplicates (two coins) are separate layers with distinct positions', () => {
    const inp: ComposeInput = {
      items: items(['book', 'coin', 'coin']),
      backgrounds: [],
      artboard: { width: 1200, height: 630 },
      mode: 'composed',
    };
    const result = compose(inp);
    const coins = result.layers.filter((l) => l.motif === 'coin');
    expect(coins).toHaveLength(2);
    expect(coins[0]?.rank).not.toBe(coins[1]?.rank);
    expect(`${coins[0]?.x},${coins[0]?.y}`).not.toBe(`${coins[1]?.x},${coins[1]?.y}`);
  });

  it('places the hero in the middle of the ground line', () => {
    const inp = input('og', 'composed', 3);
    const result = compose(inp);
    const xs = (rank: number): number => (result.layers.find((l) => l.rank === rank && l.role === 'object') as PlacedLayer).x;
    expect(xs(1)).toBeLessThan(xs(0));
    expect(xs(2)).toBeGreaterThan(xs(0));
  });

  it('short items step forward (lowered baseline) for depth', () => {
    const inp: ComposeInput = {
      items: items(['book', 'coin']),
      backgrounds: [],
      artboard: { width: 1200, height: 630 },
      mode: 'composed',
    };
    const result = compose(inp);
    const book = result.layers.find((l) => l.motif === 'book') as PlacedLayer;
    const coin = result.layers.find((l) => l.motif === 'coin') as PlacedLayer;
    const bottom = (l: PlacedLayer): number => boxBottom(layerBounds(l, metaOf(l.motif)));
    expect(bottom(coin)).toBeGreaterThan(bottom(book));
  });

  it('puts the larger painted area behind the smaller', () => {
    const result = compose(input('og', 'composed', 3));
    const order = result.layers.map((l) => l.motif);
    expect(order.indexOf('book')).toBeLessThan(order.indexOf('lamp') === -1 ? 99 : order.indexOf('lamp'));
    expect(order.indexOf('lamp')).toBeLessThan(order.indexOf('coin'));
  });

  it('S files (half-scale drawings) land at nearly the same visual size', () => {
    const l = compose({ ...input('og', 'composed', 3), items: items(SAMPLE_MOTIFS.slice(0, 3), 'l') });
    const s = compose({ ...input('og', 'composed', 3), items: items(SAMPLE_MOTIFS.slice(0, 3), 's') });
    for (const a of l.layers) {
      const b = s.layers.find((x) => x.rank === a.rank)!;
      expect(Math.abs(b.size / a.size - 1)).toBeLessThan(0.15);
    }
  });
});

describe('background echoes', () => {
  const motifs: MotifId[] = ['book', 'coin', 'lamp'];

  it('sits exactly behind its object, same rotation, shifted diagonally by 7%', () => {
    const inp: ComposeInput = {
      items: items(motifs),
      backgrounds: echoes(['book', 'coin']),
      artboard: { width: 1200, height: 630 },
      mode: 'composed',
    };
    const r = compose(inp);
    const echo = echoesOf(r.layers);
    expect(echo).toHaveLength(2);
    const obj = (motif: MotifId): PlacedLayer => objectsOf(r.layers).find((l) => l.motif === motif)!;
    const [first, second] = echo as [PlacedLayer, PlacedLayer];
    expect(first.motif).toBe('book');
    expect(second.motif).toBe('coin');
    for (const e of echo) expect(e.rotation).toBe(obj(e.motif).rotation);

    const bookW = (obj('book').size * metaOf('book').bounds.width) / metaOf('book').bounds.height;
    const d1 = 0.07 * Math.max(bookW, obj('book').size);
    expect(first.x - obj('book').x).toBeCloseTo(d1);
    expect(first.y - obj('book').y).toBeCloseTo(-d1);
    const coinW = (obj('coin').size * metaOf('coin').bounds.width) / metaOf('coin').bounds.height;
    const d2 = 0.07 * Math.max(coinW, obj('coin').size);
    expect(second.x - obj('coin').x).toBeCloseTo(-d2);
    expect(second.y - obj('coin').y).toBeCloseTo(-d2);
  });

  it('uses 12% in offset mode', () => {
    const inp: ComposeInput = {
      items: items(['book']),
      backgrounds: echoes(['book']),
      artboard: { width: 1200, height: 630 },
      mode: 'offset',
    };
    const r = compose(inp);
    const obj = objectsOf(r.layers)[0] as PlacedLayer;
    const e = echoesOf(r.layers)[0] as PlacedLayer;
    const w = (obj.size * metaOf('book').bounds.width) / metaOf('book').bounds.height;
    expect(e.x - obj.x).toBeCloseTo(0.12 * Math.max(w, obj.size));
  });

  it('matches duplicates by first unmatched occurrence', () => {
    const inp: ComposeInput = {
      items: items(['coin', 'book', 'coin']),
      backgrounds: echoes(['coin', 'coin']),
      artboard: { width: 1200, height: 630 },
      mode: 'composed',
    };
    const r = compose(inp);
    const e = echoesOf(r.layers);
    expect(e.map((l) => l.rank)).toEqual([0, 1]);
    const coins = objectsOf(r.layers).filter((l) => l.motif === 'coin');
    const first = coins.find((l) => l.rank === 0) as PlacedLayer;
    const third = coins.find((l) => l.rank === 2) as PlacedLayer;
    expect(Math.abs((e[0] as PlacedLayer).x - first.x)).toBeGreaterThan(0);
    expect(Math.abs((e[0] as PlacedLayer).x - first.x)).toBeLessThan(first.size);
    expect(Math.abs((e[1] as PlacedLayer).x - third.x)).toBeLessThan(third.size);
  });

  it('skips an echo without a counterpart', () => {
    const inp: ComposeInput = {
      items: items(['book']),
      backgrounds: echoes(['lamp']),
      artboard: { width: 1080, height: 1080 },
      mode: 'composed',
    };
    expect(echoesOf(compose(inp).layers)).toHaveLength(0);
  });

  it('never intrudes into the headline zone in title mode', () => {
    for (const preset of PRESET_IDS) {
      for (let count = 1; count <= 6; count += 1) {
        const inp = input(preset, 'title', count, true);
        const r = compose(inp);
        for (const e of echoesOf(r.layers)) {
          const b = layerBounds(e, (inp.backgrounds[e.rank] as ComposeItem).meta);
          expect(boxesIntersect(b, r.headlineZone!)).toBe(false);
        }
      }
    }
  });
});

describe('large compositions', () => {
  /** `count` items cycling through the sample motifs, echoes for the first two. */
  function crowd(count: number, preset: ArtboardPresetId, mode: LayoutMode, withEchoes = false): ComposeInput {
    const motifs = Array.from({ length: count }, (_, i) => SAMPLE_MOTIFS[i % SAMPLE_MOTIFS.length] as MotifId);
    const p = ARTBOARD_PRESETS[preset];
    return {
      items: items(motifs),
      backgrounds: withEchoes ? echoes(motifs.slice(0, 2)) : [],
      artboard: { width: p.width, height: p.height },
      mode,
    };
  }

  /** Generous: the unbounded search took seconds at ~100 layers, the bounded one takes milliseconds. */
  const TIME_LIMIT_MS = 2000;

  function expectWholeAndInside(inp: ComposeInput, result: ComposeResult, count: number): void {
    const objects = objectsOf(result.layers);
    expect(objects).toHaveLength(count);
    expect(objects.map((l) => l.rank).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));

    const scales = objects.map((l) => l.size / (inp.items[l.rank] as ComposeItem).meta.bounds.height);
    for (const s of scales) expect(s).toBeCloseTo(scales[0] as number, 9);

    const zone = result.artZone;
    for (const l of result.layers) {
      const meta = ((l.role === 'object' ? inp.items : inp.backgrounds)[l.rank] as ComposeItem).meta;
      expect(Number.isFinite(l.x) && Number.isFinite(l.y) && l.size > 0).toBe(true);
      if (l.role === 'background' && inp.mode === 'title') {
        expect(boxesIntersect(layerBounds(l, meta), result.headlineZone!)).toBe(false);
        continue;
      }
      const b = layerBounds(l, meta);
      expect(b.x).toBeGreaterThanOrEqual(zone.x - 1);
      expect(b.y).toBeGreaterThanOrEqual(zone.y - 1);
      expect(boxRight(b)).toBeLessThanOrEqual(boxRight(zone) + 1);
      expect(boxBottom(b)).toBeLessThanOrEqual(boxBottom(zone) + 1);
    }

    // The hero is never buried.
    const heroAt = result.layers.findIndex((l) => l.role === 'object' && l.rank === 0);
    const boxOf = (l: PlacedLayer): ReturnType<typeof layerBounds> =>
      layerBounds(l, (inp.items[l.rank] as ComposeItem).meta);
    const above = result.layers.slice(heroAt + 1).filter((l) => l.role === 'object').map(boxOf);
    expect(uncoveredFraction(boxOf(result.layers[heroAt] as PlacedLayer), above)).toBeGreaterThan(0.3);
  }

  it('keeps every one of 110 layers, inside the zone, in bounded time, for every format and layout', () => {
    for (const preset of PRESET_IDS) {
      for (const mode of MODES) {
        const inp = crowd(110, preset, mode, true);
        const started = performance.now();
        const result = compose(inp);
        expect(performance.now() - started, `${preset} / ${mode}`).toBeLessThan(TIME_LIMIT_MS);
        expectWholeAndInside(inp, result, 110);
        expect(echoesOf(result.layers)).toHaveLength(2);
      }
    }
  });

  it('is deterministic for large sets', () => {
    for (const mode of MODES) expect(compose(crowd(110, 'og', mode, true))).toEqual(compose(crowd(110, 'og', mode, true)));
  });

  it('handles the layer limit (500 objects) in bounded time', () => {
    const inp = crowd(500, 'portrait', 'composed');
    const started = performance.now();
    const result = compose(inp);
    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
    expectWholeAndInside(inp, result, 500);
  });

  it('works on both sides of the switch from the exhaustive to the bounded search', () => {
    for (const count of [16, 17, 24, 44]) {
      for (const mode of MODES) {
        const inp = crowd(count, 'og', mode, true);
        const started = performance.now();
        const result = compose(inp);
        expect(performance.now() - started, `${count} / ${mode}`).toBeLessThan(TIME_LIMIT_MS);
        expectWholeAndInside(inp, result, count);
      }
    }
  });
});

describe('compose options', () => {
  const rankOrder = (result: ComposeResult): number[] => objectsOf(result.layers).map((l) => l.rank);

  it('seats an echo behind the explicitly chosen object', () => {
    const inp: ComposeInput = {
      items: items(['coin', 'coin', 'coin']),
      backgrounds: echoes(['coin']),
      artboard: { width: 1200, height: 630 },
      mode: 'composed',
    };
    const nearestObject = (result: ComposeResult): number => {
      const echo = echoesOf(result.layers)[0] as PlacedLayer;
      const distance = (l: PlacedLayer): number => Math.hypot(echo.x - l.x, echo.y - l.y);
      return objectsOf(result.layers).reduce((a, b) => (distance(a) <= distance(b) ? a : b)).rank;
    };
    expect(nearestObject(compose(inp))).toBe(0);
    expect(nearestObject(compose(inp, { echoTargets: [2] }))).toBe(2);
    expect(nearestObject(compose(inp, { echoTargets: [1] }))).toBe(1);
  });

  it('skips echoes whose target does not exist', () => {
    const inp: ComposeInput = {
      items: items(['book', 'coin']),
      backgrounds: echoes(['book', 'coin']),
      artboard: { width: 1200, height: 630 },
      mode: 'composed',
    };
    const result = compose(inp, { echoTargets: [0, 7] });
    expect(echoesOf(result.layers).map((l) => l.rank)).toEqual([0]);
  });

  it('honours a preferred stacking order', () => {
    const inp = input('og', 'composed', 4);
    expect(rankOrder(compose(inp, { stacking: [3, 1, 0, 2] }))).toEqual([3, 1, 0, 2]);
    // Unlisted items go on top in index order; unknown and repeated entries are ignored.
    expect(rankOrder(compose(inp, { stacking: [2, 2, 9, -1] }))).toEqual([2, 0, 1, 3]);
    // No preference means the art-directed order.
    expect(rankOrder(compose(inp, { stacking: [] }))).toEqual(rankOrder(compose(inp)));
  });

  it('honours a preferred stacking order for large sets as well', () => {
    const count = 30;
    const motifs = Array.from({ length: count }, (_, i) => SAMPLE_MOTIFS[i % SAMPLE_MOTIFS.length] as MotifId);
    const inp: ComposeInput = { items: items(motifs), backgrounds: [], artboard: { width: 1080, height: 1080 }, mode: 'composed' };
    const reversed = Array.from({ length: count }, (_, i) => count - 1 - i);
    expect(rankOrder(compose(inp, { stacking: reversed }))).toEqual(reversed);
  });

  it('keeps the common scale when a stacking is imposed', () => {
    const inp = input('og', 'composed', 3);
    const plain = compose(inp);
    const stacked = compose(inp, { stacking: [2, 1, 0] });
    const pose = (r: ComposeResult, rank: number): PlacedLayer => objectsOf(r.layers).find((l) => l.rank === rank) as PlacedLayer;
    // Scale is shared, so every object keeps its size relative to the others.
    expect(pose(stacked, 1).size / pose(stacked, 0).size).toBeCloseTo(pose(plain, 1).size / pose(plain, 0).size, 9);
    expect(rankOrder(stacked)).toEqual([2, 1, 0]);
  });
});
