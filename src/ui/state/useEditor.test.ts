import { describe, expect, it } from 'vitest';
import { createDoc, validateDoc } from '../../doc/doc';
import { createEditorState, editorReducer } from '../../doc/editor';
import { DRAFT_BACKUP_KEY, DRAFT_KEY, loadDraft } from '../../doc/persist';
import { MAX_HEADLINE_CHARS } from '../../doc/validate';
import type { DocState, Layer } from '../../domain/types';
import {
  clearDraftUnlessChanged,
  headlineForBrief,
  paletteAddedStatus,
  paletteRemovedStatus,
  readRawDraft,
  retryDraftBackup,
  saveDraftUnlessChanged,
  withIdsAboveHistory,
  type GuardedDraftWrite,
} from './useEditor';

describe('headlineForBrief', () => {
  it('uses the trimmed text as the headline in title mode', () => {
    expect(headlineForBrief('title', '  Весенний букет ')).toBe('Весенний букет');
  });

  it('never carries a headline over from a names list', () => {
    expect(headlineForBrief('names', 'книга, 2 монеты')).toBe('');
  });

  it('keeps a long restored brief within the headline limit, so the draft stays readable', () => {
    const text = ` ${'слово '.repeat(300)}`;
    const headline = headlineForBrief('title', text);
    expect(headline.length).toBeGreaterThan(0);
    expect(headline.length).toBeLessThanOrEqual(MAX_HEADLINE_CHARS);
    expect(headline).toBe(headline.trim());
    const saved = JSON.parse(JSON.stringify({ ...createDoc(), brief: { mode: 'title', text }, headline }));
    expect(validateDoc(saved)).not.toBeNull();
  });

  it('never cuts a surrogate pair in half', () => {
    const headline = headlineForBrief('title', `${'а'.repeat(MAX_HEADLINE_CHARS - 1)}😀 дальше`);
    expect(headline).toBe('а'.repeat(MAX_HEADLINE_CHARS - 1));
    expect(() => encodeURIComponent(headline)).not.toThrow();
  });
});

describe('palette change status', () => {
  const names = ['Море', 'Очень длинное название палитры, которое не помещается в узкую строку статуса'] as const;
  const statuses = [paletteAddedStatus, paletteRemovedStatus];
  // What the line says before the palette name is all a narrow screen is sure to show.
  const lead = (text: string, name: string): string => text.slice(0, text.indexOf(`«${name}»`));

  it('treats a refused write as a warning and a stored one as nothing to worry about', () => {
    for (const status of statuses) {
      expect(status('Море', 'session').level).toBe('warning');
      expect(status('Море', 'saved').level).not.toBe('warning');
    }
  });

  it('puts the failure before the name, whatever the name is', () => {
    for (const status of statuses) {
      const [short, long] = names;
      const shortText = status(short, 'session').text;
      const longText = status(long, 'session').text;
      expect(lead(shortText, short)).toBe(lead(longText, long));
      expect(lead(shortText, short).length).toBeGreaterThan(lead(status(short, 'saved').text, short).length);
    }
  });

  it('names the palette exactly once and verbatim', () => {
    const name = 'а «б» $& \\';
    for (const status of statuses) {
      for (const change of ['saved', 'session'] as const) {
        expect(status(name, change).text.split(name)).toHaveLength(2);
      }
    }
  });
});

describe('ids of a document that replaces the present one', () => {
  const layer = (n: number): Layer => ({
    id: `l${n}`,
    motif: 'book',
    role: 'object',
    x: 0,
    y: 0,
    rotation: 0,
    size: 100,
    rank: n,
  });
  const docOf = (count: number): DocState => ({
    ...createDoc(),
    layers: Array.from({ length: count }, (_, i) => layer(i + 1)),
    nextId: count + 1,
  });
  const idAt = (doc: DocState, index: number): string => {
    const found = doc.layers[index];
    if (!found) throw new Error(`no layer at ${index}`);
    return found.id;
  };
  const idsOf = (doc: DocState): string[] => doc.layers.map((l) => l.id);

  it('are unique and leave a document that can still be restored', () => {
    const state = createEditorState(docOf(9));
    const demo = withIdsAboveHistory(state, docOf(3));
    const taken = new Set(idsOf(state.history.present));
    expect(idsOf(demo).some((id) => taken.has(id))).toBe(false);
    expect(new Set(idsOf(demo)).size).toBe(3);
    expect(validateDoc(JSON.parse(JSON.stringify(demo)))).not.toBeNull();
  });

  it('keep undo and redo from moving the selection onto a different layer', () => {
    let state = createEditorState(docOf(9));
    const demo = withIdsAboveHistory(state, docOf(3));
    state = editorReducer(state, { type: 'replaceDoc', doc: demo, selectId: null });
    state = editorReducer(state, { type: 'select', id: idAt(demo, 1) });
    state = editorReducer(state, { type: 'undo' });
    expect(state.selectedId).toBeNull();

    state = editorReducer(state, { type: 'select', id: 'l2' });
    state = editorReducer(state, { type: 'redo' });
    expect(state.selectedId).toBeNull();
  });

  it('stay clear of a document waiting in redo', () => {
    let state = createEditorState(docOf(3));
    const first = withIdsAboveHistory(state, docOf(2));
    state = editorReducer(state, { type: 'replaceDoc', doc: first, selectId: null });
    state = editorReducer(state, { type: 'undo' });
    const second = withIdsAboveHistory(state, docOf(2));
    expect(idsOf(second).some((id) => idsOf(first).includes(id))).toBe(false);
  });
});

describe('retryDraftBackup', () => {
  class Store {
    readonly data = new Map<string, string>();
    full = false;
    getItem(key: string): string | null {
      return this.data.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      if (this.full) throw new DOMException('full', 'QuotaExceededError');
      this.data.set(key, value);
    }
  }
  const unreadable = '{ not json';

  it('holds while storage refuses the copy, never touching the original, and copies it once it can', () => {
    const store = new Store();
    store.data.set(DRAFT_KEY, unreadable);
    store.full = true;
    expect(retryDraftBackup(store)).toBe('held');
    expect(store.data.get(DRAFT_KEY)).toBe(unreadable);
    expect(store.data.has(DRAFT_BACKUP_KEY)).toBe(false);

    store.full = false;
    expect(retryDraftBackup(store)).toBe('copied');
    expect(store.data.get(DRAFT_BACKUP_KEY)).toBe(unreadable);
  });

  it('has nothing to protect once the draft is gone or readable', () => {
    const store = new Store();
    expect(retryDraftBackup(store)).toBe('gone');
    store.data.set(DRAFT_KEY, JSON.stringify(createDoc()));
    expect(retryDraftBackup(store)).toBe('gone');
  });
});

describe('two-tab draft guard', () => {
  class DraftStore {
    readonly data = new Map<string, string>();
    /** Every text handed to `setItem`, in order. */
    readonly writes: string[] = [];
    full = false;
    /** Runs right after a write lands: another tab getting in before this one reads anything back. */
    afterWrite: (() => void) | null = null;
    getItem(key: string): string | null {
      return this.data.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
      if (this.full) throw new DOMException('full', 'QuotaExceededError');
      this.data.set(key, value);
      this.writes.push(value);
      this.afterWrite?.();
    }
    removeItem(key: string): void {
      this.data.delete(key);
    }
  }

  // The reducer stores a new layer with its id last; a validated draft has it first.
  const layer = (n: number): Layer => ({
    motif: 'book',
    role: 'object',
    x: 0,
    y: 0,
    rotation: 0,
    size: 100,
    rank: n,
    id: `l${n}`,
  });
  const docOf = (count: number): DocState => ({
    ...createDoc(),
    layers: Array.from({ length: count }, (_, i) => layer(i + 1)),
    nextId: count + 1,
  });
  const rawOf = (write: GuardedDraftWrite): string => {
    if (write.result === 'saved' || write.result === 'unchanged') return write.raw;
    throw new Error(`expected a stored draft, got ${write.result}`);
  };
  /** What a freshly opened tab boots with: the stored text and the validated document read from it. */
  const open = (store: DraftStore): { seen: string | null; doc: DocState } => {
    const loaded = loadDraft(store);
    if (loaded.status !== 'ok') throw new Error(`draft is ${loaded.status}`);
    return { seen: readRawDraft(store), doc: loaded.doc };
  };

  it('does not rewrite a restored document nobody touched, so the tab that saved it keeps saving', () => {
    const store = new DraftStore();
    const savedByA = rawOf(saveDraftUnlessChanged(store, docOf(1), null));

    const b = open(store);
    // The premise: a validated document serialises differently from what the other tab stored.
    expect(JSON.stringify(b.doc)).not.toBe(savedByA);
    const idle = saveDraftUnlessChanged(store, b.doc, b.seen);
    expect(idle).toEqual({ result: 'unchanged', raw: savedByA });
    expect(store.writes).toEqual([savedByA]);

    expect(saveDraftUnlessChanged(store, docOf(2), savedByA).result).toBe('saved');
  });

  it('still writes a document that differs from the stored one, even one the tab had before', () => {
    const store = new DraftStore();
    const first = rawOf(saveDraftUnlessChanged(store, docOf(1), null));
    const edited = rawOf(saveDraftUnlessChanged(store, docOf(2), first));
    // Undo back to the first document: it is not what is stored, so it has to be written.
    const undone = saveDraftUnlessChanged(store, docOf(1), edited);
    expect(undone.result).toBe('saved');
    expect(store.data.get(DRAFT_KEY)).toBe(rawOf(undone));
  });

  it('refuses to overwrite work another tab saved since this one last looked', () => {
    const store = new DraftStore();
    const savedByA = rawOf(saveDraftUnlessChanged(store, docOf(1), null));
    const b = open(store);
    const savedByB = rawOf(saveDraftUnlessChanged(store, docOf(2), b.seen));

    expect(saveDraftUnlessChanged(store, docOf(3), savedByA)).toEqual({ result: 'conflict' });
    expect(store.data.get(DRAFT_KEY)).toBe(savedByB);
    expect(store.writes).toEqual([savedByA, savedByB]);
  });

  it('refuses when the other tab started over and left nothing, or something unreadable', () => {
    const store = new DraftStore();
    const saved = rawOf(saveDraftUnlessChanged(store, docOf(1), null));
    store.data.delete(DRAFT_KEY);
    expect(saveDraftUnlessChanged(store, docOf(2), saved)).toEqual({ result: 'conflict' });
    store.data.set(DRAFT_KEY, '{ not json');
    expect(saveDraftUnlessChanged(store, docOf(2), saved)).toEqual({ result: 'conflict' });
    expect(store.data.get(DRAFT_KEY)).toBe('{ not json');
  });

  it('takes another tab landing the very same document as nothing to yield to', () => {
    const store = new DraftStore();
    const saved = rawOf(saveDraftUnlessChanged(store, docOf(1), null));
    const reformatted = JSON.stringify(JSON.parse(saved), null, 2);
    store.data.set(DRAFT_KEY, reformatted);
    expect(saveDraftUnlessChanged(store, docOf(1), saved)).toEqual({ result: 'unchanged', raw: reformatted });
  });

  it('reports exactly the text it wrote, whatever another tab stores right after', () => {
    const store = new DraftStore();
    store.afterWrite = () => store.data.set(DRAFT_KEY, 'written by another tab');
    const write = saveDraftUnlessChanged(store, docOf(1), null);
    expect(write.result).toBe('saved');
    expect(rawOf(write)).toBe(store.writes[0]);
    expect(rawOf(write)).not.toBe(store.data.get(DRAFT_KEY));
    // So the next save sees that the other tab got in first.
    expect(saveDraftUnlessChanged(store, docOf(2), rawOf(write))).toEqual({ result: 'conflict' });
  });

  it('fails without claiming a baseline when storage refuses the write', () => {
    const store = new DraftStore();
    const saved = rawOf(saveDraftUnlessChanged(store, docOf(1), null));
    store.full = true;
    expect(saveDraftUnlessChanged(store, docOf(2), saved)).toEqual({ result: 'failed' });
    expect(store.data.get(DRAFT_KEY)).toBe(saved);
  });

  it('writes the first draft into empty storage', () => {
    const store = new DraftStore();
    expect(saveDraftUnlessChanged(store, docOf(1), null).result).toBe('saved');
  });

  it('lets «Новый» drop the draft it has seen, and only that one', () => {
    const store = new DraftStore();
    const saved = rawOf(saveDraftUnlessChanged(store, docOf(1), null));
    expect(clearDraftUnlessChanged(store, saved)).toEqual({ cleared: true, raw: null });
    expect(store.data.has(DRAFT_KEY)).toBe(false);

    const newer = rawOf(saveDraftUnlessChanged(store, docOf(2), null));
    expect(clearDraftUnlessChanged(store, saved)).toEqual({ cleared: false });
    expect(store.data.get(DRAFT_KEY)).toBe(newer);
  });
});
