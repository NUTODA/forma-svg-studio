/**
 * Whitelist sanitiser for SVG trees. Produces a NEW tree; the input is never mutated.
 * Everything that is not explicitly allowed is removed, with a Russian warning where it matters.
 */
import { localName, type XmlElement, type XmlNode } from './xml.ts';

export const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'filter',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feFlood', 'feGaussianBlur', 'feMerge',
  'feMergeNode', 'feMorphology', 'feOffset', 'feFuncA', 'feFuncR', 'feFuncG', 'feFuncB', 'feDropShadow',
  'text', 'tspan',
]);

/** Presentation properties: allowed as attributes and as `style` declarations. */
export const PRESENTATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'color',
  'clip-path', 'clip-rule', 'mask', 'filter', 'display', 'visibility', 'paint-order', 'vector-effect',
  'mix-blend-mode', 'isolation', 'stop-color', 'stop-opacity', 'flood-color', 'flood-opacity', 'lighting-color',
  'color-interpolation', 'color-interpolation-filters', 'shape-rendering', 'overflow', 'font-family',
  'font-size', 'font-weight', 'font-style', 'text-anchor', 'letter-spacing', 'word-spacing', 'text-decoration',
  'dominant-baseline',
]);

const STRUCTURAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id', 'xmlns', 'xmlns:xlink', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'transform',
  'href', 'xlink:href', 'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'pathLength',
  'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'fr', 'offset',
  'clipPathUnits', 'maskUnits', 'maskContentUnits', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'filterUnits', 'primitiveUnits', 'in', 'in2', 'result', 'mode', 'type', 'values', 'tableValues', 'slope',
  'intercept', 'amplitude', 'exponent', 'operator', 'k1', 'k2', 'k3', 'k4', 'stdDeviation', 'radius', 'edgeMode',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Attributes that are dropped without a warning (editor noise, never rendering-relevant). */
const SILENT_DROP = /^(?:data-|aria-|xmlns:|class$|version$|baseProfile$|xml:|enable-background$|role$|focusable$|tabindex$|lang$)/;

const ELEMENT_REMOVAL_MESSAGES: Record<string, string> = {
  image: 'Удалён растровый <image>',
  script: 'Удалён скрипт <script>',
  style: 'Удалён <style>: таблицы стилей не поддерживаются',
  foreignObject: 'Удалён <foreignObject>',
  a: 'Удалена ссылка <a>',
  iframe: 'Удалён <iframe>',
  animate: 'Удалена анимация <animate>',
  animateTransform: 'Удалена анимация <animateTransform>',
  animateMotion: 'Удалена анимация <animateMotion>',
  set: 'Удалена анимация <set>',
  metadata: 'Удалён служебный элемент <metadata>',
  title: 'Удалён служебный элемент <title>',
  desc: 'Удалён служебный элемент <desc>',
};

export interface SanitizeResult {
  root: XmlElement;
  warnings: string[];
}

/** Collects warnings, merging repeats into «… (×N)». */
class Warnings {
  private readonly counts = new Map<string, number>();

  add(message: string): void {
    this.counts.set(message, (this.counts.get(message) ?? 0) + 1);
  }

  list(): string[] {
    return [...this.counts].map(([message, count]) => (count > 1 ? `${message} (×${count})` : message));
  }
}

/* ------------------------------------------------------------------ */
/* Values                                                              */
/* ------------------------------------------------------------------ */

/** True when every `url(...)` in the value points to a local fragment. */
function urlsAreLocal(value: string): boolean {
  const re = /url\(\s*(['"]?)\s*([^)'"]*)/gi;
  for (let m = re.exec(value); m; m = re.exec(value)) {
    if (!(m[2] ?? '').trim().startsWith('#')) return false;
  }
  return true;
}

function hasScriptScheme(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase().includes('javascript:');
}

/** Returns a warning message when the attribute must be dropped, otherwise null. */
function rejectValue(name: string, value: string): string | null {
  if (hasScriptScheme(value)) return `Удалён атрибут ${name} со скриптом (javascript:)`;
  if (name === 'href' || name === 'xlink:href') {
    const target = value.trim();
    return target.startsWith('#') && target.length > 1 ? null : `Удалена внешняя ссылка ${name}`;
  }
  if (/url\(/i.test(value) && !urlsAreLocal(value)) return `Удалена внешняя ссылка в атрибуте ${name}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* style="…"                                                           */
/* ------------------------------------------------------------------ */

function splitDeclarations(style: string): string[] {
  const css = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const ch of css) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

export function parseStyleDeclarations(style: string): [string, string][] {
  const result: [string, string][] = [];
  for (const part of splitDeclarations(style)) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).replace(/!\s*important\s*$/i, '').trim();
    if (prop && value) result.push([prop, value]);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Tree walk                                                           */
/* ------------------------------------------------------------------ */

function cleanAttributes(el: XmlElement, warnings: Warnings): { name: string; value: string }[] {
  const attrs = el.attrs.map((a) => ({ ...a }));
  const styleAttr = attrs.find((a) => a.name === 'style');
  if (styleAttr) {
    for (const [prop, value] of parseStyleDeclarations(styleAttr.value)) {
      if (!PRESENTATION_ATTRIBUTES.has(prop)) {
        warnings.add(`Удалено CSS-свойство ${prop} из style`);
        continue;
      }
      const existing = attrs.find((a) => a.name === prop);
      if (existing) existing.value = value;
      else attrs.push({ name: prop, value });
    }
  }

  const kept: { name: string; value: string }[] = [];
  for (const attr of attrs) {
    const { name, value } = attr;
    if (name === 'style') continue;
    if (/^on/i.test(name)) {
      warnings.add(`Удалён обработчик события ${name}`);
      continue;
    }
    if (name === 'xmlns') {
      if (value === SVG_NS) kept.push(attr);
      continue;
    }
    if (name === 'xmlns:xlink') {
      if (value === XLINK_NS) kept.push(attr);
      continue;
    }
    if (!PRESENTATION_ATTRIBUTES.has(name) && !STRUCTURAL_ATTRIBUTES.has(name)) {
      if (!SILENT_DROP.test(name)) warnings.add(`Удалён неподдерживаемый атрибут ${name}`);
      continue;
    }
    const problem = rejectValue(name, value);
    if (problem) {
      warnings.add(problem);
      continue;
    }
    kept.push(attr);
  }
  return kept;
}

function sanitizeNode(node: XmlNode, insideText: boolean, warnings: Warnings): XmlNode | null {
  if (node.kind === 'text') return insideText ? node : null;

  const name = node.name;
  if (!ALLOWED_ELEMENTS.has(name)) {
    warnings.add(ELEMENT_REMOVAL_MESSAGES[name] ?? `Удалён неподдерживаемый элемент <${name}>`);
    return null;
  }

  const attrs = cleanAttributes(node, warnings);
  if (name === 'use' && !attrs.some((a) => a.name === 'href' || a.name === 'xlink:href')) {
    warnings.add('Удалён <use> без локальной ссылки');
    return null;
  }

  const childInsideText = insideText || localName(name) === 'text' || localName(name) === 'tspan';
  const children: XmlNode[] = [];
  for (const child of node.children) {
    const clean = sanitizeNode(child, childInsideText, warnings);
    if (clean) children.push(clean);
  }
  return { kind: 'element', name, attrs, children };
}

export function sanitizeSvg(root: XmlElement): SanitizeResult {
  if (root.name !== 'svg') {
    throw new Error(`Корневой элемент должен быть <svg>, а не <${root.name}>`);
  }
  const warnings = new Warnings();
  const clean = sanitizeNode(root, false, warnings);
  if (!clean || clean.kind !== 'element') throw new Error('Не удалось очистить SVG');
  return { root: clean, warnings: warnings.list() };
}
