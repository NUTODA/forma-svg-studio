import type { DocState, Palette } from '../domain/types';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { PALETTE_SCHEMA_ID, validatePaletteJson } from '../palette/validate';
import { validateDoc } from './validate';

export const DRAFT_KEY = 'forma:draft:v1';
export const PALETTES_KEY = 'forma:palettes:v1';

/** A draft larger than this is treated as corrupted rather than parsed. */
const MAX_DRAFT_CHARS = 2_000_000;
const MAX_CUSTOM_PALETTES = 50;

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

/** Custom palettes re-validated on load; invalid entries are dropped. */
export function loadCustomPalettes(store: ReadStore): Palette[] {
  const raw = readItem(store, PALETTES_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const taken = new Set<string>(BUILTIN_PALETTES.map((p) => p.id));
  const result: Palette[] = [];
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
    result.push({ ...checked.palette, builtIn: false });
  }
  return result;
}

export function saveCustomPalettes(store: WriteStore, palettes: readonly Palette[]): boolean {
  try {
    store.setItem(PALETTES_KEY, JSON.stringify(palettes.filter((p) => !p.builtIn).map(toStoredPalette)));
    return true;
  } catch {
    return false;
  }
}
