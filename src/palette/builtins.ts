import type { Palette, SourcePaletteId } from '../domain/types';
import { SOURCE_PALETTES } from './roles';

export const DEFAULT_PALETTE_ID = 'lavender';

function builtin(id: SourcePaletteId): Palette {
  const source = SOURCE_PALETTES[id];
  return { id, name: source.name, colors: { ...source.colors }, plane: id, builtIn: true };
}

/** Built-in palettes = the three Figma palettes (lavender «Сирень», peach «Персик», mint «Мята»), exact swatches. */
export const BUILTIN_PALETTES: readonly Palette[] = [builtin('lavender'), builtin('peach'), builtin('mint')];
