import { resolveAsset, variantForLayer } from '../assets/availability';
import type {
  Box,
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
import { ARTBOARD_PRESETS, compose, getZones, layerBounds, placeScenery, sceneryCandidates } from '../layout/compose';
import { renderedWidth } from '../layout/geometry';
import { DEFAULT_PALETTE_ID } from '../palette/builtins';
import { boundLayer, boundPose } from './bounds';
import { MAX_LAYERS } from './validate';

export { validateDoc } from './validate';
export { DEMO_PRESETS } from './demos';

/** Pixels between the stacked copies when a new layer lands on an occupied centre. */
const NEW_LAYER_NUDGE = 24;
/** A layer this close to the target counts as «already there». */
const NEW_LAYER_CLOSE = 8;
/** A motif added from the catalog may fill at most this share of the art zone on either axis. */
const NEW_LAYER_FIT = 0.9;

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
  /** Parallel to `motifs`: objects the user hid. They keep their slot in the layout but get no echo. */
  hidden?: readonly boolean[];
  /** Indices into `motifs` from the bottom of the stack to the top; replaces the art-directed z-order. */
  stacking?: readonly number[];
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

/** One background object behind the scene, as in the reference sheets. */
export const SCENERY_COUNT = 1;

/** Background objects for these visible motifs: other library objects that have a background file. */
function sceneryItems(
  visibleMotifs: readonly MotifId[],
  files: readonly AssetFileMeta[],
  detail: Detail,
  colorMode: ColorMode,
  room: number,
): ComposeItem[] {
  if (visibleMotifs.length === 0) return [];
  const variant = variantForLayer('background', colorMode);
  const out: ComposeItem[] = [];
  for (const motif of sceneryCandidates(visibleMotifs)) {
    if (out.length >= Math.min(SCENERY_COUNT, room)) break;
    const resolved = resolveAsset(files, motif, detail, variant);
    if (resolved?.exact !== false && resolved) out.push({ motif, meta: resolved.meta });
  }
  return out;
}

interface ComposedPart {
  layer: Omit<Layer, 'id'>;
  /** Index into `ComposeLayersInput.motifs` of the object drawn, or of the object an echo sits behind. */
  origin: number;
}

/**
 * Resolve files (with fallback) and run `compose`, without ids. Never produces more than MAX_LAYERS layers:
 * objects come first, echoes only fill what is left (499 objects leave room for one).
 */
function composeParts(input: ComposeLayersInput): { parts: ComposedPart[]; zones: Zones; missing: MotifId[] } {
  const { files, detail, colorMode } = input;
  const objectVariant = variantForLayer('object', colorMode);

  const items: ComposeItem[] = [];
  /** Item index → index in `input.motifs` (motifs without files are skipped). */
  const sources: number[] = [];
  const missing: MotifId[] = [];
  input.motifs.forEach((motif, index) => {
    if (items.length >= MAX_LAYERS) return;
    const resolved = resolveAsset(files, motif, detail, objectVariant);
    if (resolved) {
      items.push({ motif, meta: resolved.meta });
      sources.push(index);
    } else if (!missing.includes(motif)) missing.push(motif);
  });

  // The background object goes with the visible objects only (nothing is drawn for a hidden one).
  const visible: number[] = [];
  items.forEach((_, item) => {
    if (input.hidden?.[sources[item] as number] !== true) visible.push(item);
  });
  const backgrounds = input.backgroundObjects
    ? sceneryItems(
        visible.map((item) => (items[item] as ComposeItem).motif),
        files,
        detail,
        colorMode,
        MAX_LAYERS - items.length,
      )
    : [];

  const itemOf = new Map(sources.map((source, item) => [source, item]));
  const stacking = input.stacking?.flatMap((motif) => {
    const item = itemOf.get(motif);
    return item === undefined ? [] : [item];
  });
  const result = compose(
    { items, backgrounds, artboard: artboardOf(input.preset), mode: input.layout },
    { stacking },
  );
  const parts = result.layers.map((placed): ComposedPart => {
    // A background object belongs to the scene as a whole; it is attributed to the hero.
    const item = placed.role === 'object' ? placed.rank : (visible[0] ?? 0);
    return {
      layer: boundLayer({
        motif: placed.motif,
        role: placed.role,
        x: placed.x,
        y: placed.y,
        rotation: placed.rotation,
        size: placed.size,
        rank: placed.rank,
      }),
      origin: sources[item] as number,
    };
  });
  return {
    parts,
    zones: { orientation: result.orientation, artZone: result.artZone, headlineZone: result.headlineZone },
    missing,
  };
}

/** Resolve files (with fallback), run `compose`, assign ids `l${n}` from `startId`. */
export function composeLayers(input: ComposeLayersInput, startId: number): ComposeLayersResult {
  const { parts, zones, missing } = composeParts(input);
  const layers = parts.map(({ layer }, i): Layer => ({ id: `l${startId + i}`, ...layer }));
  return { layers, nextId: startId + layers.length, zones, missing };
}

/** Object layers of the document ordered by rank (ties keep their z-order). */
function objectsByRank(doc: DocState): { layer: Layer; index: number }[] {
  return doc.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.role === 'object')
    .sort((a, b) => a.layer.rank - b.layer.rank || a.index - b.index);
}

/** Object motifs of the document ordered by rank (input for recompose). */
export function objectMotifs(doc: DocState): MotifId[] {
  return objectsByRank(doc).map(({ layer }) => layer.motif);
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

/**
 * Re-run the layout for the document's current motifs and settings (used by preset/layout/echo changes and
 * the «пересобрать» button). Only geometry is rebuilt; what the user can see or has decided is kept:
 * - an object keeps its id (so the selection survives), its hidden flag and its place in the stacking order;
 * - an echo keeps the id and hidden flag of the old echo of the same motif (n-th with that motif);
 * - echoes follow visible objects only, so no visible echo appears behind a hidden object.
 */
export function recomposeDoc(doc: DocState, files: readonly AssetFileMeta[]): DocState {
  const objects = objectsByRank(doc);
  // The i-th object by rank is the i-th motif of the composition, so results map back through `origin`.
  const zIndex = objects.map(({ index }) => index);
  const stacking = objects.map((_, i) => i).sort((a, b) => (zIndex[a] as number) - (zIndex[b] as number));
  const { parts } = composeParts({
    ...settingsOf(doc, files, objects.map(({ layer }) => layer.motif)),
    hidden: objects.map(({ layer }) => layer.hidden === true),
    stacking,
  });

  const oldEchoes = new Map<MotifId, Layer[]>();
  for (const layer of doc.layers.filter((l) => l.role === 'background').sort((a, b) => a.rank - b.rank)) {
    oldEchoes.set(layer.motif, [...(oldEchoes.get(layer.motif) ?? []), layer]);
  }

  const taken = new Set(doc.layers.map((l) => l.id));
  let nextId = doc.nextId;
  const freshId = (): string => {
    while (taken.has(`l${nextId}`)) nextId += 1;
    const id = `l${nextId}`;
    taken.add(id);
    nextId += 1;
    return id;
  };

  const layers = parts.map(({ layer, origin }): Layer => {
    const old =
      layer.role === 'object' ? (objects[origin] as { layer: Layer }).layer : oldEchoes.get(layer.motif)?.shift();
    const placed: Layer = { id: old ? old.id : freshId(), ...layer };
    return old?.hidden === true ? { ...placed, hidden: true } : placed;
  });
  return { ...doc, layers, nextId };
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

/** Centre moved just enough that a span of `extent` stays inside `0..limit` (centred when it is wider). */
function keepWithin(center: number, extent: number, limit: number): number {
  if (extent >= limit) return limit / 2;
  return Math.max(extent / 2, Math.min(limit - extent / 2, center));
}

/** Size a new object gets at the existing common scale, or as a lone hero when nothing is there yet. */
function commonSize(doc: DocState, meta: AssetFileMeta, motif: MotifId, files: readonly AssetFileMeta[]): number {
  // S and L source bounds differ slightly by motif. An existing copy is the exact physical-size reference.
  const peers = doc.layers.filter((layer) => layer.role === 'object' && layer.motif === motif);
  if (peers.length > 0) return median(peers.map((layer) => layer.size));
  const scale = commonScale(doc, files);
  if (scale !== null) return scale * meta.bounds.height;
  const single = compose({
    items: [{ motif, meta }],
    backgrounds: [],
    artboard: artboardOf(doc.preset),
    mode: doc.layout,
  });
  return single.layers[0]?.size ?? meta.bounds.height;
}

/** Factor (≤ 1) that makes an upright object of `size` fill at most NEW_LAYER_FIT of the art zone. */
function fitFactor(doc: DocState, meta: AssetFileMeta, size: number): number {
  const zone = getZones(artboardOf(doc.preset), doc.layout).artZone;
  const width = renderedWidth(size, meta);
  return Math.min(
    1,
    (NEW_LAYER_FIT * zone.width) / Math.max(width, 1e-9),
    (NEW_LAYER_FIT * zone.height) / Math.max(size, 1e-9),
  );
}

/** Some object the user already made bigger than the whole artboard: the composition is a deliberate crop. */
function hasOversizedObject(doc: DocState, files: readonly AssetFileMeta[]): boolean {
  const board = artboardOf(doc.preset);
  const variant = variantForLayer('object', doc.colorMode);
  return doc.layers.some((layer) => {
    if (layer.role !== 'object') return false;
    const resolved = resolveAsset(files, layer.motif, doc.detail, variant);
    if (!resolved) return false;
    const box = layerBounds(layer, resolved.meta);
    return box.width > board.width || box.height > board.height;
  });
}

/**
 * New object layer for a motif added from the catalog: same common scale as the existing objects
 * (or a fresh single-object composition), at `at` or in a free spot of the art zone. It never fills more
 * than 90 % of the art zone on an axis: a motif much taller than its neighbours (a lamp next to a coin)
 * is capped here; `addMotifToDoc` rescales the neighbours instead so the proportions survive.
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

  const wanted = commonSize(doc, meta, motif, files);
  const size = wanted * fitFactor(doc, meta, wanted);

  const objectRanks = doc.layers.filter((l) => l.role === 'object').map((l) => l.rank);
  const rank = objectRanks.length > 0 ? Math.max(...objectRanks) + 1 : 0;
  let position = at;
  if (!position) {
    // Not dropped anywhere in particular: keep the whole drawing on the artboard.
    const board = artboardOf(doc.preset);
    const spot = freeSpot(doc);
    const box = layerBounds({ x: spot.x, y: spot.y, rotation: 0, size }, meta);
    position = { x: keepWithin(spot.x, box.width, board.width), y: keepWithin(spot.y, box.height, board.height) };
  }
  return boundLayer({ motif, role: 'object' as const, x: position.x, y: position.y, rotation: 0, size, rank });
}

/** Uniformly scale every layer about the art-zone centre (positions and sizes), keeping the composition's shape. */
function scaleComposition(doc: DocState, factor: number): DocState {
  const zone = getZones(artboardOf(doc.preset), doc.layout).artZone;
  const cx = zone.x + zone.width / 2;
  const cy = zone.y + zone.height / 2;
  const layers = doc.layers.map((l) =>
    boundLayer({ ...l, x: cx + (l.x - cx) * factor, y: cy + (l.y - cy) * factor, size: l.size * factor }),
  );
  return { ...doc, layers };
}

/**
 * Document with a new object for `motif` on top, plus the id it got. When the motif at the common scale
 * would not fit the art zone (a lamp added to a lone coin), the whole composition is scaled down in
 * proportion — the intended relative sizes are kept and nothing is re-laid out. If the user has already
 * enlarged an object past the artboard the composition is left alone and only the new layer is capped.
 * Null when the layer limit is reached or the motif has no file.
 */
export function addMotifToDoc(
  doc: DocState,
  motif: MotifId,
  files: readonly AssetFileMeta[],
  at?: { x: number; y: number },
): { doc: DocState; id: string } | null {
  if (doc.layers.length >= MAX_LAYERS) return null;
  const resolved = resolveAsset(files, motif, doc.detail, variantForLayer('object', doc.colorMode));
  if (!resolved) return null;

  const factor = fitFactor(doc, resolved.meta, commonSize(doc, resolved.meta, motif, files));
  const base = factor < 1 && !hasOversizedObject(doc, files) ? scaleComposition(doc, factor) : doc;
  const spec = placeNewLayer(base, motif, files, at);
  if (!spec) return null;
  const id = `l${base.nextId}`;
  return { doc: { ...base, layers: [...base.layers, { ...spec, id }], nextId: base.nextId + 1 }, id };
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
 * Toggle the background object without touching the objects. Off removes every background layer; on adds
 * one for the visible objects at the scene's common scale, in a free frame corner, at the bottom of the z-order.
 */
export function withBackgroundObjects(doc: DocState, files: readonly AssetFileMeta[], on: boolean): DocState {
  const objects = doc.layers.filter((l) => l.role === 'object');
  if (!on) return { ...doc, backgroundObjects: false, layers: objects };

  const objectVariant = variantForLayer('object', doc.colorMode);
  const board = artboardOf(doc.preset);
  const avoid = doc.layout === 'title' ? getZones(board, doc.layout).headlineZone : null;
  const ranked = objects
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => !layer.hidden)
    .sort((a, b) => a.layer.rank - b.layer.rank || a.index - b.index)
    .map(({ layer }) => layer);

  const boxes: Box[] = [];
  for (const layer of ranked) {
    const resolved = resolveAsset(files, layer.motif, doc.detail, objectVariant);
    if (resolved) boxes.push(layerBounds(layer, resolved.meta));
  }
  const scale = commonScale(doc, files);
  const items = scale === null ? [] : sceneryItems(ranked.map((l) => l.motif), files, doc.detail, doc.colorMode, MAX_LAYERS - objects.length);
  const taken = new Set<string>();
  const scenery: Layer[] = [];
  let nextId = doc.nextId;
  items.forEach((item, rank) => {
    const placed = placeScenery(item.meta, scale as number, boxes, board, avoid, taken);
    if (!placed) return;
    taken.add(placed.corner);
    const pose = boundPose({ x: placed.x, y: placed.y, rotation: 0, size: placed.size });
    scenery.push({ id: `l${nextId}`, motif: item.motif, role: 'background', ...pose, rank });
    nextId += 1;
  });
  return { ...doc, backgroundObjects: true, layers: [...scenery, ...objects], nextId };
}
