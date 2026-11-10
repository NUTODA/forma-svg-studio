import type { DocState, Layer } from '../domain/types';
import { MAX_LAYER_SIZE, boundLayer, clampCoord, hasUsableSize } from './bounds';
import { MAX_LAYERS } from './validate';

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export interface EditorState {
  history: History<DocState>;
  selectedId: string | null;
  /** Snapshot taken at the first transient update of a pointer gesture (drag/rotate). */
  gestureBase: DocState | null;
  /** Coalescing key of the last committed action (consecutive equal keys merge into one undo step). */
  lastCoalesce: string | null;
}

export type LayerPatch = Partial<Pick<Layer, 'x' | 'y' | 'rotation' | 'size' | 'hidden'>>;
export type DocSettingsPatch = Partial<
  Pick<
    DocState,
    | 'preset'
    | 'detail'
    | 'layout'
    | 'colorMode'
    | 'paletteId'
    | 'backgroundObjects'
    | 'showPlane'
    | 'showHeadline'
    | 'headline'
    | 'brief'
  >
>;

export type EditorAction =
  /** Load a document and reset history (draft restore). */
  | { type: 'load'; doc: DocState }
  /** Replace the whole document as one undo step (compose / recompose / preset). */
  | { type: 'replaceDoc'; doc: DocState; selectId?: string | null }
  /** Change document settings; `coalesce` merges consecutive edits (e.g. typing a headline). */
  | { type: 'patchDoc'; patch: DocSettingsPatch; coalesce?: string }
  /** Append layers on top (ids assigned from doc.nextId). */
  | { type: 'addLayers'; layers: Omit<Layer, 'id'>[]; select?: boolean }
  /** `transient` updates during a gesture do not create undo steps until `commitGesture`. */
  | { type: 'updateLayer'; id: string; patch: LayerPatch; transient?: boolean; coalesce?: string }
  | { type: 'commitGesture' }
  | { type: 'cancelGesture' }
  | { type: 'duplicateLayer'; id: string; offset: number }
  | { type: 'removeLayer'; id: string }
  | { type: 'reorderLayer'; id: string; to: 'up' | 'down' | 'top' | 'bottom' | number }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export function createEditorState(doc: DocState): EditorState {
  return { history: { past: [], present: doc, future: [] }, selectedId: null, gestureBase: null, lastCoalesce: null };
}

export function canUndo(state: EditorState): boolean {
  return state.history.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.history.future.length > 0;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const otherKeys = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (keys.length !== otherKeys.length) return false;
  return keys.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}

function hasLayer(doc: DocState, id: string | null): boolean {
  return id !== null && doc.layers.some((l) => l.id === id);
}

/** Selection survives only while its layer exists. */
function withValidSelection(state: EditorState): EditorState {
  return hasLayer(state.history.present, state.selectedId) ? state : { ...state, selectedId: null };
}

/**
 * A document handed in whole stays restorable from a draft: bounded geometry on every layer (layers that
 * are already fine keep their identity) and at most MAX_LAYERS of them — echoes go first, then the lowest layers.
 */
function boundDoc(doc: DocState): DocState {
  let layers = doc.layers.map(boundLayer);
  let excess = layers.length - MAX_LAYERS;
  if (excess > 0) {
    layers = layers.filter((l) => {
      if (excess <= 0 || l.role !== 'background') return true;
      excess -= 1;
      return false;
    });
    layers = layers.slice(Math.max(0, layers.length - MAX_LAYERS));
  }
  const unchanged = layers.length === doc.layers.length && layers.every((l, i) => l === doc.layers[i]);
  return unchanged ? doc : { ...doc, layers };
}

/** Normalised copy of a layer with the patch applied (non-finite numbers and non-positive sizes are ignored). */
function patchLayer(layer: Layer, patch: LayerPatch): Layer {
  const next: Layer = { ...layer };
  if (patch.x !== undefined && Number.isFinite(patch.x)) next.x = clampCoord(patch.x);
  if (patch.y !== undefined && Number.isFinite(patch.y)) next.y = clampCoord(patch.y);
  if (patch.rotation !== undefined && Number.isFinite(patch.rotation)) next.rotation = (patch.rotation % 360) + 0;
  if (patch.size !== undefined && Number.isFinite(patch.size) && patch.size > 0) {
    next.size = Math.min(patch.size, MAX_LAYER_SIZE);
  }
  if (patch.hidden === true) next.hidden = true;
  else if (patch.hidden === false) delete next.hidden;
  return next;
}

function mapLayer(doc: DocState, id: string, fn: (layer: Layer) => Layer): DocState {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? fn(l) : l)) };
}

/** Push `next` as a new undo step, or merge into the present when `key` repeats. */
function commit(initial: EditorState, next: DocState, key: string | null = null): EditorState {
  // Any action without a coalescing key ends the current coalescing run, even when it changes nothing.
  const state = key === null && initial.lastCoalesce !== null ? { ...initial, lastCoalesce: null } : initial;
  const { past, present } = state.history;
  if (deepEqual(next, present)) return state;
  const merge = key !== null && key === state.lastCoalesce;
  if (merge && past.length > 0 && deepEqual(next, past[past.length - 1])) {
    return {
      ...state,
      history: { past: past.slice(0, -1), present: next, future: [] },
      lastCoalesce: null,
    };
  }
  const nextPast = merge ? past : [...past, present].slice(-HISTORY_LIMIT);
  return {
    ...state,
    history: { past: nextPast, present: next, future: [] },
    lastCoalesce: key,
  };
}

/** A gesture interrupted by another action is committed as one step first. */
function finishGesture(state: EditorState): EditorState {
  if (!state.gestureBase) return state;
  const { past, present } = state.history;
  const base = state.gestureBase;
  const changed = !deepEqual(base, present);
  return {
    ...state,
    history: changed ? { past: [...past, base].slice(-HISTORY_LIMIT), present, future: [] } : state.history,
    gestureBase: null,
    lastCoalesce: null,
  };
}

function targetIndex(to: 'up' | 'down' | 'top' | 'bottom' | number, index: number, count: number): number | null {
  if (to === 'up') return Math.min(index + 1, count - 1);
  if (to === 'down') return Math.max(index - 1, 0);
  if (to === 'top') return count - 1;
  if (to === 'bottom') return 0;
  if (!Number.isFinite(to)) return null;
  return Math.max(0, Math.min(count - 1, Math.round(to)));
}

function transientUpdate(state: EditorState, id: string, patch: LayerPatch): EditorState {
  const present = state.history.present;
  const layer = present.layers.find((l) => l.id === id);
  if (!layer) return state;
  const next = mapLayer(present, id, (l) => patchLayer(l, patch));
  if (deepEqual(next, present)) return state;
  return {
    ...state,
    gestureBase: state.gestureBase ?? present,
    history: { ...state.history, present: next },
  };
}

function step(state: EditorState, action: EditorAction): EditorState {
  const doc = state.history.present;
  switch (action.type) {
    case 'load':
      return createEditorState(action.doc);

    case 'replaceDoc': {
      const committed = commit(state, boundDoc(action.doc));
      const selectedId = action.selectId === undefined ? committed.selectedId : action.selectId;
      return withValidSelection({ ...committed, selectedId });
    }

    case 'patchDoc': {
      const next: DocState = { ...doc };
      const patch = action.patch as Record<string, unknown>;
      const target = next as unknown as Record<string, unknown>;
      for (const key of Object.keys(patch)) if (patch[key] !== undefined) target[key] = patch[key];
      return commit(state, next, action.coalesce ?? null);
    }

    case 'addLayers': {
      const specs = action.layers.filter(hasUsableSize);
      if (specs.length === 0 || doc.layers.length + specs.length > MAX_LAYERS) return state;
      const added = specs.map((l, i): Layer => boundLayer({ ...l, id: `l${doc.nextId + i}` }));
      const next: DocState = { ...doc, layers: [...doc.layers, ...added], nextId: doc.nextId + added.length };
      const committed = commit(state, next);
      const last = added[added.length - 1];
      return action.select && last ? { ...committed, selectedId: last.id } : committed;
    }

    case 'updateLayer': {
      if (action.transient) return transientUpdate(state, action.id, action.patch);
      if (!hasLayer(doc, action.id)) return state;
      const next = mapLayer(doc, action.id, (l) => patchLayer(l, action.patch));
      return commit(state, next, action.coalesce ?? null);
    }

    case 'commitGesture':
      return finishGesture(state);

    case 'cancelGesture':
      if (!state.gestureBase) return state;
      return { ...state, history: { ...state.history, present: state.gestureBase }, gestureBase: null };

    case 'duplicateLayer': {
      const index = doc.layers.findIndex((l) => l.id === action.id);
      const original = doc.layers[index];
      if (!original || doc.layers.length >= MAX_LAYERS) return state;
      const offset = Number.isFinite(action.offset) ? action.offset : 0;
      const copy: Layer = boundLayer({
        ...original,
        id: `l${doc.nextId}`,
        x: original.x + offset,
        y: original.y + offset,
      });
      const layers = [...doc.layers.slice(0, index + 1), copy, ...doc.layers.slice(index + 1)];
      const committed = commit(state, { ...doc, layers, nextId: doc.nextId + 1 });
      return { ...committed, selectedId: copy.id };
    }

    case 'removeLayer': {
      if (!hasLayer(doc, action.id)) return state;
      const next: DocState = { ...doc, layers: doc.layers.filter((l) => l.id !== action.id) };
      return withValidSelection(commit(state, next));
    }

    case 'reorderLayer': {
      const index = doc.layers.findIndex((l) => l.id === action.id);
      const layer = doc.layers[index];
      if (!layer) return state;
      const to = targetIndex(action.to, index, doc.layers.length);
      if (to === null || to === index) return state;
      const layers = doc.layers.filter((l) => l.id !== action.id);
      layers.splice(to, 0, layer);
      return commit(state, { ...doc, layers });
    }

    case 'select': {
      const id = hasLayer(doc, action.id) ? action.id : null;
      if (id === state.selectedId) return state;
      return { ...state, selectedId: id, lastCoalesce: null };
    }

    case 'undo': {
      const { past, present, future } = state.history;
      const previous = past[past.length - 1];
      if (!previous) return state;
      return withValidSelection({
        ...state,
        history: { past: past.slice(0, -1), present: previous, future: [present, ...future] },
        lastCoalesce: null,
      });
    }

    case 'redo': {
      const { past, present, future } = state.history;
      const following = future[0];
      if (!following) return state;
      return withValidSelection({
        ...state,
        history: { past: [...past, present].slice(-HISTORY_LIMIT), present: following, future: future.slice(1) },
        lastCoalesce: null,
      });
    }
  }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const keepsGesture =
    action.type === 'commitGesture' ||
    action.type === 'cancelGesture' ||
    action.type === 'select' ||
    (action.type === 'updateLayer' && action.transient === true);
  return step(keepsGesture ? state : finishGesture(state), action);
}
