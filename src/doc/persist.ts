// CONTRACT STUB — owned by the doc/layout agent. Signatures are fixed; bodies to be implemented.
import type { DocState, Palette } from '../domain/types';

export const DRAFT_KEY = 'forma:draft:v1';
export const PALETTES_KEY = 'forma:palettes:v1';

type ReadStore = Pick<Storage, 'getItem'>;
type WriteStore = Pick<Storage, 'setItem' | 'removeItem'>;

export type DraftLoad = { status: 'empty' } | { status: 'ok'; doc: DocState } | { status: 'invalid'; reason: string };

export function loadDraft(_store: ReadStore): DraftLoad {
  throw new Error('not implemented');
}

/** Returns false (never throws) when storage is unavailable or full. */
export function saveDraft(_store: WriteStore, _doc: DocState): boolean {
  throw new Error('not implemented');
}

export function clearDraft(_store: WriteStore): void {
  throw new Error('not implemented');
}

/** Custom palettes re-validated on load; invalid entries are dropped. */
export function loadCustomPalettes(_store: ReadStore): Palette[] {
  throw new Error('not implemented');
}

export function saveCustomPalettes(_store: WriteStore, _palettes: readonly Palette[]): boolean {
  throw new Error('not implemented');
}
