// Pure helpers behind <NumberField>: parsing locale-tolerant input, stepping, formatting.

/** Parse user input such as "12,5", "-3" (also with a typographic minus), "15°" or "1 200". Null for anything else. */
export function parseNumberInput(text: string): number | null {
  const cleaned = text
    .replace(/[\s  ]/g, '')
    .replace(/[−‒–—]/g, '-')
    .replace(',', '.')
    .replace(/°$/, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Display text: at most `decimals` fraction digits, Russian decimal comma, no trailing zeros, no "-0". */
export function formatNumberValue(value: number, decimals = 1): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const normalised = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalised).replace('.', ',');
}

export interface StepModifiers {
  shift?: boolean;
  alt?: boolean;
}

/** Keyboard step: ±step, Shift ×10, Alt ×0.1. Rounded to 3 decimals to avoid float drift. */
export function stepValue(base: number, direction: 1 | -1, step: number, mods: StepModifiers = {}): number {
  const multiplier = mods.shift ? 10 : mods.alt ? 0.1 : 1;
  return Math.round((base + direction * step * multiplier) * 1000) / 1000;
}

export function clampValue(value: number, min?: number, max?: number): number {
  let result = value;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  return result;
}
