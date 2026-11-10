import type { ArtboardPreset, ArtboardPresetId, LayoutMode, Orientation, Size, Zones } from '../domain/types';

// Non-breaking space keeps «4 : 5» and «1200 × 630» on one line.
const NBSP = ' ';

export const ARTBOARD_PRESETS: Record<ArtboardPresetId, ArtboardPreset> = {
  square: { id: 'square', label: 'Квадрат', width: 1080, height: 1080, hint: `Соцсети, 1${NBSP}:${NBSP}1` },
  portrait: {
    id: 'portrait',
    label: `Портрет 4${NBSP}:${NBSP}5`,
    width: 1080,
    height: 1350,
    hint: `Лента, 4${NBSP}:${NBSP}5`,
  },
  og: { id: 'og', label: 'Обложка', width: 1200, height: 630, hint: `Превью ссылки, 1200${NBSP}×${NBSP}630` },
};

export function orientationOf(size: Size): Orientation {
  const ratio = size.width / size.height;
  if (ratio > 1.15) return 'horizontal';
  if (ratio < 0.87) return 'vertical';
  return 'square';
}

/** Art zone and reserved headline zone for an artboard and layout mode. */
export function getZones(artboard: Size, mode: LayoutMode): Zones {
  const { width: w, height: h } = artboard;
  const orientation = orientationOf(artboard);
  const m = Math.round(0.075 * Math.min(w, h));

  if (mode === 'offset') {
    const bleed = Math.round(0.035 * Math.min(w, h));
    const x0 = orientation === 'horizontal' ? 0.4 * w : orientation === 'vertical' ? m : 0.3 * w;
    const y0 = orientation === 'horizontal' ? m : orientation === 'vertical' ? 0.36 * h : 0.3 * h;
    return {
      orientation,
      artZone: { x: x0, y: y0, width: w + bleed - x0, height: h + bleed - y0 },
      headlineZone: null,
    };
  }

  if (mode === 'title') {
    if (orientation === 'horizontal') {
      return {
        orientation,
        headlineZone: { x: m, y: m, width: 0.42 * w - m, height: h - 2 * m },
        artZone: { x: 0.48 * w, y: m, width: 0.52 * w - m, height: h - 2 * m },
      };
    }
    const headlineHeight = (orientation === 'vertical' ? 0.3 : 0.32) * h;
    const gap = Math.round(0.03 * h);
    const artTop = m + headlineHeight + gap;
    return {
      orientation,
      headlineZone: { x: m, y: m, width: w - 2 * m, height: headlineHeight },
      artZone: { x: m, y: artTop, width: w - 2 * m, height: h - m - artTop },
    };
  }

  return {
    orientation,
    artZone: { x: m, y: m, width: w - 2 * m, height: h - 2 * m },
    headlineZone: null,
  };
}
