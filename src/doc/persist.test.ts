import { describe, expect, it } from 'vitest';
import type { Palette } from '../domain/types';
import { allFileMetas } from '../layout/testMetas';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { docFromMotifs, createDoc } from './doc';
import {
  DRAFT_BACKUP_KEY,
  DRAFT_KEY,
  PALETTES_KEY,
  backupDraft,
  clearDraft,
  loadCustomPalettes,
  loadDraft,
  saveCustomPalettes,
  saveDraft,
} from './persist';

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
