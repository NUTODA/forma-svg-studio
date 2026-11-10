// CONTRACT STUB — owned by the palette agent. Signatures are fixed; bodies/values to be implemented.
import type { PaintRole, SourcePaletteId } from '../domain/types';

export interface RoleInfo {
  /** Russian short label, e.g. «Акцент». */
  label: string;
  /** Russian description of where the role is used. */
  description: string;
  group: 'artboard' | 'background' | 'objects';
}

export const ROLE_INFO: Record<PaintRole, RoleInfo> = {} as Record<PaintRole, RoleInfo>;

/**
 * Exact swatches of the three Figma palettes (public/assets/source-manifest.json), per role.
 * `paper` is not a Figma swatch: it is the artboard colour when the plane is off.
 */
export const SOURCE_PALETTES: Record<SourcePaletteId, { name: string; colors: Record<PaintRole, string> }> =
  {} as Record<SourcePaletteId, { name: string; colors: Record<PaintRole, string> }>;

/**
 * Role of a source colour in its source palette: exact swatch match first, otherwise nearest
 * swatch in OKLab (paper excluded). Returns the role and the reference swatch it was matched to.
 */
export function classifyColor(_hex: string, _source: SourcePaletteId): { role: PaintRole; reference: string; exact: boolean } {
  throw new Error('not implemented');
}
