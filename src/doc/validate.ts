import { MOTIF_IDS } from '../domain/types';
import type {
  ArtboardPresetId,
  BriefMode,
  ColorMode,
  Detail,
  DocState,
  Layer,
  LayerRole,
  LayoutMode,
  MotifId,
} from '../domain/types';

export const MAX_LAYERS = 500;
export const MAX_BRIEF_CHARS = 2000;
export const MAX_HEADLINE_CHARS = 500;
export const MAX_ID_CHARS = 64;
export const MAX_COORD = 1_000_000;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const PRESETS: readonly ArtboardPresetId[] = ['square', 'portrait', 'og'];
const DETAILS: readonly Detail[] = ['s', 'l'];
const LAYOUTS: readonly LayoutMode[] = ['composed', 'title'];
const COLOR_MODES: readonly ColorMode[] = ['color', 'mono'];
const BRIEF_MODES: readonly BriefMode[] = ['title', 'names'];
const ROLES: readonly LayerRole[] = ['object', 'background'];

type Rec = Record<string, unknown>;

function isPlainObject(value: unknown): value is Rec {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Own, non-forbidden properties only: inherited values are never trusted. */
function own(obj: Rec, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function hasForbiddenKey(obj: Rec): boolean {
  return Object.getOwnPropertyNames(obj).some((k) => FORBIDDEN_KEYS.has(k));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' ? (allowed.find((a) => a === value) ?? null) : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

/** Numeric part of an id like `l12`, or null. */
export function numericId(id: string): number | null {
  const m = /^l(\d{1,9})$/.exec(id);
  return m ? Number(m[1]) : null;
}

function validateLayer(raw: unknown): Layer | null {
  if (!isPlainObject(raw) || hasForbiddenKey(raw)) return null;
  const id = text(own(raw, 'id'), MAX_ID_CHARS);
  const motif: MotifId | null = oneOf(own(raw, 'motif'), MOTIF_IDS);
  const role = oneOf(own(raw, 'role'), ROLES);
  const x = finite(own(raw, 'x'));
  const y = finite(own(raw, 'y'));
  const rotation = finite(own(raw, 'rotation'));
  const size = finite(own(raw, 'size'));
  const rank = finite(own(raw, 'rank'));
  const hidden = own(raw, 'hidden');
  if (!id || id.length === 0 || !motif || !role) return null;
  if (x === null || y === null || rotation === null || size === null || rank === null) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD || Math.abs(rank) > MAX_COORD) return null;
  if (!(rotation > -360 && rotation < 360)) return null;
  if (!(size > 0 && size < 10000)) return null;
  if (hidden !== undefined && typeof hidden !== 'boolean') return null;
  const layer: Layer = { id, motif, role, x, y, rotation, size, rank };
  if (hidden === true) layer.hidden = true;
  return layer;
}

function validateLayers(raw: unknown): Layer[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_LAYERS) return null;
  const layers: Layer[] = [];
  const seen = new Set<string>();
  for (const item of raw as unknown[]) {
    const layer = validateLayer(item);
    if (!layer || seen.has(layer.id)) return null;
    seen.add(layer.id);
    layers.push(layer);
  }
  return layers;
}

function validateBrief(raw: unknown): DocState['brief'] | null {
  if (!isPlainObject(raw) || hasForbiddenKey(raw)) return null;
  const mode = oneOf(own(raw, 'mode'), BRIEF_MODES);
  const body = text(own(raw, 'text'), MAX_BRIEF_CHARS);
  return mode && body !== null ? { mode, text: body } : null;
}

/** Strict structural validation for persisted drafts; returns a fresh sanitised copy or null. */
export function validateDoc(value: unknown): DocState | null {
  if (!isPlainObject(value) || hasForbiddenKey(value)) return null;
  if (own(value, 'version') !== 1) return null;

  const preset = oneOf(own(value, 'preset'), PRESETS);
  const detail = oneOf(own(value, 'detail'), DETAILS);
  // Drafts from before the two layouts were merged may still say 'offset'.
  const rawLayout = own(value, 'layout');
  const layout = oneOf(rawLayout === 'offset' ? 'composed' : rawLayout, LAYOUTS);
  const colorMode = oneOf(own(value, 'colorMode'), COLOR_MODES);
  const paletteId = text(own(value, 'paletteId'), MAX_ID_CHARS);
  const headline = text(own(value, 'headline'), MAX_HEADLINE_CHARS);
  const brief = validateBrief(own(value, 'brief'));
  const layers = validateLayers(own(value, 'layers'));
  const nextId = finite(own(value, 'nextId'));
  const backgroundObjects = own(value, 'backgroundObjects');
  const showPlane = own(value, 'showPlane');
  const showHeadline = own(value, 'showHeadline');

  if (!preset || !detail || !layout || !colorMode || !paletteId || headline === null || !brief || !layers) return null;
  if (typeof backgroundObjects !== 'boolean' || typeof showPlane !== 'boolean' || typeof showHeadline !== 'boolean') {
    return null;
  }
  if (nextId === null || !Number.isInteger(nextId) || nextId < 1 || nextId > MAX_COORD) return null;

  const maxNumeric = layers.reduce((max, l) => Math.max(max, numericId(l.id) ?? 0), 0);
  if (nextId <= maxNumeric) return null;

  return {
    version: 1,
    preset,
    detail,
    layout,
    colorMode,
    paletteId,
    backgroundObjects,
    showPlane,
    showHeadline,
    headline,
    brief,
    layers,
    nextId,
  };
}
