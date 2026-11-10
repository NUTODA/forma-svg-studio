import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { availableMotifs } from '../../assets/availability';
import { assetManifest } from '../../assets/manifest';
import {
  addMotifToDoc,
  createDoc,
  DEMO_PRESETS,
  docFromMotifs,
  objectMotifs,
  recomposeDoc,
  withBackgroundObjects,
} from '../../doc/doc';
import { canRedo, canUndo, createEditorState, editorReducer, type EditorState } from '../../doc/editor';
import {
  backupDraft,
  clearDraft,
  commitPaletteEdit,
  DRAFT_BACKUP_KEY,
  DRAFT_KEY,
  loadCustomPalettes,
  loadDraft,
  paletteIdTakenMessage,
  paletteLimitMessage,
  saveDraft,
  type DraftLoad,
  type PaletteCommit,
  type PaletteEdit,
} from '../../doc/persist';
import type {
  ArtboardPresetId,
  BriefMode,
  ColorMode,
  Detail,
  DocState,
  IssueAction,
  LayoutMode,
  MotifId,
  Palette,
} from '../../domain/types';
import { MAX_HEADLINE_CHARS, MAX_LAYERS } from '../../doc/validate';
import {
  buildExportSvg,
  exportTitle,
  nothingToExportReason,
  requiredFiles,
  type RenderContext,
} from '../../export/render';
import { ARTBOARD_PRESETS, getZones } from '../../layout/compose';
import { BUILTIN_PALETTES, DEFAULT_PALETTE_ID } from '../../palette/builtins';
import { createColorResolver, paperColor } from '../../palette/resolve';
import { copyText } from '../PalettePanel.logic';
import { downloadText } from '../util/download';
import { commandForKey, isInsideOpenDialog, isTextEntryTarget, needsSelection, type ShortcutCommand } from '../util/shortcuts';
import { exportFileName } from '../util/slug';
import { normalizeAngle, replaceToken } from '../util/text';
import {
  analyseBrief,
  buildDemo,
  composedMessage,
  detailFallbackMessage,
  emptyBriefMessage,
  firstProblemMessage,
  layerName,
  motifName,
  motifsWithoutDetail,
} from './briefing';
import type { BriefResult, EditorApi, PaletteChange, ReorderTarget, StatusLevel, StatusMessage } from './editorContext';
import { useTemplates } from './useTemplates';

const AUTOSAVE_DELAY_MS = 400;
const DUPLICATE_OFFSET = 24;

interface Boot {
  doc: DocState;
  brief: BriefResult | null;
  status: StatusMessage | null;
  /** An unreadable draft with no copy yet: autosave must leave it alone. */
  draftHeld: boolean;
  /** The stored draft text as this tab found it: the baseline the two-tab guard compares against. */
  raw: string | null;
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readDraft(store: Pick<Storage, 'getItem'> | null): DraftLoad {
  if (!store) return { status: 'empty' };
  try {
    return loadDraft(store);
  } catch {
    return { status: 'empty' };
  }
}

/**
 * Autosave holds off while an unreadable draft has no copy. Each retry says whether it still has to
 * (`held`: storage refused the copy), has just been copied (`copied`) or is no longer there (`gone`).
 */
export function retryDraftBackup(store: Pick<Storage, 'getItem' | 'setItem'>): 'held' | 'copied' | 'gone' {
  if (readDraft(store).status !== 'invalid') return 'gone';
  return backupDraft(store) ? 'copied' : 'held';
}

/*
 * Two tabs share one draft key. The guard is sequential and keeps no format of its own: a tab remembers the
 * stored draft text it last read or wrote (`seen`) and writes only while storage still holds exactly that
 * (or already holds the very document it is about to write).
 */

/** The stored draft exactly as the browser holds it; `null` when there is none or storage is blocked. */
export function readRawDraft(store: Pick<Storage, 'getItem'>): string | null {
  try {
    return store.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

/** Key order and spacing aside: two documents with the same content give the same text. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/**
 * Whether the stored text already holds this document. A restored draft comes back validated, so writing it
 * out again can reorder fields without changing a thing; that is not work another tab should be asked to yield to.
 */
function storedDraftHolds(raw: string, doc: DocState): boolean {
  try {
    const stored = loadDraft({ getItem: () => raw });
    return stored.status === 'ok' && canonicalJson(stored.doc) === canonicalJson(doc);
  } catch {
    return false;
  }
}

/**
 * `unchanged`: storage already holds this document, so nothing was written. `conflict`: another tab changed the
 * draft since `seen`, so nothing was written. `saved` and `unchanged` carry the stored text, the new `seen`;
 * for `saved` it is exactly what was handed to storage, never a re-read that another tab could have changed.
 */
export type GuardedDraftWrite =
  | { result: 'saved'; raw: string }
  | { result: 'unchanged'; raw: string }
  | { result: 'conflict' }
  | { result: 'failed' };

export function saveDraftUnlessChanged(
  store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  doc: DocState,
  seen: string | null,
): GuardedDraftWrite {
  const stored = readRawDraft(store);
  // Equal content loses nothing whoever wrote it, so it is neither a write nor a conflict.
  if (stored !== null && storedDraftHolds(stored, doc)) return { result: 'unchanged', raw: stored };
  if (stored !== seen) return { result: 'conflict' };
  // `saveDraft` owns the serialisation: take the exact text it hands to storage.
  const written: { raw: string | null } = { raw: null };
  const saved = saveDraft(
    {
      setItem: (key, value) => {
        store.setItem(key, value);
        written.raw = value;
      },
      removeItem: (key) => store.removeItem(key),
    },
    doc,
  );
  return saved && written.raw !== null ? { result: 'saved', raw: written.raw } : { result: 'failed' };
}

/** «Новый» drops the draft this tab has seen, never a newer one from another tab. Afterwards nothing is stored. */
export function clearDraftUnlessChanged(
  store: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  seen: string | null,
): { cleared: true; raw: null } | { cleared: false } {
  if (readRawDraft(store) !== seen) return { cleared: false };
  clearDraft(store);
  return { cleared: true, raw: null };
}

const OTHER_TAB_PAUSED =
  'Автосохранение выключено: черновик изменён в другой вкладке и остался нетронутым. Эту версию сохраните SVG-файлом, затем обновите страницу';
const OTHER_TAB_NEW =
  'Начат новый документ, но автосохранение выключено: в другой вкладке есть более новый черновик, он не тронут. Обновите страницу, чтобы открыть его';

const files = assetManifest.files;
const planes = assetManifest.planes;
const available: ReadonlySet<MotifId> = new Set(availableMotifs(files));
const metaByFile = new Map([...files, ...planes].map((meta) => [meta.file, meta] as const));

function computeBoot(): Boot {
  const store = getStorage();
  // Read before the draft is parsed: if another tab writes in between, this tab only ever looks older than it is.
  const raw = store ? readRawDraft(store) : null;
  const draft = readDraft(store);
  if (draft.status === 'ok') {
    return {
      doc: draft.doc,
      brief: null,
      status: { id: 1, text: 'Черновик восстановлен', level: 'info' },
      draftHeld: false,
      raw,
    };
  }
  if (draft.status === 'invalid') {
    // Autosave would soon write a fresh document over the unreadable original: keep a copy first. If the
    // copy fails, the original stays untouched (autosave is held) until a retry succeeds or «Новый».
    const kept = store ? backupDraft(store) : false;
    const note = kept
      ? ` Копия сохранена в браузере под ключом «${DRAFT_BACKUP_KEY}».`
      : ' Копию сохранить не удалось: исходный черновик остаётся нетронутым, а автосохранение выключено, пока копия не получится или вы не нажмёте «Новый».';
    return {
      doc: createDoc(),
      brief: null,
      status: { id: 1, text: `Черновик не загружен — ${draft.reason}${note}`, level: 'warning' },
      draftHeld: !kept,
      raw,
    };
  }
  const first = DEMO_PRESETS[0];
  if (first) {
    const demo = buildDemo(first, files, available);
    return { doc: demo.doc, brief: demo.brief, status: null, draftHeld: false, raw };
  }
  return { doc: createDoc(), brief: null, status: null, draftHeld: false, raw };
}

/**
 * After a layer disappears (delete) or its controls remount (duplicate), the focused element may
 * be gone and focus falls to <body>. Return it to the canvas so keyboard work continues.
 */
function keepFocusOnCanvas(): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) document.getElementById('artboard')?.focus();
  });
}

/** Layer commands act on the selection only when the user is working on the canvas or the layer list. */
function isLayerCommandTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target === document.body || target === document.documentElement) return true;
  return target.closest('#artboard, .layers') !== null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireFirstPalette(list: readonly Palette[]): Palette {
  const first = list[0];
  if (!first) throw new Error('Нет доступных палитр');
  return first;
}

function pickPalette(list: readonly Palette[], id: string): Palette {
  return (
    list.find((p) => p.id === id) ?? list.find((p) => p.id === DEFAULT_PALETTE_ID) ?? requireFirstPalette(list)
  );
}

/**
 * Title mode makes the text the headline; a names list is not a headline, so a new scene starts without one.
 * A restored brief may be longer than a headline may be, and a headline over the limit makes the draft unreadable.
 */
export function headlineForBrief(mode: BriefMode, text: string): string {
  if (mode !== 'title') return '';
  const trimmed = text.trim();
  if (trimmed.length <= MAX_HEADLINE_CHARS) return trimmed;
  const cut = trimmed.slice(0, MAX_HEADLINE_CHARS);
  // Never end on half of a surrogate pair: a lone surrogate breaks URI encoding downstream.
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trimEnd();
}

/** An edit that was applied: stored, or kept for this tab only. The other outcomes were refused. */
type PaletteWrite = Extract<PaletteChange, 'saved' | 'session'>;
type PaletteStatus = { text: string; level: StatusLevel };

function loadBootPalettes(): Palette[] {
  const store = getStorage();
  if (!store) return [];
  try {
    const builtInIds = new Set(BUILTIN_PALETTES.map((p) => p.id));
    return loadCustomPalettes(store).filter((p) => !builtInIds.has(p.id));
  } catch {
    return [];
  }
}

/*
 * Palette names are user text of any length, and the status line is narrow: the failure and its consequence
 * come first and the name last, so a long name can only crowd out itself.
 */

/** One message per import: a palette the browser refused to store works now but is gone after a reload. */
export function paletteAddedStatus(name: string, change: PaletteWrite): PaletteStatus {
  return change === 'saved'
    ? { text: `Палитра «${name}» добавлена`, level: 'success' }
    : {
        text: `Добавлено только в этой вкладке, не сохранено — после перезагрузки пропадёт палитра «${name}»`,
        level: 'warning',
      };
}

/** A removal the browser refused to store leaves the old list saved, so the palette may come back. */
export function paletteRemovedStatus(name: string, change: PaletteWrite): PaletteStatus {
  return change === 'saved'
    ? { text: `Палитра «${name}» удалена`, level: 'info' }
    : {
        text: `Удалено только в этой вкладке, не сохранено — после перезагрузки может вернуться палитра «${name}»`,
        level: 'warning',
      };
}

/**
 * Layer ids of a document that replaces the present one are minted above every `nextId` in the history
 * (undo and redo branches included): selection follows ids, so an id must never name two different layers.
 */
export function withIdsAboveHistory(state: EditorState, next: DocState): DocState {
  const { past, present, future } = state.history;
  const floor = Math.max(...[...past, present, ...future].map((d) => d.nextId));
  const layers = next.layers.map((layer, i) => ({ ...layer, id: `l${floor + i}` }));
  return { ...next, layers, nextId: floor + layers.length };
}

function layerLimitMessage(): string {
  return `На холсте уже ${MAX_LAYERS} слоёв — это предел`;
}

function layerOf(state: EditorState, id: string) {
  return state.history.present.layers.find((l) => l.id === id);
}

export function useEditor(): EditorApi {
  const [boot] = useState(computeBoot);
  const [state, dispatch] = useReducer(editorReducer, boot.doc, createEditorState);
  const [brief, setBrief] = useState<BriefResult | null>(boot.brief);
  const [status, setStatus] = useState<StatusMessage | null>(boot.status);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [bootPalettes] = useState(loadBootPalettes);
  const [customPalettes, setCustomPalettes] = useState<Palette[]>(bootPalettes);
  const statusCounter = useRef(boot.status ? boot.status.id : 0);

  const doc = state.history.present;

  const announce = useCallback((text: string, level: StatusLevel = 'info') => {
    statusCounter.current += 1;
    setStatus({ id: statusCounter.current, text, level });
  }, []);

  /* ---- palettes ---- */
  const palettes = useMemo(() => [...BUILTIN_PALETTES, ...customPalettes], [customPalettes]);
  const palette = useMemo(() => pickPalette(palettes, doc.paletteId), [palettes, doc.paletteId]);
  const color = useMemo(() => createColorResolver(palette), [palette]);
  const paper = useMemo(() => paperColor(palette), [palette]);
  const zones = useMemo(() => getZones(ARTBOARD_PRESETS[doc.preset], doc.layout), [doc.preset, doc.layout]);

  /* ---- templates ---- */
  const { templates, requestTemplates, ensureTemplates } = useTemplates(metaByFile, announce);
  const required = useMemo(() => requiredFiles(doc, { files, planes, palette }), [doc, palette]);
  const requiredKey = required.join('|');
  useEffect(() => {
    requestTemplates(requiredKey ? requiredKey.split('|') : []);
  }, [requiredKey, requestTemplates]);

  /* Latest values for stable callbacks. */
  const latest = useRef({ state, palette, palettes, customPalettes, color, paper });
  useLayoutEffect(() => {
    latest.current = { state, palette, palettes, customPalettes, color, paper };
  });

  /* ---- autosave ---- */
  const saveFailed = useRef(false);
  const pendingSave = useRef<DocState | null>(null);
  const draftHeld = useRef(boot.draftHeld);
  // Stored draft text this tab last read or wrote. Another tab's change makes it stale; autosave then stays
  // off for the rest of this page's life, so the newer draft and this tab's working copy both survive.
  const seenRaw = useRef(boot.raw);
  const otherTabAhead = useRef(false);
  const writeDraft = useCallback(
    (toSave: DocState) => {
      const store = getStorage();
      pendingSave.current = null;
      if (otherTabAhead.current) return;
      if (draftHeld.current && store) {
        // The unreadable original is still the only copy: write over it only once a copy exists.
        const retry = retryDraftBackup(store);
        if (retry === 'held') return;
        draftHeld.current = false;
        if (retry === 'copied') {
          announce(`Копия повреждённого черновика сохранена под ключом «${DRAFT_BACKUP_KEY}» — автосохранение включено`);
        }
      }
      const write: GuardedDraftWrite = store ? saveDraftUnlessChanged(store, toSave, seenRaw.current) : { result: 'failed' };
      if (write.result === 'conflict') {
        otherTabAhead.current = true;
        setSavedAt(null);
        announce(OTHER_TAB_PAUSED, 'warning');
        return;
      }
      // `unchanged` is as good as a write: the stored draft already is this document.
      const ok = write.result !== 'failed';
      if (write.result !== 'failed') seenRaw.current = write.raw;
      setSavedAt(ok ? Date.now() : null);
      if (!ok && !saveFailed.current) announce('Не удалось сохранить черновик — изменения останутся только в этой вкладке', 'warning');
      saveFailed.current = !ok;
    },
    [announce],
  );
  useEffect(() => {
    pendingSave.current = doc;
    const timer = setTimeout(() => writeDraft(doc), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc, writeDraft]);
  useEffect(() => {
    const flush = () => {
      if (pendingSave.current) writeDraft(pendingSave.current);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [writeDraft]);

  /* ---- helpers over the latest state ---- */
  const currentDoc = useCallback(() => latest.current.state.history.present, []);
  const selectionIn = useCallback((next: DocState): string | null => {
    const id = latest.current.state.selectedId;
    return id !== null && next.layers.some((l) => l.id === id) ? id : null;
  }, []);
  const replaceDoc = useCallback(
    (next: DocState, selectId: string | null) => dispatch({ type: 'replaceDoc', doc: next, selectId }),
    [],
  );
  const rebuild = useCallback(
    (patch: Partial<DocState>) => {
      const next = recomposeDoc({ ...currentDoc(), ...patch }, files);
      replaceDoc(next, selectionIn(next));
    },
    [currentDoc, replaceDoc, selectionIn],
  );

  /* ---- brief ---- */
  const setBriefMode = useCallback((mode: BriefMode, text?: string) => {
    const current = latest.current.state.history.present.brief;
    // One patch for mode + text: a tab switch is a single undo step that never coalesces with typing.
    dispatch({ type: 'patchDoc', patch: { brief: { mode, text: text ?? current.text } } });
    setBrief(null);
  }, []);

  const setBriefText = useCallback((text: string) => {
    const mode = latest.current.state.history.present.brief.mode;
    dispatch({ type: 'patchDoc', patch: { brief: { mode, text } }, coalesce: 'brief-text' });
    setBrief(null);
  }, []);

  const composeBrief = useCallback(
    (text: string, mode: BriefMode): boolean => {
      const base = currentDoc();
      const { motifs, result } = analyseBrief(text, mode, available);
      setBrief(result);
      if (motifs.length === 0) {
        if (base.brief.text !== text || base.brief.mode !== mode) {
          dispatch({ type: 'patchDoc', patch: { brief: { mode, text } }, coalesce: 'brief-text' });
        }
        announce(firstProblemMessage(result) ?? emptyBriefMessage(mode, text), 'error');
        return false;
      }
      // The first composition of an empty document gets the art-directed look (palette plane + echoes);
      // later recompositions keep whatever the user chose.
      const look = base.layers.length === 0 ? { showPlane: true, backgroundObjects: true } : {};
      const next = docFromMotifs(
        { ...base, ...look, brief: { mode, text }, headline: headlineForBrief(mode, text) },
        motifs,
        files,
      );
      replaceDoc(next, null);
      announce(composedMessage(motifs, next.layout), 'success');
      return true;
    },
    [announce, currentDoc, replaceDoc],
  );

  const runBrief = useCallback((): boolean => {
    const { text, mode } = currentDoc().brief;
    return composeBrief(text, mode);
  }, [composeBrief, currentDoc]);

  const addMotif = useCallback(
    (motif: MotifId, at?: { x: number; y: number }) => {
      // The reducer refuses a layer past the limit; say so instead of reporting an add that never happened.
      if (currentDoc().layers.length >= MAX_LAYERS) {
        announce(layerLimitMessage(), 'warning');
        return;
      }
      // The whole document goes in as one step: a motif too big for the common scale shrinks its neighbours in proportion.
      const added = available.has(motif) ? addMotifToDoc(currentDoc(), motif, files, at) : null;
      if (!added) {
        announce(`Не удалось добавить «${motifName(motif)}» — нет подходящего файла`, 'warning');
        return;
      }
      replaceDoc(added.doc, added.id);
      announce(`Добавлено: ${motifName(motif)}`);
    },
    [announce, currentDoc, replaceDoc],
  );

  const applyIssueAction = useCallback(
    (action: IssueAction) => {
      const { text, mode } = currentDoc().brief;
      switch (action.kind) {
        case 'replace': {
          if (action.token === undefined || action.replacement === undefined) return;
          composeBrief(replaceToken(text, action.token, action.replacement, action.range), mode);
          return;
        }
        case 'add': {
          if (action.motif) addMotif(action.motif);
          return;
        }
        case 'remove': {
          const removed = action.motif;
          if (!removed) return;
          const base = currentDoc();
          const next = docFromMotifs(
            base,
            objectMotifs(base).filter((m) => m !== removed),
            files,
          );
          replaceDoc(next, null);
          announce(`Убрано: ${motifName(removed)}`);
          return;
        }
        case 'example': {
          composeBrief(action.replacement ?? action.token ?? '', mode);
          return;
        }
      }
    },
    [addMotif, announce, composeBrief, currentDoc, replaceDoc],
  );

  const applyDemo = useCallback(
    (id: string) => {
      const preset = DEMO_PRESETS.find((p) => p.id === id);
      if (!preset) {
        announce('Такого примера нет', 'warning');
        return;
      }
      const demo = buildDemo(preset, files, available);
      replaceDoc(withIdsAboveHistory(latest.current.state, demo.doc), null);
      setBrief(demo.brief);
      announce(`Загружен пример «${preset.label}»`, 'success');
    },
    [announce, replaceDoc],
  );

  /* ---- layers ---- */
  const select = useCallback((id: string | null) => dispatch({ type: 'select', id }), []);

  const updateLayer = useCallback<EditorApi['updateLayer']>((id, patch, opts) => {
    dispatch({ type: 'updateLayer', id, patch, transient: opts?.transient, coalesce: opts?.coalesce });
  }, []);
  const commitGesture = useCallback(() => dispatch({ type: 'commitGesture' }), []);
  const cancelGesture = useCallback(() => dispatch({ type: 'cancelGesture' }), []);

  const nudge = useCallback((id: string, dx: number, dy: number) => {
    const layer = layerOf(latest.current.state, id);
    if (!layer) return;
    dispatch({
      type: 'updateLayer',
      id,
      patch: { x: layer.x + dx, y: layer.y + dy },
      coalesce: `nudge:${id}`,
    });
  }, []);

  const rotateBy = useCallback((id: string, deg: number) => {
    const layer = layerOf(latest.current.state, id);
    if (!layer) return;
    dispatch({
      type: 'updateLayer',
      id,
      patch: { rotation: normalizeAngle(layer.rotation + deg) },
      coalesce: `rotate:${id}`,
    });
  }, []);

  const duplicate = useCallback(
    (id: string) => {
      const layer = layerOf(latest.current.state, id);
      if (!layer) return;
      if (latest.current.state.history.present.layers.length >= MAX_LAYERS) {
        announce(layerLimitMessage(), 'warning');
        return;
      }
      dispatch({ type: 'duplicateLayer', id, offset: DUPLICATE_OFFSET });
      announce(`Дублировано: ${layerName(layer)}`);
      keepFocusOnCanvas();
    },
    [announce],
  );

  const remove = useCallback(
    (id: string) => {
      const layer = layerOf(latest.current.state, id);
      if (!layer) return;
      dispatch({ type: 'removeLayer', id });
      announce(`Удалено: ${layerName(layer)}`);
      keepFocusOnCanvas();
    },
    [announce],
  );

  const reorder = useCallback((id: string, to: ReorderTarget) => dispatch({ type: 'reorderLayer', id, to }), []);

  const toggleHidden = useCallback((id: string) => {
    const layer = layerOf(latest.current.state, id);
    if (!layer) return;
    dispatch({ type: 'updateLayer', id, patch: { hidden: !layer.hidden } });
  }, []);

  // The analysis describes the composition it produced; after undo/redo it would offer stale actions.
  const undo = useCallback(() => {
    if (!canUndo(latest.current.state)) return;
    dispatch({ type: 'undo' });
    setBrief(null);
    announce('Отменено');
  }, [announce]);

  const redo = useCallback(() => {
    if (!canRedo(latest.current.state)) return;
    dispatch({ type: 'redo' });
    setBrief(null);
    announce('Повторено');
  }, [announce]);

  /* ---- document settings ---- */
  const setPreset = useCallback(
    (id: ArtboardPresetId) => {
      if (currentDoc().preset !== id) rebuild({ preset: id });
    },
    [currentDoc, rebuild],
  );

  const setLayout = useCallback(
    (mode: LayoutMode) => {
      if (currentDoc().layout !== mode) rebuild({ layout: mode });
    },
    [currentDoc, rebuild],
  );

  const setDetail = useCallback(
    (detail: Detail) => {
      const base = currentDoc();
      if (base.detail === detail) return;
      dispatch({ type: 'patchDoc', patch: { detail } });
      const lacking = motifsWithoutDetail(base, files, detail);
      if (lacking.length > 0) announce(detailFallbackMessage(lacking, detail));
    },
    [announce, currentDoc],
  );

  const setColorMode = useCallback((mode: ColorMode) => {
    dispatch({ type: 'patchDoc', patch: { colorMode: mode } });
  }, []);

  const setPalette = useCallback((id: string) => {
    dispatch({ type: 'patchDoc', patch: { paletteId: id } });
  }, []);

  const setBackgroundObjects = useCallback(
    (on: boolean) => {
      const base = currentDoc();
      if (base.backgroundObjects === on) return;
      const next = withBackgroundObjects(base, files, on);
      replaceDoc(next, selectionIn(next));
    },
    [currentDoc, replaceDoc, selectionIn],
  );

  const setShowPlane = useCallback((on: boolean) => {
    dispatch({ type: 'patchDoc', patch: { showPlane: on } });
  }, []);

  const setShowHeadline = useCallback((on: boolean) => {
    dispatch({ type: 'patchDoc', patch: { showHeadline: on } });
  }, []);

  const setHeadline = useCallback((text: string) => {
    dispatch({ type: 'patchDoc', patch: { headline: text }, coalesce: 'headline' });
  }, []);

  const recompose = useCallback(() => {
    const next = recomposeDoc(currentDoc(), files);
    replaceDoc(next, selectionIn(next));
    announce('Композиция пересобрана');
  }, [announce, currentDoc, replaceDoc, selectionIn]);

  /* ---- custom palettes ---- */
  // Each edit is applied to what storage holds now, not to the list this tab loaded, so palettes another tab
  // added or removed since are kept. The shown list is updated first, so a refused write still leaves a working
  // session; `storedPalettes` is what this tab last saw in storage, the base the next edit is merged against.
  const storedPalettes = useRef<readonly Palette[]>(bootPalettes);
  const commitPalette = useCallback((edit: PaletteEdit): PaletteCommit => {
    const tab = { list: latest.current.customPalettes, stored: storedPalettes.current };
    const result = commitPaletteEdit(getStorage(), tab, edit);
    storedPalettes.current = result.stored;
    latest.current.customPalettes = result.list;
    setCustomPalettes(result.list);
    return result;
  }, []);

  const addCustomPalette = useCallback(
    (added: Palette): PaletteChange => {
      if (BUILTIN_PALETTES.some((p) => p.id === added.id)) {
        announce('Идентификатор палитры совпадает со встроенной — выберите другой', 'warning');
        return 'rejected';
      }
      const entry: Palette = { ...added, builtIn: false };
      const { status } = commitPalette({ kind: 'add', palette: entry });
      if (status === 'limit' || status === 'id-taken') {
        announce(status === 'limit' ? paletteLimitMessage() : paletteIdTakenMessage(entry.id), 'warning');
        return status;
      }
      const { text, level } = paletteAddedStatus(entry.name, status);
      announce(text, level);
      return status;
    },
    [announce, commitPalette],
  );

  const removeCustomPalette = useCallback(
    (id: string): PaletteChange => {
      const removed = latest.current.customPalettes.find((p) => p.id === id);
      if (!removed) return 'rejected';
      // Only an addition can be refused: a removal reaches storage or stays in this tab.
      const change: PaletteWrite = commitPalette({ kind: 'remove', id }).status === 'saved' ? 'saved' : 'session';
      if (currentDoc().paletteId === id) dispatch({ type: 'patchDoc', patch: { paletteId: DEFAULT_PALETTE_ID } });
      const { text, level } = paletteRemovedStatus(removed.name, change);
      announce(text, level);
      return change;
    },
    [announce, commitPalette, currentDoc],
  );

  /* ---- output ---- */
  const buildCurrentSvg = useCallback(async (): Promise<{ svg: string; fileName: string } | null> => {
    const { palette: activePalette, color: resolver, paper: paperHex } = latest.current;
    const snapshot = latest.current.state.history.present;
    // Same question the top-bar buttons ask: the shortcut must not save a file that is only paper.
    const nothing = nothingToExportReason(snapshot, { files, planes, palette: activePalette });
    if (nothing !== null) {
      announce(`${nothing} — экспортировать пока нечего`, 'warning');
      return null;
    }
    const loaded = await ensureTemplates(requiredFiles(snapshot, { files, planes, palette: activePalette }));
    const context: RenderContext = {
      files,
      planes,
      templates: loaded,
      detail: snapshot.detail,
      colorMode: snapshot.colorMode,
      palette: activePalette,
      color: resolver,
    };
    const preset = ARTBOARD_PRESETS[snapshot.preset];
    const title = exportTitle(snapshot, motifName);
    const svg = buildExportSvg(snapshot, context, {
      artboard: { width: preset.width, height: preset.height },
      paper: paperHex,
      title,
    });
    return { svg, fileName: exportFileName(title, preset.width, preset.height) };
  }, [announce, ensureTemplates]);

  const exportSvg = useCallback(async () => {
    try {
      const built = await buildCurrentSvg();
      if (!built) return;
      downloadText(built.fileName, built.svg, 'image/svg+xml;charset=utf-8');
      announce(`SVG сохранён: ${built.fileName}`, 'success');
    } catch (error) {
      announce(`Не удалось экспортировать SVG — ${errorText(error)}`, 'error');
    }
  }, [announce, buildCurrentSvg]);

  const copySvg = useCallback(async () => {
    try {
      const built = await buildCurrentSvg();
      if (!built) return;
      if (await copyText(built.svg)) announce('SVG скопирован в буфер обмена', 'success');
      else announce('Не удалось скопировать SVG — скачайте его через «Экспорт SVG»', 'error');
    } catch (error) {
      announce(`Не удалось скопировать SVG — ${errorText(error)}`, 'error');
    }
  }, [announce, buildCurrentSvg]);

  const resetDraft = useCallback(() => {
    const store = getStorage();
    // A newer draft from another tab is not this tab's to erase: «Новый» then resets only this tab, autosave stays off.
    const outcome = store && !otherTabAhead.current ? clearDraftUnlessChanged(store, seenRaw.current) : null;
    if (outcome !== null && outcome.cleared) seenRaw.current = outcome.raw;
    const superseded = otherTabAhead.current || (outcome !== null && !outcome.cleared);
    if (superseded) otherTabAhead.current = true;
    // Starting anew is the explicit choice to drop an unreadable draft that could not be copied.
    draftHeld.current = false;
    dispatch({ type: 'load', doc: createDoc() });
    setBrief(null);
    if (superseded) announce(OTHER_TAB_NEW, 'warning');
    else announce('Начат новый документ');
  }, [announce]);

  /* ---- global shortcuts ---- */
  useEffect(() => {
    const run = (command: ShortcutCommand, id: string | null) => {
      switch (command.type) {
        case 'undo':
          return undo();
        case 'redo':
          return redo();
        case 'save':
          return announce('Черновик сохраняется автоматически');
        case 'export':
          return void exportSvg();
        case 'deselect':
          return select(null);
        default:
          break;
      }
      if (id === null) return;
      switch (command.type) {
        case 'duplicate':
          return duplicate(id);
        case 'remove':
          return remove(id);
        case 'nudge':
          return nudge(id, command.dx, command.dy);
        case 'rotate':
          return rotateBy(id, command.deg);
        case 'reorder':
          return reorder(id, command.to);
        default:
          return;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isTextEntryTarget(e.target) || isInsideOpenDialog(e.target)) return;
      const command = commandForKey(e);
      if (!command) return;
      const selectedId = latest.current.state.selectedId;
      if (needsSelection(command) && (selectedId === null || !isLayerCommandTarget(e.target))) {
        // Cmd/Ctrl+D would otherwise bookmark the page. Arrows/Delete on other controls keep their own meaning.
        if (command.type === 'duplicate') e.preventDefault();
        return;
      }
      if (command.type === 'deselect' && selectedId === null) return;
      e.preventDefault();
      run(command, selectedId);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [announce, duplicate, exportSvg, nudge, redo, remove, reorder, rotateBy, select, undo]);

  return useMemo<EditorApi>(
    () => ({
      doc,
      selectedId: state.selectedId,
      canUndo: canUndo(state),
      canRedo: canRedo(state),
      files,
      planes,
      available,
      templates,
      palettes,
      palette,
      color,
      paper,
      zones,
      brief,
      status,
      savedAt,
      setBriefMode,
      setBriefText,
      runBrief,
      applyIssueAction,
      applyDemo,
      addMotif,
      select,
      updateLayer,
      commitGesture,
      cancelGesture,
      nudge,
      rotateBy,
      duplicate,
      remove,
      reorder,
      toggleHidden,
      undo,
      redo,
      setPreset,
      setDetail,
      setLayout,
      setColorMode,
      setPalette,
      setBackgroundObjects,
      setShowPlane,
      setShowHeadline,
      setHeadline,
      recompose,
      addCustomPalette,
      removeCustomPalette,
      requestTemplates,
      exportSvg,
      copySvg,
      resetDraft,
      announce,
    }),
    [
      doc,
      state,
      templates,
      palettes,
      palette,
      color,
      paper,
      zones,
      brief,
      status,
      savedAt,
      setBriefMode,
      setBriefText,
      runBrief,
      applyIssueAction,
      applyDemo,
      addMotif,
      select,
      updateLayer,
      commitGesture,
      cancelGesture,
      nudge,
      rotateBy,
      duplicate,
      remove,
      reorder,
      toggleHidden,
      undo,
      redo,
      setPreset,
      setDetail,
      setLayout,
      setColorMode,
      setPalette,
      setBackgroundObjects,
      setShowPlane,
      setShowHeadline,
      setHeadline,
      recompose,
      addCustomPalette,
      removeCustomPalette,
      requestTemplates,
      exportSvg,
      copySvg,
      resetDraft,
      announce,
    ],
  );
}
