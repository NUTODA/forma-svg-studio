// Vetted-asset templates: parse → sanitise → measure → pre-tokenise, then instantiate by token replacement.
import type { Box, SourcePaletteId } from '../domain/types.ts';
import { paintedBounds, parseViewBox } from './bounds.ts';
import { isColorlessPaint, isHexColor, isPaintAttribute, opacityAttributeFor, parseColor } from './colors.ts';
import { sanitizeSvg } from './sanitize.ts';
import { getAttr, parseXml, serializeXml, type XmlElement, type XmlNode } from './xml.ts';

/**
 * A pre-processed, sanitised bundled SVG ready for fast per-instance rendering.
 * `body` is opaque: wrapper <g> carrying the root presentation attributes + sanitised children,
 * with internal tokens for the per-instance id prefix and for every paint colour.
 */
export interface SvgTemplate {
  file: string;
  /** Palette the drawing's colours come from (objects: `lavender`; planes: their own). */
  source: SourcePaletteId;
  viewBox: Box;
  bounds: Box;
  colors: string[];
  body: string;
  warnings: string[];
}

export interface SvgAnalysis {
  viewBox: Box;
  bounds: Box;
  colors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

// A private-use code point never produced by real files (sources containing it are rejected).
const TOKEN_CHAR = '';
const PREFIX_TOKEN = `${TOKEN_CHAR}p${TOKEN_CHAR}`;
const colorToken = (index: number): string => `${TOKEN_CHAR}c${index}${TOKEN_CHAR}`;
const TOKEN_RE = /(?:p|c(\d+))/g;
const ID_PREFIX_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const URL_REF_RE = /url\(\s*(['"]?)\s*#([^)'"\s]+)\s*\1\s*\)/g;

/** Attributes that never move from the source <svg> onto the instance wrapper. */
const ROOT_ONLY_ATTRIBUTES = new Set(['width', 'height', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'id', 'transform', 'xmlns', 'xmlns:xlink']);

const VIEWBOX_CLIP_ID = 'forma-viewbox-clip';
const OVERFLOW_TOLERANCE = 0.01;

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

interface Prepared {
  root: XmlElement;
  viewBox: Box;
  bounds: Box;
  /** Painted geometry exceeds the viewBox (after element clip-paths). */
  overflows: boolean;
  colors: string[];
  warnings: string[];
}

function forEachElement(el: XmlElement, visit: (el: XmlElement) => void): void {
  visit(el);
  for (const child of el.children) if (child.kind === 'element') forEachElement(child, visit);
}

/**
 * Rewrites every recognisable paint value to normalised `#rrggbb` (moving alpha into the matching
 * `*-opacity` attribute so nothing visible is lost) and returns the distinct colours in document order.
 */
function normalizePaints(root: XmlElement, warnings: Set<string>): string[] {
  const colors: string[] = [];
  forEachElement(root, (el) => {
    for (const attr of el.attrs) {
      if (!isPaintAttribute(attr.name)) continue;
      const parsed = parseColor(attr.value);
      if (!parsed) {
        if (!isColorlessPaint(attr.value)) warnings.add(`Неизвестный цвет «${attr.value}» в ${attr.name} оставлен как есть`);
        continue;
      }
      attr.value = parsed.hex;
      if (!colors.includes(parsed.hex)) colors.push(parsed.hex);
      if (parsed.alpha < 1) {
        const opacityName = opacityAttributeFor(attr.name);
        if (opacityName && getAttr(el, opacityName) === undefined) {
          el.attrs.push({ name: opacityName, value: String(Math.round(parsed.alpha * 1000) / 1000) });
        }
        warnings.add(`Прозрачность цвета в ${attr.name} перенесена в ${opacityName ?? 'атрибут прозрачности'}`);
      }
    }
  });
  return colors;
}

function contains(outer: Box, inner: Box, tolerance: number): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function prepare(source: string): Prepared {
  if (source.includes(TOKEN_CHAR)) throw new Error('Файл содержит служебные символы, которые приложение не поддерживает');
  let parsed: XmlElement;
  try {
    parsed = parseXml(source);
  } catch (error) {
    throw new Error(`Не удалось разобрать SVG: ${error instanceof Error ? error.message : String(error)}`);
  }
  const sanitized = sanitizeSvg(parsed);
  const warnings = new Set<string>(sanitized.warnings);
  const colors = normalizePaints(sanitized.root, warnings);
  const viewBox = parseViewBox(sanitized.root);
  const measured = paintedBounds(sanitized.root);
  for (const warning of measured.warnings) warnings.add(warning);
  const overflows = measured.unclipped !== null && !contains(viewBox, measured.unclipped, OVERFLOW_TOLERANCE);
  return { root: sanitized.root, viewBox, bounds: measured.bounds, overflows, colors, warnings: [...warnings] };
}

/** Parse + sanitise + measure raw SVG source. Throws `Error` with a Russian message if unusable. */
export function analyzeSvgSource(source: string): SvgAnalysis {
  const { viewBox, bounds, colors, warnings } = prepare(source);
  return { viewBox, bounds, colors, warnings };
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

function collectIds(root: XmlElement): Set<string> {
  const ids = new Set<string>();
  forEachElement(root, (el) => {
    const id = getAttr(el, 'id');
    if (id !== undefined) ids.add(id);
  });
  return ids;
}

function tokenizeValue(name: string, value: string, colors: readonly string[], ids: ReadonlySet<string>, dangling: Set<string>): string {
  if (name === 'id') return PREFIX_TOKEN + value;
  if (isPaintAttribute(name)) {
    const index = colors.indexOf(value);
    if (index >= 0 && isHexColor(value)) return colorToken(index);
  }
  if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
    const target = value.slice(1);
    if (!ids.has(target)) dangling.add(target);
    return `#${PREFIX_TOKEN}${target}`;
  }
  if (!value.includes('url(')) return value;
  return value.replace(URL_REF_RE, (_match, quote: string, target: string) => {
    if (!ids.has(target)) dangling.add(target);
    return `url(${quote}#${PREFIX_TOKEN}${target}${quote})`;
  });
}

function tokenizeElement(el: XmlElement, colors: readonly string[], ids: ReadonlySet<string>, dangling: Set<string>): XmlElement {
  return {
    kind: 'element',
    name: el.name,
    attrs: el.attrs.map((a) => ({ name: a.name, value: tokenizeValue(a.name, a.value, colors, ids, dangling) })),
    children: el.children.map((child): XmlNode => (child.kind === 'element' ? tokenizeElement(child, colors, ids, dangling) : child)),
  };
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function viewBoxClip(viewBox: Box, clipId: string): string {
  const rect = `<rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.width}" height="${viewBox.height}"/>`;
  return `<defs><clipPath id="${PREFIX_TOKEN}${clipId}">${rect}</clipPath></defs>`;
}

export function buildTemplate(source: string, info: { file: string; source: SourcePaletteId }): SvgTemplate {
  const prepared = prepare(source);
  const ids = collectIds(prepared.root);
  const dangling = new Set<string>();
  const tokenized = tokenizeElement(prepared.root, prepared.colors, ids, dangling);

  const wrapper: XmlElement = {
    kind: 'element',
    name: 'g',
    attrs: tokenized.attrs.filter((a) => !ROOT_ONLY_ATTRIBUTES.has(a.name)),
    children: tokenized.children,
  };
  let body = serializeXml(wrapper);
  if (prepared.overflows) {
    const clipId = uniqueId(VIEWBOX_CLIP_ID, ids);
    const clip = viewBoxClip(prepared.viewBox, clipId);
    body = `<g clip-path="url(#${PREFIX_TOKEN}${clipId})">${clip}${body}</g>`;
  }

  const warnings = [...prepared.warnings];
  for (const id of dangling) warnings.push(`Ссылка на несуществующий id «${id}»`);
  return {
    file: info.file,
    source: info.source,
    viewBox: prepared.viewBox,
    bounds: prepared.bounds,
    colors: prepared.colors,
    body,
    warnings,
  };
}

/** True when instances contain `xlink:href` (the export root then needs `xmlns:xlink`). */
export function templateUsesXlink(t: SvgTemplate): boolean {
  return /\sxlink:href=/.test(t.body);
}

/**
 * Produce standalone markup (one <g>…</g>) for one instance:
 * every id becomes `${idPrefix}${id}`, every url(#id) / href="#id" / xlink:href="#id" reference
 * is rewritten accordingly, every paint colour (normalised `#rrggbb`) is passed through `color`.
 * `idPrefix` must match /^[A-Za-z][A-Za-z0-9_-]*$/.
 */
export function instantiate(
  template: SvgTemplate,
  opts: { idPrefix: string; color: (hex: string) => string },
): string {
  const { idPrefix, color } = opts;
  if (!ID_PREFIX_RE.test(idPrefix)) throw new Error(`Недопустимый префикс идентификаторов «${idPrefix}»`);
  const resolved = new Map<number, string>();
  return template.body.replace(TOKEN_RE, (_token: string, index: string | undefined) => {
    if (index === undefined) return idPrefix;
    const i = Number(index);
    let out = resolved.get(i);
    if (out === undefined) {
      const sourceHex = template.colors[i] ?? '#000000';
      const mapped = color(sourceHex);
      out = isHexColor(mapped) ? mapped.toLowerCase() : sourceHex;
      resolved.set(i, out);
    }
    return out;
  });
}
