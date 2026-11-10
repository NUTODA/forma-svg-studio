import { describe, expect, it } from 'vitest';
import type {
  ArtboardPresetId,
  Box,
  ComposeInput,
  ComposeItem,
  ComposeResult,
  LayoutMode,
  MotifId,
  PlacedLayer,
} from '../domain/types';
import { ARTBOARD_PRESETS, compose, getZones, layerBounds, orientationOf, sceneryCandidates } from './compose';
import { boxesIntersect, uncoveredFraction, visibleAxes } from './geometry';
import { placeScenery } from './scenery';
import { SAMPLE_MOTIFS, metaOf } from './testMetas';

const PRESET_IDS: ArtboardPresetId[] = ['square', 'portrait', 'og'];
const MODES: LayoutMode[] = ['composed', 'title'];

function items(motifs: readonly MotifId[], detail: 's' | 'l' = 'l'): ComposeItem[] {
  return motifs.map((motif) => ({ motif, meta: metaOf(motif, detail, 'main') }));
}

function sceneryFor(motifs: readonly MotifId[]): ComposeItem[] {
  const motif = sceneryCandidates(motifs)[0] as MotifId;
  return [{ motif, meta: metaOf(motif, 'l', 'background') }];
}

function input(preset: ArtboardPresetId, mode: LayoutMode, motifs: readonly MotifId[], withScenery = false): ComposeInput {
  const p = ARTBOARD_PRESETS[preset];
  return {
    items: items(motifs),
    backgrounds: withScenery ? sceneryFor(motifs) : [],
    artboard: { width: p.width, height: p.height },
    mode,
  };
}

const sample = (count: number): MotifId[] => SAMPLE_MOTIFS.slice(0, count) as MotifId[];
const objectsOf = (layers: PlacedLayer[]): PlacedLayer[] => layers.filter((l) => l.role === 'object');
const sceneryOf = (layers: PlacedLayer[]): PlacedLayer[] => layers.filter((l) => l.role === 'background');

function boxOf(inp: ComposeInput, l: PlacedLayer): Box {
  return layerBounds(l, ((l.role === 'object' ? inp.items : inp.backgrounds)[l.rank] as ComposeItem).meta);
}

/** Scene look shared by every format, mode and item count. */
function expectSceneRules(inp: ComposeInput, result: ComposeResult, count: number): void {
  const objects = objectsOf(result.layers);
  expect(objects).toHaveLength(count);
  expect(objects.map((l) => l.rank).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i));

  // Upright (rotation would break the isometric grid) and one common scale for everything, scenery included.
  const scale = (l: PlacedLayer): number =>
    l.size / ((l.role === 'object' ? inp.items : inp.backgrounds)[l.rank] as ComposeItem).meta.bounds.height;
  const common = scale(objects[0] as PlacedLayer);
  for (const l of result.layers) {
    expect(l.rotation).toBe(0);
    expect(scale(l)).toBeCloseTo(common, 9);
    expect(Number.isFinite(l.x) && Number.isFinite(l.y) && l.size > 0).toBe(true);
  }

  // Scenery is drawn first (behind everything).
  const firstObject = result.layers.findIndex((l) => l.role === 'object');
  expect(result.layers.slice(0, firstObject).every((l) => l.role === 'background')).toBe(true);

  // The frame may crop the scene, but every object stays mostly in view.
  for (const l of objects) {
    const { vx, vy } = visibleAxes(boxOf(inp, l), inp.artboard);
    expect(Math.min(vx, vy)).toBeGreaterThanOrEqual(0.6 - 1e-6);
  }

  // Nothing — objects or scenery — reaches the headline.
  if (inp.mode === 'title') {
    expect(result.headlineZone).not.toBeNull();
    for (const l of result.layers) expect(boxesIntersect(boxOf(inp, l), result.headlineZone as Box)).toBe(false);
  }
}

describe('artboard presets and zones', () => {
  it('defines the three presets', () => {
    expect(ARTBOARD_PRESETS.square).toMatchObject({ width: 1080, height: 1080, label: 'Квадрат' });
    expect(ARTBOARD_PRESETS.portrait).toMatchObject({ width: 1080, height: 1350 });
    expect(ARTBOARD_PRESETS.og).toMatchObject({ width: 1200, height: 630, label: 'Обложка' });
  });

  it('derives the orientation from the ratio', () => {
    expect(orientationOf({ width: 1200, height: 630 })).toBe('horizontal');
    expect(orientationOf({ width: 1080, height: 1350 })).toBe('vertical');
    expect(orientationOf({ width: 1080, height: 1080 })).toBe('square');
  });

  it('composed: the art zone is the whole frame (the scene may be cropped by it)', () => {
    const z = getZones({ width: 1200, height: 630 }, 'composed');
    expect(z.artZone).toEqual({ x: 0, y: 0, width: 1200, height: 630 });
    expect(z.headlineZone).toBeNull();
  });

  it('title: horizontal keeps the left part for the headline, the art runs to the right edge', () => {
    const z = getZones({ width: 1200, height: 630 }, 'title');
    expect(z.headlineZone!.x + z.headlineZone!.width).toBeLessThanOrEqual(z.artZone.x);
    expect(z.artZone.x + z.artZone.width).toBe(1200);
    expect(z.artZone).toMatchObject({ y: 0, height: 630 });
  });

  it('title: vertical and square keep the top for the headline, the art runs to the bottom edge', () => {
    for (const size of [{ width: 1080, height: 1350 }, { width: 1080, height: 1080 }]) {
      const z = getZones(size, 'title');
      expect(z.headlineZone!.y + z.headlineZone!.height).toBeLessThan(z.artZone.y);
      expect(z.artZone).toMatchObject({ x: 0, width: size.width });
      expect(z.artZone.y + z.artZone.height).toBe(size.height);
    }
  });
});

describe('compose: the reference look', () => {
  for (const preset of PRESET_IDS) {
    for (const mode of MODES) {
      for (let count = 1; count <= 8; count += 1) {
        it(`${preset} / ${mode} / ${count} item(s)`, () => {
          const inp = input(preset, mode, sample(count), true);
          expectSceneRules(inp, compose(inp), count);
        });
      }
    }
  }

  it('is deterministic', () => {
    for (const preset of PRESET_IDS) {
      for (const mode of MODES) expect(compose(input(preset, mode, sample(5), true))).toEqual(compose(input(preset, mode, sample(5), true)));
    }
  });

  it('returns only zones for an empty brief', () => {
    const r = compose({ items: [], backgrounds: [], artboard: { width: 1080, height: 1080 }, mode: 'composed' });
    expect(r.layers).toEqual([]);
    expect(r.artZone.width).toBeGreaterThan(0);
  });

  it('keeps relative proportions of the source drawings', () => {
    const result = compose(input('square', 'composed', ['book', 'coin']));
    const book = result.layers.find((l) => l.motif === 'book')!;
    const coin = result.layers.find((l) => l.motif === 'coin')!;
    expect(book.size / coin.size).toBeCloseTo(metaOf('book').bounds.height / metaOf('coin').bounds.height, 6);
  });

  it('lets a flat back object (book, folder) run off the frame, like the references', () => {
    for (const motifs of [['book', 'phone'], ['folder', 'wallet', 'coin']] as MotifId[][]) {
      const inp = input('square', 'composed', motifs);
      const back = objectsOf(compose(inp).layers).find((l) => l.motif === motifs[0])!;
      const { vx, vy } = visibleAxes(boxOf(inp, back), inp.artboard);
      expect(Math.min(vx, vy)).toBeLessThan(1);
    }
  });

  it('keeps a compact group (wallet and coin) whole, with room left for the background', () => {
    const inp = input('square', 'composed', ['wallet', 'coin']);
    for (const l of objectsOf(compose(inp).layers)) {
      const { vx, vy } = visibleAxes(boxOf(inp, l), inp.artboard);
      expect(vx * vy).toBeCloseTo(1, 6);
    }
  });

  it('rests small objects on a flat one (phone on a book)', () => {
    const inp = input('square', 'composed', ['book', 'phone']);
    const layers = objectsOf(compose(inp).layers);
    const book = boxOf(inp, layers.find((l) => l.motif === 'book')!);
    const phone = layers.find((l) => l.motif === 'phone')!;
    expect(phone.x).toBeGreaterThan(book.x);
    expect(phone.x).toBeLessThan(book.x + book.width);
    expect(phone.y).toBeGreaterThan(book.y);
    expect(phone.y).toBeLessThan(book.y + book.height);
    // The phone lies on the book, not under it.
    expect(layers.findIndex((l) => l.motif === 'phone')).toBeGreaterThan(layers.findIndex((l) => l.motif === 'book'));
  });

  it('never buries an object (up to 6 items)', () => {
    for (const preset of PRESET_IDS) {
      for (let count = 2; count <= 6; count += 1) {
        const inp = input(preset, 'composed', sample(count));
        const result = compose(inp);
        const objects = objectsOf(result.layers);
        objects.forEach((l, i) => {
          const covers = objects.slice(i + 1).map((o) => boxOf(inp, o));
          expect(uncoveredFraction(boxOf(inp, l), covers)).toBeGreaterThanOrEqual(0.4);
        });
      }
    }
  });

  it('duplicates (two coins) are separate layers with distinct positions', () => {
    const result = compose(input('og', 'composed', ['wallet', 'coin', 'coin']));
    const coins = objectsOf(result.layers).filter((l) => l.motif === 'coin');
    expect(coins).toHaveLength(2);
    expect(coins[0]!.x !== coins[1]!.x || coins[0]!.y !== coins[1]!.y).toBe(true);
  });

  it('S files (half-scale drawings) land at nearly the same visual size', () => {
    const l = compose(input('square', 'composed', ['headphones']));
    const s = compose({ ...input('square', 'composed', ['headphones']), items: items(['headphones'], 's') });
    expect(objectsOf(s.layers)[0]!.size / objectsOf(l.layers)[0]!.size).toBeGreaterThan(0.8);
  });
});

describe('background object (scenery)', () => {
  it('is another library object, best suited to the hero first', () => {
    expect(sceneryCandidates(['headphones'])[0]).toBe('bouquet');
    expect(sceneryCandidates(['wallet', 'coin'])[0]).toBe('lamp');
    expect(sceneryCandidates(['puzzle', 'pen'])[0]).toBe('book');
    expect(sceneryCandidates(['book', 'lamp'])).not.toContain('book');
    expect(sceneryCandidates(['book', 'lamp'])).not.toContain('lamp');
    expect(sceneryCandidates([])).toHaveLength(10);
  });

  it('sits behind the scene in a frame corner, cropped by the frame', () => {
    for (const preset of PRESET_IDS) {
      const inp = input(preset, 'composed', ['wallet', 'coin'], true);
      const result = compose(inp);
      const [bg] = sceneryOf(result.layers);
      expect(bg).toBeDefined();
      expect(result.layers[0]).toBe(bg);
      const { vx, vy } = visibleAxes(boxOf(inp, bg!), inp.artboard);
      expect(vx).toBeLessThan(1);
      expect(vy).toBeLessThan(1);
      expect(Math.min(vx, vy)).toBeGreaterThan(0.3);
    }
  });

  it('is left out rather than drawn over the headline', () => {
    const meta = metaOf('lamp', 'l', 'background');
    const board = { width: 1000, height: 1000 };
    // A headline zone covering the whole frame leaves no corner.
    expect(placeScenery(meta, 1, [], board, { x: 0, y: 0, width: 1000, height: 1000 })).toBeNull();
    expect(placeScenery(meta, 0.2, [], board, null)).not.toBeNull();
  });

  it('two background objects take different corners', () => {
    const inp: ComposeInput = {
      ...input('square', 'composed', ['wallet', 'coin']),
      backgrounds: [
        { motif: 'lamp', meta: metaOf('lamp', 'l', 'background') },
        { motif: 'bouquet', meta: metaOf('bouquet', 'l', 'background') },
      ],
    };
    const [a, b] = sceneryOf(compose(inp).layers);
    expect(a!.x !== b!.x || a!.y !== b!.y).toBe(true);
  });
});

describe('large compositions', () => {
  function crowd(count: number, preset: ArtboardPresetId, mode: LayoutMode): ComposeInput {
    const motifs = Array.from({ length: count }, (_, i) => SAMPLE_MOTIFS[i % SAMPLE_MOTIFS.length] as MotifId);
    return input(preset, mode, motifs, true);
  }
  const TIME_LIMIT_MS = 2000;

  it('keeps every one of 110 layers in bounded time, for every format and layout', () => {
    for (const preset of PRESET_IDS) {
      for (const mode of MODES) {
        const inp = crowd(110, preset, mode);
        const started = performance.now();
        const result = compose(inp);
        expect(performance.now() - started, `${preset} / ${mode}`).toBeLessThan(TIME_LIMIT_MS);
        expectSceneRules(inp, result, 110);
      }
    }
  });

  it('handles the layer limit (500 objects) in bounded time', () => {
    const inp = crowd(500, 'portrait', 'composed');
    const started = performance.now();
    const result = compose(inp);
    expect(performance.now() - started).toBeLessThan(TIME_LIMIT_MS);
    expectSceneRules(inp, result, 500);
  });

  it('works on both sides of the switch from the exhaustive to the bounded search', () => {
    for (const count of [16, 17, 24]) {
      for (const mode of MODES) {
        const inp = crowd(count, 'og', mode);
        expectSceneRules(inp, compose(inp), count);
      }
    }
  });
});

describe('compose options', () => {
  const rankOrder = (result: ComposeResult): number[] => objectsOf(result.layers).map((l) => l.rank);

  it('honours a preferred stacking order', () => {
    const inp = input('og', 'composed', sample(4));
    expect(rankOrder(compose(inp, { stacking: [3, 1, 0, 2] }))).toEqual([3, 1, 0, 2]);
    expect(rankOrder(compose(inp, { stacking: [2, 2, 9, -1] }))).toEqual([2, 0, 1, 3]);
    expect(rankOrder(compose(inp, { stacking: [] }))).toEqual(rankOrder(compose(inp)));
  });

  it('keeps the common scale when a stacking is imposed', () => {
    const inp = input('og', 'composed', sample(3));
    const plain = compose(inp);
    const stacked = compose(inp, { stacking: [2, 1, 0] });
    const pose = (r: ComposeResult, rank: number): PlacedLayer => objectsOf(r.layers).find((l) => l.rank === rank) as PlacedLayer;
    expect(pose(stacked, 1).size / pose(stacked, 0).size).toBeCloseTo(pose(plain, 1).size / pose(plain, 0).size, 9);
  });
});
