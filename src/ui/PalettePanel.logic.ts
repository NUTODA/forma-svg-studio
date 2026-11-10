// Pure helpers for the palette panel and the import dialog.
import type { PaintRole, Palette } from '../domain/types';

/** The five swatches shown in each palette option. */
export const PREVIEW_ROLES: readonly PaintRole[] = ['tint', 'tone', 'deep', 'accent', 'highlight'];

/** Built-in palettes first, then custom ones; relative order is otherwise preserved. */
export function orderPalettes(palettes: readonly Palette[]): Palette[] {
  return [...palettes.filter((p) => p.builtIn), ...palettes.filter((p) => !p.builtIn)];
}

/** Radio-group key handling: arrows wrap around, Home/End jump. Returns the next index or null if the key is not handled. */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowUp':
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export const ROLE_GROUP_LABEL: Record<'artboard' | 'background' | 'objects', string> = {
  artboard: 'Холст',
  background: 'Фон',
  objects: 'Объекты',
};

export function roleGroupLabel(group: string): string {
  return group in ROLE_GROUP_LABEL ? ROLE_GROUP_LABEL[group as keyof typeof ROLE_GROUP_LABEL] : group;
}

/** Copy via the async clipboard API, then the legacy `execCommand` path. Resolves to whether it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path (permissions, insecure context).
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
