// CONTRACT STUB — owned by the palette agent. Signatures are fixed; bodies to be implemented.
import type { ColorResolver, Palette } from '../domain/types';

/** Artboard background colour (used when the plane is off; always painted under everything). */
export function paperColor(_palette: Palette): string {
  throw new Error('not implemented');
}

/**
 * Role-aware, memoised resolver. For a source colour: classify it in its source palette
 * (exact swatch → role; otherwise nearest swatch), take the target palette colour for that role,
 * and for non-exact matches re-apply the colour's OKLab offset from the matched swatch (gamut-clamped).
 * Exact swatches map exactly; mapping is always computed from the original source colour.
 */
export function createColorResolver(_palette: Palette): ColorResolver {
  throw new Error('not implemented');
}
