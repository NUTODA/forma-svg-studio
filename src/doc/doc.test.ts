import { describe, expect, it } from 'vitest';
import type { Box, DocState, Layer, MotifId } from '../domain/types';
import { ARTBOARD_PRESETS, getZones, layerBounds } from '../layout/compose';
import { boxesIntersect, visibleFraction } from '../layout/geometry';
import { allFileMetas, metaOf } from '../layout/testMetas';
import {
  DEMO_PRESETS,
  addMotifToDoc,
  composeLayers,
  createDoc,
  docFromMotifs,
  objectMotifs,
  placeNewLayer,
  recomposeDoc,
  validateDoc,
  withBackgroundObjects,
} from './doc';
import { MAX_LAYERS } from './validate';

const FILES = allFileMetas();

const layer = (over: Partial<Layer> = {}): Layer => ({
  id: 'l1',
  motif: 'book',
  role: 'object',
  x: 100,
  y: 100,
  rotation: 0,
  size: 200,
  rank: 0,
  ...over,
});

const docWith = (layers: Layer[], over: Partial<DocState> = {}): DocState => ({
  ...createDoc(),
  layers,
  nextId: layers.length + 1,
  ...over,
});

describe('createDoc', () => {
  it('has art-directed defaults', () => {
    expect(createDoc()).toEqual({
      version: 1,
      preset: 'og',
      detail: 'l',
      layout: 'composed',
      colorMode: 'color',
      paletteId: 'lavender',
      backgroundObjects: false,
      showPlane: false,
      showHeadline: true,
      headline: '',
      brief: { mode: 'title', text: '' },
      layers: [],
      nextId: 1,
    });
  });

  it('returns independent objects', () => {
    const a = createDoc();
    a.layers.push(layer());
    expect(createDoc().layers).toHaveLength(0);
  });
});

describe('validateDoc', () => {
  it('accepts createDoc() and returns a fresh copy', () => {
    const doc = createDoc();
    const result = validateDoc(doc);
    expect(result).toEqual(doc);
    expect(result).not.toBe(doc);
    expect(result?.brief).not.toBe(doc.brief);
  });

  it('accepts documents derived from the demo presets', () => {
    for (const demo of DEMO_PRESETS) {
      const base: DocState = {
        ...createDoc(),
        preset: demo.preset,
        layout: demo.layout,
        detail: demo.detail,
        paletteId: demo.paletteId,
        colorMode: demo.colorMode,
        backgroundObjects: demo.backgroundObjects,
        showPlane: demo.showPlane,
        brief: demo.brief,
      };
      const doc = docFromMotifs(base, ['bouquet', 'book', 'coin', 'pen'], FILES);
      expect(doc.layers.length).toBeGreaterThanOrEqual(4);
      expect(validateDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    }
  });

  it('strips unknown keys', () => {
    const result = validateDoc({ ...createDoc(), extra: 1, brief: { mode: 'names', text: 'x', more: true } });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('extra');
    expect(result?.brief).toEqual({ mode: 'names', text: 'x' });
  });

  it('rejects garbage', () => {
    for (const bad of [null, undefined, 0, 'doc', [], {}, true, () => 1]) expect(validateDoc(bad)).toBeNull();
  });

  it('rejects wrong settings', () => {
    const base = createDoc();
    const bad: unknown[] = [
      { ...base, version: 2 },
      { ...base, preset: 'a4' },
      { ...base, detail: 'm' },
      { ...base, layout: 'grid' },
      { ...base, colorMode: 'gray' },
      { ...base, paletteId: '' },
      { ...base, paletteId: 5 },
      { ...base, backgroundObjects: 'no' },
      { ...base, showPlane: 1 },
      { ...base, showHeadline: undefined },
      { ...base, headline: null },
      { ...base, headline: 'я'.repeat(501) },
      { ...base, brief: { mode: 'free', text: '' } },
      { ...base, brief: { mode: 'title', text: 'я'.repeat(2001) } },
      { ...base, brief: 'text' },
      { ...base, layers: {} },
      { ...base, nextId: 0 },
      { ...base, nextId: 1.5 },
      { ...base, nextId: Number.NaN },
    ];
    for (const b of bad) expect(validateDoc(b), JSON.stringify(b)).toBeNull();
  });

  it('rejects broken layers', () => {
    const doc = (layers: unknown[], nextId = 10): unknown => ({ ...createDoc(), layers, nextId });
    const ok = layer();
    expect(validateDoc(doc([ok]))).not.toBeNull();
    const bad: unknown[][] = [
      [{ ...ok, motif: 'dragon' }],
      [{ ...ok, role: 'shadow' }],
      [{ ...ok, x: Number.NaN }],
      [{ ...ok, y: Infinity }],
      [{ ...ok, x: '1' }],
      [{ ...ok, rotation: 360 }],
      [{ ...ok, rotation: -360 }],
      [{ ...ok, rotation: Number.NaN }],
      [{ ...ok, size: 0 }],
      [{ ...ok, size: -5 }],
      [{ ...ok, size: 10000 }],
      [{ ...ok, rank: 'a' }],
      [{ ...ok, hidden: 'yes' }],
      [{ ...ok, id: '' }],
      [{ ...ok, id: 'l'.repeat(65) }],
      [{ ...ok, id: 7 }],
      [ok, { ...ok }],
      [null],
      ['layer'],
      [[]],
    ];
    for (const layers of bad) expect(validateDoc(doc(layers)), JSON.stringify(layers)).toBeNull();
  });

  it('requires nextId above every numeric id', () => {
    const layers = [layer({ id: 'l5' })];
    expect(validateDoc({ ...createDoc(), layers, nextId: 5 })).toBeNull();
    expect(validateDoc({ ...createDoc(), layers, nextId: 6 })).not.toBeNull();
    // Non-numeric ids do not constrain nextId.
    expect(validateDoc({ ...createDoc(), layers: [layer({ id: 'custom' })], nextId: 1 })).not.toBeNull();
  });

  it('keeps hidden only when true', () => {
    const doc = validateDoc({ ...createDoc(), layers: [layer({ hidden: true }), layer({ id: 'l2', hidden: false })], nextId: 3 });
    expect(doc?.layers[0]?.hidden).toBe(true);
    expect(doc?.layers[1]).not.toHaveProperty('hidden');
  });

  it('is not fooled by prototype keys or inherited values', () => {
    const polluted = JSON.parse(
      '{"__proto__":{"polluted":true},"version":1,"preset":"og","detail":"l","layout":"composed","colorMode":"color",' +
        '"paletteId":"lavender","backgroundObjects":false,"showPlane":false,"showHeadline":true,"headline":"",' +
        '"brief":{"mode":"title","text":""},"layers":[],"nextId":1}',
    );
    expect(validateDoc(polluted)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();

    const nested = JSON.parse(
      JSON.stringify({ ...createDoc(), layers: [layer()], nextId: 2 }).replace('"role"', '"constructor":{},"role"'),
    );
    expect(validateDoc(nested)).toBeNull();

    const inheriting = Object.create(createDoc()) as unknown;
    expect(validateDoc(inheriting)).toBeNull();

    const layerInherits = { ...createDoc(), layers: [Object.create(layer())], nextId: 2 };
    expect(validateDoc(layerInherits)).toBeNull();
  });

  it('opens drafts saved with the retired «Со смещением» layout as «Иллюстрация»', () => {
    const legacy = { ...createDoc(), layout: 'offset' } as unknown;
    expect(validateDoc(legacy)?.layout).toBe('composed');
  });

  it('keeps a valid hand-set headline zone and drops a broken one', () => {
    const box = { x: 0.5, y: 0.1, width: 0.45, height: 0.8 };
    expect(validateDoc({ ...createDoc(), headlineBox: box })?.headlineBox).toEqual(box);
    for (const bad of [{ x: 0.8, y: 0, width: 0.5, height: 0.5 }, { x: -1, y: 0, width: 0.2, height: 0.2 }, { x: 0, y: 0, width: 0, height: 1 }, 'box', null]) {
      const doc = validateDoc({ ...createDoc(), headlineBox: bad });
      expect(doc).not.toBeNull();
      expect(doc).not.toHaveProperty('headlineBox');
    }
  });

  it('recompose lays the scene out around a hand-set headline zone and keeps it through a format change', () => {
    const base = docFromMotifs({ ...createDoc(), layout: 'title', backgroundObjects: true }, ['book', 'coin', 'lamp'], FILES);
    const headlineBox = { x: 0.05, y: 0.55, width: 0.9, height: 0.4 };
    for (const preset of ['og', 'square', 'portrait'] as const) {
      const next = recomposeDoc({ ...base, preset, headlineBox }, FILES);
      expect(next.headlineBox).toEqual(headlineBox);
      const headline = getZones(ARTBOARD_PRESETS[preset], 'title', headlineBox).headlineZone as Box;
      for (const l of next.layers) {
        const meta = metaOf(l.motif, 'l', l.role === 'object' ? 'main' : 'background');
        expect(boxesIntersect(layerBounds(l, meta), headline), `${preset} ${l.motif}`).toBe(false);
      }
    }
  });

  it('rejects absurd layer counts', () => {
    const layers = Array.from({ length: 501 }, (_, i) => layer({ id: `l${i + 1}` }));
    expect(validateDoc({ ...createDoc(), layers, nextId: 600 })).toBeNull();
  });
});

describe('DEMO_PRESETS', () => {
  it('matches the agreed demo set', () => {
    expect(DEMO_PRESETS.map((d) => d.id)).toEqual(['learning-by-parts', 'first-salary', 'study-kit']);
    const [learning, salary, study] = DEMO_PRESETS;
    expect(learning).toMatchObject({
      preset: 'og',
      layout: 'title',
      detail: 'l',
      paletteId: 'lavender',
      colorMode: 'color',
      backgroundObjects: true,
      showPlane: true,
      brief: { mode: 'title', text: 'Знания по кусочкам' },
    });
    expect(salary).toMatchObject({
      preset: 'portrait',
      layout: 'composed',
      paletteId: 'peach',
      backgroundObjects: true,
      showPlane: true,
      brief: { mode: 'title', text: 'Финансовая грамотность: как копить с первой зарплаты' },
    });
    expect(study).toMatchObject({
      preset: 'square',
      layout: 'composed',
      detail: 's',
      paletteId: 'mint',
      backgroundObjects: true,
      showPlane: true,
      brief: { mode: 'names', text: 'книга, наушники, лампа, ручка' },
    });
    expect(learning?.label).toBe('Знания по кусочкам');
    expect(salary?.label).toBe('Первая зарплата');
    expect(study?.label).toBe('Набор для учёбы');
  });
});

describe('composeLayers', () => {
  const base = {
    files: FILES,
    preset: 'og' as const,
    layout: 'composed' as const,
    detail: 'l' as const,
    colorMode: 'color' as const,
    backgroundObjects: false,
  };

  it('assigns ids from startId and reports the next one', () => {
    const r = composeLayers({ ...base, motifs: ['book', 'coin', 'lamp'] }, 7);
    expect(r.layers.map((l) => l.id)).toEqual(['l7', 'l8', 'l9']);
    expect(r.nextId).toBe(10);
    expect(r.missing).toEqual([]);
    expect(r.zones.artZone.width).toBeGreaterThan(0);
  });

  it('skips and reports motifs without files', () => {
    const files = FILES.filter((f) => f.motif !== 'lamp');
    const r = composeLayers({ ...base, files, motifs: ['book', 'lamp', 'lamp', 'coin'] }, 1);
    expect(r.missing).toEqual(['lamp']);
    expect(r.layers.map((l) => l.motif).sort()).toEqual(['book', 'coin']);
  });

  it('adds one background object: another library object suited to the hero, at the bottom', () => {
    const two = composeLayers({ ...base, backgroundObjects: true, motifs: ['book', 'coin'] }, 1);
    expect(two.layers.filter((l) => l.role === 'background')).toEqual([]);
    const three = composeLayers({ ...base, backgroundObjects: true, motifs: ['book', 'coin', 'lamp'] }, 1);
    // The lamp is already in the scene, so the next choice for a book is the bouquet.
    expect(three.layers.filter((l) => l.role === 'background').map((l) => l.motif)).toEqual(['bouquet']);
    expect(three.layers[0]?.role).toBe('background');
    const off = composeLayers({ ...base, backgroundObjects: false, motifs: ['book', 'coin', 'lamp'] }, 1);
    expect(off.layers.every((l) => l.role === 'object')).toBe(true);
  });

  it('is deterministic', () => {
    const input = { ...base, backgroundObjects: true, motifs: ['book', 'coin', 'coin'] as MotifId[] };
    expect(composeLayers(input, 1)).toEqual(composeLayers(input, 1));
  });

  it('produces valid documents with title clearance', () => {
    const r = composeLayers({ ...base, layout: 'title', backgroundObjects: true, motifs: ['bouquet', 'book', 'pen'] }, 1);
    const doc = { ...createDoc(), layers: r.layers, nextId: r.nextId };
    expect(validateDoc(doc)).not.toBeNull();
  });

  it('uses mono files for objects in mono mode', () => {
    const r = composeLayers({ ...base, colorMode: 'mono', motifs: ['book'] }, 1);
    const meta = metaOf('book', 'l', 'background');
    expect(r.layers[0]?.size).toBeGreaterThan(0);
    // Same source proportions, so the rendered size is consistent with the background file's bounds.
    const bounds = layerBounds(r.layers[0] as Layer, meta);
    expect(bounds.height).toBeCloseTo(r.layers[0]?.size ?? 0);
  });
});

describe('objectMotifs / recomposeDoc / docFromMotifs', () => {
  it('orders object motifs by rank and ignores echoes', () => {
    const doc = docWith([
      layer({ id: 'l1', motif: 'coin', rank: 2 }),
      layer({ id: 'l2', motif: 'book', rank: 0 }),
      layer({ id: 'l3', motif: 'book', role: 'background', rank: 0 }),
      layer({ id: 'l4', motif: 'lamp', rank: 1 }),
    ]);
    expect(objectMotifs(doc)).toEqual(['book', 'lamp', 'coin']);
  });

  it('recompose keeps settings and the identity of the layers it re-lays out', () => {
    const base = docFromMotifs({ ...createDoc(), headline: 'Заголовок', paletteId: 'mint' }, ['book', 'coin'], FILES);
    expect(base.nextId).toBe(3);
    const next = recomposeDoc({ ...base, preset: 'portrait' }, FILES);
    expect(next.preset).toBe('portrait');
    expect(next.headline).toBe('Заголовок');
    expect(next.paletteId).toBe('mint');
    expect(objectMotifs(next)).toEqual(['book', 'coin']);
    expect(next.layers.map((l) => l.id).sort()).toEqual(['l1', 'l2']);
    expect(next.nextId).toBe(3);
    // The frame may crop the scene, but every object stays mostly in view.
    for (const l of next.layers) {
      expect(visibleFraction(layerBounds(l, metaOf(l.motif)), ARTBOARD_PRESETS.portrait)).toBeGreaterThan(0.35);
    }
  });

  it('docFromMotifs continues ids from base.nextId and keeps the brief', () => {
    const base = { ...createDoc(), nextId: 20, brief: { mode: 'names' as const, text: 'книга' } };
    const doc = docFromMotifs(base, ['book'], FILES);
    expect(doc.layers[0]?.id).toBe('l20');
    expect(doc.nextId).toBe(21);
    expect(doc.brief).toEqual(base.brief);
  });
});

describe('placeNewLayer', () => {
  it('returns null for a motif without files', () => {
    expect(placeNewLayer(createDoc(), 'lamp', FILES.filter((f) => f.motif !== 'lamp'))).toBeNull();
  });

  it('first object: sized like a single hero, at the art-zone centre', () => {
    const doc = createDoc();
    const spot = placeNewLayer(doc, 'book', FILES);
    const solo = docFromMotifs(doc, ['book'], FILES).layers[0] as Layer;
    expect(spot).toMatchObject({ motif: 'book', role: 'object', rotation: 0, rank: 0 });
    // A lone hero may run off the frame; a catalog drop is capped to fit the art zone.
    expect(spot?.size).toBeLessThanOrEqual(solo.size + 1e-6);
    expect(spot?.size).toBeGreaterThan(0.7 * solo.size);
    const zone = getZones(ARTBOARD_PRESETS.og, 'composed').artZone;
    expect(spot?.x).toBeCloseTo(zone.x + zone.width / 2);
    expect(spot?.y).toBeCloseTo(zone.y + zone.height / 2);
  });

  it('uses the median common scale of existing objects', () => {
    const doc = docFromMotifs(createDoc(), ['book', 'coin', 'lamp'], FILES);
    const scales = doc.layers.map((l) => l.size / metaOf(l.motif).bounds.height);
    const median = [...scales].sort((a, b) => a - b)[1] as number;
    const spot = placeNewLayer(doc, 'pen', FILES);
    expect(spot?.size).toBeCloseTo(median * metaOf('pen').bounds.height);
    expect(spot?.rank).toBe(3);
  });

  it('keeps a catalog copy the same size after S/L changes with different source-height ratios', () => {
    const original = docFromMotifs(createDoc(), ['book', 'bouquet', 'bouquet'], FILES);
    const added = addMotifToDoc({ ...original, detail: 's' }, 'book', FILES);
    const books = added?.doc.layers.filter((l) => l.role === 'object' && l.motif === 'book') ?? [];
    expect(books).toHaveLength(2);
    expect(books[1]?.size).toBeCloseTo(books[0]?.size ?? 0, 6);
  });

  it('honours `at`', () => {
    const doc = docFromMotifs(createDoc(), ['book'], FILES);
    const spot = placeNewLayer(doc, 'coin', FILES, { x: 12, y: 34 });
    expect(spot).toMatchObject({ x: 12, y: 34 });
  });

  it('nudges by 24 px per layer already at the centre', () => {
    const zone = getZones(ARTBOARD_PRESETS.og, 'composed').artZone;
    const cx = zone.x + zone.width / 2;
    const cy = zone.y + zone.height / 2;
    const one = docWith([layer({ x: cx + 3, y: cy - 5 })]);
    expect(placeNewLayer(one, 'coin', FILES)).toMatchObject({ x: cx + 24, y: cy + 24 });
    const two = docWith([layer({ x: cx, y: cy }), layer({ id: 'l2', x: cx + 24, y: cy + 24, rank: 1 })]);
    const third = placeNewLayer(two, 'coin', FILES);
    expect(third?.x).toBe(cx + 48);
    expect(third?.y).toBe(cy + 48);
    const far = docWith([layer({ x: cx + 100, y: cy })]);
    expect(placeNewLayer(far, 'coin', FILES)).toMatchObject({ x: cx, y: cy });
  });
});

describe('withBackgroundObjects', () => {
  const composed = (n: number, over: Partial<DocState> = {}): DocState =>
    docFromMotifs({ ...createDoc(), ...over }, (['book', 'coin', 'lamp', 'pen'] as MotifId[]).slice(0, n), FILES);

  it('on: adds one background object at the bottom without moving objects', () => {
    const doc = composed(3);
    const objects = doc.layers;
    const next = withBackgroundObjects(doc, FILES, true);
    expect(next.backgroundObjects).toBe(true);
    expect(next.layers.filter((l) => l.role === 'object')).toEqual(objects);
    const scenery = next.layers.filter((l) => l.role === 'background');
    expect(scenery.map((e) => e.motif)).toEqual(['bouquet']);
    expect(next.layers[0]).toEqual(scenery[0]);
    expect(scenery.map((e) => e.id)).toEqual(['l4']);
    expect(next.nextId).toBe(5);

    // Upright, at the scene's common scale.
    const bg = scenery[0] as Layer;
    const book = objects.find((l) => l.motif === 'book') as Layer;
    expect(bg.rotation).toBe(0);
    expect(bg.size / metaOf('bouquet', 'l', 'background').bounds.height).toBeCloseTo(book.size / metaOf('book').bounds.height, 6);
    expect(validateDoc(next)).not.toBeNull();
  });

  it('keeps the foreground intact when the selected background cannot fit', () => {
    const before = composed(2);
    const next = withBackgroundObjects(before, FILES, true);
    expect(next.backgroundObjects).toBe(true);
    expect(next.layers).toEqual(before.layers);
  });

  it('places it exactly where a fresh composition would', () => {
    const pose = (layers: Layer[]): Pick<Layer, 'motif' | 'x' | 'y' | 'size'> => {
      const { motif, x, y, size } = layers.find((l) => l.role === 'background') as Layer;
      return { motif, x, y, size };
    };
    const direct = composeLayers(
      { motifs: ['book', 'coin', 'lamp'], files: FILES, preset: 'og', layout: 'composed', detail: 'l', colorMode: 'color', backgroundObjects: true },
      1,
    );
    const toggled = withBackgroundObjects(composed(3), FILES, true);
    const a = pose(direct.layers);
    const b = pose(toggled.layers);
    expect(b.motif).toBe(a.motif);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
    expect(b.size).toBeCloseTo(a.size, 6);
  });

  it('off: removes background objects only and keeps objects', () => {
    const doc = composed(3, { backgroundObjects: true });
    expect(doc.layers.some((l) => l.role === 'background')).toBe(true);
    const next = withBackgroundObjects(doc, FILES, false);
    expect(next.backgroundObjects).toBe(false);
    expect(next.layers).toEqual(doc.layers.filter((l) => l.role === 'object'));
  });

  it('on replaces the existing background object instead of duplicating it', () => {
    const doc = composed(3, { backgroundObjects: true });
    const next = withBackgroundObjects(doc, FILES, true);
    expect(next.layers.filter((l) => l.role === 'background')).toHaveLength(1);
  });

  it('title layout: the background object keeps out of the headline zone', () => {
    for (const preset of ['og', 'square', 'portrait'] as const) {
      const doc = composed(3, { layout: 'title', preset });
      const next = withBackgroundObjects(doc, FILES, true);
      const headline = getZones(ARTBOARD_PRESETS[preset], 'title').headlineZone as Box;
      for (const e of next.layers.filter((l) => l.role === 'background')) {
        expect(boxesIntersect(layerBounds(e, metaOf(e.motif, 'l', 'background')), headline)).toBe(false);
      }
    }
  });

  it('takes a free corner, away from where the user moved the objects', () => {
    const doc = composed(1);
    const board = ARTBOARD_PRESETS.og;
    // The book is dragged into the top-left corner.
    const moved = { ...doc, layers: doc.layers.map((l) => ({ ...l, x: 150, y: 100 })) };
    const bg = withBackgroundObjects(moved, FILES, true).layers.find((l) => l.role === 'background') as Layer;
    expect(bg.x > board.width / 2 || bg.y > board.height / 2).toBe(true);
  });

  it('with no objects only flips the flag', () => {
    const next = withBackgroundObjects(createDoc(), FILES, true);
    expect(next.backgroundObjects).toBe(true);
    expect(next.layers).toEqual([]);
    expect(next.nextId).toBe(1);
  });
});

describe('recomposeDoc keeps user decisions', () => {
  it('hidden objects stay hidden after a format change', () => {
    const base = docFromMotifs(createDoc(), ['book', 'coin', 'lamp'], FILES);
    const coin = base.layers.find((l) => l.motif === 'coin');
    expect(coin).toBeDefined();
    const hidden: DocState = {
      ...base,
      layers: base.layers.map((l) => (l.id === coin?.id ? { ...l, hidden: true } : l)),
    };
    const next = recomposeDoc({ ...hidden, preset: 'portrait' }, FILES);
    expect(next.layers.find((l) => l.motif === 'coin')?.hidden).toBe(true);
    expect(next.layers.filter((l) => l.motif !== 'coin').every((l) => !l.hidden)).toBe(true);
  });
});

describe('recomposeDoc keeps identity, stacking and echoes', () => {
  const composedDoc = (motifs: MotifId[], over: Partial<DocState> = {}): DocState =>
    docFromMotifs({ ...createDoc(), ...over }, motifs, FILES);
  const hide = (doc: DocState, id: string): DocState => ({
    ...doc,
    layers: doc.layers.map((l) => (l.id === id ? { ...l, hidden: true } : l)),
  });
  const find = (doc: DocState, id: string): Layer | undefined => doc.layers.find((l) => l.id === id);

  it('every layer keeps its id, motif and rank through format and layout changes', () => {
    const base = composedDoc(['book', 'coin', 'lamp']);
    const patches: Partial<DocState>[] = [
      { preset: 'square' },
      { layout: 'title' },
      { layout: 'composed', preset: 'portrait' },
    ];
    for (const patch of patches) {
      const next = recomposeDoc({ ...base, ...patch }, FILES);
      expect(next.layers.map((l) => l.id).sort()).toEqual(base.layers.map((l) => l.id).sort());
      for (const old of base.layers) expect(find(next, old.id)).toMatchObject({ motif: old.motif, rank: old.rank });
      expect(next.nextId).toBe(base.nextId);
      expect(validateDoc(next)).not.toBeNull();
    }
  });

  it('a recompose that changes nothing in the roster does not touch the id counter', () => {
    const base = composedDoc(['book', 'coin'], { backgroundObjects: true });
    const next = recomposeDoc(base, FILES);
    expect(next.nextId).toBe(base.nextId);
    expect(next.layers.map((l) => l.id)).toEqual(base.layers.map((l) => l.id));
  });

  it('maps duplicates and rank gaps by rank order, hiding the right ones', () => {
    const doc = docWith(
      [
        layer({ id: 'l1', motif: 'coin', rank: 5 }),
        layer({ id: 'l2', motif: 'book', rank: 1, hidden: true }),
        layer({ id: 'l3', motif: 'coin', rank: 9, hidden: true }),
      ],
      { nextId: 4 },
    );
    const next = recomposeDoc(doc, FILES);
    expect(next.layers.map((l) => [l.id, l.rank, l.hidden === true])).toEqual([
      ['l1', 1, false],
      ['l2', 0, true],
      ['l3', 2, true],
    ]);
    expect(find(next, 'l1')).not.toHaveProperty('hidden');
  });

  it('keeps the mapping when some motif has no file any more', () => {
    const base = composedDoc(['book', 'lamp', 'coin']);
    const coin = base.layers.find((l) => l.motif === 'coin') as Layer;
    const next = recomposeDoc(hide(base, coin.id), FILES.filter((f) => f.motif !== 'lamp'));
    expect(next.layers.map((l) => l.motif).sort()).toEqual(['book', 'coin']);
    expect(find(next, coin.id)).toMatchObject({ motif: 'coin', hidden: true });
    expect(next.layers.filter((l) => l.hidden).map((l) => l.id)).toEqual([coin.id]);
  });

  it('retains a hand-made stacking order', () => {
    const base = composedDoc(['book', 'coin', 'lamp']);
    const reversed: DocState = { ...base, layers: [...base.layers].reverse() };
    for (const patch of [{ preset: 'square' }, { layout: 'title' }] as Partial<DocState>[]) {
      const next = recomposeDoc({ ...reversed, ...patch }, FILES);
      expect(next.layers.map((l) => l.id)).toEqual(reversed.layers.map((l) => l.id));
    }
  });

  it('keeps the background object at the bottom and objects in their stacking order', () => {
    const base = composedDoc(['book', 'coin', 'lamp'], { backgroundObjects: true });
    const scenery = base.layers.filter((l) => l.role === 'background');
    const objects = base.layers.filter((l) => l.role === 'object').reverse();
    const next = recomposeDoc({ ...base, layers: [...scenery, ...objects], preset: 'portrait' }, FILES);
    expect(next.layers.slice(0, 1).map((l) => l.id)).toEqual(scenery.map((l) => l.id));
    expect(next.layers.slice(1).map((l) => l.id)).toEqual(objects.map((l) => l.id));
  });

  it('the background object keeps its id and its hidden flag', () => {
    const base = composedDoc(['book', 'coin', 'lamp'], { backgroundObjects: true });
    const [bg] = base.layers.filter((l) => l.role === 'background');
    expect(bg?.motif).toBe('bouquet');
    const next = recomposeDoc({ ...hide(base, (bg as Layer).id), layout: 'title' }, FILES);
    const after = next.layers.filter((l) => l.role === 'background');
    expect(after.map((e) => e.id)).toEqual([(bg as Layer).id]);
    expect(after[0]?.hidden).toBe(true);
    expect(next.layers[0]).toEqual(after[0]);
    expect(next.nextId).toBe(base.nextId);
  });

  it('chooses the background object for the visible objects only', () => {
    const base = composedDoc(['wallet', 'coin'], { backgroundObjects: true });
    const hero = base.layers.find((l) => l.role === 'object' && l.rank === 0) as Layer;
    // A hidden wallet cannot become the background behind the remaining coin.
    const next = recomposeDoc({ ...hide(base, hero.id), preset: 'portrait' }, FILES);
    expect(find(next, hero.id)?.hidden).toBe(true);
    const scenery = next.layers.filter((l) => l.role === 'background');
    expect(scenery.map((e) => e.motif)).not.toContain('wallet');
    expect(scenery.map((e) => e.motif)).not.toContain('coin');
  });

  it('a background object that did not exist gets a fresh unique id', () => {
    const base = composedDoc(['book', 'coin', 'lamp']);
    const next = recomposeDoc({ ...base, backgroundObjects: true }, FILES);
    const ids = next.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(next.layers).toHaveLength(4);
    expect(next.layers.filter((l) => l.role === 'background').map((l) => l.id)).toEqual(['l4']);
    expect(next.nextId).toBe(5);
    expect(validateDoc(next)).not.toBeNull();
  });

  it('turning echoes off keeps the objects as they are', () => {
    const base = composedDoc(['book', 'coin', 'lamp'], { backgroundObjects: true });
    const next = recomposeDoc({ ...base, backgroundObjects: false }, FILES);
    expect(next.layers.map((l) => l.id)).toEqual(base.layers.filter((l) => l.role === 'object').map((l) => l.id));
  });
});

describe('layer limit', () => {
  const crowd = (count: number, over: Partial<DocState> = {}): DocState =>
    docFromMotifs({ ...createDoc(), ...over }, Array.from({ length: count }, () => 'coin' as MotifId), FILES);
  const roles = (doc: DocState): { objects: number; echoes: number } => ({
    objects: doc.layers.filter((l) => l.role === 'object').length,
    echoes: doc.layers.filter((l) => l.role === 'background').length,
  });
  const CASES = [
    { objects: MAX_LAYERS - 2, echoes: 1 },
    { objects: MAX_LAYERS - 1, echoes: 1 },
    { objects: MAX_LAYERS, echoes: 0 },
  ] as const;

  it('composing a brief longer than the limit stops at the limit', () => {
    const doc = crowd(MAX_LAYERS + 20, { backgroundObjects: true });
    expect(doc.layers).toHaveLength(MAX_LAYERS);
    expect(doc.nextId).toBe(MAX_LAYERS + 1);
    expect(roles(doc)).toEqual({ objects: MAX_LAYERS, echoes: 0 });
    expect(validateDoc(doc)).not.toBeNull();
  });

  it('recompose adds only the echoes that still fit', () => {
    for (const { objects, echoes } of CASES) {
      const next = recomposeDoc({ ...crowd(objects), backgroundObjects: true }, FILES);
      expect(roles(next).objects).toBe(objects);
      expect(roles(next).echoes).toBeLessThanOrEqual(echoes);
      expect(validateDoc(next), `${objects} objects`).not.toBeNull();
    }
  });

  it('composing with echoes adds only the echoes that still fit', () => {
    for (const { objects, echoes } of CASES) {
      const doc = crowd(objects, { backgroundObjects: true });
      expect(roles(doc).objects).toBe(objects);
      expect(roles(doc).echoes).toBeLessThanOrEqual(echoes);
      expect(validateDoc(doc), `${objects} objects`).not.toBeNull();
    }
  });

  it('switching echoes on adds only the echoes that still fit', () => {
    for (const { objects, echoes } of CASES) {
      const next = withBackgroundObjects(crowd(objects), FILES, true);
      expect(next.backgroundObjects).toBe(true);
      expect(roles(next).objects).toBe(objects);
      expect(roles(next).echoes).toBeLessThanOrEqual(echoes);
      expect(validateDoc(next), `${objects} objects`).not.toBeNull();
    }
  });

  it('addMotifToDoc refuses to go past the limit', () => {
    expect(addMotifToDoc(crowd(MAX_LAYERS), 'pen', FILES)).toBeNull();
    expect(addMotifToDoc(crowd(MAX_LAYERS - 1), 'pen', FILES)?.doc.layers).toHaveLength(MAX_LAYERS);
  });
});

describe('echo geometry', () => {
  it('stays inside the coordinate and size limits for an object at the limits', () => {
    const base = docFromMotifs(createDoc(), ['book'], FILES);
    const wild: DocState = {
      ...base,
      layers: base.layers.map((l) => ({ ...l, x: 1_000_000, y: -1_000_000, size: 9999 })),
    };
    const next = withBackgroundObjects(wild, FILES, true);
    // At this scale any background object would swallow the frame, so none is added; the document stays valid.
    expect(next.layers.filter((l) => l.role === 'background')).toHaveLength(0);
    expect(validateDoc(next)).not.toBeNull();
  });

  it('is cropped by a frame corner, never pushed into the middle of the scene', () => {
    const board = ARTBOARD_PRESETS.og;
    const doc = docFromMotifs({ ...createDoc(), backgroundObjects: true }, ['headphones', 'phone'], FILES);
    const bg = doc.layers.find((l) => l.role === 'background') as Layer;
    const box = layerBounds(bg, metaOf(bg.motif, 'l', 'background'));
    const share = visibleFraction(box, board);
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThan(1);
  });
});

describe('addMotifToDoc', () => {
  const board = ARTBOARD_PRESETS.og;
  const zone = getZones(board, 'composed').artZone;
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height / 2;
  const boxOf = (l: Layer): ReturnType<typeof layerBounds> => layerBounds(l, metaOf(l.motif));

  it('a lamp added to a lone coin fits the cover, and the coin shrinks with it', () => {
    const first = addMotifToDoc(createDoc(), 'coin', FILES);
    expect(first).not.toBeNull();
    // Hand-placed off the centre, so the proportional shrink has something to show.
    const handPlaced: DocState = {
      ...(first as { doc: DocState }).doc,
      layers: (first as { doc: DocState }).doc.layers.map((l) => ({ ...l, x: cx + 100, y: cy - 60 })),
    };
    const coin = handPlaced.layers[0] as Layer;

    const next = addMotifToDoc(handPlaced, 'lamp', FILES);
    expect(next).not.toBeNull();
    const added = next as { doc: DocState; id: string };
    expect(added.doc.layers).toHaveLength(2);
    const [coinAfter, lamp] = added.doc.layers as [Layer, Layer];
    expect(lamp.id).toBe(added.id);
    expect(added.doc.nextId).toBe(3);

    // The new motif is no bigger than the art zone allows, and sits on the artboard.
    const lampBox = boxOf(lamp);
    expect(lampBox.height).toBeLessThanOrEqual(0.9 * zone.height + 1e-6);
    expect(lampBox.width).toBeLessThanOrEqual(0.9 * zone.width + 1e-6);
    expect(visibleFraction(lampBox, board)).toBeCloseTo(1, 6);

    // The drawings keep their real relative sizes (common scale)…
    expect(lamp.size / coinAfter.size).toBeCloseTo(metaOf('lamp').bounds.height / metaOf('coin').bounds.height, 6);
    // …so the existing coin shrank in proportion, about the art-zone centre.
    const k = coinAfter.size / coin.size;
    expect(k).toBeLessThan(1);
    expect(coinAfter.x - cx).toBeCloseTo((coin.x - cx) * k, 6);
    expect(coinAfter.y - cy).toBeCloseTo((coin.y - cy) * k, 6);
    expect(coinAfter).toMatchObject({ id: coin.id, motif: 'coin', rank: 0 });
    expect(validateDoc(added.doc)).not.toBeNull();
  });

  it('an ordinary motif leaves the existing layers exactly as they are', () => {
    const base = docFromMotifs(createDoc(), ['book', 'coin', 'lamp'], FILES);
    const next = addMotifToDoc(base, 'pen', FILES);
    expect(next?.doc.layers.slice(0, 3)).toEqual(base.layers);
    expect(next?.doc.layers[3]).toMatchObject({ id: next?.id, motif: 'pen', role: 'object', rank: 3 });
    expect(next?.doc.nextId).toBe(base.nextId + 1);
  });

  it('shrinks echoes and hidden layers together with the rest of the composition', () => {
    const coins = docFromMotifs(createDoc(), ['coin', 'coin', 'coin'], FILES);
    const firstEcho = layer({ id: 'l4', motif: 'folder', role: 'background' });
    const base = { ...coins, layers: [firstEcho, ...coins.layers], nextId: 5 };
    const hidden: DocState = { ...base, layers: base.layers.map((l, i) => (i === 3 ? { ...l, hidden: true } : l)) };
    // A lamp is several times taller than a coin, so at the coins' common scale it needs the proportional fit.
    const next = addMotifToDoc(hidden, 'lamp', FILES);
    const after = next?.doc.layers as Layer[];
    expect(after).toHaveLength(base.layers.length + 1);
    const k = (after[2] as Layer).size / (base.layers[2] as Layer).size;
    expect(k).toBeLessThan(1);
    expect((after[0] as Layer).size / firstEcho.size).toBeCloseTo(k, 9);
    expect(after[3]?.hidden).toBe(true);
    expect(after.slice(0, base.layers.length).map((l) => l.role)).toEqual(base.layers.map((l) => l.role));
  });

  it('leaves a composition alone that the user already enlarged beyond the artboard, capping only the new layer', () => {
    const doc = docWith([layer({ size: 2000 })]);
    const next = addMotifToDoc(doc, 'lamp', FILES);
    expect(next?.doc.layers[0]).toEqual(doc.layers[0]);
    const lamp = next?.doc.layers[1] as Layer;
    expect(boxOf(lamp).height).toBeLessThanOrEqual(0.9 * zone.height + 1e-6);
  });

  it('puts the drawing where it was dropped, even at the edge of the artboard', () => {
    const next = addMotifToDoc(createDoc(), 'lamp', FILES, { x: 0, y: 0 });
    expect(next?.doc.layers[0]).toMatchObject({ x: 0, y: 0 });
    const wild = addMotifToDoc(createDoc(), 'lamp', FILES, { x: 9e9, y: Number.NaN });
    expect(wild?.doc.layers[0]).toMatchObject({ x: 1_000_000, y: 0 });
    expect(validateDoc(wild?.doc)).not.toBeNull();
  });

  it('keeps the whole drawing on the artboard when no drop point is given', () => {
    // Ten layers on the centre push the next one 240 px diagonally: its lower edge would leave the 630 px board.
    const stacked = docWith(
      Array.from({ length: 10 }, (_, i) => layer({ id: `l${i + 1}`, x: cx, y: cy, rank: i })),
    );
    const next = addMotifToDoc(stacked, 'lamp', FILES);
    const lamp = next?.doc.layers[10] as Layer;
    expect(lamp.x).toBeGreaterThan(cx);
    expect(visibleFraction(boxOf(lamp), board)).toBeCloseTo(1, 6);
  });

  it('returns null for a motif without files, and placeNewLayer never exceeds the art zone', () => {
    expect(addMotifToDoc(createDoc(), 'lamp', FILES.filter((f) => f.motif !== 'lamp'))).toBeNull();
    const coin = addMotifToDoc(createDoc(), 'coin', FILES) as { doc: DocState };
    const spot = placeNewLayer(coin.doc, 'lamp', FILES) as Omit<Layer, 'id'>;
    expect(boxOf({ ...spot, id: 'x' }).height).toBeLessThanOrEqual(0.9 * zone.height + 1e-6);
  });
});
