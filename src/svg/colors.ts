/** CSS colour parsing for SVG paint values. Pure TS. */

/** Attributes whose value is a single paint/colour. */
export const PAINT_ATTRIBUTES = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color'] as const;
export type PaintAttribute = (typeof PAINT_ATTRIBUTES)[number];

const PAINT_ATTRIBUTE_SET: ReadonlySet<string> = new Set(PAINT_ATTRIBUTES);

export function isPaintAttribute(name: string): name is PaintAttribute {
  return PAINT_ATTRIBUTE_SET.has(name);
}

/** Companion opacity attribute that can carry a colour's alpha channel (none for `color`/`lighting-color`). */
export function opacityAttributeFor(name: string): string | null {
  switch (name) {
    case 'fill':
      return 'fill-opacity';
    case 'stroke':
      return 'stroke-opacity';
    case 'stop-color':
      return 'stop-opacity';
    case 'flood-color':
      return 'flood-opacity';
    default:
      return null;
  }
}

export interface ParsedColor {
  /** Normalised lowercase `#rrggbb`. */
  hex: string;
  /** 0..1; 1 when the source had no alpha channel. */
  alpha: number;
}

// prettier-ignore
const NAMED = (
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,' +
  'black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,' +
  'chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,' +
  'darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,' +
  'darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
  'darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dimgrey:696969,' +
  'dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,' +
  'ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,grey:808080,' +
  'honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,' +
  'lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,' +
  'lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightslategrey:778899,' +
  'lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,magenta:ff00ff,' +
  'maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,' +
  'mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,' +
  'mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,' +
  'navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,' +
  'orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,' +
  'papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,' +
  'rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,' +
  'sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,' +
  'slateblue:6a5acd,slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,' +
  'tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,' +
  'white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32'
);

const NAMED_COLORS: ReadonlyMap<string, string> = new Map(
  NAMED.split(',').map((entry): [string, string] => {
    const [name = '', hex = ''] = entry.split(':');
    return [name, `#${hex}`];
  }),
);

function toHexByte(value: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
}

function toHex(r: number, g: number, b: number): string {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function parseHex(body: string): ParsedColor | null {
  if (!/^[0-9a-f]+$/.test(body)) return null;
  const expand = (s: string): string => s.replace(/./g, (c) => c + c);
  switch (body.length) {
    case 3:
      return { hex: `#${expand(body)}`, alpha: 1 };
    case 4:
      return { hex: `#${expand(body.slice(0, 3))}`, alpha: parseInt(expand(body[3] ?? 'f'), 16) / 255 };
    case 6:
      return { hex: `#${body}`, alpha: 1 };
    case 8:
      return { hex: `#${body.slice(0, 6)}`, alpha: parseInt(body.slice(6), 16) / 255 };
    default:
      return null;
  }
}

/** Splits `a, b, c` / `a b c / d` argument lists into numeric tokens. */
function functionArguments(inner: string): string[] | null {
  const parts = inner.split(/[\s,/]+/).filter((p) => p !== '');
  return parts.length === 3 || parts.length === 4 ? parts : null;
}

function parseChannel(token: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/.exec(token);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] ? (n / 100) * 255 : n;
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%?)$/.exec(token);
  if (!match) return null;
  const n = Number(match[2] ? Number(match[1]) / 100 : match[1]);
  return Math.min(1, Math.max(0, n));
}

function parseRgb(inner: string): ParsedColor | null {
  const args = functionArguments(inner);
  if (!args) return null;
  const channels = args.slice(0, 3).map(parseChannel);
  const alpha = parseAlpha(args[3]);
  if (channels.some((c) => c === null) || alpha === null) return null;
  const [r, g, b] = channels as [number, number, number];
  return { hex: toHex(r, g, b), alpha };
}

function hueToRgb(p: number, q: number, t: number): number {
  const u = ((t % 1) + 1) % 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function parseHsl(inner: string): ParsedColor | null {
  const args = functionArguments(inner);
  if (!args) return null;
  const hue = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg)?$/.exec(args[0] ?? '');
  const sat = /^(\d+\.?\d*|\.\d+)%$/.exec(args[1] ?? '');
  const light = /^(\d+\.?\d*|\.\d+)%$/.exec(args[2] ?? '');
  const alpha = parseAlpha(args[3]);
  if (!hue || !sat || !light || alpha === null) return null;
  const h = Number(hue[1]) / 360;
  const s = Math.min(1, Number(sat[1]) / 100);
  const l = Math.min(1, Number(light[1]) / 100);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    hex: toHex(hueToRgb(p, q, h + 1 / 3) * 255, hueToRgb(p, q, h) * 255, hueToRgb(p, q, h - 1 / 3) * 255),
    alpha,
  };
}

/**
 * Parses a paint value into hex + alpha. Returns null for `none`, `transparent`, `currentColor`,
 * `inherit`, `url(...)` and anything unrecognised.
 */
export function parseColor(value: string): ParsedColor | null {
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  if (v.startsWith('#')) return parseHex(v.slice(1));
  const fn = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(v);
  if (fn) return fn[1]?.startsWith('rgb') ? parseRgb(fn[2] ?? '') : parseHsl(fn[2] ?? '');
  const named = NAMED_COLORS.get(v);
  return named ? { hex: named, alpha: 1 } : null;
}

/** `'#rrggbb'` lowercase, or null when the value is not a plain colour. Alpha is dropped (see `parseColor`). */
export function normalizeColor(value: string): string | null {
  return parseColor(value)?.hex ?? null;
}

/** True for keywords that legitimately carry no colour (so they are not worth a warning). */
export function isColorlessPaint(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    v === '' ||
    v === 'none' ||
    v === 'transparent' ||
    v === 'currentcolor' ||
    v === 'inherit' ||
    v === 'initial' ||
    v === 'unset' ||
    v === 'context-fill' ||
    v === 'context-stroke' ||
    v.startsWith('url(')
  );
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
