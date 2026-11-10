import type { ReorderTarget } from '../state/editorContext';

export type ShortcutCommand =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'duplicate' }
  | { type: 'remove' }
  | { type: 'deselect' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'rotate'; deg: number }
  | { type: 'reorder'; to: ReorderTarget }
  | { type: 'save' }
  | { type: 'export' };

/** The subset of KeyboardEvent the mapping needs (keeps the function testable without a DOM). */
export interface KeyInfo {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Commands that act on the selected layer and are ignored without a selection. */
export function needsSelection(command: ShortcutCommand): boolean {
  switch (command.type) {
    case 'duplicate':
    case 'remove':
    case 'nudge':
    case 'rotate':
    case 'reorder':
      return true;
    default:
      return false;
  }
}

/**
 * Letter of a shortcut: the typed Latin letter when there is one (QWERTZ/AZERTY keep ⌘Z = undo),
 * otherwise the physical key (so the Russian layout still works: ⌘Я → Z).
 */
function letterOf(e: KeyInfo): string {
  const typed = e.key.toLowerCase();
  if (/^[a-z]$/.test(typed)) return typed;
  if (e.code?.startsWith('Key')) return e.code.slice(3).toLowerCase();
  return typed;
}

function bracketOf(e: KeyInfo): 'left' | 'right' | null {
  if (e.code === 'BracketLeft' || e.key === '[' || e.key === '{') return 'left';
  if (e.code === 'BracketRight' || e.key === ']' || e.key === '}') return 'right';
  return null;
}

const NUDGE: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Map a key press to an editor command, or null when it is not a shortcut. */
export function commandForKey(e: KeyInfo): ShortcutCommand | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  const letter = letterOf(e);
  const bracket = bracketOf(e);

  if (mod) {
    if (letter === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (letter === 'y' && !e.shiftKey) return { type: 'redo' };
    if (letter === 'd' && !e.shiftKey) return { type: 'duplicate' };
    if (letter === 's' && !e.shiftKey) return { type: 'save' };
    if (letter === 'e' && !e.shiftKey) return { type: 'export' };
    if (bracket) {
      const forward = bracket === 'right';
      if (e.shiftKey) return { type: 'reorder', to: forward ? 'top' : 'bottom' };
      return { type: 'reorder', to: forward ? 'up' : 'down' };
    }
    return null;
  }

  const nudge = NUDGE[e.key];
  if (nudge) {
    const step = e.shiftKey ? 10 : 1;
    return { type: 'nudge', dx: nudge[0] * step, dy: nudge[1] * step };
  }
  if (bracket) {
    const step = e.shiftKey ? 15 : 1;
    return { type: 'rotate', deg: bracket === 'right' ? step : -step };
  }
  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'remove' };
  if (e.key === 'Escape') return { type: 'deselect' };
  return null;
}

/** True when keystrokes in this element belong to the element itself (text entry). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** True when the target lives inside an open modal <dialog>. */
export function isInsideOpenDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('dialog[open]') !== null;
}
