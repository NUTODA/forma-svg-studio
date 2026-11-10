// CONTRACT STUB — owned by the palette agent. Signatures are fixed; bodies to be implemented.
import type { Palette } from '../domain/types';

export const PALETTE_SCHEMA_ID = 'forma.palette/v1';
/** Max accepted JSON size in bytes. */
export const PALETTE_MAX_BYTES = 20_000;

export interface PaletteError {
  /** JSON path, e.g. `colors.primary`; empty string for the whole document. */
  path: string;
  /** Russian, actionable. */
  message: string;
}

export type PaletteValidation =
  | { ok: true; palette: Palette; warnings: string[] }
  | { ok: false; errors: PaletteError[] };

/** Ready-to-edit template object documenting every role. */
export function paletteTemplate(): unknown {
  throw new Error('not implemented');
}

/** Pretty-printed template JSON. */
export function paletteTemplateJson(): string {
  throw new Error('not implemented');
}

/**
 * Safely parse and validate user-supplied palette JSON (never eval, size-limited, prototype-pollution safe).
 * `takenIds` — ids already used, a fresh unique id is derived when needed.
 */
export function validatePaletteJson(_text: string, _takenIds: ReadonlySet<string>): PaletteValidation {
  throw new Error('not implemented');
}
