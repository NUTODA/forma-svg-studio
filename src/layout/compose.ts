// CONTRACT STUB — owned by the layout agent. Signatures are fixed; bodies to be implemented.
import type {
  ArtboardPreset,
  ArtboardPresetId,
  AssetFileMeta,
  Box,
  ComposeInput,
  ComposeResult,
  LayoutMode,
  Layer,
  PlacedLayer,
  Size,
  Zones,
} from '../domain/types';

export const ARTBOARD_PRESETS: Record<ArtboardPresetId, ArtboardPreset> = {} as Record<ArtboardPresetId, ArtboardPreset>;

/** Art zone and reserved headline zone for an artboard and layout mode. */
export function getZones(_artboard: Size, _mode: LayoutMode): Zones {
  throw new Error('not implemented');
}

/** Deterministic art-directed composition (uniform common scale, source proportions preserved). */
export function compose(_input: ComposeInput): ComposeResult {
  throw new Error('not implemented');
}

/** Axis-aligned bounds (artboard units) of a placed layer's painted geometry, rotation included. */
export function layerBounds(_layer: Pick<Layer | PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>, _meta: AssetFileMeta): Box {
  throw new Error('not implemented');
}
