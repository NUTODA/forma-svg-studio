// CONTRACT STUB — owned by the doc/layout agent. Signatures are fixed; bodies to be implemented.
import type {
  ArtboardPresetId,
  AssetFileMeta,
  DemoPreset,
  Detail,
  DocState,
  Layer,
  LayoutMode,
  MotifId,
  Zones,
} from '../domain/types';

/** Empty document with art-directed defaults (og 1200×630, composed, L, ivory-lilac, backgrounds on). */
export function createDoc(): DocState {
  throw new Error('not implemented');
}

/** Strict structural validation for persisted drafts; returns a sanitised copy or null. */
export function validateDoc(_value: unknown): DocState | null {
  throw new Error('not implemented');
}

export interface ComposeLayersInput {
  /** Object motifs in relevance order (duplicates allowed, e.g. two coins). */
  motifs: MotifId[];
  files: readonly AssetFileMeta[];
  preset: ArtboardPresetId;
  layout: LayoutMode;
  detail: Detail;
  showBackground: boolean;
}

export interface ComposeLayersResult {
  layers: Layer[];
  nextId: number;
  zones: Zones;
  /** Requested motifs that have no files (skipped). */
  missing: MotifId[];
}

/** Resolve files (with fallback), run `compose`, assign ids `l${n}` from `startId`. */
export function composeLayers(_input: ComposeLayersInput, _startId: number): ComposeLayersResult {
  throw new Error('not implemented');
}

/** Object motifs of the document ordered by rank (input for recompose). */
export function objectMotifs(_doc: DocState): MotifId[] {
  throw new Error('not implemented');
}

/** Re-run the layout for the document's current motifs and settings (used by preset/layout/background changes). */
export function recomposeDoc(_doc: DocState, _files: readonly AssetFileMeta[]): DocState {
  throw new Error('not implemented');
}

/**
 * New object layer for a motif added from the catalog: same common scale as the existing objects
 * (or a fresh single-object composition), centred at `at` or in a free spot of the art zone.
 */
export function placeNewLayer(
  _doc: DocState,
  _motif: MotifId,
  _files: readonly AssetFileMeta[],
  _at?: { x: number; y: number },
): Omit<Layer, 'id'> | null {
  throw new Error('not implemented');
}

/**
 * New document = `base` settings + freshly composed layers for `motifs` (ids continue from base.nextId).
 * Used by «Собрать» for both brief modes and by demo presets (the caller does the analysis).
 */
export function docFromMotifs(
  _base: DocState,
  _motifs: MotifId[],
  _files: readonly AssetFileMeta[],
): DocState {
  throw new Error('not implemented');
}

/** 2–3 demonstrative presets (at least one by title, one by names), using real motifs. */
export const DEMO_PRESETS: readonly DemoPreset[] = [];
