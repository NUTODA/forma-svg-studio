import type { ColorResolver, Palette, SourcePaletteId } from '../domain/types';
import { hexToOklab, normalizeHex, oklabToHex } from './color';
import { classifyColor } from './roles';

/** Artboard background colour (used when the plane is off; always painted under everything). */
export function paperColor(palette: Palette): string {
  return palette.colors.paper;
}

/**
 * Role-aware, memoised resolver. For a source colour: classify it in its source palette
 * (exact swatch → role; otherwise nearest swatch), take the target palette colour for that role,
 * and for non-exact matches re-apply the colour's OKLab offset from the matched swatch (gamut-clamped).
 * Exact swatches map exactly; mapping is always computed from the original source colour.
 */
export function createColorResolver(palette: Palette): ColorResolver {
  const cache = new Map<string, string>();

  function compute(hex: string, source: SourcePaletteId): string {
    const normalized = normalizeHex(hex);
    if (!normalized) return hex.toLowerCase();

    const { role, reference, exact } = classifyColor(normalized, source);
    const target = palette.colors[role];
    if (exact) return target;

    const src = hexToOklab(normalized);
    const ref = hexToOklab(reference);
    const tgt = hexToOklab(target);
    if (!src || !ref || !tgt) return target;
    return oklabToHex({ L: tgt.L + (src.L - ref.L), a: tgt.a + (src.a - ref.a), b: tgt.b + (src.b - ref.b) });
  }

  return (sourceHex, source) => {
    const key = `${source}|${sourceHex}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = compute(sourceHex, source);
    cache.set(key, value);
    return value;
  };
}
