// CONTRACT STUB — owned by the SVG core agent. Signatures are fixed; bodies to be implemented.
import type { AssetFileMeta, Detail, MotifId, Variant } from '../domain/types';

export interface ParsedAssetName {
  motif: MotifId;
  detail: Detail;
  variant: Variant;
}

/** `book-s-main.svg` → {motif:'book', detail:'s', variant:'main'}; anything else → null. */
export function parseAssetFileName(_file: string): ParsedAssetName | null {
  throw new Error('not implemented');
}

export interface ResolvedAsset {
  meta: AssetFileMeta;
  /** True when the exact motif/detail/variant file exists. */
  exact: boolean;
}

/**
 * Nearest real file for a request. Fallback order:
 * exact → same variant, other detail → other variant, same detail → other variant, other detail.
 * Returns null when the motif has no files at all.
 */
export function resolveAsset(
  _files: readonly AssetFileMeta[],
  _motif: MotifId,
  _detail: Detail,
  _variant: Variant,
): ResolvedAsset | null {
  throw new Error('not implemented');
}

/** Motifs with at least one file, in MOTIF_IDS order. */
export function availableMotifs(_files: readonly AssetFileMeta[]): MotifId[] {
  throw new Error('not implemented');
}

/** Which of the 4 combinations exist for a motif, keyed `s-main`, `s-background`, `l-main`, `l-background`. */
export function motifAvailability(
  _files: readonly AssetFileMeta[],
  _motif: MotifId,
): Record<`${Detail}-${Variant}`, boolean> {
  throw new Error('not implemented');
}
