import { describe, expect, it } from 'vitest';
import {
  MAX_XML_DEPTH,
  XmlError,
  escapeXmlAttr,
  escapeXmlText,
  getAttr,
  parseXml,
  serializeXml,
  type XmlElement,
} from './xml';

describe('escaping user text', () => {
  it('drops characters that XML 1.0 forbids even when escaped', () => {
    expect(escapeXmlText('Весна\u000Bи\u0000цветы￾')).toBe('Веснаицветы');
    expect(escapeXmlAttr('a\u0001b\uD800c')).toBe('abc');
  });

  it('keeps tabs, line breaks and valid astral characters', () => {
    expect(escapeXmlText('a\tb\nc 🌷 <&>')).toBe('a\tb\nc 🌷 &lt;&amp;&gt;');
    expect(escapeXmlAttr('a\tb\n"🌷"')).toBe('a&#9;b&#10;&quot;🌷&quot;');
  });
});

const child = (el: XmlElement, i: number): XmlElement => {
  const c = el.children[i];
  if (!c || c.kind !== 'element') throw new Error('no element child');
  return c;
};

describe('parseXml', () => {
  it('parses elements, quotes, self-closing tags and namespaced attributes in order', () => {
    const root = parseXml(`<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#a" x="1"/><g id="a"></g></svg>`);
    expect(root.attrs.map((a) => a.name)).toEqual(['xmlns', 'xmlns:xlink']);
    const use = child(root, 0);
    expect(use.attrs).toEqual([
      { name: 'xlink:href', value: '#a' },
      { name: 'x', value: '1' },
    ]);
    expect(child(root, 1).name).toBe('g');
  });

  it('decodes the five named entities and numeric references', () => {
    const root = parseXml(`<svg data="&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos; &#65;&#x42;"><text>x &amp; y &#1105;</text></svg>`);
    expect(getAttr(root, 'data')).toBe(`<a> & "b" 'c' AB`);
    expect(child(root, 0).children).toEqual([{ kind: 'text', text: 'x & y ё' }]);
  });

  it('treats CDATA as text and skips comments, processing instructions and a plain doctype', () => {
    const root = parseXml(
      `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><!-- hi --><svg><text><![CDATA[a < b & c]]><!-- x --> tail</text></svg>`,
    );
    expect(child(root, 0).children).toEqual([{ kind: 'text', text: 'a < b & c tail' }]);
  });

  it('drops whitespace-only text except inside text/tspan', () => {
    const root = parseXml(`<svg>\n  <g>\n  </g>\n  <text><tspan> </tspan> <tspan>a</tspan></text>\n</svg>`);
    expect(root.children).toHaveLength(2);
    expect(child(root, 0).children).toHaveLength(0);
    const text = child(root, 1);
    expect(text.children).toHaveLength(3);
    expect(child(text, 0).children).toEqual([{ kind: 'text', text: ' ' }]);
  });

  it('rejects DOCTYPE with ENTITY declarations (XXE / billion laughs)', () => {
    const evil = `<!DOCTYPE svg [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><svg>&lol2;</svg>`;
    expect(() => parseXml(evil)).toThrow(XmlError);
    expect(() => parseXml(evil)).toThrow(/ENTITY/);
    expect(() => parseXml(`<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg/>`)).toThrow(XmlError);
  });

  it('rejects unknown entities', () => {
    expect(() => parseXml('<svg>&nbsp;</svg>')).toThrow(/Неизвестная сущность/);
    expect(() => parseXml('<svg>a & b</svg>')).toThrow(XmlError);
  });

  it.each([
    ['unclosed element', '<svg><g></svg>'],
    ['stray close', '<svg></svg></g>'],
    ['two roots', '<svg/><svg/>'],
    ['unquoted attribute', '<svg a=1/>'],
    ['duplicate attribute', '<svg a="1" a="2"/>'],
    ['unterminated comment', '<svg><!-- x</svg>'],
    ['unterminated tag', '<svg'],
    ['no root', '<!-- only a comment -->'],
    ['text outside root', 'hello <svg/>'],
    ['lt in attribute', '<svg a="<"/>'],
  ])('throws XmlError with a Russian message and position: %s', (_name, source) => {
    try {
      parseXml(source);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(XmlError);
      expect((error as XmlError).message).toMatch(/[А-Яа-яЁё]/);
      expect((error as XmlError).message).toMatch(/позиция \d+/);
      expect(typeof (error as XmlError).position).toBe('number');
    }
  });

  it('caps input size and nesting depth', () => {
    expect(() => parseXml(`<svg>${' '.repeat(2 * 1024 * 1024)}</svg>`)).toThrow(/слишком большой/);
    const deep = '<g>'.repeat(MAX_XML_DEPTH + 1) + '</g>'.repeat(MAX_XML_DEPTH + 1);
    expect(() => parseXml(deep)).toThrow(/вложенность/);
    const ok = '<g>'.repeat(MAX_XML_DEPTH) + '</g>'.repeat(MAX_XML_DEPTH);
    expect(() => parseXml(ok)).not.toThrow();
  });
});

describe('serializeXml', () => {
  it('escapes attributes and text correctly', () => {
    const root = parseXml(`<svg a="&lt;&amp;&quot;&gt;"><text>&lt;x&gt; &amp; "q"</text></svg>`);
    expect(serializeXml(root)).toBe(`<svg a="&lt;&amp;&quot;&gt;"><text>&lt;x&gt; &amp; "q"</text></svg>`);
  });

  it('round-trips structure and attribute order', () => {
    const source = `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><g id="a" fill="red"><path d="M0 0L1 1"/><use xlink:href="#a"/></g></svg>`;
    const once = serializeXml(parseXml(source));
    expect(once).toBe(source);
    expect(serializeXml(parseXml(once))).toBe(once);
  });

  it('keeps newlines in attribute values distinguishable after a round-trip', () => {
    const root = parseXml('<svg a="x&#10;y"/>');
    expect(getAttr(root, 'a')).toBe('x\ny');
    expect(getAttr(parseXml(serializeXml(root)), 'a')).toBe('x\ny');
  });
});
