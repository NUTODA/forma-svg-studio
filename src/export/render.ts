// CONTRACT STUB — owned by the SVG core agent. Signatures are fixed; bodies to be implemented.
// The artboard preview and the exported file are built from the SAME functions in this module,
// which is what guarantees "export renders exactly like the preview".
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
import type { SvgTemplate } from '../svg/template';

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

/** Uniform scale for a layer: `layer.size / meta.bounds.height`. */
export function layerScale(_layer: Layer, _meta: AssetFileMeta): number {
  throw new Error('not implemented');
}

/** `translate(x y) rotate(r) scale(s) translate(-cx -cy)` with numbers rounded to 3 decimals. */
export function layerTransform(_layer: Layer, _meta: AssetFileMeta): string {
  throw new Error('not implemented');
}

/** Stable, unique, readable group ids for all layers (keyed by layer.id), in z-order. */
export function layerGroupIds(_layers: readonly Layer[]): Map<string, string> {
  throw new Error('not implemented');
}

/** File a layer is drawn with (variantForLayer + resolveAsset fallback), or null if the motif has no files. */
export function layerAsset(
  _layer: Layer,
  _ctx: Pick<RenderContext, 'files' | 'detail' | 'colorMode'>,
): { meta: AssetFileMeta; exact: boolean } | null {
  throw new Error('not implemented');
}

/** Resolve file + template and render one layer; null if the motif has no file or the template is not loaded yet. */
export function renderLayer(_layer: Layer, _groupId: string, _ctx: RenderContext): RenderedLayer | null {
  throw new Error('not implemented');
}

/** Cover-fitted palette plane, or null when the plane is off / missing / not loaded. */
export function renderPlane(_doc: DocState, _artboard: Size, _ctx: RenderContext): RenderedPlane | null {
  throw new Error('not implemented');
}

/** Files (manifest names: objects + plane) needed to render a document. */
export function requiredFiles(_doc: DocState, _ctx: Pick<RenderContext, 'files' | 'planes' | 'palette'>): string[] {
  throw new Error('not implemented');
}

export interface ExportOptions {
  artboard: Size;
  /** Paper colour; the artboard background rect. */
  paper: string;
  /** Used for <title>; defaults to «Форма». */
  title?: string;
}

/**
 * Standalone SVG document: xmlns (+ xmlns:xlink when needed), width/height/viewBox of the artboard,
 * <title>/<desc>, paper rect, optional plane group, and one editable <g> per visible layer in z-order
 * with data-forma-motif / data-forma-role attributes. Never contains raster images or external references.
 * Throws if a required template is missing.
 */
export function buildExportSvg(_doc: DocState, _ctx: RenderContext, _opts: ExportOptions): string {
  throw new Error('not implemented');
}
