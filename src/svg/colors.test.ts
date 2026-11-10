import { describe, expect, it } from 'vitest';
import { normalizeColor, parseColor } from './colors';

describe('normalizeColor', () => {
  it.each([
    ['#FFF', '#ffffff'],
    ['#D7CDF5', '#d7cdf5'],
    ['#abc', '#aabbcc'],
    ['#ffffff80', '#ffffff'],
    ['#f008', '#ff0000'],
    ['white', '#ffffff'],
    ['WHITE', '#ffffff'],
    ['black', '#000000'],
    ['rebeccapurple', '#663399'],
    ['rgb(255, 0, 0)', '#ff0000'],
    ['rgb(255 0 0 / 50%)', '#ff0000'],
    ['rgba(0,128,255,0.5)', '#0080ff'],
    ['rgb(100%, 0%, 50%)', '#ff0080'],
    ['hsl(120, 100%, 50%)', '#00ff00'],
    ['  #7864d7  ', '#7864d7'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeColor(input)).toBe(expected);
  });

  it.each(['none', 'transparent', 'currentColor', 'inherit', 'url(#a)', 'url(#a) red', '', '#12', '#ggg', 'rgb(1,2)', 'notacolor'])(
    '%s → null',
    (input) => {
      expect(normalizeColor(input)).toBeNull();
    },
  );

  it('reports alpha separately', () => {
    expect(parseColor('#ff000080')?.alpha).toBeCloseTo(0.502, 2);
    expect(parseColor('rgba(1,2,3,.25)')?.alpha).toBe(0.25);
    expect(parseColor('red')?.alpha).toBe(1);
  });
});
