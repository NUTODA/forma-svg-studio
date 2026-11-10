// The artboard preview and the exported file are built from the SAME functions in this module,
// which is what guarantees "export renders exactly like the preview".
import { resolveAsset, resolvePlane, variantForLayer } from '../assets/availability';
import type {
  AssetFileMeta,
  ColorMode,
  ColorResolver,
  Detail,
  DocState,
  Layer,
  Palette,
  PlaneFileMeta,
  Size,
} from '../domain/types';
import { normalizeColor } from '../svg/colors';
import { instantiate, templateUsesXlink, type SvgTemplate } from '../svg/template';
import { escapeXmlAttr, escapeXmlText } from '../svg/xml';

export interface RenderContext {
  files: readonly AssetFileMeta[];
  planes: readonly PlaneFileMeta[];
  templates: ReadonlyMap<string, SvgTemplate>;
  detail: Detail;
  colorMode: ColorMode;
  palette: Palette;
  color: ColorResolver;
}

export interface RenderedLayer {
  layer: Layer;
  meta: AssetFileMeta;
  /** Human-readable unique group id, e.g. `book-1`, `bouquet-background-1`. */
  groupId: string;
  /** SVG transform attribute value: translate · rotate · uniform scale · re-centre. */
  transform: string;
  /** Instance markup from `instantiate()` with ids prefixed by `${groupId}__`. */
  markup: string;
  /** True when a fallback file (not the exact detail/variant) is used. */
  fallback: boolean;
}

export interface RenderedPlane {
  meta: PlaneFileMeta;
  /** Always `plane`. */
  groupId: string;
  /** Cover-fit transform (uniform scale, centred crop). */
  transform: string;
  markup: string;
  fallback: boolean;
}

/** Rounds to at most 3 decimals and prints without trailing zeros (`-0` → `0`). */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

/** Uniform scale for a layer: `layer.size / meta.bounds.height`. */
export function layerScale(layer: Layer, meta: AssetFileMeta): number {
  const height = meta.bounds.height > 0 ? meta.bounds.height : meta.viewBox.height;
  return height > 0 ? layer.size / height : 1;
}

/** `translate(x y) rotate(r) scale(s) translate(-cx -cy)` with numbers rounded to 3 decimals. */
export function layerTransform(layer: Layer, meta: AssetFileMeta): string {
  const cx = meta.bounds.x + meta.bounds.width / 2;
  const cy = meta.bounds.y + meta.bounds.height / 2;
  const rotation = formatNumber(layer.rotation);
  const parts = [`translate(${formatNumber(layer.x)} ${formatNumber(layer.y)})`];
  if (rotation !== '0') parts.push(`rotate(${rotation})`);
  parts.push(`scale(${formatNumber(layerScale(layer, meta))})`, `translate(${formatNumber(-cx)} ${formatNumber(-cy)})`);
  return parts.join(' ');
}

/** Stable, unique, readable group ids for all layers (keyed by layer.id), in z-order. */
export function layerGroupIds(layers: readonly Layer[]): Map<string, string> {
  const counters = new Map<string, number>();
  const ids = new Map<string, string>();
  for (const layer of layers) {
    const key = `${layer.motif}|${layer.role}`;
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    ids.set(layer.id, layer.role === 'background' ? `${layer.motif}-background-${n}` : `${layer.motif}-${n}`);
  }
  return ids;
}

/** File a layer is drawn with (variantForLayer + resolveAsset fallback), or null if the motif has no files. */
export function layerAsset(
  layer: Layer,
  ctx: Pick<RenderContext, 'files' | 'detail' | 'colorMode'>,
): { meta: AssetFileMeta; exact: boolean } | null {
  return resolveAsset(ctx.files, layer.motif, ctx.detail, variantForLayer(layer.role, ctx.colorMode));
}

/** Resolve file + template and render one layer; null if the motif has no file or the template is not loaded yet. */
export function renderLayer(layer: Layer, groupId: string, ctx: RenderContext): RenderedLayer | null {
  const asset = layerAsset(layer, ctx);
  if (!asset) return null;
  const template = ctx.templates.get(asset.meta.file);
  if (!template) return null;
  return {
    layer,
    meta: asset.meta,
    groupId,
    transform: layerTransform(layer, asset.meta),
    markup: instantiate(template, { idPrefix: `${groupId}__`, color: (hex) => ctx.color(hex, template.source) }),
    fallback: !asset.exact,
  };
}

function planeTransform(meta: PlaneFileMeta, artboard: Size): string {
  const vb = meta.viewBox;
  const scale = Math.max(artboard.width / vb.width, artboard.height / vb.height);
  const tx = (artboard.width - vb.width * scale) / 2;
  const ty = (artboard.height - vb.height * scale) / 2;
  return `translate(${formatNumber(tx)} ${formatNumber(ty)}) scale(${formatNumber(scale)}) translate(${formatNumber(-vb.x)} ${formatNumber(-vb.y)})`;
}

/** Cover-fitted palette plane, or null when the plane is off / missing / not loaded. */
export function renderPlane(doc: DocState, artboard: Size, ctx: RenderContext): RenderedPlane | null {
  if (!doc.showPlane) return null;
  const resolved = resolvePlane(ctx.planes, ctx.palette.plane, ctx.detail);
  if (!resolved) return null;
  const template = ctx.templates.get(resolved.meta.file);
  if (!template) return null;
  return {
    meta: resolved.meta,
    groupId: 'plane',
    transform: planeTransform(resolved.meta, artboard),
    markup: instantiate(template, { idPrefix: 'plane__', color: (hex) => ctx.color(hex, template.source) }),
    fallback: !resolved.exact,
  };
}

/** Attributes of the layer `<g>`; shared by the React preview and the export serializer. */
export function layerAttributes(r: RenderedLayer): Record<string, string> {
  return {
    id: r.groupId,
    transform: r.transform,
    'data-forma-motif': r.layer.motif,
    'data-forma-role': r.layer.role,
  };
}

/** Attributes of the plane `<g>`; shared by the React preview and the export serializer. */
export function planeAttributes(p: RenderedPlane): Record<string, string> {
  return { id: p.groupId, transform: p.transform, 'data-forma-role': 'plane' };
}

/** Files (manifest names: objects + plane) needed to render a document. */
export function requiredFiles(doc: DocState, ctx: Pick<RenderContext, 'files' | 'planes' | 'palette'>): string[] {
  const files = new Set<string>();
  for (const layer of doc.layers) {
    if (layer.hidden) continue;
    const asset = layerAsset(layer, { files: ctx.files, detail: doc.detail, colorMode: doc.colorMode });
    if (asset) files.add(asset.meta.file);
  }
  if (doc.showPlane) {
    const plane = resolvePlane(ctx.planes, ctx.palette.plane, doc.detail);
    if (plane) files.add(plane.meta.file);
  }
  return [...files];
}

export interface ExportOptions {
  artboard: Size;
  /** Paper colour; the artboard background rect. */
  paper: string;
  /** Used for <title>; defaults to «Форма». */
  title?: string;
}

function attributeString(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${escapeXmlAttr(value)}"`)
    .join('');
}

function groupMarkup(attrs: Record<string, string>, markup: string): string {
  return `<g${attributeString(attrs)}>${markup}</g>`;
}

function missingFiles(doc: DocState, ctx: RenderContext): string[] {
  // Judge by the context actually used for rendering, so the check cannot disagree with renderLayer.
  const effective: DocState = { ...doc, detail: ctx.detail, colorMode: ctx.colorMode };
  return requiredFiles(effective, ctx).filter((file) => !ctx.templates.has(file));
}

/**
 * Standalone SVG document: xmlns (+ xmlns:xlink when needed), width/height/viewBox of the artboard,
 * <title>/<desc>, paper rect, optional plane group, and one editable <g> per visible layer in z-order
 * with data-forma-motif / data-forma-role attributes. Never contains raster images or external references.
 * Throws if a required template is missing.
 */
export function buildExportSvg(doc: DocState, ctx: RenderContext, opts: ExportOptions): string {
  const { width, height } = opts.artboard;
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Размер артборда должен быть положительным числом');
  }
  const paper = normalizeColor(opts.paper);
  if (!paper) throw new Error(`Цвет бумаги «${opts.paper}» не распознан — нужен формат #rrggbb`);

  const missing = missingFiles(doc, ctx);
  if (missing.length > 0) {
    throw new Error(`Не удалось собрать SVG: не загружены файлы ${missing.map((f) => `«${f}»`).join(', ')}`);
  }

  const groupIds = layerGroupIds(doc.layers);
  const layers: string[] = [];
  const usedTemplates: SvgTemplate[] = [];
  for (const layer of doc.layers) {
    if (layer.hidden) continue;
    const rendered = renderLayer(layer, groupIds.get(layer.id) ?? layer.id, ctx);
    if (!rendered) continue;
    layers.push(`    ${groupMarkup(layerAttributes(rendered), rendered.markup)}`);
    const template = ctx.templates.get(rendered.meta.file);
    if (template) usedTemplates.push(template);
  }

  const plane = renderPlane(doc, opts.artboard, ctx);
  if (plane) {
    const template = ctx.templates.get(plane.meta.file);
    if (template) usedTemplates.push(template);
  }

  const w = formatNumber(width);
  const h = formatNumber(height);
  const xlink = usedTemplates.some(templateUsesXlink) ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '';
  const title = escapeXmlText(opts.title ?? 'Форма');
  const desc = escapeXmlText(`Создано в «Форме» · ${w} × ${h} · палитра «${ctx.palette.name}»`);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg"${xlink} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `  <title>${title}</title>`,
    `  <desc>${desc}</desc>`,
    `  <rect id="paper" width="${w}" height="${h}" fill="${paper}"/>`,
  ];
  if (plane) lines.push(`  ${groupMarkup(planeAttributes(plane), plane.markup)}`);
  lines.push('  <g id="artwork">', ...layers, '  </g>', '</svg>', '');
  return lines.join('\n');
}
