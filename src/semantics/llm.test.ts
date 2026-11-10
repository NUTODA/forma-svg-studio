import { describe, expect, it } from 'vitest';
import { analyzeTitle } from './analyzeTitle';
import { applyLlmPick, needsLlm, sanitizePick } from './llm';
import type { MotifId } from '../domain/types';

const ALL = new Set<MotifId>(['book', 'puzzle', 'lamp', 'pen']);

describe('llm adapter', () => {
  it('sanitizes the server answer against the available catalog', () => {
    expect(sanitizePick({ objects: ['puzzle', 'coin', 'book', 'puzzle', 'x'], reason: ' ok ' }, ALL)).toEqual({
      motifs: ['puzzle', 'book'],
      reason: 'ok',
    });
    expect(sanitizePick({ objects: ['coin'] }, ALL)).toBeNull();
    expect(sanitizePick(null, ALL)).toBeNull();
    expect(sanitizePick({ objects: 'book' }, ALL)).toBeNull();
  });

  it('merges a pick into the rule-based analysis and removes guess warnings', () => {
    const base = analyzeTitle('asdfgh qwerty', ALL);
    expect(base.fallbackUsed).toBe(true);
    const merged = applyLlmPick(base, { motifs: ['lamp', 'pen'], reason: 'Идея и запись' });
    expect(merged.selected).toEqual(['lamp', 'pen']);
    expect(merged.fallbackUsed).toBe(false);
    expect(merged.summary).toContain('ИИ');
    expect(merged.issues.some((i) => i.code === 'no-match')).toBe(false);
    expect(merged.issues.some((i) => i.code === 'llm')).toBe(true);
    expect(merged.matches.slice(0, 2).map((m) => m.motif)).toEqual(['lamp', 'pen']);
  });

  it('asks the model for every usable title', () => {
    const all = new Set<MotifId>(['book', 'puzzle', 'lamp', 'pen', 'coin', 'wallet', 'phone', 'headphones']);
    expect(needsLlm(analyzeTitle('Знания по кусочкам', all))).toBe(true);
    expect(needsLlm(analyzeTitle('Как накопить на поездку', all))).toBe(true);
    expect(needsLlm(analyzeTitle('   ', all))).toBe(false);
  });

  it('keeps a background pick only when it is available and not in the scene', () => {
    expect(sanitizePick({ objects: ['puzzle'], background: 'book' }, ALL)?.scenery).toBe('book');
    expect(sanitizePick({ objects: ['puzzle'], background: 'puzzle' }, ALL)?.scenery).toBeUndefined();
    expect(sanitizePick({ objects: ['puzzle'], background: 'coin' }, ALL)?.scenery).toBeUndefined();
  });

  it('keeps sure objects first and never restores excluded ones', () => {
    const all = new Set<MotifId>(['phone', 'headphones', 'lamp', 'coin']);
    const base = analyzeTitle('Телефон без наушников', all);
    const merged = applyLlmPick(base, { motifs: ['headphones', 'lamp', 'phone'], reason: '' });
    expect(merged.selected).toEqual(['phone', 'lamp']);
    expect(merged.issues.some((i) => i.code === 'llm')).toBe(false);
  });
});
