/** Colour maths: hex, sRGB ↔ linear ↔ OKLab (Ottosson), WCAG contrast, mixing. No dependencies. */

export interface Rgb {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/** Parses `#rgb` / `#rrggbb` (case-insensitive). Returns null for anything else. */
export function parseHex(input: string): Rgb | null {
  const m6 = HEX6.exec(input);
  if (m6?.[1]) {
    const n = parseInt(m6[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const m3 = HEX3.exec(input);
  if (m3?.[1]) {
    const [r = '0', g = '0', b = '0'] = m3[1].split('');
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  return null;
}

/** Normalises `#rgb` / `#RRGGBB` to lowercase `#rrggbb`, or null when invalid. */
export function normalizeHex(input: string): string | null {
  const rgb = parseHex(input);
  return rgb ? formatHex(rgb) : null;
}

const clamp255 = (v: number): number => Math.min(255, Math.max(0, Math.round(v)));
const byteHex = (v: number): string => clamp255(v).toString(16).padStart(2, '0');

/** Formats channels (clamped and rounded) as lowercase `#rrggbb`. */
export function formatHex(rgb: Rgb): string {
  return `#${byteHex(rgb.r)}${byteHex(rgb.g)}${byteHex(rgb.b)}`;
}

/** sRGB channel 0..1 → linear 0..1. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear channel 0..1 → sRGB 0..1. */
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

export function rgbToLinear(rgb: Rgb): [number, number, number] {
  return [srgbToLinear(rgb.r / 255), srgbToLinear(rgb.g / 255), srgbToLinear(rgb.b / 255)];
}

export function linearToRgb(r: number, g: number, b: number): Rgb {
  return { r: linearToSrgb(r) * 255, g: linearToSrgb(g) * 255, b: linearToSrgb(b) * 255 };
}

export function linearToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab → linear sRGB (may fall outside 0..1 for out-of-gamut colours). */
export function oklabToLinear(lab: Lab): [number, number, number] {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function rgbToOklab(rgb: Rgb): Lab {
  const [r, g, b] = rgbToLinear(rgb);
  return linearToOklab(r, g, b);
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Gamut clamp: out-of-range linear channels are clipped to 0..1, then encoded as sRGB. */
export function oklabToRgb(lab: Lab): Rgb {
  const [r, g, b] = oklabToLinear(lab);
  return linearToRgb(clamp01(r), clamp01(g), clamp01(b));
}

export function hexToOklab(hex: string): Lab | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToOklab(rgb) : null;
}

/** OKLab → gamut-clamped lowercase `#rrggbb`. */
export function oklabToHex(lab: Lab): string {
  return formatHex(oklabToRgb(lab));
}

/** Euclidean distance in OKLab. */
export function oklabDistance(p: Lab, q: Lab): number {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** WCAG 2.x relative luminance (0..1); 0 for invalid input. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgbToLinear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Perceptual mix in OKLab; `t` = 0 → a, 1 → b. Invalid inputs return `a` lowercased. */
export function mixHex(a: string, b: string, t: number): string {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  if (!la || !lb) return a.toLowerCase();
  const k = clamp01(t);
  return oklabToHex({ L: la.L + (lb.L - la.L) * k, a: la.a + (lb.a - la.a) * k, b: la.b + (lb.b - la.b) * k });
}
