import { describe, expect, it } from 'vitest';
import type { DocState, Layer } from '../domain/types';
import { createDoc, validateDoc } from './doc';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createEditorState,
  editorReducer,
} from './editor';
import type { EditorAction, EditorState } from './editor';

const spec = (over: Partial<Omit<Layer, 'id'>> = {}): Omit<Layer, 'id'> => ({
  motif: 'book',
  role: 'object',
  x: 100,
  y: 100,
  rotation: 0,
  size: 200,
  rank: 0,
  ...over,
});

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function withLayers(count: number): EditorState {
  const layers = Array.from({ length: count }, (_, i) => spec({ x: 100 + i, rank: i }));
  return run(createEditorState(createDoc()), { type: 'addLayers', layers });
}

const doc = (s: EditorState): DocState => s.history.present;
const ids = (s: EditorState): string[] => doc(s).layers.map((l) => l.id);

describe('editorReducer basics', () => {
  it('creates a clean state', () => {
    const s = createEditorState(createDoc());
    expect(s).toMatchObject({ selectedId: null, gestureBase: null, lastCoalesce: null });
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  it('addLayers assigns ids from nextId, appends on top and optionally selects the last', () => {
    const s = run(createEditorState(createDoc()), {
      type: 'addLayers',
      layers: [spec(), spec({ motif: 'coin', rank: 1 })],
      select: true,
    });
    expect(ids(s)).toEqual(['l1', 'l2']);
    expect(doc(s).nextId).toBe(3);
    expect(s.selectedId).toBe('l2');
    expect(canUndo(s)).toBe(true);
    expect(validateDoc(doc(s))).not.toBeNull();
  });

  it('addLayers with nothing creates no step', () => {
    const s0 = createEditorState(createDoc());
    expect(run(s0, { type: 'addLayers', layers: [] })).toBe(s0);
  });

  it('patchDoc changes settings as one step', () => {
    const s = run(createEditorState(createDoc()), { type: 'patchDoc', patch: { preset: 'square', showPlane: true } });
    expect(doc(s)).toMatchObject({ preset: 'square', showPlane: true });
    expect(s.history.past).toHaveLength(1);
  });

  it('load resets history, selection and gesture', () => {
    let s = withLayers(2);
    s = run(s, { type: 'select', id: 'l1' }, { type: 'updateLayer', id: 'l1', patch: { x: 5 }, transient: true });
    const fresh = createDoc();
    const loaded = run(s, { type: 'load', doc: fresh });
    expect(loaded).toEqual(createEditorState(fresh));
  });

  it('replaceDoc is one undo step and manages selection', () => {
    let s = run(withLayers(2), { type: 'select', id: 'l1' });
    const replacement = { ...createDoc(), layers: [{ ...spec(), id: 'l9' }], nextId: 10 };
    s = run(s, { type: 'replaceDoc', doc: replacement });
    expect(s.selectedId).toBeNull();
    expect(ids(s)).toEqual(['l9']);
    s = run(s, { type: 'replaceDoc', doc: replacement, selectId: 'l9' });
    expect(s.selectedId).toBe('l9');
    expect(s.history.past).toHaveLength(2);
    s = run(s, { type: 'undo' });
    expect(ids(s)).toEqual(['l1', 'l2']);
    expect(s.selectedId).toBeNull();
  });

  it('replaceDoc keeps a surviving selection', () => {
    let s = run(withLayers(2), { type: 'select', id: 'l1' });
    s = run(s, { type: 'replaceDoc', doc: { ...doc(s), headline: 'x' } });
    expect(s.selectedId).toBe('l1');
  });
});

describe('undo / redo', () => {
  it('walks back and forth', () => {
    let s = withLayers(1);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { x: 500 } });
    expect(doc(s).layers[0]?.x).toBe(500);
    s = run(s, { type: 'undo' });
    expect(doc(s).layers[0]?.x).toBe(100);
    expect(canRedo(s)).toBe(true);
    s = run(s, { type: 'redo' });
    expect(doc(s).layers[0]?.x).toBe(500);
    expect(canRedo(s)).toBe(false);
  });

  it('a new step clears the future', () => {
    let s = withLayers(1);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { x: 500 } }, { type: 'undo' });
    expect(canRedo(s)).toBe(true);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { x: 7 } });
    expect(canRedo(s)).toBe(false);
  });

  it('undo/redo on empty stacks are no-ops', () => {
    const s0 = createEditorState(createDoc());
    expect(run(s0, { type: 'undo' })).toBe(s0);
    expect(run(s0, { type: 'redo' })).toBe(s0);
  });

  it('clears the selection when the selected layer disappears', () => {
    let s = run(withLayers(1), { type: 'select', id: 'l1' });
    s = run(s, { type: 'undo' });
    expect(ids(s)).toEqual([]);
    expect(s.selectedId).toBeNull();
    s = run(s, { type: 'redo', }, { type: 'select', id: 'l1' }, { type: 'removeLayer', id: 'l1' });
    expect(s.selectedId).toBeNull();
    s = run(s, { type: 'undo' });
    expect(s.selectedId).toBeNull();
    s = run(s, { type: 'select', id: 'l1' }, { type: 'redo' });
    expect(s.selectedId).toBeNull();
  });

  it('keeps selection of a layer that still exists after undo', () => {
    let s = withLayers(2);
    s = run(s, { type: 'select', id: 'l1' }, { type: 'updateLayer', id: 'l2', patch: { x: 9 } }, { type: 'undo' });
    expect(s.selectedId).toBe('l1');
  });

  it('selection never enters history', () => {
    let s = withLayers(1);
    const pastLength = s.history.past.length;
    s = run(s, { type: 'select', id: 'l1' }, { type: 'select', id: null });
    expect(s.history.past).toHaveLength(pastLength);
  });

  it('ignores selecting a missing layer', () => {
    const s = run(withLayers(1), { type: 'select', id: 'nope' });
    expect(s.selectedId).toBeNull();
  });
});

describe('history limit', () => {
  it('drops the oldest entries', () => {
    let s = withLayers(1);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) {
      s = run(s, { type: 'updateLayer', id: 'l1', patch: { x: 1000 + i } });
    }
    expect(s.history.past).toHaveLength(HISTORY_LIMIT);
    let undone = s;
    for (let i = 0; i < HISTORY_LIMIT; i += 1) undone = run(undone, { type: 'undo' });
    expect(canUndo(undone)).toBe(false);
    // The oldest reachable state is not the very first one: it was dropped.
    expect(doc(undone).layers[0]?.x).toBe(1000 + 20);
  });
});

describe('gestures', () => {
  it('a drag is one undo step, committed once', () => {
    let s = withLayers(1);
    const stepsBefore = s.history.past.length;
    for (const x of [110, 120, 130]) {
      s = run(s, { type: 'updateLayer', id: 'l1', patch: { x }, transient: true });
    }
    expect(s.history.past).toHaveLength(stepsBefore);
    expect(s.gestureBase?.layers[0]?.x).toBe(100);
    expect(doc(s).layers[0]?.x).toBe(130);
    s = run(s, { type: 'commitGesture' });
    expect(s.gestureBase).toBeNull();
    expect(s.history.past).toHaveLength(stepsBefore + 1);
    s = run(s, { type: 'undo' });
    expect(doc(s).layers[0]?.x).toBe(100);
  });

  it('commit without changes adds no step', () => {
    let s = withLayers(1);
    const before = s.history.past.length;
    s = run(
      s,
      { type: 'updateLayer', id: 'l1', patch: { x: 150 }, transient: true },
      { type: 'updateLayer', id: 'l1', patch: { x: 100 }, transient: true },
      { type: 'commitGesture' },
    );
    expect(s.history.past).toHaveLength(before);
    expect(s.gestureBase).toBeNull();
  });

  it('commit with no gesture is a no-op', () => {
    const s = withLayers(1);
    expect(run(s, { type: 'commitGesture' })).toBe(s);
  });

  it('cancel restores the base document', () => {
    let s = withLayers(1);
    const before = doc(s);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { x: 999, rotation: 30 }, transient: true }, { type: 'cancelGesture' });
    expect(doc(s)).toEqual(before);
    expect(s.gestureBase).toBeNull();
    expect(canRedo(s)).toBe(false);
    expect(run(s, { type: 'cancelGesture' })).toBe(s);
  });

  it('an unrelated action finishes a running gesture first', () => {
    let s = withLayers(1);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { x: 300 }, transient: true }, { type: 'patchDoc', patch: { headline: 'h' } });
    expect(s.gestureBase).toBeNull();
    s = run(s, { type: 'undo' });
    expect(doc(s).headline).toBe('');
    expect(doc(s).layers[0]?.x).toBe(300);
    s = run(s, { type: 'undo' });
    expect(doc(s).layers[0]?.x).toBe(100);
  });

  it('a transient update on a missing layer or with identical values does nothing', () => {
    const s = withLayers(1);
    expect(run(s, { type: 'updateLayer', id: 'zzz', patch: { x: 1 }, transient: true })).toBe(s);
    expect(run(s, { type: 'updateLayer', id: 'l1', patch: { x: 100 }, transient: true })).toBe(s);
  });
});

describe('coalescing', () => {
  it('merges consecutive edits with the same key into one step', () => {
    let s = createEditorState(createDoc());
    for (const text of ['К', 'Кн', 'Кни', 'Книг']) {
      s = run(s, { type: 'patchDoc', patch: { headline: text }, coalesce: 'headline' });
    }
    expect(doc(s).headline).toBe('Книг');
    expect(s.history.past).toHaveLength(1);
    s = run(s, { type: 'undo' });
    expect(doc(s).headline).toBe('');
  });

  it('a different key starts a new step', () => {
    let s = createEditorState(createDoc());
    s = run(
      s,
      { type: 'patchDoc', patch: { headline: 'a' }, coalesce: 'headline' },
      { type: 'patchDoc', patch: { headline: 'ab' }, coalesce: 'other' },
    );
    expect(s.history.past).toHaveLength(2);
  });

  it('any non-coalesced action resets the run', () => {
    let s = createEditorState(createDoc());
    s = run(
      s,
      { type: 'patchDoc', patch: { headline: 'a' }, coalesce: 'headline' },
      { type: 'patchDoc', patch: { showPlane: true } },
      { type: 'patchDoc', patch: { headline: 'ab' }, coalesce: 'headline' },
    );
    expect(s.history.past).toHaveLength(3);
  });

  it('undo ends the run', () => {
    let s = createEditorState(createDoc());
    s = run(
      s,
      { type: 'patchDoc', patch: { headline: 'a' }, coalesce: 'headline' },
      { type: 'undo' },
      { type: 'patchDoc', patch: { headline: 'b' }, coalesce: 'headline' },
      { type: 'patchDoc', patch: { headline: 'bc' }, coalesce: 'headline' },
    );
    expect(s.history.past).toHaveLength(1);
    expect(s.lastCoalesce).toBe('headline');
  });

  it('works for layer nudges and clears the future', () => {
    let s = withLayers(1);
    const before = s.history.past.length;
    s = run(
      s,
      { type: 'updateLayer', id: 'l1', patch: { x: 101 }, coalesce: 'nudge:l1' },
      { type: 'updateLayer', id: 'l1', patch: { x: 102 }, coalesce: 'nudge:l1' },
      { type: 'updateLayer', id: 'l1', patch: { x: 103 }, coalesce: 'nudge:l1' },
    );
    expect(s.history.past).toHaveLength(before + 1);
    expect(doc(s).layers[0]?.x).toBe(103);
    s = run(s, { type: 'undo' });
    expect(doc(s).layers[0]?.x).toBe(100);
  });
});

describe('no-op actions', () => {
  it('create no undo step', () => {
    const s = withLayers(3);
    const noops: EditorAction[] = [
      { type: 'updateLayer', id: 'l1', patch: { x: 100 } },
      { type: 'updateLayer', id: 'l1', patch: {} },
      { type: 'updateLayer', id: 'l1', patch: { hidden: false } },
      { type: 'updateLayer', id: 'l1', patch: { x: Number.NaN, size: -3 } },
      { type: 'updateLayer', id: 'missing', patch: { x: 1 } },
      { type: 'patchDoc', patch: { preset: 'og' } },
      { type: 'patchDoc', patch: { brief: { mode: 'title', text: '' } } },
      { type: 'patchDoc', patch: {} },
      { type: 'reorderLayer', id: 'l3', to: 'up' },
      { type: 'reorderLayer', id: 'l3', to: 'top' },
      { type: 'reorderLayer', id: 'l1', to: 'down' },
      { type: 'reorderLayer', id: 'l1', to: 'bottom' },
      { type: 'reorderLayer', id: 'l2', to: 1 },
      { type: 'reorderLayer', id: 'l2', to: Number.NaN },
      { type: 'removeLayer', id: 'missing' },
      { type: 'duplicateLayer', id: 'missing', offset: 10 },
    ];
    for (const action of noops) {
      const next = run(s, action);
      expect(next.history.past, JSON.stringify(action)).toHaveLength(s.history.past.length);
      expect(next.history.present, JSON.stringify(action)).toBe(s.history.present);
    }
  });

  it('even a no-op without a key ends a coalescing run', () => {
    let s = createEditorState(createDoc());
    s = run(
      s,
      { type: 'patchDoc', patch: { headline: 'a' }, coalesce: 'headline' },
      { type: 'patchDoc', patch: { preset: 'og' } },
      { type: 'patchDoc', patch: { headline: 'ab' }, coalesce: 'headline' },
    );
    expect(s.history.past).toHaveLength(2);
  });
});

describe('layer operations', () => {
  it('updateLayer normalises rotation and size', () => {
    let s = withLayers(1);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { rotation: 725, size: 50000 } });
    expect(doc(s).layers[0]?.rotation).toBe(5);
    expect(doc(s).layers[0]?.size).toBeLessThan(10000);
    expect(validateDoc(doc(s))).not.toBeNull();
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { rotation: -360 } });
    expect(Object.is(doc(s).layers[0]?.rotation, 0)).toBe(true);
  });

  it('hidden toggles on and off', () => {
    let s = withLayers(1);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { hidden: true } });
    expect(doc(s).layers[0]?.hidden).toBe(true);
    s = run(s, { type: 'updateLayer', id: 'l1', patch: { hidden: false } });
    expect(doc(s).layers[0]).not.toHaveProperty('hidden');
  });

  it('duplicateLayer inserts the copy right above the original, offset, selected', () => {
    let s = withLayers(3);
    s = run(s, { type: 'duplicateLayer', id: 'l1', offset: 24 });
    expect(ids(s)).toEqual(['l1', 'l4', 'l2', 'l3']);
    const [orig, copy] = doc(s).layers as [Layer, Layer];
    expect(copy.x).toBe(orig.x + 24);
    expect(copy.y).toBe(orig.y + 24);
    expect(copy.motif).toBe(orig.motif);
    expect(doc(s).nextId).toBe(5);
    expect(s.selectedId).toBe('l4');
    s = run(s, { type: 'undo' });
    expect(ids(s)).toEqual(['l1', 'l2', 'l3']);
    expect(s.selectedId).toBeNull();
  });

  it('removeLayer removes and clears a matching selection only', () => {
    let s = run(withLayers(3), { type: 'select', id: 'l2' });
    s = run(s, { type: 'removeLayer', id: 'l1' });
    expect(s.selectedId).toBe('l2');
    s = run(s, { type: 'removeLayer', id: 'l2' });
    expect(s.selectedId).toBeNull();
    expect(ids(s)).toEqual(['l3']);
  });

  it('reorders by up / down / top / bottom / index', () => {
    const s = withLayers(4);
    const order = (a: EditorAction): string[] => ids(run(s, a));
    expect(order({ type: 'reorderLayer', id: 'l2', to: 'up' })).toEqual(['l1', 'l3', 'l2', 'l4']);
    expect(order({ type: 'reorderLayer', id: 'l3', to: 'down' })).toEqual(['l1', 'l3', 'l2', 'l4']);
    expect(order({ type: 'reorderLayer', id: 'l1', to: 'top' })).toEqual(['l2', 'l3', 'l4', 'l1']);
    expect(order({ type: 'reorderLayer', id: 'l4', to: 'bottom' })).toEqual(['l4', 'l1', 'l2', 'l3']);
    expect(order({ type: 'reorderLayer', id: 'l1', to: 2 })).toEqual(['l2', 'l3', 'l1', 'l4']);
    expect(order({ type: 'reorderLayer', id: 'l4', to: 0 })).toEqual(['l4', 'l1', 'l2', 'l3']);
    expect(order({ type: 'reorderLayer', id: 'l1', to: 99 })).toEqual(['l2', 'l3', 'l4', 'l1']);
    expect(order({ type: 'reorderLayer', id: 'l4', to: -5 })).toEqual(['l4', 'l1', 'l2', 'l3']);
  });

  it('every reorder is undoable', () => {
    let s = withLayers(3);
    s = run(s, { type: 'reorderLayer', id: 'l1', to: 'top' }, { type: 'undo' });
    expect(ids(s)).toEqual(['l1', 'l2', 'l3']);
  });
});
