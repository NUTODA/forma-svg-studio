import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAssetFileName, parsePlaneFileName } from '../src/assets/availability';
import {
  MOTIF_IDS,
  SOURCE_PALETTE_IDS,
  type AssetFileMeta,
  type AssetManifest,
  type Box,
  type PlaneFileMeta,
  type SourcePaletteId,
} from '../src/domain/types';
import { BUILTIN_PALETTES } from '../src/palette/builtins';
import { createColorResolver } from '../src/palette/resolve';
import { SOURCE_PALETTES } from '../src/palette/roles';
import { buildTemplate, instantiate } from '../src/svg/template';
import { FORBIDDEN_ELEMENTS, checkReferences } from '../src/svg/testing';
import { scanAssets } from './scanAssets';

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets');

/** The eight swatches of the lavender source palette (objects are drawn in it), lowercase. */
const LAVENDER_SWATCHES = ['#d7cdf5', '#aa9bf0', '#7864d7', '#181817', '#f9ecb0', '#f9a3aa', '#ffe3e1', '#ffffff'];
/** Background-variant files are monochrome: only these two colours. */
const BACKGROUND_COLORS = ['#d7cdf5', '#7864d7'];
const HEX_RE = /^#[0-9a-f]{6}$/;

/** One scanned file together with the palette its colours come from. */
interface Entry {
  file: string;
  kind: 'object' | 'plane';
  source: SourcePaletteId;
  meta: AssetFileMeta | PlaneFileMeta;
}

const identity = (hex: string): string => hex;

function boundsProblem(viewBox: Box, bounds: Box): string | null {
  if (!(viewBox.width > 0 && viewBox.height > 0)) return `viewBox has no area: ${JSON.stringify(viewBox)}`;
  if (!(bounds.width > 0 && bounds.height > 0)) return `bounds have no area: ${JSON.stringify(bounds)}`;
  const inside =
    bounds.x >= viewBox.x - 1 &&
    bounds.y >= viewBox.y - 1 &&
    bounds.x + bounds.width <= viewBox.x + viewBox.width + 1 &&
    bounds.y + bounds.height <= viewBox.y + viewBox.height + 1;
  return inside ? null : `bounds ${JSON.stringify(bounds)} are outside viewBox ${JSON.stringify(viewBox)}`;
}

/* ------------------------------------------------------------------ */
/* The real, read-only library in public/assets                        */
/* ------------------------------------------------------------------ */

describe('scanAssets on public/assets', () => {
  let manifest: AssetManifest;
  let entries: Entry[];

  beforeAll(() => {
    manifest = scanAssets(ASSETS_DIR);
    entries = [
      ...manifest.files.map((meta): Entry => ({ file: meta.file, kind: 'object', source: 'lavender', meta })),
      ...manifest.planes.map((meta): Entry => ({ file: meta.file, kind: 'plane', source: meta.palette, meta })),
    ];
  }, 60_000);

  it('finds the library (guards against a wrong folder making every other check vacuous)', () => {
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.planes.length).toBeGreaterThan(0);
  });

  it('accepts every recognised SVG: nothing is ignored for failing validation', () => {
    const failed = manifest.ignored.filter((entry) => entry.reason.includes('не прошёл проверку'));
    expect(failed).toEqual([]);

    const unnamed = manifest.ignored.filter((entry) => !failed.includes(entry));
    if (unnamed.length > 0) console.info('Файлы с нераспознанными именами:', unnamed.map((e) => e.file).join(', '));
  });

  it('accounts for every object combination (scanned + missing = all), logging what is missing', () => {
    const scanned = new Set(manifest.files.map((f) => f.file));
    const missing: string[] = [];
    for (const motif of MOTIF_IDS) {
      for (const detail of ['s', 'l']) {
        for (const variant of ['main', 'background']) {
          const file = `${motif}-${detail}-${variant}.svg`;
          if (!scanned.has(file)) missing.push(file);
        }
      }
    }
    for (const palette of SOURCE_PALETTE_IDS) {
      for (const detail of ['s', 'l']) {
        const file = `plane-${palette}-${detail}.svg`;
        if (!manifest.planes.some((p) => p.file === file)) missing.push(file);
      }
    }
    if (missing.length > 0) console.info(`Нет файлов (${missing.length}):`, missing.join(', '));
    expect(manifest.files.length + manifest.planes.length + missing.length).toBe(MOTIF_IDS.length * 4 + SOURCE_PALETTE_IDS.length * 2);
  });

  it('reports each file under the motif/detail/variant or palette/detail of its name', () => {
    const wrong: string[] = [];
    for (const meta of manifest.files) {
      const parsed = parseAssetFileName(meta.file);
      if (!parsed || parsed.motif !== meta.motif || parsed.detail !== meta.detail || parsed.variant !== meta.variant) wrong.push(meta.file);
    }
    for (const meta of manifest.planes) {
      const parsed = parsePlaneFileName(meta.file);
      if (!parsed || parsed.palette !== meta.palette || parsed.detail !== meta.detail) wrong.push(meta.file);
    }
    expect(wrong).toEqual([]);
  });

  it('measures positive bounds inside the viewBox (±1 unit) for every file', () => {
    const problems = entries.flatMap(({ file, meta }) => {
      const problem = boundsProblem(meta.viewBox, meta.bounds);
      return problem ? [`${file}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it('reports colours as lowercase #rrggbb', () => {
    const problems = entries.flatMap(({ file, meta }) => meta.colors.filter((c) => !HEX_RE.test(c)).map((c) => `${file}: ${c}`));
    expect(problems).toEqual([]);
  });

  it('draws objects only in lavender source swatches', () => {
    const problems = manifest.files.flatMap((meta) =>
      meta.colors.filter((c) => !LAVENDER_SWATCHES.includes(c)).map((c) => `${meta.file}: ${c} is not a lavender swatch`),
    );
    expect(problems).toEqual([]);
  });

  it('draws background-variant files only in #d7cdf5 and #7864d7', () => {
    const problems = manifest.files
      .filter((meta) => meta.variant === 'background')
      .flatMap((meta) => meta.colors.filter((c) => !BACKGROUND_COLORS.includes(c)).map((c) => `${meta.file}: ${c}`));
    expect(problems).toEqual([]);
  });

  it('draws every plane in the swatches of its own palette', () => {
    const problems = manifest.planes.flatMap((meta) => {
      const swatches = Object.values(SOURCE_PALETTES[meta.palette].colors);
      return meta.colors.filter((c) => !swatches.includes(c)).map((c) => `${meta.file}: ${c} is not a ${meta.palette} swatch`);
    });
    expect(problems).toEqual([]);
  });

  it('re-colouring with the file own palette is the identity (default preview = Figma file)', () => {
    const resolvers = new Map(BUILTIN_PALETTES.map((palette) => [palette.id, createColorResolver(palette)]));
    const changed: string[] = [];
    for (const { file, source, meta } of entries) {
      const resolve = resolvers.get(source);
      if (!resolve) throw new Error(`Нет палитры ${source}`);
      for (const color of meta.colors) {
        const mapped = resolve(color, source);
        if (mapped !== color) changed.push(`${file}: ${color} -> ${mapped}`);
      }
    }
    expect(changed).toEqual([]);
  });

  it('turns every file into a template whose instances have no dangling or duplicate ids and no forbidden elements', () => {
    const problems: string[] = [];
    for (const { file, source } of entries) {
      const template = buildTemplate(readFileSync(path.join(ASSETS_DIR, file), 'utf8'), { file, source });
      const first = instantiate(template, { idPrefix: 'x__', color: identity });
      const second = instantiate(template, { idPrefix: 'y__', color: identity });

      const single = checkReferences(first);
      const both = checkReferences(first + second);
      if (single.dangling.length > 0) problems.push(`${file}: dangling ${single.dangling.join(', ')}`);
      if (single.duplicateIds.length > 0) problems.push(`${file}: duplicate ids ${single.duplicateIds.join(', ')}`);
      if (both.duplicateIds.length > 0) problems.push(`${file}: two instances share ids ${both.duplicateIds.join(', ')}`);
      const unprefixed = single.ids.filter((id) => !id.startsWith('x__'));
      if (unprefixed.length > 0) problems.push(`${file}: ids without the prefix ${unprefixed.join(', ')}`);
      const forbidden = single.elements.filter((name) => FORBIDDEN_ELEMENTS.includes(name));
      if (forbidden.length > 0) problems.push(`${file}: forbidden elements ${forbidden.join(', ')}`);
      if (/href="https?:/.test(first)) problems.push(`${file}: external href`);
    }
    expect(problems).toEqual([]);
  });

  it.each(['plane-peach-s.svg', 'plane-peach-l.svg'])('%s: the clipPath id is prefixed per instance', (file) => {
    const fullPath = path.join(ASSETS_DIR, file);
    if (!existsSync(fullPath)) {
      console.info(`${file} отсутствует — проверка clipPath пропущена`);
      return;
    }
    const source = readFileSync(fullPath, 'utf8');
    const clipIds = [...source.matchAll(/<clipPath\b[^>]*\sid="([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
    if (clipIds.length === 0) {
      console.info(`${file} не содержит clipPath — проверка пропущена`);
      return;
    }

    const template = buildTemplate(source, { file, source: 'peach' });
    const markup = instantiate(template, { idPrefix: 'x__', color: identity });
    for (const id of clipIds) {
      expect(markup).toContain(`id="x__${id}"`);
      expect(markup).not.toContain(`id="${id}"`);
      expect(markup).toContain(`url(#x__${id})`);
      expect(markup).not.toContain(`url(#${id})`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* public/assets/source-manifest.json                                  */
/* ------------------------------------------------------------------ */

interface SourceVariant {
  file: string;
  viewBox: string;
  width: number;
  height: number;
}

interface SourceManifest {
  objects: Record<string, { variants: Record<string, SourceVariant> }>;
  palettes: Record<string, { background: string[]; objects: string[]; planes: Record<string, SourceVariant> }>;
}

describe('source-manifest.json', () => {
  const manifestPath = path.join(ASSETS_DIR, 'source-manifest.json');
  let source: SourceManifest | null = null;
  let scanned: AssetManifest;

  beforeAll(() => {
    scanned = scanAssets(ASSETS_DIR);
    if (existsSync(manifestPath)) source = JSON.parse(readFileSync(manifestPath, 'utf8')) as SourceManifest;
    else console.info('source-manifest.json отсутствует — проверки пропущены');
  }, 60_000);

  it('lists only files that exist, under the names and keys they claim, with matching viewBox sizes', () => {
    if (!source) return;
    // `expected` is what the file name must parse to, derived from the manifest keys (`book` + `l-main`, `mint` + `s`).
    const listed: { key: string; entry: SourceVariant; expected: object }[] = [];
    for (const [motif, object] of Object.entries(source.objects)) {
      for (const [variantKey, entry] of Object.entries(object.variants)) {
        const [detail, variant] = variantKey.split('-');
        listed.push({ key: `${motif}/${variantKey}`, entry, expected: { motif, detail, variant } });
      }
    }
    for (const [palette, data] of Object.entries(source.palettes)) {
      for (const [detail, entry] of Object.entries(data.planes)) {
        listed.push({ key: `${palette}/${detail}`, entry, expected: { palette, detail } });
      }
    }
    expect(listed.length).toBeGreaterThan(0);

    const scannedMetas = [...scanned.files, ...scanned.planes];
    const problems: string[] = [];
    for (const { key, entry, expected } of listed) {
      const { file } = entry;
      if (!existsSync(path.join(ASSETS_DIR, file))) {
        problems.push(`${key}: файл ${file} не существует`);
        continue;
      }
      const parsed = parseAssetFileName(file) ?? parsePlaneFileName(file);
      if (!isDeepStrictEqual(parsed, expected)) problems.push(`${key}: имя ${file} не соответствует ключу`);

      const meta = scannedMetas.find((m) => m.file === file);
      if (!meta) {
        problems.push(`${key}: файл ${file} не принят сканером`);
        continue;
      }
      const [, , width, height] = entry.viewBox.split(/\s+/).map(Number);
      if (width === undefined || height === undefined || Math.abs(width - meta.viewBox.width) > 1 || Math.abs(height - meta.viewBox.height) > 1) {
        problems.push(`${key}: viewBox «${entry.viewBox}» не совпадает с ${meta.viewBox.width}×${meta.viewBox.height}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has the same palette swatches as the app (so the swatch checks above test the right colours)', () => {
    if (!source) return;
    expect(Object.keys(source.palettes).length).toBeGreaterThan(0);

    for (const [id, data] of Object.entries(source.palettes)) {
      const app = Object.entries(SOURCE_PALETTES).find(([key]) => key === id)?.[1];
      if (!app) {
        console.info(`Палитра «${id}» из source-manifest.json неизвестна приложению`);
        continue;
      }
      const { tint, tone, deep, ink, highlight, accent, accentSoft, light } = app.colors;
      expect([...data.background, ...data.objects].map((c) => c.toLowerCase()), id).toEqual([tint, tone, deep, ink, highlight, accent, accentSoft, light]);
    }

    const lavender = source.palettes.lavender;
    if (lavender) {
      expect([...lavender.background, ...lavender.objects].map((c) => c.toLowerCase()).sort()).toEqual([...LAVENDER_SWATCHES].sort());
    }
  });
});

/* ------------------------------------------------------------------ */
/* Synthetic folders                                                   */
/* ------------------------------------------------------------------ */

function svgOf(width: number, height: number, fill: string): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
}

describe('scanAssets on synthetic folders', () => {
  const created: string[] = [];

  function folder(files: Record<string, string> = {}): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'forma-scan-'));
    created.push(dir);
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
    return dir;
  }

  afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
  });

  it('reads metadata of recognised object and plane files', () => {
    const object = svgOf(10, 20, '#D7CDF5');
    const plane = svgOf(50, 50, '#BEEBEB');
    const result = scanAssets(folder({ 'book-s-main.svg': object, 'plane-mint-s.svg': plane }));

    expect(result.ignored).toEqual([]);
    expect(result.files).toEqual([
      {
        file: 'book-s-main.svg',
        motif: 'book',
        detail: 's',
        variant: 'main',
        viewBox: { x: 0, y: 0, width: 10, height: 20 },
        bounds: { x: 0, y: 0, width: 10, height: 20 },
        colors: ['#d7cdf5'],
        bytes: Buffer.byteLength(object),
        warnings: [],
      },
    ]);
    expect(result.planes).toEqual([
      {
        file: 'plane-mint-s.svg',
        palette: 'mint',
        detail: 's',
        viewBox: { x: 0, y: 0, width: 50, height: 50 },
        bounds: { x: 0, y: 0, width: 50, height: 50 },
        colors: ['#beebeb'],
        bytes: Buffer.byteLength(plane),
        warnings: [],
      },
    ]);
  });

  it('sorts files by motif order, then S before L, then main before background; planes by palette then detail', () => {
    const svg = svgOf(10, 10, '#ffffff');
    const names = [
      'pen-l-background.svg',
      'plane-mint-l.svg',
      'book-l-background.svg',
      'coin-s-main.svg',
      'plane-peach-s.svg',
      'book-s-main.svg',
      'plane-lavender-l.svg',
      'book-l-main.svg',
      'plane-lavender-s.svg',
    ];
    const result = scanAssets(folder(Object.fromEntries(names.map((name) => [name, svg]))));
    expect(result.files.map((f) => f.file)).toEqual(['book-s-main.svg', 'book-l-main.svg', 'book-l-background.svg', 'coin-s-main.svg', 'pen-l-background.svg']);
    expect(result.planes.map((p) => p.file)).toEqual(['plane-lavender-s.svg', 'plane-lavender-l.svg', 'plane-peach-s.svg', 'plane-mint-l.svg']);
  });

  it('ignores badly named SVGs with a naming reason, without reading them', () => {
    // Names must differ by more than letter case, or a case-insensitive file system would merge them.
    const badNames = ['Book-s-main.svg', 'pencil-s-main.svg', 'book-s.svg', 'coin-l-main.SVG', 'plane-coral-s.svg', 'notes.svg'];
    const contents = Object.fromEntries(badNames.map((name) => [name, name === 'notes.svg' ? 'not even xml' : svgOf(10, 10, '#ffffff')]));
    const result = scanAssets(folder({ ...contents, 'book-l-main.svg': svgOf(10, 10, '#ffffff') }));

    expect(result.files.map((f) => f.file)).toEqual(['book-l-main.svg']);
    expect(result.planes).toEqual([]);
    expect(result.ignored.map((i) => i.file).sort()).toEqual([...badNames].sort());
    for (const { file, reason } of result.ignored) {
      expect(reason, file).toMatch(/^Имя не соответствует шаблону/);
      expect(reason, file).not.toContain('не прошёл проверку');
    }
  });

  it('ignores correctly named but unusable SVGs with a validation reason', () => {
    const result = scanAssets(
      folder({
        'coin-l-main.svg': '<svg',
        'lamp-s-main.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        'plane-peach-s.svg': '',
        'folder-s-main.svg': '<div/>',
        'book-l-main.svg': svgOf(10, 10, '#ffffff'),
      }),
    );

    expect(result.files.map((f) => f.file)).toEqual(['book-l-main.svg']);
    expect(result.planes).toEqual([]);
    expect(result.ignored.map((i) => i.file).sort()).toEqual(['coin-l-main.svg', 'folder-s-main.svg', 'lamp-s-main.svg', 'plane-peach-s.svg']);
    for (const { file, reason } of result.ignored) expect(reason, file).toMatch(/^Файл не прошёл проверку: \S/);
    expect(result.ignored.find((i) => i.file === 'coin-l-main.svg')?.reason).toContain('Не удалось разобрать SVG');
    expect(result.ignored.find((i) => i.file === 'lamp-s-main.svg')?.reason).toContain('viewBox');
  });

  it('silently skips files that are not SVG', () => {
    const result = scanAssets(
      folder({
        'source-manifest.json': '{}',
        'book-s-main.svg.png': 'png',
        'book-s-main.svg.bak': svgOf(10, 10, '#ffffff'),
        'plane-mint-s.png': 'png',
        'notes.txt': 'hello',
        README: 'hello',
        'plane-mint-l.svg': svgOf(10, 10, '#ffffff'),
      }),
    );
    expect(result.ignored).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.planes.map((p) => p.file)).toEqual(['plane-mint-l.svg']);
  });

  it('does not descend into sub-folders and skips directories named like assets', () => {
    const dir = folder();
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, 'nested', 'book-s-main.svg'), svgOf(10, 10, '#ffffff'));
    mkdirSync(path.join(dir, 'coin-s-main.svg'));
    expect(scanAssets(dir)).toEqual({ files: [], planes: [], ignored: [] });
  });

  it('returns an empty manifest for an empty or missing directory', () => {
    const empty = folder();
    expect(scanAssets(empty)).toEqual({ files: [], planes: [], ignored: [] });
    expect(scanAssets(path.join(empty, 'does-not-exist'))).toEqual({ files: [], planes: [], ignored: [] });
  });
});
