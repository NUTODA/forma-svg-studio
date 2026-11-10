import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
// Modules reachable from vite.config.ts use explicit `.ts` extensions so the config also loads natively in Node.
import { parseAssetFileName, parsePlaneFileName } from '../src/assets/availability.ts';
import { MOTIF_IDS, SOURCE_PALETTE_IDS, type AssetFileMeta, type AssetManifest, type PlaneFileMeta } from '../src/domain/types.ts';
import { analyzeSvgSource } from '../src/svg/template.ts';

const NAME_HINT =
  'ожидается <id>-<s|l>-<main|background>.svg или plane-<lavender|peach|mint>-<s|l>.svg (строчными буквами)';

const detailOrder = (detail: 's' | 'l'): number => (detail === 's' ? 0 : 1);
const variantOrder = (variant: 'main' | 'background'): number => (variant === 'main' ? 0 : 1);

function compareMetas(a: AssetFileMeta, b: AssetFileMeta): number {
  return (
    MOTIF_IDS.indexOf(a.motif) - MOTIF_IDS.indexOf(b.motif) ||
    detailOrder(a.detail) - detailOrder(b.detail) ||
    variantOrder(a.variant) - variantOrder(b.variant)
  );
}

function comparePlanes(a: PlaneFileMeta, b: PlaneFileMeta): number {
  return (
    SOURCE_PALETTE_IDS.indexOf(a.palette) - SOURCE_PALETTE_IDS.indexOf(b.palette) ||
    detailOrder(a.detail) - detailOrder(b.detail)
  );
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Scans a folder (non-recursive) of bundled SVGs with the same analysis the browser uses. */
export function scanAssets(dir: string): AssetManifest {
  const files: AssetFileMeta[] = [];
  const planes: PlaneFileMeta[] = [];
  const ignored: { file: string; reason: string }[] = [];

  for (const file of listFiles(dir)) {
    if (path.extname(file).toLowerCase() !== '.svg') continue;
    const asset = parseAssetFileName(file);
    const plane = asset ? null : parsePlaneFileName(file);
    if (!asset && !plane) {
      ignored.push({ file, reason: `Имя не соответствует шаблону: ${NAME_HINT}` });
      continue;
    }

    const fullPath = path.join(dir, file);
    let analysis: ReturnType<typeof analyzeSvgSource>;
    try {
      analysis = analyzeSvgSource(readFileSync(fullPath, 'utf8'));
    } catch (error) {
      ignored.push({ file, reason: `Файл не прошёл проверку: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }

    const common = {
      file,
      viewBox: analysis.viewBox,
      bounds: analysis.bounds,
      colors: analysis.colors,
      bytes: statSync(fullPath).size,
      warnings: analysis.warnings,
    };
    if (asset) files.push({ ...common, motif: asset.motif, detail: asset.detail, variant: asset.variant });
    else if (plane) planes.push({ ...common, palette: plane.palette, detail: plane.detail });
  }

  files.sort(compareMetas);
  planes.sort(comparePlanes);
  return { files, planes, ignored };
}
