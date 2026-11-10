import { PAINT_ROLES } from '../domain/types';
import type { PaintRole, SourcePaletteId } from '../domain/types';
import { hexToOklab, normalizeHex, oklabDistance } from './color';
import type { Lab } from './color';

export interface RoleInfo {
  /** Russian short label, e.g. «Акцент». */
  label: string;
  /** Russian description of where the role is used. */
  description: string;
  group: 'artboard' | 'background' | 'objects';
}

export const ROLE_INFO: Record<PaintRole, RoleInfo> = {
  paper: {
    label: 'Бумага',
    description: 'Цвет артборда, когда плоскость выключена.',
    group: 'artboard',
  },
  tint: {
    label: 'Светлый фон',
    description: 'Заливки фоновых вариантов и плоскости.',
    group: 'background',
  },
  tone: {
    label: 'Средний тон',
    description: 'Средние тона плоскости и фоновых вариантов.',
    group: 'background',
  },
  deep: {
    label: 'Глубокий тон',
    description: 'Линии фоновых вариантов, акцентные плоскости.',
    group: 'background',
  },
  ink: {
    label: 'Контур',
    description: 'Линии и тени объектов.',
    group: 'background',
  },
  highlight: {
    label: 'Блик',
    description: 'Тёплый акцент: блики и яркие детали объектов.',
    group: 'objects',
  },
  accent: {
    label: 'Акцент',
    description: 'Главный цветовой акцент объектов.',
    group: 'objects',
  },
  accentSoft: {
    label: 'Мягкий акцент',
    description: 'Приглушённая версия акцента: крупные мягкие заливки.',
    group: 'objects',
  },
  light: {
    label: 'Белый',
    description: 'Блики и светлые детали.',
    group: 'objects',
  },
};

type SwatchList = readonly [string, string, string, string];

function buildColors(background: SwatchList, objects: SwatchList): Record<PaintRole, string> {
  const [tint, tone, deep, ink] = background;
  const [highlight, accent, accentSoft, light] = objects;
  return { paper: '#ffffff', tint, tone, deep, ink, highlight, accent, accentSoft, light };
}

/**
 * Exact swatches of the three Figma palettes (public/assets/source-manifest.json), per role.
 * `paper` is not a Figma swatch: it is the artboard colour when the plane is off.
 */
export const SOURCE_PALETTES: Record<SourcePaletteId, { name: string; colors: Record<PaintRole, string> }> = {
  lavender: {
    name: 'Сирень',
    colors: buildColors(
      ['#d7cdf5', '#aa9bf0', '#7864d7', '#181817'],
      ['#f9ecb0', '#f9a3aa', '#ffe3e1', '#ffffff'],
    ),
  },
  peach: {
    name: 'Персик',
    colors: buildColors(
      ['#fdd7b9', '#fac896', '#d27532', '#181817'],
      ['#f9ecb0', '#80dada', '#beebeb', '#ffffff'],
    ),
  },
  mint: {
    name: 'Мята',
    colors: buildColors(
      ['#beebeb', '#80dada', '#5abebe', '#181817'],
      ['#ffd4f2', '#6d7bfc', '#b6c6fe', '#ffffff'],
    ),
  },
};

interface Reference {
  role: PaintRole;
  hex: string;
  lab: Lab;
}

/** Roles that can be matched (everything but paper), in PAINT_ROLES order. */
const MATCHABLE_ROLES = PAINT_ROLES.filter((role) => role !== 'paper');

function buildReferences(id: SourcePaletteId): Reference[] {
  return MATCHABLE_ROLES.map((role) => {
    const hex = SOURCE_PALETTES[id].colors[role];
    const lab = hexToOklab(hex);
    if (!lab) throw new Error(`Invalid built-in swatch ${hex}`);
    return { role, hex, lab };
  });
}

const REFERENCES: Record<SourcePaletteId, Reference[]> = {
  lavender: buildReferences('lavender'),
  peach: buildReferences('peach'),
  mint: buildReferences('mint'),
};

/**
 * Role of a source colour in its source palette: exact swatch match first (the first role in
 * PAINT_ROLES order wins when two share a hex), otherwise nearest swatch in OKLab (paper excluded).
 */
export function classifyColor(hex: string, source: SourcePaletteId): { role: PaintRole; reference: string; exact: boolean } {
  const candidates = REFERENCES[source];
  const normalized = normalizeHex(hex);
  const exact = candidates.find((c) => c.hex === normalized);
  if (exact) return { role: exact.role, reference: exact.hex, exact: true };

  const lab = normalized ? hexToOklab(normalized) : null;
  let best = candidates[0];
  if (!best) throw new Error('No reference swatches');
  if (lab) {
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = oklabDistance(lab, candidate.lab);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return { role: best.role, reference: best.hex, exact: false };
}
