// Pure formatting helpers shared by the brief / catalog panels (no React, easy to test).
import type {
  Box,
  Detail,
  InputIssue,
  IssueLevel,
  MatchReason,
  MatchStrength,
  MotifId,
  NameEntry,
  Variant,
} from '../domain/types';
import { MOTIFS } from '../domain/motifs';
import type { BriefResult } from './state/editorContext';

export const NBSP = ' ';

/** Display name of a motif; falls back to the id so a missing catalogue entry never breaks the UI. */
export function motifName(id: MotifId): string {
  return MOTIFS[id]?.name ?? id;
}

/** Russian plural form for `n`: forms = [1 мотив, 2 мотива, 5 мотивов]. */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n));
  const m10 = abs % 10;
  const m100 = abs % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export function motifsCountLabel(n: number): string {
  return `${n}${NBSP}${pluralRu(n, ['мотив', 'мотива', 'мотивов'])}`;
}

export function catalogNote(available: number, total: number): string | null {
  if (available >= total) return null;
  return `Доступно ${available}${NBSP}из${NBSP}${total}${NBSP}мотивов — остальные появятся, когда их файлы будут добавлены`;
}

/* ---------------- Analysis ---------------- */

export function strengthBars(strength: MatchStrength): 1 | 2 | 3 {
  return strength === 'strong' ? 3 : strength === 'medium' ? 2 : 1;
}

export function strengthLabel(strength: MatchStrength): string {
  return strength === 'strong'
    ? 'сильное совпадение'
    : strength === 'medium'
      ? 'среднее совпадение'
      : 'слабое совпадение';
}

/** Reasons as one muted line: unique details joined with « · ». */
export function reasonsLine(reasons: readonly MatchReason[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const r of reasons) {
    const text = r.detail.trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.join(' · ');
}

export type ChipTone = 'ok' | 'warn' | 'err' | 'neutral';

export function nameStatusChip(entry: Pick<NameEntry, 'status' | 'motif' | 'suggestion'>): {
  label: string;
  tone: ChipTone;
} {
  switch (entry.status) {
    case 'matched':
      return { label: 'найдено', tone: 'ok' };
    case 'weak': {
      const guess = entry.motif ?? entry.suggestion;
      return {
        label: guess ? `похоже на${NBSP}«${motifName(guess)}»` : 'неточное совпадение',
        tone: 'warn',
      };
    }
    case 'unavailable':
      return { label: 'нет в библиотеке', tone: 'neutral' };
    case 'unmatched':
      return { label: 'не найдено', tone: 'err' };
  }
}

export function noticeClass(level: IssueLevel): string {
  return `notice notice--${level}`;
}

export function briefIssues(brief: BriefResult): readonly InputIssue[] {
  return brief.mode === 'title' ? brief.analysis.issues : brief.parse.issues;
}

export function hasErrorIssue(brief: BriefResult | null): boolean {
  return brief ? briefIssues(brief).some((i) => i.level === 'error') : false;
}

export function namesSummary(entries: readonly NameEntry[]): string {
  if (entries.length === 0) return 'Названия не указаны';
  const ok = entries.filter((e) => e.status === 'matched' || e.status === 'weak').length;
  return `Распознано ${ok}${NBSP}из${NBSP}${entries.length}`;
}

/** Text for the polite live region: the summary plus the messages that need attention. */
export function briefAnnouncement(brief: BriefResult | null): string {
  if (!brief) return '';
  const attention = briefIssues(brief)
    .filter((i) => i.level !== 'info')
    .map((i) => i.message);
  const summary = brief.mode === 'title' ? brief.analysis.summary : namesSummary(brief.parse.entries);
  return [summary, ...attention].filter(Boolean).join('. ');
}

/* ---------------- Brief panel ---------------- */

/** Roving-tabindex arrow handling for the tablist; `null` when the key is not a navigation key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export function isMacPlatform(platform: string | undefined): boolean {
  return platform ? /mac|iphone|ipad|ipod/i.test(platform) : false;
}

export function runShortcutHint(mac: boolean): string {
  return mac ? '⌘↵' : 'Ctrl↵';
}

/* ---------------- Demo list ---------------- */

export function briefModeLabel(mode: 'title' | 'names'): string {
  return mode === 'title' ? 'Заголовок' : 'Названия';
}

/** Text as shown in a demo card, wrapped in «ёлочки». */
export function quoted(text: string): string {
  return `«${text}»`;
}

/* ---------------- Catalog / thumbnails ---------------- */

const DETAIL_NAME: Record<Detail, string> = { s: 'Упрощённая', l: 'Подробная' };
const VARIANT_NAME: Record<Variant, string> = {
  main: 'основной (цветной)',
  background: 'фоновый (монохромный)',
};

export type AvailabilityKey = `${Detail}-${Variant}`;

export const AVAILABILITY_CELLS: readonly { key: AvailabilityKey; detail: Detail; variant: Variant }[] = [
  { key: 's-main', detail: 's', variant: 'main' },
  { key: 's-background', detail: 's', variant: 'background' },
  { key: 'l-main', detail: 'l', variant: 'main' },
  { key: 'l-background', detail: 'l', variant: 'background' },
];

export function availabilityCellTitle(detail: Detail, variant: Variant, present: boolean): string {
  return `${DETAIL_NAME[detail]} детализация, ${VARIANT_NAME[variant]} вариант: ${present ? 'файл есть' : 'файла нет'}`;
}

export const FALLBACK_TITLE =
  'Для текущей детализации и цветового режима точного файла нет — показан ближайший вариант';

export function availabilityDescription(
  availability: Record<AvailabilityKey, boolean>,
  approximate: boolean,
): string {
  const yn = (key: AvailabilityKey) => (availability[key] ? 'есть' : 'нет');
  const text =
    `Файлы: упрощённая — основной ${yn('s-main')}, фон ${yn('s-background')}; ` +
    `подробная — основной ${yn('l-main')}, фон ${yn('l-background')}.`;
  return approximate ? `${text} ${FALLBACK_TITLE}.` : text;
}

/** viewBox for a thumbnail: painted bounds with 6% air on every side. */
export function thumbViewBox(bounds: Box): string {
  const pad = Math.max(bounds.width, bounds.height) * 0.06;
  const round = (n: number) => Math.round(n * 100) / 100;
  return [bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2].map(round).join(' ');
}

/** `useId()` output → valid, unique id prefix for `instantiate`. */
export function thumbIdPrefix(useId: string): string {
  return `thumb-${useId.replace(/[^A-Za-z0-9_-]/g, '_')}__`;
}
