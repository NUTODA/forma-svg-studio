import { describe, expect, it } from 'vitest';
import type { Palette } from '../domain/types';
import { allFileMetas } from '../layout/testMetas';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { validatePaletteJson } from '../palette/validate';
import { docFromMotifs, createDoc } from './doc';
import {
  DRAFT_BACKUP_KEY,
  DRAFT_KEY,
  MAX_CUSTOM_PALETTES,
  PALETTES_KEY,
  backupDraft,
  clearDraft,
  commitPaletteEdit,
  loadCustomPalettes,
  loadDraft,
  paletteIdTakenMessage,
  paletteLimitMessage,
  paletteLimitReachedMessage,
  readCustomPalettes,
  saveCustomPalettes,
  saveDraft,
} from './persist';
import type { PaletteCommit, PaletteEdit } from './persist';

class FakeStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const throwing = {
  getItem(): string | null {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem(): void {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem(): void {
    throw new DOMException('blocked', 'SecurityError');
  },
};

const sampleDoc = (): ReturnType<typeof createDoc> =>
  docFromMotifs({ ...createDoc(), headline: 'Заголовок', brief: { mode: 'names', text: 'книга, монета' } }, ['book', 'coin'], allFileMetas());

const customPalette = (over: Partial<Palette> = {}): Palette => {
  const base = BUILTIN_PALETTES[0] as Palette;
  return { ...base, id: 'my-palette', name: 'Моя палитра', builtIn: false, ...over };
};

describe('draft persistence', () => {
  it('is empty when nothing is stored', () => {
    expect(loadDraft(new FakeStorage())).toEqual({ status: 'empty' });
  });

  it('round-trips a document', () => {
    const store = new FakeStorage();
    const doc = sampleDoc();
    expect(saveDraft(store, doc)).toBe(true);
    expect(store.data.has(DRAFT_KEY)).toBe(true);
    expect(loadDraft(store)).toEqual({ status: 'ok', doc });
  });

  it('clearDraft removes it', () => {
    const store = new FakeStorage();
    saveDraft(store, createDoc());
    clearDraft(store);
    expect(loadDraft(store)).toEqual({ status: 'empty' });
  });

  it('reports broken JSON in Russian', () => {
    const store = new FakeStorage();
    store.setItem(DRAFT_KEY, '{not json');
    const result = loadDraft(store);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toMatch(/[а-яё]/i);
  });

  it('reports structurally invalid drafts', () => {
    const store = new FakeStorage();
    store.setItem(DRAFT_KEY, JSON.stringify({ ...createDoc(), preset: 'a4' }));
    expect(loadDraft(store).status).toBe('invalid');
    store.setItem(DRAFT_KEY, JSON.stringify([1, 2, 3]));
    expect(loadDraft(store).status).toBe('invalid');
    store.setItem(DRAFT_KEY, 'null');
    expect(loadDraft(store).status).toBe('invalid');
  });

  it('mentions a different format version', () => {
    const store = new FakeStorage();
    store.setItem(DRAFT_KEY, JSON.stringify({ ...createDoc(), version: 3 }));
    const result = loadDraft(store);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.reason).toContain('версии');
  });

  it('rejects a draft with prototype pollution', () => {
    const store = new FakeStorage();
    store.setItem(DRAFT_KEY, JSON.stringify(createDoc()).replace('{', '{"__proto__":{"x":1},'));
    expect(loadDraft(store).status).toBe('invalid');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it('never throws when storage is full or blocked', () => {
    expect(saveDraft(throwing, createDoc())).toBe(false);
    expect(() => clearDraft(throwing)).not.toThrow();
    expect(loadDraft(throwing)).toEqual({ status: 'empty' });
  });
});

describe('custom palettes persistence', () => {
  it('round-trips with stable ids', () => {
    const store = new FakeStorage();
    const palettes = [customPalette(), customPalette({ id: 'second', name: 'Вторая' })];
    expect(saveCustomPalettes(store, palettes)).toBe(true);
    const loaded = loadCustomPalettes(store);
    expect(loaded.map((p) => p.id)).toEqual(['my-palette', 'second']);
    expect(loaded.map((p) => p.name)).toEqual(['Моя палитра', 'Вторая']);
    expect(loaded[0]?.colors).toEqual(palettes[0]?.colors);
    expect(loaded.every((p) => !p.builtIn)).toBe(true);
  });

  it('does not store built-in palettes', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, [...BUILTIN_PALETTES, customPalette()]);
    expect(JSON.parse(store.data.get(PALETTES_KEY) ?? '[]')).toHaveLength(1);
  });

  it('returns an empty list when nothing is stored or the data is not a list', () => {
    const store = new FakeStorage();
    expect(loadCustomPalettes(store)).toEqual([]);
    store.setItem(PALETTES_KEY, '{"a":1}');
    expect(loadCustomPalettes(store)).toEqual([]);
    store.setItem(PALETTES_KEY, 'garbage');
    expect(loadCustomPalettes(store)).toEqual([]);
  });

  it('drops invalid entries and keeps valid ones', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, [customPalette()]);
    const stored = JSON.parse(store.data.get(PALETTES_KEY) ?? '[]') as Record<string, unknown>[];
    const broken = { ...stored[0], id: 'broken', colors: { ...(stored[0]?.colors as object), accent: 'not-a-colour' } };
    store.setItem(PALETTES_KEY, JSON.stringify([broken, 42, null, ...stored]));
    const loaded = loadCustomPalettes(store);
    expect(loaded.map((p) => p.id)).toEqual(['my-palette']);
  });

  it('derives a unique id when a stored id clashes with a built-in or an earlier palette', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, [customPalette({ id: 'mint' }), customPalette({ id: 'dup' }), customPalette({ id: 'dup' })]);
    const loaded = loadCustomPalettes(store);
    expect(loaded).toHaveLength(3);
    expect(new Set(loaded.map((p) => p.id)).size).toBe(3);
    expect(loaded.map((p) => p.id)).not.toContain('mint');
  });

  it('never throws when storage is full or blocked', () => {
    expect(saveCustomPalettes(throwing, [customPalette()])).toBe(false);
    expect(loadCustomPalettes(throwing)).toEqual([]);
  });
});

/** A store that can be told to refuse reads or writes, and counts the writes it took. */
class FlakyStorage extends FakeStorage {
  full = false;
  blocked = false;
  writes = 0;
  override getItem(key: string): string | null {
    if (this.blocked) throw new DOMException('blocked', 'SecurityError');
    return super.getItem(key);
  }
  override setItem(key: string, value: string): void {
    if (this.full) throw new DOMException('full', 'QuotaExceededError');
    this.writes += 1;
    super.setItem(key, value);
  }
}

const manyPalettes = (count: number): Palette[] =>
  Array.from({ length: count }, (_, i) => customPalette({ id: `p-${i}`, name: `Палитра ${i}` }));
const idsOf = (list: readonly Palette[]): string[] => list.map((p) => p.id);

describe('custom palette limit', () => {
  it('stores exactly the limit and loads all of it back', () => {
    const store = new FakeStorage();
    expect(saveCustomPalettes(store, manyPalettes(MAX_CUSTOM_PALETTES))).toBe(true);
    expect(loadCustomPalettes(store)).toHaveLength(MAX_CUSTOM_PALETTES);
  });

  it('refuses one more instead of saving what a reload would cut off', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, manyPalettes(MAX_CUSTOM_PALETTES));
    const before = store.data.get(PALETTES_KEY);
    expect(saveCustomPalettes(store, manyPalettes(MAX_CUSTOM_PALETTES + 1))).toBe(false);
    expect(store.data.get(PALETTES_KEY)).toBe(before);
    expect(idsOf(loadCustomPalettes(store))).toEqual(idsOf(manyPalettes(MAX_CUSTOM_PALETTES)));
  });

  it('does not count built-in palettes against the limit', () => {
    const store = new FakeStorage();
    expect(saveCustomPalettes(store, [...BUILTIN_PALETTES, ...manyPalettes(MAX_CUSTOM_PALETTES)])).toBe(true);
  });
});

describe('editing palettes while another tab edits them', () => {
  interface Tab {
    list: readonly Palette[];
    stored: readonly Palette[];
  }
  const openTab = (store: FakeStorage): Tab => {
    const loaded = loadCustomPalettes(store);
    return { list: loaded, stored: loaded };
  };
  const run = (store: FakeStorage, tab: Tab, edit: PaletteEdit): PaletteCommit => {
    const result = commitPaletteEdit(store, tab, edit);
    tab.list = result.list;
    tab.stored = result.stored;
    return result;
  };
  const add = (id: string, name = id): PaletteEdit => ({ kind: 'add', palette: customPalette({ id, name }) });
  const remove = (id: string): PaletteEdit => ({ kind: 'remove', id });
  const inStorage = (store: FakeStorage): string[] => idsOf(loadCustomPalettes(store));

  it('keeps what the other tab added when this tab adds', () => {
    const store = new FakeStorage();
    const a = openTab(store);
    const b = openTab(store);
    expect(run(store, a, add('first')).status).toBe('saved');
    expect(run(store, b, add('second')).status).toBe('saved');
    expect(inStorage(store)).toEqual(['first', 'second']);
    expect(idsOf(b.list)).toEqual(['first', 'second']);
  });

  it('keeps what the other tab added when this tab removes', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, [customPalette({ id: 'old' })]);
    const a = openTab(store);
    const b = openTab(store);
    run(store, a, add('new'));
    expect(run(store, b, remove('old')).status).toBe('saved');
    expect(inStorage(store)).toEqual(['new']);
    expect(idsOf(b.list)).toEqual(['new']);
  });

  it('does not bring back what the other tab removed', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, [customPalette({ id: 'x' }), customPalette({ id: 'y' })]);
    const a = openTab(store);
    const b = openTab(store);
    run(store, a, remove('x'));
    run(store, b, add('z'));
    expect(inStorage(store)).toEqual(['y', 'z']);
  });

  it('refuses an id that the other tab took after this one validated it, and offers the list to validate against', () => {
    const store = new FakeStorage();
    const a = openTab(store);
    const b = openTab(store);
    run(store, a, add('myata', 'Мята А'));
    const raw = store.data.get(PALETTES_KEY);

    const refused = run(store, b, add('myata', 'Мята Б'));
    expect(refused.status).toBe('id-taken');
    expect(store.data.get(PALETTES_KEY)).toBe(raw);
    expect(idsOf(b.list)).toEqual(['myata']);

    // The dialog validates again against the refreshed list and gets a free id; the retry goes through.
    const retry = validatePaletteJson(JSON.stringify({ name: 'Мята', colors: customPalette().colors }), new Set(idsOf(b.list)));
    if (!retry.ok) throw new Error('expected the retry to validate');
    expect(retry.palette.id).toBe('myata-2');
    expect(run(store, b, { kind: 'add', palette: retry.palette }).status).toBe('saved');
    expect(inStorage(store)).toEqual(['myata', 'myata-2']);
  });

  it('refuses the palette that would pass the limit, writes nothing and leaves the saved ones intact', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, manyPalettes(MAX_CUSTOM_PALETTES));
    const raw = store.data.get(PALETTES_KEY);
    const tab = openTab(store);
    const result = run(store, tab, add('one-too-many'));
    expect(result.status).toBe('limit');
    expect(store.data.get(PALETTES_KEY)).toBe(raw);
    expect(tab.list).toHaveLength(MAX_CUSTOM_PALETTES);
  });

  it('enforces the limit across tabs, not only against the list this tab loaded', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, manyPalettes(MAX_CUSTOM_PALETTES - 1));
    const a = openTab(store);
    const b = openTab(store);
    expect(run(store, a, add('last-seat')).status).toBe('saved');
    expect(run(store, b, add('no-seat')).status).toBe('limit');
    expect(inStorage(store)).toHaveLength(MAX_CUSTOM_PALETTES);
    expect(inStorage(store)).toContain('last-seat');
    expect(inStorage(store)).not.toContain('no-seat');
    // Making room still works from either tab.
    expect(run(store, b, remove('p-0')).status).toBe('saved');
    expect(run(store, b, add('no-seat')).status).toBe('saved');
  });

  it('lets a palette be removed at the limit', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, manyPalettes(MAX_CUSTOM_PALETTES));
    const tab = openTab(store);
    expect(run(store, tab, remove('p-3')).status).toBe('saved');
    expect(inStorage(store)).toHaveLength(MAX_CUSTOM_PALETTES - 1);
  });

  it('reports a refused write as session-only and carries the palette into the next successful save', () => {
    const store = new FlakyStorage();
    const tab = openTab(store);
    store.full = true;
    const refused = run(store, tab, add('kept'));
    expect(refused.status).toBe('session');
    expect(idsOf(tab.list)).toEqual(['kept']);
    expect(inStorage(store)).toEqual([]);

    store.full = false;
    expect(run(store, tab, add('next')).status).toBe('saved');
    expect(inStorage(store)).toEqual(['kept', 'next']);
  });

  it('carries a session-only palette next to what the other tab added in the meantime', () => {
    const store = new FlakyStorage();
    const a = openTab(store);
    const b = openTab(store);
    store.full = true;
    run(store, a, add('mine'));
    store.full = false;
    run(store, b, add('theirs'));
    expect(run(store, a, add('later')).status).toBe('saved');
    expect(inStorage(store).sort()).toEqual(['later', 'mine', 'theirs']);
  });

  it('gives a carried palette a new id when the other tab took its id meanwhile', () => {
    const store = new FlakyStorage();
    const a = openTab(store);
    const b = openTab(store);
    store.full = true;
    run(store, a, add('x', 'Моя'));
    store.full = false;
    run(store, b, add('x', 'Чужая'));
    run(store, a, add('y'));
    const loaded = loadCustomPalettes(store);
    expect(idsOf(loaded).sort()).toEqual(['x', 'x-2', 'y']);
    expect(loaded.find((p) => p.id === 'x')?.name).toBe('Чужая');
    expect(loaded.find((p) => p.id === 'x-2')?.name).toBe('Моя');
  });

  it('keeps a removal that storage refused instead of bringing the palette back', () => {
    const store = new FlakyStorage();
    saveCustomPalettes(store, [customPalette({ id: 'a' }), customPalette({ id: 'b' })]);
    const tab = openTab(store);
    store.full = true;
    expect(run(store, tab, remove('b')).status).toBe('session');
    expect(inStorage(store)).toEqual(['a', 'b']);
    expect(idsOf(tab.list)).toEqual(['a']);

    store.full = false;
    expect(run(store, tab, add('c')).status).toBe('saved');
    expect(inStorage(store)).toEqual(['a', 'c']);
  });

  it('never reports a refused write as saved, and never writes over a list it could not read', () => {
    const full = new FlakyStorage();
    const tab = openTab(full);
    full.full = true;
    expect(run(full, tab, add('a')).status).toBe('session');
    expect(run(full, tab, remove('a')).status).toBe('session');

    const blocked = new FlakyStorage();
    saveCustomPalettes(blocked, [customPalette({ id: 'precious' })]);
    const other = openTab(blocked);
    blocked.blocked = true;
    const writesBefore = blocked.writes;
    expect(run(blocked, other, add('unsaved')).status).toBe('session');
    expect(blocked.writes).toBe(writesBefore);
    blocked.blocked = false;
    expect(inStorage(blocked)).toEqual(['precious']);
  });

  it('works without any storage, for this tab only', () => {
    const result = commitPaletteEdit(null, { list: [], stored: [] }, add('lonely'));
    expect(result.status).toBe('session');
    expect(idsOf(result.list)).toEqual(['lonely']);
  });

  it('replaces a palette with the same id that this tab already knows, as an edit rather than a clash', () => {
    const store = new FakeStorage();
    saveCustomPalettes(store, [customPalette({ id: 'same', name: 'Было' })]);
    const tab = openTab(store);
    expect(run(store, tab, add('same', 'Стало')).status).toBe('saved');
    expect(loadCustomPalettes(store).map((p) => p.name)).toEqual(['Стало']);
  });
});

describe('palette refusal messages', () => {
  it('name the limit and the way out, so the user knows what to do next', () => {
    for (const text of [paletteLimitMessage(), paletteLimitReachedMessage()]) {
      expect(text).toContain(String(MAX_CUSTOM_PALETTES));
      expect(text).toMatch(/[Уу]далите/);
      expect(text).toMatch(/повтор|снова/);
    }
  });

  it('name the id that was taken and ask for a retry', () => {
    const text = paletteIdTakenMessage('myata');
    expect(text).toContain('«myata»');
    expect(text).toMatch(/ещё раз/);
    expect(text).toMatch(/другой вкладки/);
  });
});

describe('readCustomPalettes', () => {
  it('tells an unreadable store from an empty one', () => {
    expect(readCustomPalettes(throwing)).toEqual({ status: 'unreadable' });
    expect(readCustomPalettes(new FakeStorage())).toEqual({ status: 'ok', palettes: [] });
    const garbage = new FakeStorage();
    garbage.setItem(PALETTES_KEY, 'garbage');
    expect(readCustomPalettes(garbage)).toEqual({ status: 'ok', palettes: [] });
  });
});

describe('backupDraft', () => {
  it('keeps an unreadable draft under a separate key', () => {
    const store = new FakeStorage();
    store.setItem(DRAFT_KEY, '{"version": 99}');
    expect(loadDraft(store).status).toBe('invalid');
    expect(backupDraft(store)).toBe(true);
    expect(store.getItem(DRAFT_BACKUP_KEY)).toBe('{"version": 99}');
    expect(backupDraft(new FakeStorage())).toBe(false);
  });
});
