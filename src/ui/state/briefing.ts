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
import { readBrief } from '../../semantics/briefMode';
import { applyLlmPick, needsLlm, type LlmPick } from '../../semantics/llm';
import { MAX_LIST_OBJECTS, parseNames } from '../../semantics/parseNames';
import { objectsCountLabel } from '../briefFormat';
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

/** Run the semantic analysis of a known kind of brief (demos state theirs; typed text goes through `analyseInput`). */
export function analyseBrief(text: string, mode: BriefMode, available: ReadonlySet<MotifId>): BriefAnalysis {
  if (mode === 'title') {
    const analysis = analyzeTitle(text, available, { max: TITLE_MOTIF_LIMIT });
    return { motifs: analysis.selected, result: { mode: 'title', analysis } };
  }
  const parse = parseNames(text, available);
  return { motifs: parse.motifs, result: { mode: 'names', parse } };
}

/**
 * Analyse text typed into the one input: an explicit list of objects is built as written (every object,
 * quantities included), anything else is interpreted as a title.
 */
export function analyseInput(text: string, available: ReadonlySet<MotifId>): BriefAnalysis {
  const { mode, parse } = readBrief(text, available);
  return mode === 'names'
    ? { motifs: parse.motifs, result: { mode, parse } }
    : analyseBrief(text, mode, available);
}

/** What a run does: the rule-based reading, and whether the model is worth asking about it. */
export interface BriefPlan {
  analysis: BriefAnalysis;
  askLlm: boolean;
}

/**
 * The model reads titles and metaphors only. A list names its objects itself: it never leaves the
 * browser and is never cut down to what a model picks, so it composes the same with a model and without.
 */
export function planBrief(text: string, available: ReadonlySet<MotifId>, llmOn: boolean): BriefPlan {
  const analysis = analyseInput(text, available);
  const { result } = analysis;
  return { analysis, askLlm: llmOn && result.mode === 'title' && needsLlm(result.analysis) };
}

export interface ComposedBrief extends BriefAnalysis {
  /** Background object the model chose for the title's meaning. */
  scenery?: MotifId;
}

/** Merges the model's answer into a title reading; a list and a missing answer stay as the rules read them. */
export function withLlmPick(analysis: BriefAnalysis, pick: LlmPick | null | undefined): ComposedBrief {
  const { result } = analysis;
  if (!pick || result.mode !== 'title') return analysis;
  const merged = applyLlmPick(result.analysis, pick);
  return {
    motifs: merged.selected,
    result: { mode: 'title', analysis: merged },
    ...(pick.scenery ? { scenery: pick.scenery } : {}),
  };
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

export function emptyBriefMessage(text: string): string {
  return text.trim()
    ? 'Не удалось подобрать объекты — уточните задание'
    : 'Введите заголовок или список объектов через запятую';
}

export function composedMessage(motifs: readonly MotifId[], layout: LayoutMode): string {
  const names = formatCountedList(motifs.map(motifName));
  return `Собрано ${objectsCountLabel(motifs.length)}: ${names} — компоновка «${LAYOUT_LABELS[layout]}»`;
}

/** Names from a list that did not make it into the composition: unknown to the library, or without files. */
export function skippedFromList(result: BriefResult): string[] {
  if (result.mode !== 'names') return [];
  return result.parse.entries
    .filter((entry) => entry.status === 'unmatched' || entry.status === 'unavailable')
    .map((entry) => `«${entry.raw}»`);
}

/** The status line after a run: how many objects were composed and, for a list, what was left out and why. */
export function composedStatus(
  result: BriefResult,
  motifs: readonly MotifId[],
  layout: LayoutMode,
): { text: string; level: 'success' | 'warning' } {
  const skipped = skippedFromList(result);
  const capped = result.mode === 'names' && result.parse.issues.some((issue) => issue.code === 'too-many');
  const notes: string[] = [];
  if (skipped.length > 0) notes.push(`Не вошло: ${skipped.join(', ')}`);
  if (capped) notes.push(`Лишнее не поместилось: в композиции не больше ${MAX_LIST_OBJECTS} объектов`);
  const text = composedMessage(motifs, layout);
  return notes.length === 0 ? { text, level: 'success' } : { text: `${text}. ${notes.join('. ')}`, level: 'warning' };
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
