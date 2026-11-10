import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize';
import { getAttr, parseXml, serializeXml } from './xml';

const clean = (body: string, rootAttrs = '') => sanitizeSvg(parseXml(`<svg xmlns="http://www.w3.org/2000/svg"${rootAttrs}>${body}</svg>`));

describe('sanitizeSvg elements', () => {
  it('removes dangerous and unsupported elements with Russian warnings', () => {
    const { root, warnings } = clean(
      `<script>alert(1)</script><style>.a{fill:red}</style><foreignObject><div/></foreignObject><image href="x.png"/><a href="#x"><path d="M0 0"/></a><animate attributeName="x"/><set/><metadata/><title>t</title><iframe/><path d="M0 0L1 1"/>`,
    );
    expect(root.children.map((c) => (c.kind === 'element' ? c.name : '#text'))).toEqual(['path']);
    expect(warnings).toContain('Удалён растровый <image>');
    expect(warnings).toContain('Удалён скрипт <script>');
    expect(warnings.some((w) => w.includes('<foreignObject>'))).toBe(true);
    expect(warnings.some((w) => w.includes('<style>'))).toBe(true);
    expect(warnings.length).toBeGreaterThanOrEqual(9);
    expect(warnings.every((w) => /[А-Яа-я]/.test(w))).toBe(true);
  });

  it('keeps whitelisted structure, including filters and nested defs', () => {
    const { root, warnings } = clean(
      `<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient><clipPath id="c"><rect width="1" height="1"/></clipPath><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><g clip-path="url(#c)" filter="url(#f)"><circle r="1" fill="url(#g)"/></g>`,
    );
    expect(warnings).toEqual([]);
    expect(serializeXml(root)).toContain('<feGaussianBlur stdDeviation="2"/>');
  });

  it('does not mutate its input and merges repeated warnings', () => {
    const input = parseXml('<svg><image/><image/></svg>');
    const { root, warnings } = sanitizeSvg(input);
    expect(input.children).toHaveLength(2);
    expect(root.children).toHaveLength(0);
    expect(warnings).toEqual(['Удалён растровый <image> (×2)']);
  });

  it('requires an <svg> root', () => {
    expect(() => sanitizeSvg(parseXml('<html/>'))).toThrow(/svg/);
  });

  it('drops text outside text/tspan but keeps it inside', () => {
    const { root } = clean('<g>stray</g><text>keep <tspan>me</tspan></text>');
    expect(serializeXml(root)).toContain('<g/>');
    expect(serializeXml(root)).toContain('<text>keep <tspan>me</tspan></text>');
  });
});

describe('sanitizeSvg attributes', () => {
  it('drops on* handlers', () => {
    const { root, warnings } = clean('<path d="M0 0" onclick="alert(1)" onload="x()"/>');
    const path = root.children[0];
    expect(path?.kind === 'element' && path.attrs.map((a) => a.name)).toEqual(['d']);
    expect(warnings.some((w) => w.includes('onclick'))).toBe(true);
  });

  it('allows only local href and xlink:href', () => {
    const { root, warnings } = clean(
      `<defs><g id="a"/></defs><use href="#a"/><use xlink:href="#a"/><use href="https://evil.example/x.svg#a"/><use xlink:href="data:image/svg+xml,xx"/>`,
    );
    const names = root.children.map((c) => (c.kind === 'element' ? `${c.name}:${c.attrs.map((a) => a.name).join(',')}` : ''));
    expect(names).toEqual(['defs:', 'use:href', 'use:xlink:href']);
    expect(warnings.some((w) => w.includes('внешняя ссылка'))).toBe(true);
  });

  it('drops javascript: values and non-local url()', () => {
    const { root } = clean(
      `<path d="M0 0" fill="url(https://evil.example/a.svg#x)"/><path d="M0 0" stroke="java&#10;script:alert(1)"/><path d="M0 0" fill="url(#ok)"/><path d="M0 0" filter="url('data:image/svg+xml,x')"/>`,
    );
    const attrs = root.children.map((c) => (c.kind === 'element' ? c.attrs.map((a) => a.name).join(',') : ''));
    expect(attrs).toEqual(['d', 'd', 'd,fill', 'd']);
  });

  it('converts whitelisted style declarations to attributes; style wins over the attribute', () => {
    const { root, warnings } = clean(
      `<path d="M0 0" fill="red" style="fill: blue; stroke:#000 !important; /* c */ stroke-width:2; behavior:url(x); opacity:.5"/>`,
    );
    const path = root.children[0];
    if (path?.kind !== 'element') throw new Error('no path');
    expect(getAttr(path, 'style')).toBeUndefined();
    expect(getAttr(path, 'fill')).toBe('blue');
    expect(getAttr(path, 'stroke')).toBe('#000');
    expect(getAttr(path, 'stroke-width')).toBe('2');
    expect(getAttr(path, 'opacity')).toBe('.5');
    expect(path.attrs[1]?.name).toBe('fill'); // converted in place, order preserved
    expect(warnings.some((w) => w.includes('behavior'))).toBe(true);
  });

  it('checks values coming from style too', () => {
    const { root } = clean(`<path d="M0 0" style="fill:url(https://evil.example/x)"/>`);
    const path = root.children[0];
    expect(path?.kind === 'element' && getAttr(path, 'fill')).toBeFalsy();
  });

  it('removes <use> that lost its reference and unknown attributes', () => {
    const { root, warnings } = clean(`<use href="http://x/y"/><path d="M0 0" data-name="a" foo="bar"/>`);
    expect(root.children).toHaveLength(1);
    expect(warnings).toContain('Удалён <use> без локальной ссылки');
    expect(warnings).toContain('Удалён неподдерживаемый атрибут foo');
    expect(warnings.some((w) => w.includes('data-name'))).toBe(false);
  });

  it('keeps only the standard xmlns declarations', () => {
    const { root } = clean('<g/>', ' xmlns:evil="http://evil" xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(root.attrs.map((a) => a.name)).toEqual(['xmlns', 'xmlns:xlink']);
  });
});
