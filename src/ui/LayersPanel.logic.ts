// Pure helpers for the layers list. The document stores z-order bottom-first; the panel shows top-first.
import type { Layer } from '../domain/types';

/** Layers as displayed: top-most first. */
export function displayOrder(layers: readonly Layer[]): Layer[] {
  return [...layers].reverse();
}

export type ListKeyIntent =
  | { kind: 'select'; index: number }
  | { kind: 'reorder'; direction: 'up' | 'down' }
  | { kind: 'remove' }
  | { kind: 'toggle' }
  | null;

interface KeyInfo {
  key: string;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

/** Maps a key press on the focused row to an intent. `index` is the display index of the focused row. */
export function listKeyIntent(event: KeyInfo, index: number, count: number): ListKeyIntent {
  if (count === 0 || event.metaKey || event.ctrlKey) return null;
  switch (event.key) {
    case 'ArrowUp':
      return event.altKey ? { kind: 'reorder', direction: 'up' } : { kind: 'select', index: Math.max(0, index - 1) };
    case 'ArrowDown':
      return event.altKey
        ? { kind: 'reorder', direction: 'down' }
        : { kind: 'select', index: Math.min(count - 1, index + 1) };
    case 'Home':
      return { kind: 'select', index: 0 };
    case 'End':
      return { kind: 'select', index: count - 1 };
    case 'Delete':
    case 'Backspace':
      return { kind: 'remove' };
    case ' ':
    case 'Spacebar':
      return { kind: 'toggle' };
    default:
      return null;
  }
}

/** Display index (0 = top) after moving a row one step in the given direction, clamped to the list. */
export function movedIndex(index: number, direction: 'up' | 'down', count: number): number {
  return direction === 'up' ? Math.max(0, index - 1) : Math.min(count - 1, index + 1);
}

/** «Букет — слой 2 из 4» (position counted from the top, as the list is displayed). */
export function reorderAnnouncement(name: string, displayIndex: number, count: number): string {
  return `${name} — слой ${displayIndex + 1} из ${count}`;
}

/** Row text: echoes get an «эхо» suffix. */
export function layerRowName(name: string, role: Layer['role']): string {
  return role === 'background' ? `${name} · эхо` : name;
}

/** Row to select after removing the row at `index` (the one below, else the one above), or null if none left. */
export function neighbourAfterRemove(order: readonly Layer[], index: number): string | null {
  return order[index + 1]?.id ?? order[index - 1]?.id ?? null;
}

/** Which row owns the single roving tab stop: the selected one, otherwise the first. */
export function tabStopId(order: readonly Layer[], selectedId: string | null): string | null {
  if (selectedId && order.some((layer) => layer.id === selectedId)) return selectedId;
  return order[0]?.id ?? null;
}
