import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { availableMotifs } from '../../assets/availability';
import { assetManifest } from '../../assets/manifest';
import {
  createDoc,
  DEMO_PRESETS,
  docFromMotifs,
  objectMotifs,
  placeNewLayer,
  recomposeDoc,
  withBackgroundObjects,
} from '../../doc/doc';
import { canRedo, canUndo, createEditorState, editorReducer, type EditorState } from '../../doc/editor';
import {
  backupDraft,
  clearDraft,
  DRAFT_BACKUP_KEY,
  loadCustomPalettes,
  loadDraft,
  saveCustomPalettes,
  saveDraft,
  type DraftLoad,
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
import { MAX_LAYERS } from '../../doc/validate';
import { buildExportSvg, requiredFiles, type RenderContext } from '../../export/render';
import { ARTBOARD_PRESETS, getZones } from '../../layout/compose';
import { BUILTIN_PALETTES, DEFAULT_PALETTE_ID } from '../../palette/builtins';
import { createColorResolver, paperColor } from '../../palette/resolve';
import { downloadText } from '../util/download';
import { commandForKey, isInsideOpenDialog, isTextEntryTarget, needsSelection, type ShortcutCommand } from '../util/shortcuts';
import { exportFileName } from '../util/slug';
import { formatUniqueList, normalizeAngle, replaceFirstOccurrence } from '../util/text';
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
import type { BriefResult, EditorApi, ReorderTarget, StatusLevel, StatusMessage } from './editorContext';
import { useTemplates } from './useTemplates';

const AUTOSAVE_DELAY_MS = 400;
const DUPLICATE_OFFSET = 24;

interface Boot {
  doc: DocState;
  brief: BriefResult | null;
  status: StatusMessage | null;
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readDraft(store: Storage | null): DraftLoad {
  if (!store) return { status: 'empty' };
  try {
    return loadDraft(store);
  } catch {
    return { status: 'empty' };
  }
}

const files = assetManifest.files;
const planes = assetManifest.planes;
const available: ReadonlySet<MotifId> = new Set(availableMotifs(files));
const metaByFile = new Map([...files, ...planes].map((meta) => [meta.file, meta] as const));

function computeBoot(): Boot {
  const store = getStorage();
  const draft = readDraft(store);
  if (draft.status === 'ok') {
    return { doc: draft.doc, brief: null, status: { id: 1, text: 'Черновик восстановлен', level: 'info' } };
  }
  if (draft.status === 'invalid') {
    // Autosave will soon write a fresh document: keep the unreadable original instead of losing it.
    const kept = store ? backupDraft(store) : false;
    const note = kept ? ` Копия сохранена в браузере под ключом «${DRAFT_BACKUP_KEY}».` : '';
    return {
      doc: createDoc(),
      brief: null,
      status: { id: 1, text: `Черновик не загружен — ${draft.reason}${note}`, level: 'warning' },
    };
  }
  const first = DEMO_PRESETS[0];
  if (first) {
    const demo = buildDemo(first, files, available);
    return { doc: demo.doc, brief: demo.brief, status: null };
  }
  return { doc: createDoc(), brief: null, status: null };
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

/** Title mode makes the text the headline; a names list is not a headline, so a new scene starts without one. */
export function headlineForBrief(mode: BriefMode, text: string): string {
  return mode === 'title' ? text.trim() : '';
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
  const [customPalettes, setCustomPalettes] = useState<Palette[]>(() => {
    const store = getStorage();
    if (!store) return [];
    try {
      const builtInIds = new Set(BUILTIN_PALETTES.map((p) => p.id));
      return loadCustomPalettes(store).filter((p) => !builtInIds.has(p.id));
    } catch {
      return [];
    }
  });
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
  const writeDraft = useCallback(
    (toSave: DocState) => {
      const store = getStorage();
      const ok = store ? saveDraft(store, toSave) : false;
      pendingSave.current = null;
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
      const next = docFromMotifs(
        { ...base, brief: { mode, text }, headline: headlineForBrief(mode, text) },
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
      const layer = available.has(motif) ? placeNewLayer(currentDoc(), motif, files, at) : null;
      if (!layer) {
        announce(`Не удалось добавить «${motifName(motif)}» — нет подходящего файла`, 'warning');
        return;
      }
      dispatch({ type: 'addLayers', layers: [layer], select: true });
      announce(`Добавлено: ${motifName(motif)}`);
    },
    [announce, currentDoc],
  );

  const applyIssueAction = useCallback(
    (action: IssueAction) => {
      const { text, mode } = currentDoc().brief;
      switch (action.kind) {
        case 'replace': {
          if (action.token === undefined || action.replacement === undefined) return;
          composeBrief(replaceFirstOccurrence(text, action.token, action.replacement), mode);
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
      replaceDoc(demo.doc, null);
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
        announce(`На холсте уже ${MAX_LAYERS} слоёв — это предел`, 'warning');
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
  const persistPalettes = useCallback(
    (next: Palette[]) => {
      const store = getStorage();
      const ok = store ? saveCustomPalettes(store, next) : false;
      if (!ok) announce('Палитра не сохранена в браузере — после перезагрузки она пропадёт', 'warning');
    },
    [announce],
  );

  const addCustomPalette = useCallback(
    (added: Palette) => {
      if (BUILTIN_PALETTES.some((p) => p.id === added.id)) {
        announce('Идентификатор палитры совпадает со встроенной — выберите другой', 'warning');
        return;
      }
      const custom = latest.current.customPalettes;
      const entry: Palette = { ...added, builtIn: false };
      const next = custom.some((p) => p.id === entry.id)
        ? custom.map((p) => (p.id === entry.id ? entry : p))
        : [...custom, entry];
      latest.current.customPalettes = next;
      setCustomPalettes(next);
      persistPalettes(next);
    },
    [announce, persistPalettes],
  );

  const removeCustomPalette = useCallback(
    (id: string) => {
      const custom = latest.current.customPalettes;
      if (!custom.some((p) => p.id === id)) return;
      const next = custom.filter((p) => p.id !== id);
      latest.current.customPalettes = next;
      setCustomPalettes(next);
      persistPalettes(next);
      if (currentDoc().paletteId === id) dispatch({ type: 'patchDoc', patch: { paletteId: DEFAULT_PALETTE_ID } });
    },
    [currentDoc, persistPalettes],
  );

  /* ---- output ---- */
  const buildCurrentSvg = useCallback(async (): Promise<{ svg: string; fileName: string } | null> => {
    const { palette: activePalette, color: resolver, paper: paperHex } = latest.current;
    const snapshot = latest.current.state.history.present;
    if (snapshot.layers.length === 0) {
      announce('Добавьте объекты — экспортировать пока нечего', 'warning');
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
    const title = snapshot.headline.trim() || formatUniqueList(objectMotifs(snapshot).map(motifName));
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
      const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
      if (!clipboard?.writeText) {
        announce('Буфер обмена недоступен в этом браузере — сохраните SVG файлом', 'error');
        return;
      }
      const built = await buildCurrentSvg();
      if (!built) return;
      await clipboard.writeText(built.svg);
      announce('SVG скопирован в буфер обмена', 'success');
    } catch (error) {
      announce(`Не удалось скопировать SVG — ${errorText(error)}`, 'error');
    }
  }, [announce, buildCurrentSvg]);

  const resetDraft = useCallback(() => {
    const store = getStorage();
    if (store) clearDraft(store);
    dispatch({ type: 'load', doc: createDoc() });
    setBrief(null);
    announce('Начат новый документ');
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
