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

/**
 * Art zone and reserved headline zone for an artboard and layout mode.
 *
 * The art zone runs to the frame edges on purpose: like the reference illustrations, the scene is cropped by
 * the frame (compose() keeps the front objects whole and lets only the back one bleed). In `title` mode the
 * side facing the headline is a hard edge.
 */
export function getZones(artboard: Size, mode: LayoutMode): Zones {
  const { width: w, height: h } = artboard;
  const orientation = orientationOf(artboard);
  const m = Math.round(0.075 * Math.min(w, h));

  if (mode === 'title') {
    if (orientation === 'horizontal') {
      return {
        orientation,
        headlineZone: { x: m, y: m, width: 0.42 * w - m, height: h - 2 * m },
        artZone: { x: 0.46 * w, y: 0, width: 0.54 * w, height: h },
      };
    }
    const headlineHeight = (orientation === 'vertical' ? 0.28 : 0.3) * h;
    const artTop = m + headlineHeight + Math.round(0.03 * h);
    return {
      orientation,
      headlineZone: { x: m, y: m, width: w - 2 * m, height: headlineHeight },
      artZone: { x: 0, y: artTop, width: w, height: h - artTop },
    };
  }

  return { orientation, artZone: { x: 0, y: 0, width: w, height: h }, headlineZone: null };
}
