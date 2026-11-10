// CONTRACT STUB — owned by the palette agent. Signatures are fixed; bodies to be implemented.
import type { ColorMode, ColorResolver, PaintRole, Palette } from '../domain/types';

/** Effective role colours for a mode (`mono` derives tinted greys unless palette.mono overrides a role). */
export function effectiveRoleColors(_palette: Palette, _mode: ColorMode): Record<PaintRole, string> {
  throw new Error('not implemented');
}

/** Artboard background colour. */
export function paperColor(_palette: Palette, _mode: ColorMode): string {
  throw new Error('not implemented');
}

/**
 * Role-aware, memoised resolver: classify the source colour into a role, take the palette colour for
 * that role and re-apply the source's offset from the role reference in OKLab (only lightness in mono).
 * When the palette colour equals the reference the source colour is returned unchanged.
 */
export function createColorResolver(_palette: Palette, _mode: ColorMode): ColorResolver {
  throw new Error('not implemented');
}
