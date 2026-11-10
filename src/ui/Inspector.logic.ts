// Pure helpers for the Inspector: Russian labels and number presentation.
import type { ColorMode, Detail, LayerRole, LayoutMode } from '../domain/types';

export const ROLE_LABEL: Record<LayerRole, string> = {
  object: 'Объект',
  background: 'Фон',
};

export const LAYOUT_LABEL: Record<LayoutMode, string> = {
  composed: 'Иллюстрация',
  title: 'С заголовком',
};

export const DETAIL_LABEL: Record<Detail, string> = {
  s: 'Упрощённая',
  l: 'Подробная',
};

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  color: 'Цветной',
  mono: 'Монохром',
};

/** Shared composition scale as a whole percentage. */
export function scalePercent(scale: number): number {
  return Math.round(scale * 100);
}

/** "1200 × 630" with real multiplication sign and thin separators between the parts. */
export function formatDimensions(width: number, height: number): string {
  return `${width} × ${height}`;
}

/** Tooltip for the "замена" chip. */
export function fallbackTitle(file: string): string {
  return `Нет точного файла — показан ближайший: ${file}`;
}

/** Number of foreground objects (echoes are decoration and not counted). */
export function countObjects(layers: readonly { role: LayerRole }[]): number {
  return layers.reduce((n, layer) => (layer.role === 'object' ? n + 1 : n), 0);
}
