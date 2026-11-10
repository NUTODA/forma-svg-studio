/** Pure geometry and copy helpers for the artboard (kept DOM-free so they can be unit-tested). */
import type { Box, Layer, LayerRole, Size } from '../domain/types';
import { MIN_HEADLINE_SHARE } from '../layout/zones';

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 1;
/** Screen distance of the rotation handle above the selection frame, in CSS px. */
export const ROTATE_HANDLE_OFFSET = 24;
export const ROTATE_SNAP_DEG = 15;
/** Pointer travel (CSS px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;

const NBSP = ' ';

export interface Point {
  x: number;
  y: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f + 0;
}

/** Largest zoom (at most `MAX_ZOOM`) that fits the artboard into the available area. */
export function fitScale(avail: Size, artboard: Size): number {
  if (avail.width <= 0 || avail.height <= 0 || artboard.width <= 0 || artboard.height <= 0) return MIN_ZOOM;
  return clamp(Math.min(avail.width / artboard.width, avail.height / artboard.height), MIN_ZOOM, MAX_ZOOM);
}

/** Zoom readout such as «54 %», with a non-breaking space. */
export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}${NBSP}%`;
}

/** Russian plural form: `pluralRu(2, 'объект', 'объекта', 'объектов')`. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** «Обложка · 1200 × 630»: the preset label gets the size unless it already carries it. */
export function artboardCaption(label: string, size: Size): string {
  const hasSize = label.includes(String(size.width)) && label.includes(String(size.height));
  return hasSize ? label : `${label} · ${size.width}${NBSP}×${NBSP}${size.height}`;
}

export interface SelectionFrame {
  /** Centre in artboard units. */
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/** Rotated rectangle of a layer's painted bounds: height = size, width follows the source aspect. */
export function selectionFrame(layer: Pick<Layer, 'x' | 'y' | 'size' | 'rotation'>, bounds: Box): SelectionFrame {
  const aspect = bounds.height > 0 ? bounds.width / bounds.height : 1;
  return { cx: layer.x, cy: layer.y, width: layer.size * aspect, height: layer.size, rotation: layer.rotation };
}

/** Client px to artboard units, for an element whose bounding rect maps onto the whole artboard. */
export function clientToArtboard(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  artboard: Size,
): Point {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: ((client.x - rect.left) * artboard.width) / rect.width,
    y: ((client.y - rect.top) * artboard.height) / rect.height,
  };
}

/** Shift-drag: keep only the dominant axis. */
export function constrainAxis(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/** Normalise degrees to the range (-180, 180]. */
export function normalizeAngle(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return (wrapped > 180 ? wrapped - 360 : wrapped) + 0;
}

/** Direction of `point` seen from `centre` in degrees: 0 is straight up, clockwise is positive. */
export function angleAbout(centre: Point, point: Point): number {
  return (Math.atan2(point.x - centre.x, -(point.y - centre.y)) * 180) / Math.PI;
}

export interface RotationDrag {
  centre: Point;
  /** Pointer position (artboard units) when the gesture began. */
  start: Point;
  current: Point;
  startRotation: number;
  snap: boolean;
}

/** New rotation in degrees: the start rotation plus the angle swept about the centre, optionally snapped to 15°. */
export function rotationFromDrag(drag: RotationDrag): number {
  const swept = angleAbout(drag.centre, drag.current) - angleAbout(drag.centre, drag.start);
  const raw = drag.startRotation + swept;
  const value = drag.snap ? Math.round(raw / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG : raw;
  return round(normalizeAngle(value), 2);
}

export const HEADLINE_LINE_HEIGHT = 1.08;
/** Average advance of a Literata Cyrillic glyph in em (deliberately a little generous). */
const HEADLINE_CHAR_EM = 0.68;
const HEADLINE_SPACE_EM = 0.25;
const HEADLINE_MAX_LINES = 3;
const HEADLINE_MIN_SIZE = 12;

/** Greedy word-wrap estimate of how many lines `text` takes at `fontSize` in a box `width` wide. */
export function estimateLineCount(text: string, fontSize: number, width: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || width <= 0) return 1;
  const charWidth = HEADLINE_CHAR_EM * fontSize;
  const spaceWidth = HEADLINE_SPACE_EM * fontSize;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = word.length * charWidth;
    if (w > width) {
      // An over-long word is broken across lines.
      const rows = Math.ceil(w / width);
      lines += used > 0 ? rows : rows - 1;
      used = w - (rows - 1) * width;
    } else if (used === 0) {
      used = w;
    } else if (used + spaceWidth + w <= width) {
      used += spaceWidth + w;
    } else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/** Share of the zone height the text may use; the rest keeps the «Зона заголовка» tag clear. */
const HEADLINE_USABLE_HEIGHT = 0.78;
/** Upper bound relative to the zone width, so a short title in a tall zone stays a headline, not a poster. */
const HEADLINE_MAX_WIDTH_RATIO = 1 / 8;

/**
 * Font size (artboard units) for the headline guide: the largest size at which the text takes at
 * most three lines and fits the usable part of the zone, never above the size where two lines
 * would fill the zone or the width cap.
 */
export function headlineFontSize(text: string, zone: Pick<Box, 'width' | 'height'>): number {
  const usable = zone.height * HEADLINE_USABLE_HEIGHT;
  // The longest word must fit on one line: words are never broken mid-word.
  const longestWord = Math.max(1, ...text.split(/\s+/).map((w) => w.length));
  let size = Math.max(
    Math.min(
      zone.height / (2 * HEADLINE_LINE_HEIGHT),
      zone.width * HEADLINE_MAX_WIDTH_RATIO,
      zone.width / (longestWord * HEADLINE_CHAR_EM),
    ),
    HEADLINE_MIN_SIZE,
  );
  while (size > HEADLINE_MIN_SIZE) {
    const lines = estimateLineCount(text, size, zone.width);
    if (lines <= HEADLINE_MAX_LINES && lines * HEADLINE_LINE_HEIGHT * size <= usable) break;
    size *= 0.96;
  }
  return round(Math.max(size, HEADLINE_MIN_SIZE), 1);
}

const ROLE_LABEL: Record<LayerRole, string> = { object: 'объект', background: 'фон' };

/** «Букет, объект, слой 3 из 4». */
export function layerAriaLabel(name: string, role: LayerRole, position: number, total: number): string {
  return `${name}, ${ROLE_LABEL[role]}, слой${NBSP}${position}${NBSP}из${NBSP}${total}`;
}

/** Index of the radio to focus after an arrow/Home/End key, or null for any other key. */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Which part of the headline zone is dragged: the body moves it, a corner resizes it. */
export type ZoneGrip = 'body' | 'nw' | 'ne' | 'sw' | 'se';

/** The headline zone after dragging `grip` by (dx, dy): kept on the artboard and no smaller than the minimum. */
export function draggedZone(
  origin: Box,
  grip: ZoneGrip,
  dx: number,
  dy: number,
  artboard: { width: number; height: number },
): Box {
  const minW = MIN_HEADLINE_SHARE * artboard.width;
  const minH = MIN_HEADLINE_SHARE * artboard.height;
  if (grip === 'body') {
    return {
      ...origin,
      x: Math.min(artboard.width - origin.width, Math.max(0, origin.x + dx)),
      y: Math.min(artboard.height - origin.height, Math.max(0, origin.y + dy)),
    };
  }
  let x0 = origin.x;
  let y0 = origin.y;
  let x1 = origin.x + origin.width;
  let y1 = origin.y + origin.height;
  if (grip === 'nw' || grip === 'sw') x0 = Math.min(x1 - minW, Math.max(0, x0 + dx));
  else x1 = Math.max(x0 + minW, Math.min(artboard.width, x1 + dx));
  if (grip === 'nw' || grip === 'ne') y0 = Math.min(y1 - minH, Math.max(0, y0 + dy));
  else y1 = Math.max(y0 + minH, Math.min(artboard.height, y1 + dy));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
