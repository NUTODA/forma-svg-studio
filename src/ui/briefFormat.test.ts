import { describe, expect, it, vi } from 'vitest';

vi.mock('../domain/motifs', () => ({
  MOTIFS: {
    book: { id: 'book', name: 'Книга', description: '', aliases: [] },
    headphones: { id: 'headphones', name: 'Наушники', description: '', aliases: [] },
  },
}));

import {
  NBSP,
  availabilityDescription,
  briefAnnouncement,
  catalogNote,
  hasErrorIssue,
  isMacPlatform,
  motifsCountLabel,
  nameStatusChip,
  namesSummary,
  nextTabIndex,
  pluralRu,
  reasonsLine,
  strengthBars,
  thumbIdPrefix,
  thumbViewBox,
} from './briefFormat';
import type { BriefResult } from './state/editorContext';
import type { NameEntry, TitleAnalysis } from '../domain/types';

describe('pluralRu / counts', () => {
  const forms = ['мотив', 'мотива', 'мотивов'] as const;
  it.each([
    [0, 'мотивов'],
    [1, 'мотив'],
    [2, 'мотива'],
    [4, 'мотива'],
    [5, 'мотивов'],
    [10, 'мотивов'],
    [11, 'мотивов'],
    [12, 'мотивов'],
    [14, 'мотивов'],
    [21, 'мотив'],
    [22, 'мотива'],
    [101, 'мотив'],
    [111, 'мотивов'],
  ])('%i → %s', (n, word) => {
    expect(pluralRu(n, forms)).toBe(word);
  });

  it('formats the catalog count with a non-breaking space', () => {
    expect(motifsCountLabel(10)).toBe(`10${NBSP}мотивов`);
    expect(motifsCountLabel(3)).toBe(`3${NBSP}мотива`);
    expect(motifsCountLabel(1)).toBe(`1${NBSP}мотив`);
  });

  it('shows the availability note only when motifs are missing', () => {
    expect(catalogNote(10, 10)).toBeNull();
    expect(catalogNote(7, 10)).toBe(
      `Доступно 7${NBSP}из${NBSP}10${NBSP}мотивов — остальные появятся, когда их файлы будут добавлены`,
    );
  });
});

describe('analysis helpers', () => {
  it('maps strength to bars', () => {
    expect(strengthBars('strong')).toBe(3);
    expect(strengthBars('medium')).toBe(2);
    expect(strengthBars('weak')).toBe(1);
  });

  it('joins unique reason details with a middle dot', () => {
    const reasons = [
      { kind: 'name', token: 'книга', detail: 'название «книга»' },
      { kind: 'theme', token: 'учёба', detail: 'тема «учёба»' },
      { kind: 'alias', token: 'книжка', detail: 'название «книга»' },
    ] as const;
    expect(reasonsLine(reasons)).toBe('название «книга» · тема «учёба»');
    expect(reasonsLine([])).toBe('');
  });

  it('builds status chips for names', () => {
    expect(nameStatusChip({ status: 'matched', motif: 'book' })).toEqual({ label: 'найдено', tone: 'ok' });
    expect(nameStatusChip({ status: 'weak', motif: 'headphones' })).toEqual({
      label: `похоже на${NBSP}«Наушники»`,
      tone: 'warn',
    });
    expect(nameStatusChip({ status: 'unmatched' })).toEqual({ label: 'не найдено', tone: 'err' });
    expect(nameStatusChip({ status: 'unavailable', motif: 'book' })).toEqual({
      label: 'нет в библиотеке',
      tone: 'neutral',
    });
  });

  const entry = (status: NameEntry['status']): NameEntry => ({ raw: 'x', status, count: 1 });
  it('summarises names', () => {
    expect(namesSummary([])).toBe('Названия не указаны');
    expect(namesSummary([entry('matched'), entry('weak'), entry('unmatched'), entry('unavailable')])).toBe(
      `Распознано 2${NBSP}из${NBSP}4`,
    );
  });

  const title = (issues: TitleAnalysis['issues']): BriefResult => ({
    mode: 'title',
    analysis: {
      input: 'x',
      matches: [],
      selected: [],
      excluded: [],
      themes: [],
      unknownTokens: [],
      fallbackUsed: false,
      summary: 'Книга и лампа',
      issues,
    },
  });

  it('detects error-level issues', () => {
    expect(hasErrorIssue(null)).toBe(false);
    expect(hasErrorIssue(title([{ level: 'warning', code: 'w', message: 'm' }]))).toBe(false);
    expect(hasErrorIssue(title([{ level: 'error', code: 'e', message: 'm' }]))).toBe(true);
  });

  it('announces the summary and attention-level issues only', () => {
    const brief = title([
      { level: 'info', code: 'i', message: 'инфо' },
      { level: 'warning', code: 'w', message: 'внимание' },
    ]);
    expect(briefAnnouncement(brief)).toBe('Книга и лампа. внимание');
    expect(briefAnnouncement(null)).toBe('');
  });
});

describe('tab navigation', () => {
  it('wraps with arrows and jumps with Home/End', () => {
    expect(nextTabIndex('ArrowRight', 0, 2)).toBe(1);
    expect(nextTabIndex('ArrowRight', 1, 2)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 2)).toBe(1);
    expect(nextTabIndex('Home', 1, 2)).toBe(0);
    expect(nextTabIndex('End', 0, 2)).toBe(1);
    expect(nextTabIndex('a', 0, 2)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });

  it('detects the platform for the shortcut hint', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });
});

describe('thumbnail helpers', () => {
  it('pads the painted bounds by 6% of the longer side', () => {
    expect(thumbViewBox({ x: 10, y: 20, width: 100, height: 50 })).toBe('4 14 112 62');
  });

  it('sanitises useId output into a valid id prefix', () => {
    const prefix = thumbIdPrefix(':r1a:');
    expect(prefix).toBe('thumb-_r1a___');
    expect(prefix).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });

  it('describes file availability and fallbacks', () => {
    const text = availabilityDescription(
      { 's-main': true, 's-background': false, 'l-main': true, 'l-background': true },
      true,
    );
    expect(text).toContain('упрощённая — основной есть, фон нет');
    expect(text).toContain('подробная — основной есть, фон есть');
    expect(text).toContain('ближайший вариант');
  });
});
