// UI CONTRACT — implemented by `useEditor` (shell agent), consumed by every panel via `useEditorApi()`.
import { createContext, useContext } from 'react';
import type {
  ArtboardPresetId,
  AssetFileMeta,
  ColorMode,
  ColorResolver,
  Detail,
  DocState,
  LayoutMode,
  MotifId,
  NamesParse,
  Palette,
  PlaneFileMeta,
  TitleAnalysis,
  Zones,
} from '../../domain/types';
import type { LayerPatch } from '../../doc/editor';
import type { SvgTemplate } from '../../svg/template';

/** MIME type for dragging a motif from the catalog onto the artboard. */
export const MOTIF_DRAG_MIME = 'application/x-forma-motif';

export type StatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface StatusMessage {
  /** Monotonic id so identical consecutive messages are still announced. */
  id: number;
  text: string;
  level: StatusLevel;
}

export type BriefResult =
  | { mode: 'title'; analysis: TitleAnalysis }
  | { mode: 'names'; parse: NamesParse };

export type ReorderTarget = 'up' | 'down' | 'top' | 'bottom' | number;

/**
 * How a custom palette change ended: `saved` to the browser, applied only for this tab (`session`:
 * storage refused, the editor keeps working from memory) or not applied at all. Of the refusals, `limit`
 * is a full list, `id-taken` an id another tab took after the palette was validated (the list now
 * contains it, so validating again gives a free id) and `rejected` anything else.
 */
export type PaletteChange = 'saved' | 'session' | 'rejected' | 'limit' | 'id-taken';

export interface EditorApi {
  /* ---- state ---- */
  doc: DocState;
  selectedId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Real files from public/assets (manifest). */
  files: readonly AssetFileMeta[];
  planes: readonly PlaneFileMeta[];
  /** Motifs that have at least one real file. */
  available: ReadonlySet<MotifId>;
  /** Templates loaded so far, keyed by file name. */
  templates: ReadonlyMap<string, SvgTemplate>;
  palettes: readonly Palette[];
  palette: Palette;
  /** Resolver for the active palette + colour mode (preview, thumbnails and export share it). */
  color: ColorResolver;
  paper: string;
  zones: Zones;
  /** Result of the last «Собрать» (null before the first run or after editing the text). */
  brief: BriefResult | null;
  status: StatusMessage | null;
  /** Time of the last successful draft save, null if never / failed. */
  savedAt: number | null;

  /* ---- brief ---- */
  setBriefText(text: string): void;
  /**
   * Read the current brief text and compose. One input serves both kinds of brief: an explicit list of objects
   * is built as written, anything else is interpreted as a title. Returns false when nothing could be composed.
   */
  runBrief(): boolean;
  /** True while the optional LLM is interpreting the title (rule-based result is the fallback). */
  briefBusy: boolean;
  /** True when the server has an LLM configured. */
  llmOn: boolean;
  /** Apply an issue action from analysis feedback. */
  applyIssueAction(action: import('../../domain/types').IssueAction): void;
  applyDemo(id: string): void;

  /* ---- layers ---- */
  addMotif(motif: MotifId, at?: { x: number; y: number }): void;
  select(id: string | null): void;
  /** `transient: true` while dragging; call `commitGesture()` on pointer up. */
  updateLayer(id: string, patch: LayerPatch, opts?: { transient?: boolean; coalesce?: string }): void;
  commitGesture(): void;
  cancelGesture(): void;
  nudge(id: string, dx: number, dy: number): void;
  rotateBy(id: string, deg: number): void;
  duplicate(id: string): void;
  remove(id: string): void;
  reorder(id: string, to: ReorderTarget): void;
  toggleHidden(id: string): void;
  undo(): void;
  redo(): void;

  /* ---- document settings ---- */
  setPreset(id: ArtboardPresetId): void;
  setDetail(detail: Detail): void;
  setLayout(mode: LayoutMode): void;
  setColorMode(mode: ColorMode): void;
  setPalette(id: string): void;
  /** Decorative monochrome echoes behind the objects (re-composes the echo layers only). */
  setBackgroundObjects(on: boolean): void;
  /** Palette plane under the artwork. */
  setShowPlane(on: boolean): void;
  setShowHeadline(on: boolean): void;
  /** Hand-set headline zone as fractions of the artboard; null restores the format's default. Re-lays the scene out. */
  setHeadlineBox(box: import('../../domain/types').Box | null): void;
  setHeadline(text: string): void;
  recompose(): void;

  /* ---- palettes ---- */
  /** Both announce the one outcome themselves (including session-only); callers must not announce over it. */
  addCustomPalette(palette: Palette): PaletteChange;
  removeCustomPalette(id: string): PaletteChange;

  /* ---- assets / output ---- */
  /** Ask for templates to be loaded (thumbnails, artboard). Safe to call repeatedly. */
  requestTemplates(files: readonly string[]): void;
  exportSvg(): Promise<void>;
  copySvg(): Promise<void>;
  resetDraft(): void;
  announce(text: string, level?: StatusLevel): void;
}

export const EditorContext = createContext<EditorApi | null>(null);

export function useEditorApi(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error('useEditorApi must be used inside <EditorContext.Provider>');
  return api;
}
