import { PAINT_ROLES } from '../domain/types';
import type { DocState, Palette } from '../domain/types';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { PALETTE_SCHEMA_ID, uniqueId, validatePaletteJson } from '../palette/validate';
import { validateDoc } from './validate';

export const DRAFT_KEY = 'forma:draft:v1';
export const PALETTES_KEY = 'forma:palettes:v1';

/** A draft larger than this is treated as corrupted rather than parsed. */
const MAX_DRAFT_CHARS = 2_000_000;
/** What loadCustomPalettes keeps; the editor and saveCustomPalettes refuse to go past it. */
export const MAX_CUSTOM_PALETTES = 50;

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem' | 'removeItem'>;

export type DraftLoad = { status: 'empty' } | { status: 'ok'; doc: DocState } | { status: 'invalid'; reason: string };

function readItem(store: ReadStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    // Storage blocked by the browser: behave as if nothing was saved.
    return null;
  }
}

export function loadDraft(store: ReadStore): DraftLoad {
  const raw = readItem(store, DRAFT_KEY);
  if (raw === null) return { status: 'empty' };
  if (raw.length > MAX_DRAFT_CHARS) {
    return { status: 'invalid', reason: 'Черновик слишком большой, поэтому его нельзя открыть.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'invalid', reason: 'Черновик повреждён: не удалось прочитать данные.' };
  }

  const doc = validateDoc(parsed);
  if (doc) return { status: 'ok', doc };

  const version =
    typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, 'version')
      ? (parsed as { version: unknown }).version
      : undefined;
  if (typeof version === 'number' && version !== 1) {
    return { status: 'invalid', reason: 'Черновик сохранён в другой версии формата.' };
  }
  return { status: 'invalid', reason: 'Черновик не прошёл проверку: в нём есть недопустимые или повреждённые данные.' };
}

/** Returns false (never throws) when storage is unavailable or full. */
export function saveDraft(store: WriteStore, doc: DocState): boolean {
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(doc));
    return true;
  } catch {
    return false;
  }
}

export const DRAFT_BACKUP_KEY = 'forma:draft:v1:backup';

/**
 * Keeps an unreadable draft under a separate key before autosave writes a fresh document over it.
 * Returns false when there was nothing to keep or storage refused.
 */
export function backupDraft(store: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  const raw = readItem(store, DRAFT_KEY);
  if (raw === null) return false;
  try {
    store.setItem(DRAFT_BACKUP_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(store: WriteStore): void {
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear if storage is blocked.
  }
}

/** Palette in the shareable JSON schema, plus its stable `id`. */
function toStoredPalette(p: Palette): Record<string, unknown> {
  return { schema: PALETTE_SCHEMA_ID, id: p.id, name: p.name, plane: p.plane, colors: p.colors };
}

export type StoredPalettes = { status: 'ok'; palettes: Palette[] } | { status: 'unreadable' };

/**
 * The custom palettes in storage, each re-validated; invalid entries are dropped and the list is cut at the
 * limit. `unreadable` (the browser refused the read) is not an empty list: nothing may be written because of it.
 */
export function readCustomPalettes(store: ReadStore): StoredPalettes {
  let raw: string | null;
  try {
    raw = store.getItem(PALETTES_KEY);
  } catch {
    return { status: 'unreadable' };
  }
  if (raw === null) return { status: 'ok', palettes: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'ok', palettes: [] };
  }
  if (!Array.isArray(parsed)) return { status: 'ok', palettes: [] };

  const taken = new Set<string>(BUILTIN_PALETTES.map((p) => p.id));
  const palettes: Palette[] = [];
  for (const entry of (parsed as unknown[]).slice(0, MAX_CUSTOM_PALETTES)) {
    let text: string;
    try {
      text = JSON.stringify(entry);
    } catch {
      continue;
    }
    const checked = validatePaletteJson(text, taken);
    if (!checked.ok) continue;
    taken.add(checked.palette.id);
    palettes.push({ ...checked.palette, builtIn: false });
  }
  return { status: 'ok', palettes };
}

export function loadCustomPalettes(store: ReadStore): Palette[] {
  const read = readCustomPalettes(store);
  return read.status === 'ok' ? read.palettes : [];
}

/**
 * Returns false (never throws) when storage is unavailable or full. A list over the limit is not written
 * either: loadCustomPalettes would cut it short, so the extra palettes would be reported as saved and then lost.
 */
export function saveCustomPalettes(store: WriteStore, palettes: readonly Palette[]): boolean {
  const custom = palettes.filter((p) => !p.builtIn);
  if (custom.length > MAX_CUSTOM_PALETTES) return false;
  try {
    store.setItem(PALETTES_KEY, JSON.stringify(custom.map(toStoredPalette)));
    return true;
  } catch {
    return false;
  }
}

/** Shown by the editor and by the import dialog alike; the failure comes first because the status line is narrow. */
export function paletteLimitMessage(): string {
  return `Не добавлено: предел — ${MAX_CUSTOM_PALETTES} своих палитр. Удалите ненужную (корзина в панели «Палитра») и повторите импорт — сохранённые палитры не тронуты`;
}

/** For the import dialog when the list is already full, before anything has been pasted. */
export function paletteLimitReachedMessage(): string {
  return `Уже сохранено ${MAX_CUSTOM_PALETTES} своих палитр — это предел. Закройте окно, удалите ненужную палитру (корзина в панели «Палитра») и откройте импорт снова.`;
}

export function paletteIdTakenMessage(id: string): string {
  return `Не добавлено: идентификатор «${id}» только что занят палитрой из другой вкладки. Проверьте новый идентификатор в предпросмотре и нажмите «Добавить палитру» ещё раз`;
}

/* ------------------------------------------------------------------ */
/* Editing the list while another tab may be editing it too            */
/* ------------------------------------------------------------------ */

export type PaletteEdit = { kind: 'add'; palette: Palette } | { kind: 'remove'; id: string };

/** What a tab knows: the list it shows, and the list it last saw in storage (the base of the next merge). */
export interface TabPalettes {
  list: readonly Palette[];
  stored: readonly Palette[];
}

export interface PaletteCommit {
  /**
   * `saved`: written to storage. `session`: applied in this tab only (storage unreadable or refused the write).
   * `limit` and `id-taken`: the edit was refused and nothing was written.
   */
  status: 'saved' | 'session' | 'limit' | 'id-taken';
  /** The list this tab shows from now on, other tabs' changes included. */
  list: Palette[];
  /** What storage holds as far as this tab knows: pass it back as `stored` next time. */
  stored: Palette[];
}

/** Field by field, so the order of keys never matters. */
function samePalette(a: Palette, b: Palette): boolean {
  return (
    a.id === b.id && a.name === b.name && a.plane === b.plane && PAINT_ROLES.every((role) => a.colors[role] === b.colors[role])
  );
}

/**
 * Three-way merge by id of this tab's `list` into the `current` list in storage; `stored` is what this tab last
 * saw there. Whatever this tab left alone follows storage, so another tab's additions and removals stand; what
 * this tab added, changed or removed is applied on top, edits that storage once refused included.
 */
function mergePalettes(stored: readonly Palette[], list: readonly Palette[], current: readonly Palette[]): Palette[] {
  const was = new Map(stored.map((p) => [p.id, p] as const));
  const here = new Set(list.map((p) => p.id));
  const merged = current.filter((p) => !(was.has(p.id) && !here.has(p.id)));
  const taken = new Set(merged.map((p) => p.id));
  for (const palette of list) {
    const before = was.get(palette.id);
    if (before && samePalette(before, palette)) continue;
    const at = merged.findIndex((p) => p.id === palette.id);
    if (at >= 0 && before) {
      merged[at] = palette;
    } else if (at < 0) {
      merged.push(palette);
      taken.add(palette.id);
    } else {
      // Added here while the same id appeared in storage from elsewhere: both stay, this one under a new id.
      const id = uniqueId(palette.id, taken);
      taken.add(id);
      merged.push({ ...palette, id });
    }
  }
  return merged;
}

function applyEdit(list: readonly Palette[], edit: PaletteEdit): Palette[] {
  if (edit.kind === 'remove') return list.filter((p) => p.id !== edit.id);
  const entry: Palette = { ...edit.palette, builtIn: false };
  return list.some((p) => p.id === entry.id) ? list.map((p) => (p.id === entry.id ? entry : p)) : [...list, entry];
}

/**
 * Applies one edit to what storage holds *now*, not to the list this tab loaded long ago, so palettes another tab
 * added or removed since are kept. The read and the write are separate calls: this narrows the window for
 * a lost update to one edit, it does not close it.
 *
 * An added palette whose id has appeared in storage since it was validated is refused (`id-taken`); the returned
 * list already contains the newcomer, so validating again yields a free id. Adding past the limit is refused
 * (`limit`) and writes nothing, so the saved palettes stay as they are. `session` is reported whenever the
 * write did not happen; the unsaved difference is carried into the next commit, never dropped.
 */
export function commitPaletteEdit(
  store: (ReadStore & WriteStore) | null,
  tab: TabPalettes,
  edit: PaletteEdit,
): PaletteCommit {
  const read = store ? readCustomPalettes(store) : null;
  const current = read?.status === 'ok' ? read.palettes : null;
  const stored = current ?? [...tab.stored];
  const view = (list: readonly Palette[]): Palette[] => (current ? mergePalettes(tab.stored, list, current) : [...list]);

  const before = view(tab.list);
  if (
    edit.kind === 'add' &&
    current?.some((p) => p.id === edit.palette.id) &&
    !tab.stored.some((p) => p.id === edit.palette.id)
  ) {
    return { status: 'id-taken', list: before, stored };
  }
  const after = view(applyEdit(tab.list, edit));
  if (edit.kind === 'add' && after.length > before.length && after.length > MAX_CUSTOM_PALETTES) {
    return { status: 'limit', list: before, stored };
  }
  if (!store || !current) return { status: 'session', list: after, stored };
  return saveCustomPalettes(store, after)
    ? { status: 'saved', list: after, stored: after }
    : { status: 'session', list: after, stored };
}
