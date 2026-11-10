import { describe, expect, it } from 'vitest';
import type { DocState, Layer, MotifId } from '../domain/types';
import { ARTBOARD_PRESETS, getZones, layerBounds } from '../layout/compose';
import { allFileMetas, metaOf } from '../layout/testMetas';
import {
  DEMO_PRESETS,
  composeLayers,
  createDoc,
  docFromMotifs,
  objectMotifs,
  placeNewLayer,
  recomposeDoc,
  validateDoc,
  withBackgroundObjects,
} from './doc';

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

  it('rejects absurd layer counts', () => {
    const layers = Array.from({ length: 501 }, (_, i) => layer({ id: `l${i + 1}` }));
    expect(validateDoc({ ...createDoc(), layers, nextId: 600 })).toBeNull();
  });
});

describe('DEMO_PRESETS', () => {
  it('matches the agreed demo set', () => {
    expect(DEMO_PRESETS.map((d) => d.id)).toEqual(['spring-bouquet', 'first-salary', 'study-kit']);
    const [spring, salary, study] = DEMO_PRESETS;
    expect(spring).toMatchObject({
      preset: 'og',
      layout: 'title',
      detail: 'l',
      paletteId: 'lavender',
      colorMode: 'color',
      backgroundObjects: false,
      showPlane: true,
      brief: { mode: 'title', text: 'Весенний букет: как выбрать цветы к 8 Марта' },
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
      layout: 'offset',
      detail: 's',
      paletteId: 'mint',
      backgroundObjects: false,
      showPlane: true,
      brief: { mode: 'names', text: 'книга, наушники, лампа, ручка' },
    });
    expect(spring?.label.replace(/ /g, ' ')).toBe('Букет к 8 Марта');
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

  it('adds echoes for the top motif, or top two with three or more objects', () => {
    const two = composeLayers({ ...base, backgroundObjects: true, motifs: ['book', 'coin'] }, 1);
    expect(two.layers.filter((l) => l.role === 'background').map((l) => l.motif)).toEqual(['book']);
    const three = composeLayers({ ...base, backgroundObjects: true, motifs: ['book', 'coin', 'lamp'] }, 1);
    expect(three.layers.filter((l) => l.role === 'background').map((l) => l.motif)).toEqual(['book', 'coin']);
    expect(three.layers.slice(0, 2).every((l) => l.role === 'background')).toBe(true);
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

  it('recompose keeps settings, replaces layers, continues ids', () => {
    const base = docFromMotifs({ ...createDoc(), headline: 'Заголовок', paletteId: 'mint' }, ['book', 'coin'], FILES);
    expect(base.nextId).toBe(3);
    const next = recomposeDoc({ ...base, preset: 'portrait' }, FILES);
    expect(next.preset).toBe('portrait');
    expect(next.headline).toBe('Заголовок');
    expect(next.paletteId).toBe('mint');
    expect(objectMotifs(next)).toEqual(['book', 'coin']);
    expect(next.layers.map((l) => l.id)).toEqual(['l3', 'l4']);
    expect(next.nextId).toBe(5);
    const art = getZones(ARTBOARD_PRESETS.portrait, 'composed').artZone;
    for (const l of next.layers) {
      const b = layerBounds(l, metaOf(l.motif));
      expect(b.x).toBeGreaterThanOrEqual(art.x - 1);
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
    expect(spot?.size).toBeCloseTo(solo.size);
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

  it('on: derives echoes at the bottom without moving objects', () => {
    const doc = composed(3);
    const objects = doc.layers;
    const next = withBackgroundObjects(doc, FILES, true);
    expect(next.backgroundObjects).toBe(true);
    expect(next.layers.filter((l) => l.role === 'object')).toEqual(objects);
    const echoes = next.layers.filter((l) => l.role === 'background');
    expect(echoes.map((e) => e.motif)).toEqual(['book', 'coin']);
    expect(next.layers.slice(0, 2)).toEqual(echoes);
    expect(echoes.map((e) => e.id)).toEqual(['l4', 'l5']);
    expect(next.nextId).toBe(6);

    const book = objects.find((l) => l.motif === 'book') as Layer;
    const echo = echoes[0] as Layer;
    expect(echo.rotation).toBe(book.rotation);
    expect(echo.x).toBeGreaterThan(book.x);
    expect(echo.y).toBeLessThan(book.y);
    expect(echo.size / metaOf('book', 'l', 'background').bounds.height).toBeCloseTo(book.size / metaOf('book').bounds.height);
    expect(validateDoc(next)).not.toBeNull();
  });

  it('on with fewer than three objects: one echo', () => {
    const next = withBackgroundObjects(composed(2), FILES, true);
    expect(next.layers.filter((l) => l.role === 'background')).toHaveLength(1);
  });

  it('uses the same echo placement rules as compose (relative to the object)', () => {
    const rel = (layers: Layer[]): { motif: string; dx: number; dy: number; scale: number }[] =>
      layers
        .filter((l) => l.role === 'background')
        .map((e) => {
          const o = layers.find((l) => l.role === 'object' && l.motif === e.motif) as Layer;
          return { motif: e.motif, dx: (e.x - o.x) / o.size, dy: (e.y - o.y) / o.size, scale: e.size / o.size };
        });
    const direct = composeLayers(
      { motifs: ['book', 'coin', 'lamp'], files: FILES, preset: 'og', layout: 'composed', detail: 'l', colorMode: 'color', backgroundObjects: true },
      1,
    );
    const a = rel(direct.layers);
    const b = rel(withBackgroundObjects(composed(3), FILES, true).layers);
    expect(b).toHaveLength(a.length);
    a.forEach((e, i) => {
      expect(b[i]?.motif).toBe(e.motif);
      expect(b[i]?.dx).toBeCloseTo(e.dx, 6);
      expect(b[i]?.dy).toBeCloseTo(e.dy, 6);
      expect(b[i]?.scale).toBeCloseTo(e.scale, 6);
    });
  });

  it('off: removes echoes only and keeps objects', () => {
    const doc = composed(3, { backgroundObjects: true });
    expect(doc.layers.some((l) => l.role === 'background')).toBe(true);
    const next = withBackgroundObjects(doc, FILES, false);
    expect(next.backgroundObjects).toBe(false);
    expect(next.layers).toEqual(doc.layers.filter((l) => l.role === 'object'));
  });

  it('on replaces existing echoes instead of duplicating them', () => {
    const doc = composed(3, { backgroundObjects: true });
    const next = withBackgroundObjects(doc, FILES, true);
    expect(next.layers.filter((l) => l.role === 'background')).toHaveLength(2);
  });

  it('title layout: echoes keep out of the headline zone', () => {
    const doc = composed(3, { layout: 'title' });
    const next = withBackgroundObjects(doc, FILES, true);
    const zones = getZones(ARTBOARD_PRESETS.og, 'title');
    for (const e of next.layers.filter((l) => l.role === 'background')) {
      const b = layerBounds(e, metaOf(e.motif, 'l', 'background'));
      expect(b.x).toBeGreaterThanOrEqual((zones.headlineZone?.x ?? 0) + (zones.headlineZone?.width ?? 0) - 1);
    }
  });

  it('follows manually moved objects', () => {
    const doc = composed(1);
    const moved = { ...doc, layers: doc.layers.map((l) => ({ ...l, x: 300, y: 300 })) };
    const next = withBackgroundObjects(moved, FILES, true);
    const echo = next.layers.find((l) => l.role === 'background') as Layer;
    expect(Math.abs(echo.x - 300)).toBeGreaterThan(0);
    expect(Math.abs(echo.x - 300)).toBeLessThan(120);
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
