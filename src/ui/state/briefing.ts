import { resolveAsset, variantForLayer } from '../../assets/availability';
import { createDoc, docFromMotifs } from '../../doc/doc';
import type {
  AssetFileMeta,
  BriefMode,
  DemoPreset,
  Detail,
  DocState,
  InputIssue,
  Layer,
  LayoutMode,
  MotifId,
} from '../../domain/types';
import { MOTIFS } from '../../domain/motifs';
import { analyzeTitle } from '../../semantics/analyzeTitle';
import { parseNames } from '../../semantics/parseNames';
import { formatCountedList } from '../util/text';
import type { BriefResult } from './editorContext';

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
  composed: 'Иллюстрация',
  title: 'С заголовком',
};

/** Max motifs picked from a free-form title. */
const TITLE_MOTIF_LIMIT = 3;

export function motifName(id: MotifId): string {
  return MOTIFS[id]?.name ?? id;
}

export function layerName(layer: Pick<Layer, 'motif' | 'role'>): string {
  const name = motifName(layer.motif);
  return layer.role === 'background' ? `${name} · фон` : name;
}

export interface BriefAnalysis {
  motifs: MotifId[];
  result: BriefResult;
}

/** Run the semantic analysis matching the brief mode. */
export function analyseBrief(text: string, mode: BriefMode, available: ReadonlySet<MotifId>): BriefAnalysis {
  if (mode === 'title') {
    const analysis = analyzeTitle(text, available, { max: TITLE_MOTIF_LIMIT });
    return { motifs: analysis.selected, result: { mode: 'title', analysis } };
  }
  const parse = parseNames(text, available);
  return { motifs: parse.motifs, result: { mode: 'names', parse } };
}

export function briefIssues(result: BriefResult): InputIssue[] {
  return result.mode === 'title' ? result.analysis.issues : result.parse.issues;
}

/** Most useful message for a brief that produced nothing: first error, then warning, then anything. */
export function firstProblemMessage(result: BriefResult): string | null {
  const issues = briefIssues(result);
  const issue =
    issues.find((i) => i.level === 'error') ?? issues.find((i) => i.level === 'warning') ?? issues[0];
  return issue?.message ?? null;
}

export function emptyBriefMessage(mode: BriefMode, text: string): string {
  if (!text.trim()) {
    return mode === 'title' ? 'Введите заголовок — по нему подберутся объекты' : 'Введите названия объектов через запятую';
  }
  return 'Не удалось подобрать объекты — уточните задание';
}

export function composedMessage(motifs: readonly MotifId[], layout: LayoutMode): string {
  const names = formatCountedList(motifs.map(motifName));
  return `Собрано: ${names} — компоновка «${LAYOUT_LABELS[layout]}»`;
}

/** Motifs of the document that have no exact file for `detail` (they are drawn with the nearest variant). */
export function motifsWithoutDetail(doc: DocState, files: readonly AssetFileMeta[], detail: Detail): MotifId[] {
  const lacking = new Set<MotifId>();
  for (const layer of doc.layers) {
    const resolved = resolveAsset(files, layer.motif, detail, variantForLayer(layer.role, doc.colorMode));
    if (resolved && !resolved.exact) lacking.add(layer.motif);
  }
  return [...lacking];
}

export function detailFallbackMessage(motifs: readonly MotifId[], detail: Detail): string {
  const kind = detail === 'l' ? 'подробной' : 'упрощённой';
  return `Нет ${kind} версии: ${motifs.map(motifName).join(', ')} — используется ближайший вариант`;
}

/** Document for a demo preset plus the analysis that explains it. */
export function buildDemo(
  preset: DemoPreset,
  files: readonly AssetFileMeta[],
  available: ReadonlySet<MotifId>,
): { doc: DocState; brief: BriefResult } {
  const { motifs, result } = analyseBrief(preset.brief.text, preset.brief.mode, available);
  const base: DocState = {
    ...createDoc(),
    preset: preset.preset,
    layout: preset.layout,
    detail: preset.detail,
    paletteId: preset.paletteId,
    colorMode: preset.colorMode,
    backgroundObjects: preset.backgroundObjects,
    showPlane: preset.showPlane,
    brief: { mode: preset.brief.mode, text: preset.brief.text },
    headline: preset.brief.mode === 'title' ? preset.brief.text.trim() : '',
  };
  return { doc: docFromMotifs(base, motifs, files), brief: result };
}
