import { describe, expect, it } from 'vitest';
import { parseAssetFileName, parsePlaneFileName } from '../assets/availability';
import { createDoc } from '../doc/doc';
import type {
  AssetFileMeta,
  ColorResolver,
  DocState,
  Layer,
  MotifId,
  Palette,
  PlaneFileMeta,
  SourcePaletteId,
} from '../domain/types';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { buildTemplate, type SvgTemplate } from '../svg/template';
import { FORBIDDEN_ELEMENTS, checkReferences } from '../svg/testing';
import { childElements, getAttr, parseXml, type XmlElement } from '../svg/xml';
import { exportFileName } from '../ui/util/slug';
import {
  buildExportSvg,
  exportTitle,
  formatNumber,
  hasExportableContent,
  layerAsset,
  layerAttributes,
  layerGroupIds,
  layerScale,
  layerTransform,
  nothingToExportReason,
  planeAttributes,
  renderLayer,
  renderPlane,
  requiredFiles,
  type RenderContext,
} from './render';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK_NS = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

/** Coloured object: root fill="none", fill="white", clipPath, linearGradient, a source colour (#7864d7) to remap. */
const BOOK_MAIN_SVG = `<svg width="100" height="80" viewBox="0 0 100 80" fill="none" ${NS}>
<g clip-path="url(#clip0)">
<rect width="100" height="80" fill="#7864D7"/>
<path d="M10 10H90V70H10Z" fill="url(#grad)" stroke="white"/>
</g>
<defs>
<clipPath id="clip0"><rect width="100" height="80" fill="white"/></clipPath>
<linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#AA9BF0"/><stop offset="1" stop-color="#181817"/></linearGradient>
</defs>
</svg>`;

/** Monochrome background variant: only the two background swatches. */
const BOOK_BACKGROUND_SVG = `<svg width="100" height="80" viewBox="0 0 100 80" fill="none" ${NS}>
<g clip-path="url(#clip0)">
<path d="M0 0H100V80H0Z" fill="#D7CDF5"/>
<path d="M10 10H90" stroke="#7864D7"/>
</g>
<defs><clipPath id="clip0"><rect width="100" height="80" fill="white"/></clipPath></defs>
</svg>`;

/** Object that references its own defs through xlink:href. */
const COIN_SVG = `<svg width="60" height="60" viewBox="0 0 60 60" fill="none" ${NS} ${XLINK_NS}>
<use xlink:href="#shape"/>
<defs><circle id="shape" cx="30" cy="30" r="28" fill="#F9ECB0" stroke="#181817"/></defs>
</svg>`;

function planeSvg(size: number, fill: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" ${NS}>
<g clip-path="url(#clip0)">
<rect width="${size}" height="${size}" fill="${fill}"/>
<line x1="0" y1="0" x2="${size}" y2="${size}" stroke="#D27532"/>
</g>
<defs><clipPath id="clip0"><rect width="${size}" height="${size}" fill="white"/></clipPath></defs>
</svg>`;
}

function palette(id: SourcePaletteId): Palette {
  const found = BUILTIN_PALETTES.find((p) => p.id === id);
  if (!found) throw new Error(`Нет встроенной палитры ${id}`);
  return found;
}

function makeAsset(file: string, svg: string): { meta: AssetFileMeta; template: SvgTemplate } {
  const parsed = parseAssetFileName(file);
  if (!parsed) throw new Error(`Некорректное имя фикстуры ${file}`);
  const template = buildTemplate(svg, { file, source: 'lavender' });
  const meta: AssetFileMeta = {
    file,
    ...parsed,
    viewBox: template.viewBox,
    bounds: template.bounds,
    colors: template.colors,
    bytes: svg.length,
    warnings: template.warnings,
  };
  return { meta, template };
}

function makePlane(file: string, svg: string): { meta: PlaneFileMeta; template: SvgTemplate } {
  const parsed = parsePlaneFileName(file);
  if (!parsed) throw new Error(`Некорректное имя фикстуры ${file}`);
  const template = buildTemplate(svg, { file, source: parsed.palette });
  const meta: PlaneFileMeta = {
    file,
    ...parsed,
    viewBox: template.viewBox,
    bounds: template.bounds,
    colors: template.colors,
    bytes: svg.length,
    warnings: template.warnings,
  };
  return { meta, template };
}

// A synthetic library: book (l-main, l-background), coin (l-main only, uses xlink), no pen.
// Planes: peach-l only, lavender-s and lavender-l.
const ASSETS = [
  makeAsset('book-l-main.svg', BOOK_MAIN_SVG),
  makeAsset('book-l-background.svg', BOOK_BACKGROUND_SVG),
  makeAsset('coin-l-main.svg', COIN_SVG),
];
const PLANES = [
  makePlane('plane-peach-l.svg', planeSvg(1000, '#FDD7B9')),
  makePlane('plane-lavender-l.svg', planeSvg(1000, '#D7CDF5')),
  makePlane('plane-lavender-s.svg', planeSvg(500, '#D7CDF5')),
];
const FILES = ASSETS.map((a) => a.meta);
const PLANE_METAS = PLANES.map((p) => p.meta);
const TEMPLATES = new Map<string, SvgTemplate>([...ASSETS, ...PLANES].map((e) => [e.template.file, e.template]));

/** Fake resolver: the lavender accent colour becomes #123456, everything else is left alone. */
const recolor: ColorResolver = (hex) => (hex === '#7864d7' ? '#123456' : hex);

function ctx(over: Partial<RenderContext> = {}): RenderContext {
  return {
    files: FILES,
    planes: PLANE_METAS,
    templates: TEMPLATES,
    detail: 'l',
    colorMode: 'color',
    palette: palette('peach'),
    color: recolor,
    ...over,
  };
}

function layer(id: string, motif: MotifId, over: Partial<Layer> = {}): Layer {
  return { id, motif, role: 'object', x: 100, y: 100, rotation: 0, size: 50, rank: 0, ...over };
}

function docWith(layers: Layer[], over: Partial<DocState> = {}): DocState {
  return { ...createDoc(), detail: 'l', colorMode: 'color', showPlane: false, layers, ...over };
}

const ARTBOARD = { width: 1200, height: 630 };

/** Z-order: echo, book, hidden book, coin, book (two visible instances of the same file). */
const ECHO = layer('l1', 'book', { role: 'background', x: 400, y: 300, size: 200 });
const BOOK_A = layer('l2', 'book', { x: 600, y: 315, rotation: 12.5, size: 240 });
const BOOK_HIDDEN = layer('l3', 'book', { hidden: true });
const COIN = layer('l4', 'coin', { x: 300, y: 200, size: 100 });
const BOOK_B = layer('l5', 'book', { x: 900, y: 400, rotation: -30, size: 120 });
const MIXED_LAYERS = [ECHO, BOOK_A, BOOK_HIDDEN, COIN, BOOK_B];

/** Visible layers (with their group ids) in z-order, rendered the same way the exporter does. */
function visibleRendered(doc: DocState, context: RenderContext) {
  const ids = layerGroupIds(doc.layers);
  return doc.layers
    .filter((l) => !l.hidden)
    .map((l) => renderLayer(l, ids.get(l.id) ?? l.id, context))
    .filter((r) => r !== null);
}

function exportOf(doc: DocState, context = ctx(), over: { paper?: string; title?: string; artboard?: { width: number; height: number } } = {}): string {
  return buildExportSvg(doc, context, { artboard: ARTBOARD, paper: '#ffffff', ...over });
}

/** checkReferences wraps fragments but needs a bare root element, so the XML prolog is dropped first. */
function referencesOf(svg: string) {
  return checkReferences(svg.replace(/^<\?xml[^>]*\?>\s*/, ''));
}

function artworkGroups(svg: string): XmlElement[] {
  const artwork = childElements(parseXml(svg)).find((el) => getAttr(el, 'id') === 'artwork');
  if (!artwork) throw new Error('В экспорте нет группы #artwork');
  return childElements(artwork);
}

function attributesMarkup(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('');
}

/* ------------------------------------------------------------------ */
/* Numbers and transforms                                              */
/* ------------------------------------------------------------------ */

describe('formatNumber', () => {
  it.each([
    [0, '0'],
    [-0, '0'],
    [5, '5'],
    [2.0, '2'],
    [1.5, '1.5'],
    [1200, '1200'],
    [1.23456, '1.235'],
    [-2.5678, '-2.568'],
    [0.1 + 0.2, '0.3'],
    [0.001, '0.001'],
    [0.0004, '0'],
    [-0.0004, '0'],
    [1e-7, '0'],
  ])('formats %s as «%s»', (value, expected) => {
    expect(formatNumber(value)).toBe(expected);
  });
});

describe('layerScale / layerTransform', () => {
  const meta: AssetFileMeta = {
    file: 'book-l-main.svg',
    motif: 'book',
    detail: 'l',
    variant: 'main',
    viewBox: { x: 0, y: 0, width: 400, height: 300 },
    bounds: { x: 10, y: 20, width: 200, height: 100 },
    colors: [],
    bytes: 1,
    warnings: [],
  };

  it('scales uniformly by size / bounds.height', () => {
    expect(layerScale(layer('a', 'book', { size: 50 }), meta)).toBe(0.5);
    expect(layerScale(layer('a', 'book', { size: 300 }), meta)).toBe(3);
  });

  it('falls back to the viewBox height for empty bounds, and to 1 when both are empty', () => {
    const noBounds = { ...meta, bounds: { x: 0, y: 0, width: 0, height: 0 } };
    expect(layerScale(layer('a', 'book', { size: 150 }), noBounds)).toBe(0.5);
    const nothing = { ...noBounds, viewBox: { x: 0, y: 0, width: 0, height: 0 } };
    expect(layerScale(layer('a', 'book', { size: 150 }), nothing)).toBe(1);
  });

  it('composes translate · scale · re-centre and omits rotate at 0°', () => {
    const transform = layerTransform(layer('a', 'book', { x: 300, y: 150, rotation: 0, size: 50 }), meta);
    // bounds centre = (10 + 200/2, 20 + 100/2) = (110, 70)
    expect(transform).toBe('translate(300 150) scale(0.5) translate(-110 -70)');
    expect(transform).not.toContain('rotate');
  });

  it('puts rotate between translate and scale', () => {
    const transform = layerTransform(layer('a', 'book', { x: 300, y: 150, rotation: 30, size: 50 }), meta);
    expect(transform).toBe('translate(300 150) rotate(30) scale(0.5) translate(-110 -70)');
    expect(layerTransform(layer('a', 'book', { rotation: -12.5 }), meta)).toContain(' rotate(-12.5) ');
  });

  it('omits rotate when the rotation rounds to zero and rounds everything to 3 decimals', () => {
    expect(layerTransform(layer('a', 'book', { rotation: 0.0004 }), meta)).not.toContain('rotate');
    expect(layerTransform(layer('a', 'book', { rotation: -0.0004 }), meta)).not.toContain('rotate');
    const transform = layerTransform(layer('a', 'book', { x: 10.12345, y: 1.9996, rotation: 12.34567, size: 100 }), {
      ...meta,
      bounds: { x: 0, y: 0, width: 30, height: 300 },
    });
    // centre (15, 150), scale 100/300 = 0.3333…
    expect(transform).toBe('translate(10.123 2) rotate(12.346) scale(0.333) translate(-15 -150)');
  });

  it('re-centres by the bounds centre, including a negative origin', () => {
    const negative = { ...meta, bounds: { x: -10, y: -20, width: 40, height: 20 } };
    expect(layerTransform(layer('a', 'book', { x: 0, y: 0, size: 20 }), negative)).toBe('translate(0 0) scale(1) translate(-10 10)');
  });

  it('keeps the rendered height equal to layer.size whatever file (S or L) is used', () => {
    const small = { ...meta, bounds: { x: 0, y: 0, width: 100, height: 120 } };
    const large = { ...meta, bounds: { x: 0, y: 0, width: 200, height: 240 } };
    const l = layer('a', 'book', { size: 60 });
    for (const m of [small, large]) {
      const scale = Number(/scale\(([^ )]+)\)/.exec(layerTransform(l, m))?.[1]);
      expect(scale * m.bounds.height).toBeCloseTo(60, 6);
    }
  });
});

describe('layerGroupIds', () => {
  it('numbers duplicates per motif and role in z-order, echoes separately', () => {
    const layers = [
      layer('a', 'book', { role: 'background' }),
      layer('b', 'book'),
      layer('c', 'book'),
      layer('d', 'coin'),
      layer('e', 'book', { role: 'background' }),
      layer('f', 'coin'),
    ];
    const ids = layerGroupIds(layers);
    expect([...ids]).toEqual([
      ['a', 'book-background-1'],
      ['b', 'book-1'],
      ['c', 'book-2'],
      ['d', 'coin-1'],
      ['e', 'book-background-2'],
      ['f', 'coin-2'],
    ]);
    expect(new Set(ids.values()).size).toBe(layers.length);
  });

  it('does not depend on the hidden flag, so ids stay stable when a layer is toggled', () => {
    const visible = layerGroupIds([layer('a', 'book'), layer('b', 'book')]);
    const hidden = layerGroupIds([layer('a', 'book', { hidden: true }), layer('b', 'book')]);
    expect(hidden).toEqual(visible);
  });
});

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

describe('renderLayer', () => {
  it('renders the exact file with prefixed ids, mapped colours and the layer transform', () => {
    const l = layer('l9', 'book', { x: 300, y: 150, size: 40 });
    const rendered = renderLayer(l, 'book-1', ctx());
    if (!rendered) throw new Error('layer was not rendered');

    expect(rendered.layer).toBe(l);
    expect(rendered.groupId).toBe('book-1');
    expect(rendered.meta.file).toBe('book-l-main.svg');
    expect(rendered.fallback).toBe(false);
    expect(rendered.transform).toBe(layerTransform(l, rendered.meta));

    const root = parseXml(rendered.markup);
    expect(root.name).toBe('g');
    expect(getAttr(root, 'fill')).toBe('none');

    expect(rendered.markup).toContain('id="book-1__clip0"');
    expect(rendered.markup).toContain('clip-path="url(#book-1__clip0)"');
    expect(rendered.markup).toContain('fill="url(#book-1__grad)"');
    expect(rendered.markup).toContain('fill="#123456"');
    expect(rendered.markup).not.toContain('#7864d7');
    expect(rendered.markup).toContain('stroke="#ffffff"');
    expect(rendered.markup).not.toContain('white');
  });

  it('asks the colour resolver for the template source palette', () => {
    const calls: [string, SourcePaletteId][] = [];
    const spy: ColorResolver = (hex, source) => {
      calls.push([hex, source]);
      return hex;
    };
    renderLayer(layer('a', 'book'), 'book-1', ctx({ color: spy }));
    expect(calls.length).toBeGreaterThan(0);
    expect(new Set(calls.map(([, source]) => source))).toEqual(new Set(['lavender']));
    expect(calls.map(([hex]) => hex).sort()).toEqual([...(TEMPLATES.get('book-l-main.svg')?.colors ?? [])].sort());
  });

  it('returns null when the template is not loaded yet', () => {
    expect(renderLayer(layer('a', 'book'), 'book-1', ctx({ templates: new Map() }))).toBeNull();
    const withoutBook = new Map(TEMPLATES);
    withoutBook.delete('book-l-main.svg');
    expect(renderLayer(layer('a', 'book'), 'book-1', ctx({ templates: withoutBook }))).toBeNull();
    expect(renderLayer(layer('a', 'coin'), 'coin-1', ctx({ templates: withoutBook }))).not.toBeNull();
  });

  it('returns null for a motif without any file', () => {
    expect(renderLayer(layer('a', 'pen'), 'pen-1', ctx())).toBeNull();
    expect(layerAsset(layer('a', 'pen'), ctx())).toBeNull();
  });

  it('flags a fallback file (and only then)', () => {
    // coin only has l-main: s detail falls back to it, and so does the echo (background) variant.
    const fallbackDetail = renderLayer(layer('a', 'coin'), 'coin-1', ctx({ detail: 's' }));
    expect(fallbackDetail?.meta.file).toBe('coin-l-main.svg');
    expect(fallbackDetail?.fallback).toBe(true);

    const fallbackVariant = renderLayer(layer('a', 'coin', { role: 'background' }), 'coin-background-1', ctx());
    expect(fallbackVariant?.meta.file).toBe('coin-l-main.svg');
    expect(fallbackVariant?.fallback).toBe(true);

    expect(renderLayer(layer('a', 'coin'), 'coin-1', ctx())?.fallback).toBe(false);
  });

  it('uses the monochrome background file for objects in mono mode, main file in colour mode', () => {
    const object = layer('a', 'book');
    expect(renderLayer(object, 'book-1', ctx({ colorMode: 'color' }))?.meta.file).toBe('book-l-main.svg');

    const mono = renderLayer(object, 'book-1', ctx({ colorMode: 'mono' }));
    expect(mono?.meta.file).toBe('book-l-background.svg');
    expect(mono?.fallback).toBe(false);

    // Echoes are always the background file.
    const echo = layer('b', 'book', { role: 'background' });
    expect(renderLayer(echo, 'book-background-1', ctx({ colorMode: 'color' }))?.meta.file).toBe('book-l-background.svg');
    expect(renderLayer(echo, 'book-background-1', ctx({ colorMode: 'mono' }))?.meta.file).toBe('book-l-background.svg');
  });

  it('falls back to the main file and flags it when mono mode has no background file', () => {
    const rendered = renderLayer(layer('a', 'coin'), 'coin-1', ctx({ colorMode: 'mono' }));
    expect(rendered?.meta.file).toBe('coin-l-main.svg');
    expect(rendered?.fallback).toBe(true);
  });

  it('gives every instance of the same file its own id namespace', () => {
    const first = renderLayer(layer('a', 'book'), 'book-1', ctx());
    const second = renderLayer(layer('b', 'book'), 'book-2', ctx());
    const report = referencesOf(`${first?.markup}${second?.markup}`);
    expect(report.references.length).toBeGreaterThan(0);
    expect(report.dangling).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Plane                                                               */
/* ------------------------------------------------------------------ */

describe('renderPlane', () => {
  const planeDoc = docWith([], { showPlane: true });

  it('is null when the plane is off, missing or not loaded', () => {
    expect(renderPlane(docWith([], { showPlane: false }), ARTBOARD, ctx())).toBeNull();
    expect(renderPlane(planeDoc, ARTBOARD, ctx({ planes: [] }))).toBeNull();
    expect(renderPlane(planeDoc, ARTBOARD, ctx({ templates: new Map() }))).toBeNull();
  });

  it('renders the palette plane as group `plane` with its own id prefix and source palette', () => {
    const calls: [string, SourcePaletteId][] = [];
    const spy: ColorResolver = (hex, source) => {
      calls.push([hex, source]);
      return hex;
    };
    const rendered = renderPlane(planeDoc, ARTBOARD, ctx({ color: spy }));
    if (!rendered) throw new Error('plane was not rendered');

    expect(rendered.groupId).toBe('plane');
    expect(rendered.meta.file).toBe('plane-peach-l.svg');
    expect(rendered.fallback).toBe(false);
    expect(rendered.markup).toContain('id="plane__clip0"');
    expect(rendered.markup).toContain('url(#plane__clip0)');
    expect(new Set(calls.map(([, source]) => source))).toEqual(new Set(['peach']));
    expect(planeAttributes(rendered)).toEqual({ id: 'plane', transform: rendered.transform, 'data-forma-role': 'plane' });
  });

  it('falls back to the same palette in the other detail, then to lavender, and flags it', () => {
    const peachS = renderPlane(planeDoc, ARTBOARD, ctx({ detail: 's' }));
    expect(peachS?.meta.file).toBe('plane-peach-l.svg');
    expect(peachS?.fallback).toBe(true);

    const mint = renderPlane(planeDoc, ARTBOARD, ctx({ palette: palette('mint'), detail: 's' }));
    expect(mint?.meta.file).toBe('plane-lavender-s.svg');
    expect(mint?.fallback).toBe(true);
  });

  it('cover-fits a 1000×1000 plane into 1200×630 and 1080×1350 with a centred crop', () => {
    const wide = renderPlane(planeDoc, { width: 1200, height: 630 }, ctx());
    expect(wide?.transform).toBe('translate(0 -285) scale(1.2) translate(0 0)');

    const tall = renderPlane(planeDoc, { width: 1080, height: 1350 }, ctx());
    expect(tall?.transform).toBe('translate(-135 0) scale(1.35) translate(0 0)');
  });

  it('cover-fits a 500×500 plane (scale = the larger ratio) and a square board without offset', () => {
    const s = ctx({ palette: palette('lavender'), detail: 's' });
    expect(renderPlane(planeDoc, { width: 1200, height: 630 }, s)?.transform).toBe('translate(0 -285) scale(2.4) translate(0 0)');
    expect(renderPlane(planeDoc, { width: 1080, height: 1350 }, s)?.transform).toBe('translate(-135 0) scale(2.7) translate(0 0)');
    expect(renderPlane(planeDoc, { width: 1080, height: 1080 }, s)?.transform).toBe('translate(0 0) scale(2.16) translate(0 0)');
  });

  it('honours a non-zero viewBox origin', () => {
    const shifted: PlaneFileMeta[] = PLANE_METAS.map((p) => ({ ...p, viewBox: { x: 10, y: 20, width: 100, height: 100 } }));
    const rendered = renderPlane(planeDoc, { width: 200, height: 100 }, ctx({ planes: shifted }));
    expect(rendered?.transform).toBe('translate(0 -50) scale(2) translate(-10 -20)');
  });

  it.each([
    ['1200×630', { width: 1200, height: 630 }],
    ['1080×1350', { width: 1080, height: 1350 }],
    ['1080×1080', { width: 1080, height: 1080 }],
  ])('covers the whole %s artboard without leaving a gap', (_label, artboard) => {
    for (const context of [ctx(), ctx({ palette: palette('lavender'), detail: 's' })]) {
      const rendered = renderPlane(planeDoc, artboard, context);
      const m = /^translate\((\S+) (\S+)\) scale\((\S+)\) translate\((\S+) (\S+)\)$/.exec(rendered?.transform ?? '');
      if (!m) throw new Error(`unexpected transform ${rendered?.transform}`);
      const [tx, ty, scale] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const vb = rendered?.meta.viewBox;
      if (!vb) throw new Error('no viewBox');
      expect(tx).toBeLessThanOrEqual(0.001);
      expect(ty).toBeLessThanOrEqual(0.001);
      expect(tx + vb.width * scale).toBeGreaterThanOrEqual(artboard.width - 0.01);
      expect(ty + vb.height * scale).toBeGreaterThanOrEqual(artboard.height - 0.01);
    }
  });
});

/* ------------------------------------------------------------------ */
/* requiredFiles                                                       */
/* ------------------------------------------------------------------ */

describe('requiredFiles', () => {
  const peach = palette('peach');
  const base = { files: FILES, planes: PLANE_METAS, palette: peach };

  it('lists each needed file once and skips hidden layers and motifs without files', () => {
    const doc = docWith([ECHO, BOOK_A, BOOK_HIDDEN, COIN, BOOK_B, layer('p', 'pen')]);
    const files = requiredFiles(doc, base);
    expect([...files].sort()).toEqual(['book-l-background.svg', 'book-l-main.svg', 'coin-l-main.svg']);
    expect(new Set(files).size).toBe(files.length);
  });

  it('does not require the files of hidden layers', () => {
    const doc = docWith([BOOK_A, layer('h', 'coin', { hidden: true })]);
    expect(requiredFiles(doc, base)).toEqual(['book-l-main.svg']);
    expect(requiredFiles(docWith([layer('h', 'coin', { hidden: true })]), base)).toEqual([]);
  });

  it('includes the plane only when it is on (resolved for the palette and detail)', () => {
    expect(requiredFiles(docWith([BOOK_A], { showPlane: false }), base)).toEqual(['book-l-main.svg']);
    expect([...requiredFiles(docWith([BOOK_A], { showPlane: true }), base)].sort()).toEqual(['book-l-main.svg', 'plane-peach-l.svg']);
    expect(requiredFiles(docWith([], { showPlane: true }), { ...base, palette: palette('mint') })).toEqual(['plane-lavender-l.svg']);
    expect(requiredFiles(docWith([], { showPlane: true }), { ...base, planes: [] })).toEqual([]);
  });

  it('follows the colour mode and the fallback rules of renderLayer', () => {
    expect(requiredFiles(docWith([BOOK_A], { colorMode: 'mono' }), base)).toEqual(['book-l-background.svg']);
    expect(requiredFiles(docWith([COIN], { detail: 's' }), base)).toEqual(['coin-l-main.svg']);
  });
});

/* ------------------------------------------------------------------ */
/* What is worth exporting, and what it is called                      */
/* ------------------------------------------------------------------ */

describe('hasExportableContent', () => {
  const base = { files: FILES, planes: PLANE_METAS, palette: palette('peach') };
  const hiddenBook = { ...BOOK_A, hidden: true };
  const hiddenCoin = { ...COIN, hidden: true };

  it('is false for paper only: no layers, or every layer hidden and no plane', () => {
    expect(hasExportableContent(docWith([]), base)).toBe(false);
    expect(hasExportableContent(docWith([hiddenBook, hiddenCoin]), base)).toBe(false);
  });

  it('is true as soon as one layer is visible', () => {
    expect(hasExportableContent(docWith([BOOK_A]), base)).toBe(true);
    expect(hasExportableContent(docWith([hiddenBook, COIN]), base)).toBe(true);
  });

  it('counts a visible plane as content, alone or under hidden layers', () => {
    expect(hasExportableContent(docWith([], { showPlane: true }), base)).toBe(true);
    expect(hasExportableContent(docWith([hiddenBook], { showPlane: true }), base)).toBe(true);
  });

  it('ignores a plane the palette cannot draw and layers without a file', () => {
    expect(hasExportableContent(docWith([], { showPlane: true }), { ...base, planes: [] })).toBe(false);
    expect(hasExportableContent(docWith([layer('p', 'pen')]), base)).toBe(false);
  });

  it('agrees with what buildExportSvg draws: an export with content has a layer or the plane in it', () => {
    const drawn = (doc: DocState): boolean => {
      const root = parseXml(exportOf(doc));
      const ids = childElements(root).map((el) => getAttr(el, 'id'));
      return ids.includes('plane') || artworkGroups(exportOf(doc)).length > 0;
    };
    const docs = [
      docWith([]),
      docWith([hiddenBook]),
      docWith([BOOK_A]),
      docWith([], { showPlane: true }),
      docWith([hiddenBook], { showPlane: true }),
      docWith([layer('p', 'pen')]),
    ];
    for (const doc of docs) expect(hasExportableContent(doc, base)).toBe(drawn(doc));
  });
});

describe('nothingToExportReason', () => {
  const base = { files: FILES, planes: PLANE_METAS, palette: palette('peach') };

  it('names the cause, and is null when there is something to export', () => {
    expect(nothingToExportReason(docWith([]), base)).toBe('Холст пуст');
    expect(nothingToExportReason(docWith([{ ...BOOK_A, hidden: true }]), base)).toBe('Все объекты скрыты');
    expect(nothingToExportReason(docWith([layer('p', 'pen')]), base)).toBe('Нечего рисовать');
    expect(nothingToExportReason(docWith([BOOK_A]), base)).toBeNull();
    expect(nothingToExportReason(docWith([], { showPlane: true }), base)).toBeNull();
  });
});

describe('exportTitle', () => {
  const NAMES: Partial<Record<MotifId, string>> = { book: 'Книга', coin: 'Монета', pen: 'Ручка' };
  const nameOf = (motif: MotifId): string => NAMES[motif] ?? motif;

  it('lists the objects of the file once each, in rank order', () => {
    const doc = docWith([layer('a', 'coin', { rank: 1 }), layer('b', 'book', { rank: 0 }), layer('c', 'coin', { rank: 2 })]);
    expect(exportTitle(doc, nameOf)).toBe('Книга, Монета');
  });

  it('leaves out hidden objects and echoes, which are not in the file', () => {
    expect(exportTitle(docWith([BOOK_A, { ...COIN, hidden: true }]), nameOf)).toBe('Книга');
    expect(exportTitle(docWith([ECHO, BOOK_A]), nameOf)).toBe('Книга');
    expect(exportTitle(docWith([{ ...BOOK_A, hidden: true }, COIN]), nameOf)).toBe('Монета');
  });

  it('is empty when no object is left, so the caller falls back to the default', () => {
    expect(exportTitle(docWith([]), nameOf)).toBe('');
    expect(exportTitle(docWith([{ ...BOOK_A, hidden: true }], { showPlane: true }), nameOf)).toBe('');
  });

  it('keeps a deliberate headline, trimmed, even when its objects are hidden', () => {
    expect(exportTitle(docWith([BOOK_A], { headline: '  Весенний букет ' }), nameOf)).toBe('Весенний букет');
    expect(exportTitle(docWith([{ ...BOOK_A, hidden: true }], { headline: 'Заголовок' }), nameOf)).toBe('Заголовок');
  });

  it('uses only the visible objects of a names list, which has no headline', () => {
    const doc = docWith([BOOK_A, { ...COIN, hidden: true }], { brief: { mode: 'names', text: 'книга, монета' }, headline: '' });
    expect(exportTitle(doc, nameOf)).toBe('Книга');
    expect(exportFileName(exportTitle(doc, nameOf), 1200, 630)).toBe('forma-kniga-1200x630.svg');
  });

  it('gives a file name of its own when there is no title at all', () => {
    expect(exportFileName(exportTitle(docWith([], { showPlane: true }), nameOf), 1200, 630)).toBe(
      'forma-illustration-1200x630.svg',
    );
  });
});

/* ------------------------------------------------------------------ */
/* buildExportSvg                                                      */
/* ------------------------------------------------------------------ */

describe('buildExportSvg', () => {
  it('writes a standalone SVG document: prolog, xmlns, size and viewBox', () => {
    const svg = exportOf(docWith([BOOK_A]));
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>\n')).toBe(true);

    const root = parseXml(svg);
    expect(root.name).toBe('svg');
    expect(getAttr(root, 'xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(getAttr(root, 'width')).toBe('1200');
    expect(getAttr(root, 'height')).toBe('630');
    expect(getAttr(root, 'viewBox')).toBe('0 0 1200 630');

    const portrait = exportOf(docWith([BOOK_A]), ctx(), { artboard: { width: 1080, height: 1350 } });
    expect(portrait).toContain('width="1080" height="1350" viewBox="0 0 1080 1350"');
  });

  it('declares xmlns:xlink only when a used template contains xlink:href', () => {
    const plain = exportOf(docWith([BOOK_A]));
    expect(plain).not.toContain('xmlns:xlink');
    expect(plain).not.toContain('xlink:href');

    const withXlink = exportOf(docWith([BOOK_A, COIN]));
    expect(getAttr(parseXml(withXlink), 'xmlns:xlink')).toBe('http://www.w3.org/1999/xlink');
    expect(withXlink).toContain('xlink:href="#coin-1__shape"');

    // A hidden layer is not part of the file, so it cannot require the namespace.
    const hiddenXlink = exportOf(docWith([BOOK_A, { ...COIN, hidden: true }]));
    expect(hiddenXlink).not.toContain('xmlns:xlink');
  });

  it('escapes the title and describes the artboard and palette', () => {
    const title = 'Книга <b> & «Монета» "кавычки"';
    const svg = exportOf(docWith([BOOK_A]), ctx(), { title });
    expect(svg).toContain('<title>Книга &lt;b&gt; &amp; «Монета» "кавычки"</title>');

    const titleElement = childElements(parseXml(svg)).find((el) => el.name === 'title');
    expect(titleElement?.children).toEqual([{ kind: 'text', text: title }]);

    const desc = childElements(parseXml(svg)).find((el) => el.name === 'desc');
    expect(JSON.stringify(desc?.children)).toContain('1200 × 630');
    expect(JSON.stringify(desc?.children)).toContain('Персик');
  });

  it('defaults the title to «Форма»', () => {
    expect(exportOf(docWith([BOOK_A]))).toContain('<title>Форма</title>');
  });

  it('defaults an empty or blank title to «Форма» as well', () => {
    expect(exportOf(docWith([BOOK_A]), ctx(), { title: '' })).toContain('<title>Форма</title>');
    expect(exportOf(docWith([BOOK_A]), ctx(), { title: '  \n ' })).toContain('<title>Форма</title>');
  });

  it('never draws the headline into the file, only into its metadata', () => {
    const doc = docWith([BOOK_A], { layout: 'title', showHeadline: true, headline: 'Весенний букет' });
    const svg = exportOf(doc, ctx(), { title: exportTitle(doc, () => 'Книга') });
    expect(svg).toContain('<title>Весенний букет</title>');
    expect(svg).not.toContain('<text');
    expect(svg.replace('<title>Весенний букет</title>', '')).not.toContain('Весенний букет');
  });

  it('draws the paper rect first, with a normalised colour', () => {
    const svg = exportOf(docWith([BOOK_A]), ctx(), { paper: '#FDD7B9' });
    expect(svg).toContain('<rect id="paper" width="1200" height="630" fill="#fdd7b9"/>');
    expect(exportOf(docWith([BOOK_A]), ctx(), { paper: 'white' })).toContain('fill="#ffffff"/>');

    const children = childElements(parseXml(svg));
    expect(children.map((el) => el.name)).toEqual(['title', 'desc', 'rect', 'g']);
    expect(getAttr(children[2] as XmlElement, 'id')).toBe('paper');
  });

  it('puts the plane group between the paper and the artwork, and only when the plane is on', () => {
    const on = exportOf(docWith([BOOK_A], { showPlane: true }));
    const children = childElements(parseXml(on));
    expect(children.map((el) => getAttr(el, 'id') ?? el.name)).toEqual(['title', 'desc', 'paper', 'plane', 'artwork']);
    const planeGroup = children.find((el) => getAttr(el, 'id') === 'plane');
    expect(getAttr(planeGroup as XmlElement, 'data-forma-role')).toBe('plane');
    expect(getAttr(planeGroup as XmlElement, 'transform')).toBe('translate(0 -285) scale(1.2) translate(0 0)');
    expect(on).toContain('id="plane__clip0"');

    const off = exportOf(docWith([BOOK_A], { showPlane: false }));
    expect(childElements(parseXml(off)).map((el) => getAttr(el, 'id') ?? el.name)).toEqual(['title', 'desc', 'paper', 'artwork']);
    expect(off).not.toContain('plane__');
  });

  it('emits one group per visible layer in z-order with motif and role attributes', () => {
    const groups = artworkGroups(exportOf(docWith(MIXED_LAYERS)));
    expect(groups.map((g) => getAttr(g, 'id'))).toEqual(['book-background-1', 'book-1', 'coin-1', 'book-3']);
    expect(groups.map((g) => getAttr(g, 'data-forma-motif'))).toEqual(['book', 'book', 'coin', 'book']);
    expect(groups.map((g) => getAttr(g, 'data-forma-role'))).toEqual(['background', 'object', 'object', 'object']);
    expect(groups.map((g) => getAttr(g, 'transform'))).toEqual(
      [ECHO, BOOK_A, COIN, BOOK_B].map((l) => layerTransform(l, layerAsset(l, ctx())?.meta as AssetFileMeta)),
    );
  });

  it('omits hidden layers entirely', () => {
    const svg = exportOf(docWith(MIXED_LAYERS));
    expect(svg).not.toContain('id="book-2"');
    expect(svg).not.toContain('book-2__');
    expect(artworkGroups(exportOf(docWith([{ ...BOOK_A, hidden: true }])))).toEqual([]);
  });

  it('skips layers whose motif has no files instead of failing', () => {
    const svg = exportOf(docWith([BOOK_A, layer('p', 'pen')]));
    expect(artworkGroups(svg).map((g) => getAttr(g, 'data-forma-motif'))).toEqual(['book']);
    expect(svg).not.toContain('"pen"');
  });

  it('contains no forbidden elements and no external references', () => {
    const svg = exportOf(docWith(MIXED_LAYERS, { showPlane: true }));
    const report = referencesOf(svg);
    for (const forbidden of FORBIDDEN_ELEMENTS) expect(report.elements, forbidden).not.toContain(forbidden);
    expect(svg).not.toContain('href="http');
    expect(svg).not.toContain('<image');
    expect(svg).not.toMatch(/url\((?!#)/);
  });

  it('has no dangling references and no duplicate ids, even with several instances of one file', () => {
    const svg = exportOf(docWith(MIXED_LAYERS, { showPlane: true }));
    const report = referencesOf(svg);
    expect(report.references.length).toBeGreaterThan(0);
    expect(report.dangling).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
    // book-l-main.svg is used twice (book-1, book-3): both namespaces exist side by side.
    expect(report.ids).toEqual(expect.arrayContaining(['book-1__clip0', 'book-3__clip0', 'book-background-1__clip0', 'coin-1__shape', 'plane__clip0']));
  });

  it('applies the colour mapping to every instance', () => {
    const svg = exportOf(docWith(MIXED_LAYERS, { showPlane: true }));
    expect(svg).toContain('#123456');
    expect(svg.toLowerCase()).not.toContain('#7864d7');
  });

  it('is deterministic', () => {
    const doc = docWith(MIXED_LAYERS, { showPlane: true });
    expect(exportOf(doc)).toBe(exportOf(doc));
  });

  it('throws a Russian error listing every missing file', () => {
    const doc = docWith(MIXED_LAYERS, { showPlane: true });
    const templates = new Map(TEMPLATES);
    templates.delete('book-l-main.svg');
    templates.delete('plane-peach-l.svg');
    let message = '';
    try {
      exportOf(doc, ctx({ templates }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/^Не удалось собрать SVG: не загружены файлы /);
    expect(message).toContain('«book-l-main.svg»');
    expect(message).toContain('«plane-peach-l.svg»');
    expect(message).not.toContain('coin-l-main.svg');
  });

  it('only needs templates of visible layers and of the plane when it is on', () => {
    const templates = new Map(TEMPLATES);
    templates.delete('coin-l-main.svg');
    templates.delete('plane-peach-l.svg');
    expect(() => exportOf(docWith([BOOK_A, { ...COIN, hidden: true }], { showPlane: false }), ctx({ templates }))).not.toThrow();
    expect(() => exportOf(docWith([BOOK_A, COIN]), ctx({ templates }))).toThrow(/«coin-l-main\.svg»/);
    expect(() => exportOf(docWith([BOOK_A], { showPlane: true }), ctx({ templates }))).toThrow(/«plane-peach-l\.svg»/);
  });

  it('judges missing files by the detail and colour mode actually used for rendering', () => {
    // The doc says `s`, the context renders `l`: only the `l` templates matter.
    expect(() => exportOf(docWith([BOOK_A], { detail: 's' }), ctx({ detail: 'l' }))).not.toThrow();
    // Mono mode swaps the object to the background file, so a missing background template is reported.
    const templates = new Map(TEMPLATES);
    templates.delete('book-l-background.svg');
    expect(() => exportOf(docWith([BOOK_A]), ctx({ colorMode: 'mono', templates }))).toThrow(/«book-l-background\.svg»/);
  });

  it('rejects an invalid artboard or paper colour with a Russian message', () => {
    const doc = docWith([BOOK_A]);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => exportOf(doc, ctx(), { artboard: { width: bad, height: 630 } })).toThrow(/Размер артборда/);
      expect(() => exportOf(doc, ctx(), { artboard: { width: 1200, height: bad } })).toThrow(/Размер артборда/);
    }
    expect(() => exportOf(doc, ctx(), { paper: 'not-a-colour' })).toThrow(/Цвет бумаги/);
  });
});

/* ------------------------------------------------------------------ */
/* Preview == export                                                   */
/* ------------------------------------------------------------------ */

describe('preview and export share the same markup', () => {
  const doc = docWith(MIXED_LAYERS, { showPlane: true });
  const context = ctx();
  const svg = exportOf(doc, context);

  it('embeds every rendered layer exactly as <g attributes>markup</g>, in z-order', () => {
    const rendered = visibleRendered(doc, context);
    expect(rendered).toHaveLength(4);

    let cursor = 0;
    for (const r of rendered) {
      const expected = `<g${attributesMarkup(layerAttributes(r))}>${r.markup}</g>`;
      const at = svg.indexOf(expected, cursor);
      expect(at, `group ${r.groupId} is missing or out of order`).toBeGreaterThanOrEqual(0);
      expect(svg.slice(at - 4, at)).toBe('    ');
      cursor = at + expected.length;
    }
  });

  it('embeds the plane exactly as <g attributes>markup</g> before the artwork', () => {
    const plane = renderPlane(doc, ARTBOARD, context);
    if (!plane) throw new Error('plane was not rendered');
    const expected = `<g${attributesMarkup(planeAttributes(plane))}>${plane.markup}</g>`;
    expect(svg).toContain(`  ${expected}\n  <g id="artwork">`);
  });

  it('exposes the same attributes for both consumers', () => {
    const [first] = visibleRendered(doc, context);
    if (!first) throw new Error('nothing rendered');
    expect(layerAttributes(first)).toEqual({
      id: first.groupId,
      transform: first.transform,
      'data-forma-motif': first.layer.motif,
      'data-forma-role': first.layer.role,
    });
  });
});
