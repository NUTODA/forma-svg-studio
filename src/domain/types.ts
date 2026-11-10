/**
 * Shared domain contracts for «Форма».
 * Every module imports its cross-cutting types from here so that the
 * asset pipeline, semantics, palette, layout, editor and UI stay decoupled.
 */

/** The 10 motifs of the Figma library (final ids, see ASSET-NOTES.md). */
export const MOTIF_IDS = [
  'book',
  'phone',
  'puzzle',
  'coin',
  'headphones',
  'lamp',
  'bouquet',
  'wallet',
  'folder',
  'pen',
] as const;
export type MotifId = (typeof MOTIF_IDS)[number];

/** Artwork detail level: `s` — simplified, `l` — detailed. Independent from aspect ratio. */
export type Detail = 's' | 'l';
/** Source drawing variant: `main` — coloured object, `background` — monochrome secondary version. */
export type Variant = 'main' | 'background';
/**
 * How a layer participates in the composition:
 * `object` — foreground motif (main file, or background file in mono colour mode);
 * `background` — optional decorative echo behind the objects (always the monochrome background file).
 */
export type LayerRole = 'object' | 'background';

/** Source palettes of the Figma file. Objects are drawn in `lavender`; each plane in its own palette. */
export const SOURCE_PALETTE_IDS = ['lavender', 'peach', 'mint'] as const;
export type SourcePaletteId = (typeof SOURCE_PALETTE_IDS)[number];

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Metadata of one vetted bundled SVG file (produced at build/dev time from public/assets). */
export interface AssetFileMeta {
  /** File name inside public/assets, e.g. `bouquet-l-background.svg`. */
  file: string;
  motif: MotifId;
  detail: Detail;
  variant: Variant;
  /** Root viewBox (falls back to width/height) in source user units. */
  viewBox: Box;
  /** Actual painted geometry bounds in source user units (transforms applied, clipped to viewBox). */
  bounds: Box;
  /** Distinct normalised `#rrggbb` paints found in the file (fill, stroke, stop-color…). */
  colors: string[];
  bytes: number;
  /** Sanitiser / analysis notes in Russian (empty when the file is clean). */
  warnings: string[];
}

/** A decorative background plane `plane-<palette>-<s|l>.svg` (full-bleed square, cover-fitted). */
export interface PlaneFileMeta {
  file: string;
  /** Palette the plane is drawn in (its colours are mapped from this source palette). */
  palette: SourcePaletteId;
  detail: Detail;
  viewBox: Box;
  bounds: Box;
  colors: string[];
  bytes: number;
  warnings: string[];
}

export interface AssetManifest {
  files: AssetFileMeta[];
  planes: PlaneFileMeta[];
  /** Files in public/assets that match neither pattern or failed analysis (non-SVG files are skipped silently). */
  ignored: { file: string; reason: string }[];
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

/**
 * Paint roles mirror the Figma swatches: four «background» swatches (tint → ink) and four
 * «objects» swatches (highlight, accent, accentSoft, light), plus the artboard paper.
 */
export const PAINT_ROLES = [
  'paper',
  'tint',
  'tone',
  'deep',
  'ink',
  'highlight',
  'accent',
  'accentSoft',
  'light',
] as const;
export type PaintRole = (typeof PAINT_ROLES)[number];

/** `color` — objects use the main (coloured) files; `mono` — objects use the monochrome background files. */
export type ColorMode = 'color' | 'mono';

export interface Palette {
  id: string;
  name: string;
  /** All roles, normalised lowercase `#rrggbb`. */
  colors: Record<PaintRole, string>;
  /** Which plane geometry to use as the optional background image. */
  plane: SourcePaletteId;
  builtIn: boolean;
}

/**
 * Maps a source paint (normalised `#rrggbb`) of a bundled file to the output colour for the
 * active palette. `source` is the palette the file was drawn in (objects: `lavender`,
 * planes: their own). Mapping is direct source-role → target-role, never chained.
 */
export type ColorResolver = (sourceHex: string, source: SourcePaletteId) => string;

/* ------------------------------------------------------------------ */
/* Semantics                                                           */
/* ------------------------------------------------------------------ */

export type BriefMode = 'title' | 'names';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface IssueAction {
  /** Russian button label, e.g. «Заменить на „Наушники“». */
  label: string;
  /** `replace` — replace `token` in the input with `replacement`; `add`/`remove` — include/exclude motif; `example` — load example text. */
  kind: 'replace' | 'add' | 'remove' | 'example';
  motif?: MotifId;
  token?: string;
  replacement?: string;
  /**
   * `replace` only: where `token` stands in the analysed text (UTF-16 offsets, end exclusive), so a repeated
   * word is corrected where it was clicked. Ignored when the text no longer holds `token` at that spot.
   */
  range?: { start: number; end: number };
}

export interface InputIssue {
  level: IssueLevel;
  code: string;
  /** Russian, user-facing, actionable. */
  message: string;
  action?: IssueAction;
}

export type MatchKind = 'name' | 'alias' | 'synonym' | 'theme' | 'fuzzy' | 'fallback';

export interface MatchReason {
  kind: MatchKind;
  /** The input word (as typed) that triggered the reason; empty for fallback. */
  token: string;
  /** Russian explanation, e.g. «„деньги“ — синоним монеты». */
  detail: string;
  themeId?: string;
}

export type MatchStrength = 'strong' | 'medium' | 'weak';

export interface MotifMatch {
  motif: MotifId;
  score: number;
  strength: MatchStrength;
  reasons: MatchReason[];
  /** False when the motif has no files in public/assets (it is reported, never placed). */
  available: boolean;
}

export interface TitleAnalysis {
  input: string;
  /** All candidate motifs, best first (includes unavailable and weak ones for transparency). */
  matches: MotifMatch[];
  /** Motifs chosen for the composition (available only, best first, 1..max). */
  selected: MotifId[];
  /** Motifs explicitly excluded by negation («без телефона»). */
  excluded: { motif: MotifId; token: string }[];
  /** Detected themes, best first. */
  themes: { id: string; label: string; score: number }[];
  /** Meaningful words that matched nothing. */
  unknownTokens: string[];
  fallbackUsed: boolean;
  /** One-line Russian summary of the interpretation. */
  summary: string;
  issues: InputIssue[];
}

export type NameStatus = 'matched' | 'weak' | 'unmatched' | 'unavailable';

export interface NameEntry {
  /** Fragment as typed (trimmed, without the quantity). */
  raw: string;
  status: NameStatus;
  motif?: MotifId;
  via?: 'name' | 'alias' | 'stem' | 'fuzzy';
  /** For weak/unmatched entries: best guess to offer. */
  suggestion?: MotifId;
  /** Requested quantity (1..4), from «3 монеты» or «монета ×2». */
  count: number;
}

export interface NamesParse {
  input: string;
  entries: NameEntry[];
  /** Resolved motif sequence for the composition (matched + weak entries, quantities expanded, available only). */
  motifs: MotifId[];
  issues: InputIssue[];
}

/* ------------------------------------------------------------------ */
/* Layout & document                                                   */
/* ------------------------------------------------------------------ */

/** `composed` — illustration filling the frame (reference look); `title` — same, leaving room for a headline. */
export type LayoutMode = 'composed' | 'title';
export type ArtboardPresetId = 'square' | 'portrait' | 'og';
export type Orientation = 'horizontal' | 'vertical' | 'square';

export interface ArtboardPreset {
  id: ArtboardPresetId;
  label: string;
  width: number;
  height: number;
  hint: string;
}

/**
 * A placed instance. `x`,`y` — centre of the source painted bounds in artboard units.
 * `size` — rendered height of the painted bounds in artboard units. The render scale is
 * always uniform: `size / meta.bounds.height`, so swapping S↔L files (or a late-arriving
 * exact file replacing a fallback) keeps the object's visual size and position.
 */
export interface Layer {
  id: string;
  motif: MotifId;
  role: LayerRole;
  x: number;
  y: number;
  /** Degrees, clockwise, around the centre of the painted bounds. */
  rotation: number;
  size: number;
  /** Relevance order from the brief (0 = hero). Recompose sorts object layers by it. */
  rank: number;
  hidden?: boolean;
}

export interface DocState {
  version: 1;
  preset: ArtboardPresetId;
  detail: Detail;
  layout: LayoutMode;
  colorMode: ColorMode;
  paletteId: string;
  /** Optional decorative background-variant echoes behind the objects (layers with role `background`). */
  backgroundObjects: boolean;
  /** Optional palette plane under everything (`plane-<palette.plane>-<detail>.svg`, cover-fitted). */
  showPlane: boolean;
  /** Show the headline guide in the preview (never exported). */
  showHeadline: boolean;
  /** Text shown in the headline zone guide. */
  headline: string;
  brief: { mode: BriefMode; text: string };
  /** Z-order: first = bottom. */
  layers: Layer[];
  nextId: number;
}

export interface Zones {
  orientation: Orientation;
  /** Where illustrations live. */
  artZone: Box;
  /** Reserved headline area (title layout only). */
  headlineZone: Box | null;
}

export interface ComposeItem {
  motif: MotifId;
  meta: AssetFileMeta;
}

export interface ComposeInput {
  items: ComposeItem[];
  /** Background-variant scenery objects (other motifs, already resolved files), empty when they are off. */
  backgrounds: ComposeItem[];
  artboard: Size;
  mode: LayoutMode;
}

export interface PlacedLayer {
  motif: MotifId;
  role: LayerRole;
  x: number;
  y: number;
  rotation: number;
  /** Rendered height of the painted bounds (see `Layer.size`). */
  size: number;
  /** Index of the source item in `ComposeInput.items` / `backgrounds`. */
  rank: number;
}

export interface ComposeResult extends Zones {
  /** Z-order: backgrounds first, then objects. */
  layers: PlacedLayer[];
}

export interface DemoPreset {
  id: string;
  label: string;
  description: string;
  brief: { mode: BriefMode; text: string };
  preset: ArtboardPresetId;
  layout: LayoutMode;
  detail: Detail;
  paletteId: string;
  colorMode: ColorMode;
  backgroundObjects: boolean;
  showPlane: boolean;
}
