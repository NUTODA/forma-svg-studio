import { describe, expect, it } from 'vitest';
import { MOTIF_IDS, type MotifId } from '../../domain/types';
import { analyzeTitle } from '../../semantics/analyzeTitle';
import { parseNames } from '../../semantics/parseNames';
import { formatCountedList, formatUniqueList, normalizeAngle, replaceFirstOccurrence, replaceToken } from './text';

const ALL: ReadonlySet<MotifId> = new Set(MOTIF_IDS);

describe('replaceFirstOccurrence', () => {
  it('replaces only the first match, ignoring case', () => {
    expect(replaceFirstOccurrence('Деньги и деньги', 'деньги', 'Монета')).toBe('Монета и деньги');
  });

  it('keeps the surrounding text intact', () => {
    expect(replaceFirstOccurrence('книга, телефон', 'телефон', 'Наушники')).toBe('книга, Наушники');
  });

  it('returns the input when the token is missing or empty', () => {
    expect(replaceFirstOccurrence('книга', 'лампа', 'x')).toBe('книга');
    expect(replaceFirstOccurrence('книга', '', 'x')).toBe('книга');
  });

  it('treats the token and replacement literally, not as patterns', () => {
    expect(replaceFirstOccurrence('a.b a+b', 'a+b', 'X')).toBe('a.b X');
    expect(replaceFirstOccurrence('$1 и $&', '$&', '$$')).toBe('$1 и $$');
  });
});

describe('replaceToken', () => {
  it('replaces the occurrence at the range, not the first one', () => {
    expect(replaceToken('ламба, ламба', 'ламба', 'Лампа', { start: 7, end: 12 })).toBe('ламба, Лампа');
    expect(replaceToken('ламба, ламба', 'ламба', 'Лампа', { start: 0, end: 5 })).toBe('Лампа, ламба');
  });

  it('falls back to the first occurrence when the range no longer holds the token', () => {
    expect(replaceToken('ламба, ламба', 'ламба', 'Лампа', { start: 3, end: 8 })).toBe('Лампа, ламба');
    expect(replaceToken('ламба', 'ламба', 'Лампа', { start: 40, end: 45 })).toBe('Лампа');
    expect(replaceToken('ламба', 'ламба', 'Лампа', { start: -5, end: 0 })).toBe('Лампа');
    expect(replaceToken('ламба, ламба', 'ламба', 'Лампа')).toBe('Лампа, ламба');
  });

  it('does nothing for an empty token', () => {
    expect(replaceToken('книга', '', 'x', { start: 0, end: 0 })).toBe('книга');
  });

  it('corrects the fragment of a names list the user clicked', () => {
    const input = '1) ламба\n2) книга\n3) ламба';
    const actions = parseNames(input, ALL)
      .issues.map((issue) => issue.action)
      .filter((action) => action?.kind === 'replace');
    expect(actions).toHaveLength(2);
    const apply = (index: number): string => {
      const action = actions[index];
      return replaceToken(input, action?.token ?? '', action?.replacement ?? '', action?.range);
    };
    expect(apply(0)).toBe('1) Лампа\n2) книга\n3) ламба');
    expect(apply(1)).toBe('1) ламба\n2) книга\n3) Лампа');
  });

  it('keeps the capital of a title whose first word is corrected', () => {
    const input = 'Телефан в подарок';
    const action = analyzeTitle(input, ALL).issues.find((issue) => issue.code === 'typo')?.action;
    expect(replaceToken(input, action?.token ?? '', action?.replacement ?? '', action?.range)).toBe(
      'Телефон в подарок',
    );
  });
});

describe('normalizeAngle', () => {
  it('wraps into (−180, 180]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(-180)).toBe(180);
    expect(normalizeAngle(181)).toBe(-179);
    expect(normalizeAngle(-181)).toBe(179);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(725)).toBe(5);
    expect(normalizeAngle(-725)).toBe(-5);
  });

  it('never yields negative zero', () => {
    expect(Object.is(normalizeAngle(-360), 0)).toBe(true);
  });
});

describe('list formatting', () => {
  it('counts repeated names', () => {
    expect(formatCountedList(['Монета', 'Книга', 'Монета'])).toBe('Монета ×2, Книга');
    expect(formatCountedList([])).toBe('');
  });

  it('deduplicates names', () => {
    expect(formatUniqueList(['Монета', 'Книга', 'Монета'])).toBe('Монета, Книга');
  });
});

describe('replaceFirstOccurrence — whole words first', () => {
  it('never edits a longer word that merely contains the token', () => {
    expect(replaceFirstOccurrence('книга, кни', 'кни', 'Книга')).toBe('книга, Книга');
  });

  it('falls back to a substring when the token is not a separate word', () => {
    expect(replaceFirstOccurrence('суперкнига', 'книга', 'Книга')).toBe('суперКнига');
  });
});
