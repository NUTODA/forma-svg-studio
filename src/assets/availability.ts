import {
  MOTIF_IDS,
  SOURCE_PALETTE_IDS,
  type AssetFileMeta,
  type ColorMode,
  type Detail,
  type LayerRole,
  type MotifId,
  type PlaneFileMeta,
  type SourcePaletteId,
  type Variant,
} from '../domain/types.ts';

export interface ParsedAssetName {
  motif: MotifId;
  detail: Detail;
  variant: Variant;
}

const ASSET_NAME_RE = new RegExp(`^(${MOTIF_IDS.join('|')})-(s|l)-(main|background)\\.svg$`);
const PLANE_NAME_RE = new RegExp(`^plane-(${SOURCE_PALETTE_IDS.join('|')})-(s|l)\\.svg$`);

/** Strict, case-sensitive check used before any file name reaches a URL. */
export function isBundledFileName(file: string): boolean {
  return ASSET_NAME_RE.test(file) || PLANE_NAME_RE.test(file);
}

/** `book-s-main.svg` → {motif:'book', detail:'s', variant:'main'}; anything else → null. */
export function parseAssetFileName(file: string): ParsedAssetName | null {
  const m = ASSET_NAME_RE.exec(file);
  if (!m) return null;
  return { motif: m[1] as MotifId, detail: m[2] as Detail, variant: m[3] as Variant };
}

/** `plane-mint-l.svg` → {palette:'mint', detail:'l'}; anything else → null. */
export function parsePlaneFileName(file: string): { palette: SourcePaletteId; detail: Detail } | null {
  const m = PLANE_NAME_RE.exec(file);
  if (!m) return null;
  return { palette: m[1] as SourcePaletteId, detail: m[2] as Detail };
}

export interface ResolvedAsset {
  meta: AssetFileMeta;
  /** True when the exact motif/detail/variant file exists. */
  exact: boolean;
}

const otherDetail = (detail: Detail): Detail => (detail === 's' ? 'l' : 's');
const otherVariant = (variant: Variant): Variant => (variant === 'main' ? 'background' : 'main');

/**
 * Nearest real file for a request. Fallback order:
 * exact → same variant, other detail → other variant, same detail → other variant, other detail.
 * Returns null when the motif has no files at all.
 */
export function resolveAsset(
  files: readonly AssetFileMeta[],
  motif: MotifId,
  detail: Detail,
  variant: Variant,
): ResolvedAsset | null {
  const candidates: [Detail, Variant][] = [
    [detail, variant],
    [otherDetail(detail), variant],
    [detail, otherVariant(variant)],
    [otherDetail(detail), otherVariant(variant)],
  ];
  for (const [d, v] of candidates) {
    const meta = files.find((f) => f.motif === motif && f.detail === d && f.variant === v);
    if (meta) return { meta, exact: d === detail && v === variant };
  }
  return null;
}

/** Variant a layer is drawn with: background echoes → `background`; objects → `main`, or `background` in mono mode. */
export function variantForLayer(role: LayerRole, colorMode: ColorMode): Variant {
  if (role === 'background') return 'background';
  return colorMode === 'mono' ? 'background' : 'main';
}

/** Plane for a palette: exact palette+detail → same palette other detail → `lavender` same/other detail → any. */
export function resolvePlane(
  planes: readonly PlaneFileMeta[],
  palette: SourcePaletteId,
  detail: Detail,
): { meta: PlaneFileMeta; exact: boolean } | null {
  const candidates: [SourcePaletteId, Detail][] = [
    [palette, detail],
    [palette, otherDetail(detail)],
    ['lavender', detail],
    ['lavender', otherDetail(detail)],
  ];
  for (const [p, d] of candidates) {
    const meta = planes.find((plane) => plane.palette === p && plane.detail === d);
    if (meta) return { meta, exact: p === palette && d === detail };
  }
  const any = planes.find((plane) => plane.detail === detail) ?? planes[0];
  return any ? { meta: any, exact: false } : null;
}

/** Motifs with at least one file, in MOTIF_IDS order. */
export function availableMotifs(files: readonly AssetFileMeta[]): MotifId[] {
  const present = new Set(files.map((f) => f.motif));
  return MOTIF_IDS.filter((motif) => present.has(motif));
}

/** Which of the 4 combinations exist for a motif, keyed `s-main`, `s-background`, `l-main`, `l-background`. */
export function motifAvailability(
  files: readonly AssetFileMeta[],
  motif: MotifId,
): Record<`${Detail}-${Variant}`, boolean> {
  const has = (detail: Detail, variant: Variant): boolean =>
    files.some((f) => f.motif === motif && f.detail === detail && f.variant === variant);
  return {
    's-main': has('s', 'main'),
    's-background': has('s', 'background'),
    'l-main': has('l', 'main'),
    'l-background': has('l', 'background'),
  };
}
