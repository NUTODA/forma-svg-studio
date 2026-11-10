import type { ArtboardPreset, ArtboardPresetId, Box, LayoutMode, Orientation, Size, Zones } from '../domain/types';

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
export function getZones(artboard: Size, mode: LayoutMode, headlineBox?: Box | null): Zones {
  const { width: w, height: h } = artboard;
  const orientation = orientationOf(artboard);
  const m = Math.round(0.075 * Math.min(w, h));

  if (mode === 'title' && headlineBox) {
    const headlineZone = headlineZoneFrom(headlineBox, artboard);
    return { orientation, headlineZone, artZone: artZoneAround(headlineZone, artboard) };
  }

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

/** Smallest hand-set headline zone, as a share of each artboard side. */
export const MIN_HEADLINE_SHARE = 0.12;

/** A fractional headline box, clamped to sensible limits, in artboard units. */
export function headlineZoneFrom(box: Box, artboard: Size): Box {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  const width = clamp(box.width, MIN_HEADLINE_SHARE, 1);
  const height = clamp(box.height, MIN_HEADLINE_SHARE, 1);
  const x = clamp(box.x, 0, 1 - width);
  const y = clamp(box.y, 0, 1 - height);
  return { x: x * artboard.width, y: y * artboard.height, width: width * artboard.width, height: height * artboard.height };
}

/** The headline zone of an artboard as fractions (the inverse of `headlineZoneFrom`). */
export function headlineBoxOf(zone: Box, artboard: Size): Box {
  return {
    x: zone.x / artboard.width,
    y: zone.y / artboard.height,
    width: zone.width / artboard.width,
    height: zone.height / artboard.height,
  };
}

/**
 * Where the scene goes when the headline zone is set by hand: the largest strip of the frame beside it
 * (left, right, above or below), running to the frame edges like the default layouts, with a small gap.
 */
export function artZoneAround(zone: Box, artboard: Size): Box {
  const { width: w, height: h } = artboard;
  const gap = Math.round(0.03 * Math.min(w, h));
  const strips: Box[] = [
    { x: 0, y: 0, width: zone.x - gap, height: h },
    { x: zone.x + zone.width + gap, y: 0, width: w - (zone.x + zone.width + gap), height: h },
    { x: 0, y: 0, width: w, height: zone.y - gap },
    { x: 0, y: zone.y + zone.height + gap, width: w, height: h - (zone.y + zone.height + gap) },
  ];
  const best = strips.reduce((a, b) => (Math.max(0, b.width) * Math.max(0, b.height) > Math.max(0, a.width) * Math.max(0, a.height) ? b : a));
  // A zone that covers almost the whole frame still leaves the scene a sliver to sit in.
  const minSide = 0.1 * Math.min(w, h);
  return { ...best, width: Math.max(minSide, best.width), height: Math.max(minSide, best.height) };
}
