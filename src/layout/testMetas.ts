// Test fixtures: realistic file metas built from public/assets/source-manifest.json (read-only).
import manifest from '../../public/assets/source-manifest.json';
import { MOTIF_IDS } from '../domain/types';
import type { AssetFileMeta, Detail, MotifId, Variant } from '../domain/types';

interface ManifestVariant {
  file: string;
  viewBox: string;
  width: number;
  height: number;
}

const objects = manifest.objects as unknown as Record<string, { variants: Record<string, ManifestVariant> }>;

function toMeta(motif: MotifId, detail: Detail, variant: Variant, v: ManifestVariant): AssetFileMeta {
  const [x = 0, y = 0, width = v.width, height = v.height] = v.viewBox.split(/\s+/).map(Number);
  return {
    file: v.file,
    motif,
    detail,
    variant,
    viewBox: { x, y, width, height },
    bounds: { x: 0, y: 0, width: v.width, height: v.height },
    colors: [],
    bytes: 1000,
    warnings: [],
  };
}

/** Every file of the bundled library as metas (40 entries). */
export function allFileMetas(): AssetFileMeta[] {
  const result: AssetFileMeta[] = [];
  for (const motif of MOTIF_IDS) {
    for (const detail of ['s', 'l'] as const) {
      for (const variant of ['main', 'background'] as const) {
        const v = objects[motif]?.variants[`${detail}-${variant}`];
        if (v) result.push(toMeta(motif, detail, variant, v));
      }
    }
  }
  return result;
}

export function metaOf(motif: MotifId, detail: Detail = 'l', variant: Variant = 'main'): AssetFileMeta {
  const found = allFileMetas().find((m) => m.motif === motif && m.detail === detail && m.variant === variant);
  if (!found) throw new Error(`no meta for ${motif}-${detail}-${variant}`);
  return found;
}

/** A varied set of motifs (wide, tall, tiny) in relevance order, with `coin` repeated for duplicates. */
export const SAMPLE_MOTIFS: readonly MotifId[] = [
  'book',
  'coin',
  'lamp',
  'headphones',
  'coin',
  'bouquet',
  'pen',
  'wallet',
];
