import { describe, expect, it } from 'vitest';
import { headlineForBrief } from './useEditor';

describe('headlineForBrief', () => {
  it('uses the trimmed text as the headline in title mode', () => {
    expect(headlineForBrief('title', '  Весенний букет ')).toBe('Весенний букет');
  });

  it('never carries a headline over from a names list', () => {
    expect(headlineForBrief('names', 'книга, 2 монеты')).toBe('');
  });
});
