import { describe, expect, it } from 'vitest';
import { analyzeSvgSource, buildTemplate, instantiate, templateUsesXlink } from './template';
import { FORBIDDEN_ELEMENTS, checkReferences } from './testing';
import { getAttr, parseXml } from './xml';

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

const RICH = `<svg width="100" height="100" viewBox="0 0 100 100" fill="none" ${NS}>
  <g clip-path="url(#clip0)">
    <rect width="100" height="100" fill="#D7CDF5"/>
    <path d="M10 10H90V90H10Z" fill="url(#grad)" stroke="white"/>
    <use xlink:href="#shape" x="5"/>
    <circle cx="50" cy="50" r="10" fill="white" mask="url('#m')" filter="url(#f)"/>
  </g>
  <defs>
    <clipPath id="clip0"><rect width="100" height="100" fill="white"/></clipPath>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7864D7"/><stop offset="1" stop-color="#181817"/></linearGradient>
    <linearGradient id="grad2" xlink:href="#grad"/>
    <mask id="m"><rect width="100" height="100" fill="white"/></mask>
    <filter id="f"><feGaussianBlur stdDeviation="2"/></filter>
    <path id="shape" d="M0 0L10 10" stroke="#AA9BF0"/>
  </defs>
</svg>`;

const identity = (hex: string): string => hex;

describe('analyzeSvgSource', () => {
  it('returns viewBox, bounds, distinct normalised colours and warnings', () => {
    const analysis = analyzeSvgSource(RICH);
    expect(analysis.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(analysis.bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(analysis.colors).toEqual(['#d7cdf5', '#ffffff', '#7864d7', '#181817', '#aa9bf0']);
    expect(analysis.warnings).toEqual([]);
  });

  it('reports sanitiser removals', () => {
    const analysis = analyzeSvgSource(`<svg viewBox="0 0 10 10" ${NS}><script>x</script><image href="a.png"/><rect width="5" height="5"/></svg>`);
    expect(analysis.warnings).toContain('Удалён растровый <image>');
  });

  it('rejects unusable input with Russian errors', () => {
    expect(() => analyzeSvgSource('<svg')).toThrow(/Не удалось разобрать SVG/);
    expect(() => analyzeSvgSource('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(/viewBox/);
    expect(() => analyzeSvgSource('<div/>')).toThrow(/svg/);
    expect(() => analyzeSvgSource('<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"/>')).toThrow(/ENTITY/);
    expect(() => analyzeSvgSource('<svg viewBox="0 0 1 1"></svg>')).toThrow(/служебные/);
  });

  it('carries colour alpha into opacity attributes', () => {
    const t = buildTemplate(`<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#ff000080"/></svg>`, { file: 'x.svg', source: 'lavender' });
    expect(t.warnings.some((w) => w.includes('Прозрачность'))).toBe(true);
    expect(instantiate(t, { idPrefix: 'a', color: identity })).toContain('fill-opacity="0.502"');
  });
});

describe('buildTemplate / instantiate', () => {
  const template = buildTemplate(RICH, { file: 'test.svg', source: 'lavender' });

  it('exposes metadata', () => {
    expect(template.file).toBe('test.svg');
    expect(template.source).toBe('lavender');
    expect(template.colors).toEqual(analyzeSvgSource(RICH).colors);
  });

  it('keeps the root fill="none" on the wrapper and never copies size attributes', () => {
    const markup = instantiate(template, { idPrefix: 'a__', color: identity });
    const wrapper = parseXml(markup);
    expect(wrapper.name).toBe('g');
    expect(getAttr(wrapper, 'fill')).toBe('none');
    for (const forbidden of ['width', 'height', 'viewBox', 'xmlns', 'xmlns:xlink']) expect(getAttr(wrapper, forbidden)).toBeUndefined();
  });

  it('prefixes every id and resolves every reference inside one instance', () => {
    const markup = instantiate(template, { idPrefix: 'book-1__', color: identity });
    const report = checkReferences(markup);
    // clip0, grad, grad2, m, f, shape — and one reference to each except grad2 (grad is referenced twice).
    expect(report.ids).toHaveLength(6);
    expect(report.ids.every((id) => id.startsWith('book-1__'))).toBe(true);
    expect(report.references.length).toBeGreaterThanOrEqual(6);
    expect(report.dangling).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
    expect(markup).toContain('url(#book-1__clip0)');
    expect(markup).toContain(`url('#book-1__m')`);
    expect(markup).toContain('xlink:href="#book-1__shape"');
    expect(templateUsesXlink(template)).toBe(true);
  });

  it('two instances of the same file never share an id, yet each is self-contained', () => {
    const a = instantiate(template, { idPrefix: 'book-1__', color: identity });
    const b = instantiate(template, { idPrefix: 'book-2__', color: identity });
    const ra = checkReferences(a);
    const rb = checkReferences(b);
    expect(ra.ids.filter((id) => rb.ids.includes(id))).toEqual([]);
    expect(ra.dangling).toEqual([]);
    expect(rb.dangling).toEqual([]);
    const both = checkReferences(`${a}${b}`);
    expect(both.duplicateIds).toEqual([]);
    expect(both.dangling).toEqual([]);
  });

  it('routes every paint colour through the callback, mapping source → target', () => {
    const seen: string[] = [];
    const markup = instantiate(template, {
      idPrefix: 'a__',
      color: (hex) => {
        seen.push(hex);
        return hex === '#ffffff' ? '#010203' : '#ABCDEF';
      },
    });
    expect([...new Set(seen)].sort()).toEqual([...template.colors].sort());
    expect(seen.length).toBe(template.colors.length); // once per distinct colour
    expect(markup).not.toMatch(/#d7cdf5|#7864d7|#181817|#aa9bf0/i);
    expect(markup).toContain('fill="#abcdef"');
    expect(markup).toContain('stroke="#010203"');
    expect(markup).not.toContain('');
  });

  it('falls back to the source colour when the callback returns something invalid', () => {
    const markup = instantiate(template, { idPrefix: 'a__', color: () => 'red' });
    expect(markup).toContain('fill="#d7cdf5"');
    const short = instantiate(template, { idPrefix: 'a__', color: () => '#fff' });
    expect(short).toContain('fill="#d7cdf5"');
    expect(instantiate(template, { idPrefix: 'a__', color: () => '' })).toContain('#7864d7');
  });

  it('leaves non-colour paints alone', () => {
    const markup = instantiate(template, { idPrefix: 'a__', color: identity });
    expect(markup).toContain('fill="url(#a__grad)"');
    expect(markup).toContain('fill="none"');
  });

  it('validates idPrefix', () => {
    for (const bad of ['', '1abc', 'a b', 'a"b', 'a<b', '-x', 'ё', 'a#b']) {
      expect(() => instantiate(template, { idPrefix: bad, color: identity }), bad).toThrow(/префикс/);
    }
    for (const good of ['a', 'book-1__', 'plane__', 'X_9-z']) {
      expect(() => instantiate(template, { idPrefix: good, color: identity })).not.toThrow();
    }
  });

  it('contains no forbidden elements even when the source had them', () => {
    const dirty = buildTemplate(
      `<svg viewBox="0 0 10 10" ${NS}><script>alert(1)</script><image href="https://e/x.png"/><foreignObject/><rect width="5" height="5" onclick="x()" fill="red"/></svg>`,
      { file: 'dirty.svg', source: 'lavender' },
    );
    const markup = instantiate(dirty, { idPrefix: 'd__', color: identity });
    const { elements } = checkReferences(markup);
    for (const name of FORBIDDEN_ELEMENTS) expect(elements).not.toContain(name);
    expect(markup).not.toContain('onclick');
    expect(markup).not.toContain('https://');
  });

  it('flags references to missing ids but still prefixes them', () => {
    const t = buildTemplate(`<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url(#nope)"/></svg>`, { file: 'x.svg', source: 'lavender' });
    expect(t.warnings.some((w) => w.includes('nope'))).toBe(true);
    expect(instantiate(t, { idPrefix: 'a__', color: identity })).toContain('url(#a__nope)');
  });
});

describe('viewBox clipping', () => {
  const overflowing = `<svg viewBox="0 0 100 100" ${NS}><path d="M-10 10H200V50H-10Z" fill="#FF0000"/></svg>`;
  const contained = `<svg viewBox="0 0 100 100" ${NS}><path d="M10 10H90V50H10Z" fill="#FF0000"/></svg>`;

  it('adds a per-instance clipPath equal to the viewBox when geometry exceeds it', () => {
    const t = buildTemplate(overflowing, { file: 'o.svg', source: 'lavender' });
    const markup = instantiate(t, { idPrefix: 'o-1__', color: identity });
    const report = checkReferences(markup);
    expect(report.elements).toContain('clipPath');
    expect(report.dangling).toEqual([]);
    expect(markup).toMatch(/^<g clip-path="url\(#o-1__forma-viewbox-clip\)"><defs><clipPath id="o-1__forma-viewbox-clip"><rect x="0" y="0" width="100" height="100"\/>/);
    expect(t.bounds).toEqual({ x: 0, y: 10, width: 100, height: 40 });
  });

  it('adds nothing when everything fits (also: element clip-paths are honoured)', () => {
    expect(instantiate(buildTemplate(contained, { file: 'c.svg', source: 'lavender' }), { idPrefix: 'c__', color: identity })).not.toContain('clipPath');
    const clipped = `<svg viewBox="0 0 100 100" ${NS}><defs><clipPath id="c"><rect width="100" height="100"/></clipPath></defs><g clip-path="url(#c)"><rect x="-50" width="300" height="100"/></g></svg>`;
    const markup = instantiate(buildTemplate(clipped, { file: 'c.svg', source: 'lavender' }), { idPrefix: 'c__', color: identity });
    expect(markup).not.toContain('forma-viewbox-clip');
  });

  it('avoids id collisions with the generated clip id', () => {
    const src = `<svg viewBox="0 0 10 10"><defs><clipPath id="forma-viewbox-clip"><rect width="1" height="1"/></clipPath></defs><rect x="-5" width="30" height="5" clip-path="url(#forma-viewbox-clip)" fill="red"/><rect x="-5" y="6" width="30" height="2" fill="red"/></svg>`;
    const t = buildTemplate(src, { file: 'c.svg', source: 'lavender' });
    const report = checkReferences(instantiate(t, { idPrefix: 'c__', color: identity }));
    expect(report.duplicateIds).toEqual([]);
    expect(report.dangling).toEqual([]);
    expect(report.ids).toContain('c__forma-viewbox-clip-2');
  });

  it('carries root presentation attributes on the inner wrapper', () => {
    const t = buildTemplate(`<svg viewBox="0 0 10 10" fill="none" opacity="0.5"><path d="M-5 0H20V5H-5Z" stroke="#000"/></svg>`, { file: 'c.svg', source: 'lavender' });
    const markup = instantiate(t, { idPrefix: 'c__', color: identity });
    expect(markup).toContain('<g fill="none" opacity="0.5">');
  });
});
