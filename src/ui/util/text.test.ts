import { describe, expect, it } from 'vitest';
import { formatCountedList, formatUniqueList, normalizeAngle, replaceFirstOccurrence } from './text';

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
