import { resolveAsset, variantForLayer } from '../assets/availability';
import type {
  ArtboardPresetId,
  AssetFileMeta,
  ColorMode,
  ComposeItem,
  Detail,
  DocState,
  Layer,
  LayoutMode,
  MotifId,
  Size,
  Zones,
} from '../domain/types';
import { ARTBOARD_PRESETS, compose, getZones, placeEcho } from '../layout/compose';
import { DEFAULT_PALETTE_ID } from '../palette/builtins';

export { validateDoc } from './validate';
export { DEMO_PRESETS } from './demos';

/** Pixels between the stacked copies when a new layer lands on an occupied centre. */
const NEW_LAYER_NUDGE = 24;
/** A layer this close to the target counts as «already there». */
const NEW_LAYER_CLOSE = 8;

/** Empty document with art-directed defaults (og 1200×630, composed, L, lavender, colour, plane off, echoes off). */
export function createDoc(): DocState {
  return {
    version: 1,
    preset: 'og',
    detail: 'l',
    layout: 'composed',
    colorMode: 'color',
    paletteId: DEFAULT_PALETTE_ID,
    backgroundObjects: false,
    showPlane: false,
    showHeadline: true,
    headline: '',
    brief: { mode: 'title', text: '' },
    layers: [],
    nextId: 1,
  };
}

export interface ComposeLayersInput {
  /** Object motifs in relevance order (duplicates allowed, e.g. two coins). */
  motifs: MotifId[];
  files: readonly AssetFileMeta[];
  preset: ArtboardPresetId;
  layout: LayoutMode;
  detail: Detail;
  colorMode: ColorMode;
  backgroundObjects: boolean;
}

export interface ComposeLayersResult {
  layers: Layer[];
  nextId: number;
  zones: Zones;
  /** Requested motifs that have no files (skipped). */
  missing: MotifId[];
}

function artboardOf(preset: ArtboardPresetId): Size {
  const p = ARTBOARD_PRESETS[preset];
  return { width: p.width, height: p.height };
}

/** Echoes are made for the top motif, or the top two when the composition has three or more objects. */
export function echoCount(objectCount: number): number {
  return objectCount >= 3 ? 2 : 1;
}

/** Resolve files (with fallback), run `compose`, assign ids `l${n}` from `startId`. */
export function composeLayers(input: ComposeLayersInput, startId: number): ComposeLayersResult {
  const { files, detail, colorMode } = input;
  const objectVariant = variantForLayer('object', colorMode);
  const echoVariant = variantForLayer('background', colorMode);

  const items: ComposeItem[] = [];
  const missing: MotifId[] = [];
  for (const motif of input.motifs) {
    const resolved = resolveAsset(files, motif, detail, objectVariant);
    if (resolved) items.push({ motif, meta: resolved.meta });
    else if (!missing.includes(motif)) missing.push(motif);
  }

  const backgrounds: ComposeItem[] = [];
  if (input.backgroundObjects) {
    for (const item of items.slice(0, echoCount(items.length))) {
      const resolved = resolveAsset(files, item.motif, detail, echoVariant);
      if (resolved) backgrounds.push({ motif: item.motif, meta: resolved.meta });
    }
  }

  const result = compose({ items, backgrounds, artboard: artboardOf(input.preset), mode: input.layout });
  const layers: Layer[] = result.layers.map((placed, i) => ({
    id: `l${startId + i}`,
    motif: placed.motif,
    role: placed.role,
    x: placed.x,
    y: placed.y,
    rotation: placed.rotation,
    size: placed.size,
    rank: placed.rank,
  }));
  return {
    layers,
    nextId: startId + layers.length,
    zones: { orientation: result.orientation, artZone: result.artZone, headlineZone: result.headlineZone },
    missing,
  };
}

/** Object motifs of the document ordered by rank (input for recompose). */
export function objectMotifs(doc: DocState): MotifId[] {
  return doc.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.role === 'object')
    .sort((a, b) => a.layer.rank - b.layer.rank || a.index - b.index)
    .map(({ layer }) => layer.motif);
}

function settingsOf(doc: DocState, files: readonly AssetFileMeta[], motifs: MotifId[]): ComposeLayersInput {
  return {
    motifs,
    files,
    preset: doc.preset,
    layout: doc.layout,
    detail: doc.detail,
    colorMode: doc.colorMode,
    backgroundObjects: doc.backgroundObjects,
  };
}

/** Re-run the layout for the document's current motifs and settings (used by preset/layout/echo changes). */
export function recomposeDoc(doc: DocState, files: readonly AssetFileMeta[]): DocState {
  const result = composeLayers(settingsOf(doc, files, objectMotifs(doc)), doc.nextId);
  return { ...doc, layers: result.layers, nextId: result.nextId };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Median render scale (size per source unit of height) of the existing object layers, or null. */
function commonScale(doc: DocState, files: readonly AssetFileMeta[]): number | null {
  const variant = variantForLayer('object', doc.colorMode);
  const scales: number[] = [];
  for (const layer of doc.layers) {
    if (layer.role !== 'object') continue;
    const resolved = resolveAsset(files, layer.motif, doc.detail, variant);
    if (resolved && resolved.meta.bounds.height > 0) scales.push(layer.size / resolved.meta.bounds.height);
  }
  return scales.length > 0 ? median(scales) : null;
}

/** Free spot near the art-zone centre: each layer already there pushes the new one 24 px diagonally. */
function freeSpot(doc: DocState): { x: number; y: number } {
  const board = artboardOf(doc.preset);
  const zone = getZones(board, doc.layout).artZone;
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height / 2;
  const near = (x: number, y: number): number =>
    doc.layers.filter((l) => Math.abs(l.x - x) <= NEW_LAYER_CLOSE && Math.abs(l.y - y) <= NEW_LAYER_CLOSE).length;
  const clamp = (v: number, max: number): number => Math.max(0, Math.min(max, v));
  let step = near(cx, cy);
  let x = clamp(cx + NEW_LAYER_NUDGE * step, board.width);
  let y = clamp(cy + NEW_LAYER_NUDGE * step, board.height);
  // The nudged spot may be taken as well (e.g. after undo/redo shuffles): keep stepping.
  for (let guard = 0; guard < 24 && near(x, y) > 0; guard += 1) {
    step += 1;
    x = clamp(cx + NEW_LAYER_NUDGE * step, board.width);
    y = clamp(cy + NEW_LAYER_NUDGE * step, board.height);
  }
  return { x, y };
}

/**
 * New object layer for a motif added from the catalog: same common scale as the existing objects
 * (or a fresh single-object composition), centred at `at` or in a free spot of the art zone.
 */
export function placeNewLayer(
  doc: DocState,
  motif: MotifId,
  files: readonly AssetFileMeta[],
  at?: { x: number; y: number },
): Omit<Layer, 'id'> | null {
  const resolved = resolveAsset(files, motif, doc.detail, variantForLayer('object', doc.colorMode));
  if (!resolved) return null;
  const meta = resolved.meta;

  const scale = commonScale(doc, files);
  const size =
    scale !== null
      ? scale * meta.bounds.height
      : (compose({
          items: [{ motif, meta }],
          backgrounds: [],
          artboard: artboardOf(doc.preset),
          mode: doc.layout,
        }).layers[0]?.size ?? meta.bounds.height);

  const objectRanks = doc.layers.filter((l) => l.role === 'object').map((l) => l.rank);
  const rank = objectRanks.length > 0 ? Math.max(...objectRanks) + 1 : 0;
  const position = at ?? freeSpot(doc);
  return { motif, role: 'object', x: position.x, y: position.y, rotation: 0, size, rank };
}

/**
 * New document = `base` settings + freshly composed layers for `motifs` (ids continue from base.nextId).
 * Used by «Собрать» for both brief modes and by demo presets (the caller does the analysis).
 */
export function docFromMotifs(base: DocState, motifs: MotifId[], files: readonly AssetFileMeta[]): DocState {
  const result = composeLayers(settingsOf(base, files, motifs), base.nextId);
  return { ...base, layers: result.layers, nextId: result.nextId };
}

/**
 * Toggle the decorative echoes without touching the objects. Off removes every echo layer; on derives
 * echoes from the current top-ranked visible objects (same placement rules as `compose`) and inserts
 * them at the bottom of the z-order.
 */
export function withBackgroundObjects(doc: DocState, files: readonly AssetFileMeta[], on: boolean): DocState {
  const objects = doc.layers.filter((l) => l.role === 'object');
  if (!on) return { ...doc, backgroundObjects: false, layers: objects };

  const objectVariant = variantForLayer('object', doc.colorMode);
  const echoVariant = variantForLayer('background', doc.colorMode);
  const avoid = doc.layout === 'title' ? getZones(artboardOf(doc.preset), doc.layout).headlineZone : null;

  const ranked = objects
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => !layer.hidden)
    .sort((a, b) => a.layer.rank - b.layer.rank || a.index - b.index)
    .map(({ layer }) => layer);

  const echoes: Layer[] = [];
  let nextId = doc.nextId;
  for (const object of ranked.slice(0, echoCount(ranked.length))) {
    const objectMeta = resolveAsset(files, object.motif, doc.detail, objectVariant);
    const echoMeta = resolveAsset(files, object.motif, doc.detail, echoVariant);
    if (!objectMeta || !echoMeta) continue;
    const pose = placeEcho(object, objectMeta.meta, echoMeta.meta, echoes.length, doc.layout, avoid);
    echoes.push({ id: `l${nextId}`, motif: object.motif, role: 'background', ...pose, rank: echoes.length });
    nextId += 1;
  }
  return { ...doc, backgroundObjects: true, layers: [...echoes, ...objects], nextId };
}
