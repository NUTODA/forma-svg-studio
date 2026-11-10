/**
 * Minimal, strict XML reader/writer for SVG. Pure TS, no DOM.
 * Not a general XML implementation: no namespaces resolution, no DTD entities.
 */

export const MAX_XML_LENGTH = 2 * 1024 * 1024;
export const MAX_XML_DEPTH = 256;

export interface XmlAttribute {
  name: string;
  value: string;
}

export interface XmlText {
  kind: 'text';
  text: string;
}

export interface XmlElement {
  kind: 'element';
  name: string;
  /** Source order is preserved. */
  attrs: XmlAttribute[];
  children: XmlNode[];
}

export type XmlNode = XmlElement | XmlText;

export class XmlError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (позиция ${position})`);
    this.name = 'XmlError';
    this.position = position;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function getAttr(el: XmlElement, name: string): string | undefined {
  for (const attr of el.attrs) if (attr.name === name) return attr.value;
  return undefined;
}

/** Sets an attribute in place (keeps its position) or appends it. */
export function setAttr(el: XmlElement, name: string, value: string): void {
  for (const attr of el.attrs) {
    if (attr.name === name) {
      attr.value = value;
      return;
    }
  }
  el.attrs.push({ name, value });
}

export function removeAttr(el: XmlElement, name: string): void {
  const index = el.attrs.findIndex((attr) => attr.name === name);
  if (index >= 0) el.attrs.splice(index, 1);
}

export function createElement(name: string, attrs: [string, string][] = [], children: XmlNode[] = []): XmlElement {
  return { kind: 'element', name, attrs: attrs.map(([n, v]) => ({ name: n, value: v })), children };
}

export function childElements(el: XmlElement): XmlElement[] {
  return el.children.filter((child): child is XmlElement => child.kind === 'element');
}

/** Element name without a namespace prefix. */
export function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/* ------------------------------------------------------------------ */
/* Entities                                                            */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function isValidCodePoint(cp: number): boolean {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp < 0x20 && cp !== 0x9 && cp !== 0xa && cp !== 0xd) return false;
  return cp !== 0xfffe && cp !== 0xffff;
}

/** `base` is the offset of `raw` in the source, used for error positions. */
function decodeEntities(raw: string, base: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (match: string, body: string, offset: number) => {
    if (!match.endsWith(';')) throw new XmlError('Сущность без завершающего «;»', base + offset);
    if (body.startsWith('#')) {
      const cp = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!isValidCodePoint(cp)) throw new XmlError(`Недопустимая числовая ссылка «${match}»`, base + offset);
      return String.fromCodePoint(cp);
    }
    const named = NAMED_ENTITIES[body];
    if (named === undefined) throw new XmlError(`Неизвестная сущность «${match}»`, base + offset);
    return named;
  });
}

/** A bare `&` that does not start a reference is malformed XML. */
function assertNoBareAmpersand(raw: string, base: number): void {
  const bare = /&(?!(?:#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);)/.exec(raw);
  if (bare) throw new XmlError('Символ «&» нужно записывать как «&amp;»', base + bare.index);
}

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

const NAME_RE = /[A-Za-z_:\u0080-￿][\w:.\-\u0080-￿]*/y;
const WS_RE = /[ \t\r\n]*/y;
const PRESERVE_WHITESPACE = new Set(['text', 'tspan']);

class Parser {
  private pos = 0;
  private readonly stack: XmlElement[] = [];
  private root: XmlElement | null = null;
  private preserveDepth = 0;
  private text = '';

  constructor(private readonly src: string) {}

  parse(): XmlElement {
    if (this.src.charCodeAt(0) === 0xfeff) this.pos = 1;
    const src = this.src;
    while (this.pos < src.length) {
      const lt = src.indexOf('<', this.pos);
      if (lt < 0) {
        this.addText(src.slice(this.pos), this.pos);
        this.pos = src.length;
        break;
      }
      if (lt > this.pos) this.addText(src.slice(this.pos, lt), this.pos);
      this.pos = lt;
      this.parseMarkup();
    }
    this.flushText();
    if (this.stack.length > 0) {
      const open = this.stack[this.stack.length - 1];
      throw new XmlError(`Не закрыт элемент <${open?.name ?? '?'}>`, src.length);
    }
    if (!this.root) throw new XmlError('В файле нет корневого элемента', src.length);
    return this.root;
  }

  private parseMarkup(): void {
    const src = this.src;
    if (src.startsWith('<!--', this.pos)) return this.skipUntil('-->', 4, 'Не закрыт комментарий');
    if (src.startsWith('<![CDATA[', this.pos)) return this.parseCdata();
    if (src.startsWith('<?', this.pos)) return this.skipUntil('?>', 2, 'Не закрыта инструкция обработки');
    if (src.startsWith('<!DOCTYPE', this.pos) || src.startsWith('<!doctype', this.pos)) return this.parseDoctype();
    if (src.startsWith('<!', this.pos)) throw new XmlError('Неподдерживаемая конструкция «<!»', this.pos);
    if (src.startsWith('</', this.pos)) return this.parseClose();
    this.parseOpen();
  }

  private skipUntil(terminator: string, offset: number, message: string): void {
    const end = this.src.indexOf(terminator, this.pos + offset);
    if (end < 0) throw new XmlError(message, this.pos);
    this.pos = end + terminator.length;
  }

  private parseCdata(): void {
    const start = this.pos + 9;
    const end = this.src.indexOf(']]>', start);
    if (end < 0) throw new XmlError('Не закрыт раздел CDATA', this.pos);
    if (this.stack.length === 0) throw new XmlError('CDATA вне корневого элемента', this.pos);
    this.appendText(this.src.slice(start, end));
    this.pos = end + 3;
  }

  private parseDoctype(): void {
    const src = this.src;
    const start = this.pos;
    let i = start + 9;
    let bracket = 0;
    let quote = '';
    for (; i < src.length; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '[') bracket++;
      else if (ch === ']') bracket--;
      else if (ch === '>' && bracket <= 0) break;
    }
    if (i >= src.length) throw new XmlError('Не закрыт DOCTYPE', start);
    const doctype = src.slice(start, i + 1);
    if (/<!ENTITY/i.test(doctype)) {
      throw new XmlError('DOCTYPE с объявлением сущностей (ENTITY) запрещён из соображений безопасности', start);
    }
    if (this.root || this.stack.length > 0) throw new XmlError('DOCTYPE допустим только до корневого элемента', start);
    this.pos = i + 1;
  }

  private parseClose(): void {
    const start = this.pos;
    this.flushText();
    const name = this.readName(this.pos + 2);
    this.skipWs();
    if (this.src[this.pos] !== '>') throw new XmlError('Ожидался символ «>» в закрывающем теге', this.pos);
    this.pos++;
    const open = this.stack.pop();
    if (!open) throw new XmlError(`Лишний закрывающий тег </${name}>`, start);
    if (open.name !== name) throw new XmlError(`Тег <${open.name}> закрыт как </${name}>`, start);
    if (PRESERVE_WHITESPACE.has(localName(name))) this.preserveDepth--;
  }

  private parseOpen(): void {
    const start = this.pos;
    this.flushText();
    const name = this.readName(this.pos + 1);
    const el: XmlElement = { kind: 'element', name, attrs: [], children: [] };

    for (;;) {
      const before = this.pos;
      this.skipWs();
      const ch = this.src[this.pos];
      if (ch === '>') {
        this.pos++;
        this.openElement(el, start, false);
        return;
      }
      if (ch === '/') {
        if (this.src[this.pos + 1] !== '>') throw new XmlError('Ожидался символ «>» после «/»', this.pos + 1);
        this.pos += 2;
        this.openElement(el, start, true);
        return;
      }
      if (ch === undefined) throw new XmlError(`Не закрыт тег <${name}>`, start);
      if (this.pos === before) throw new XmlError('Между атрибутами нужен пробел', this.pos);
      this.parseAttribute(el);
    }
  }

  private parseAttribute(el: XmlElement): void {
    const nameStart = this.pos;
    const name = this.readName(this.pos);
    this.skipWs();
    if (this.src[this.pos] !== '=') throw new XmlError(`У атрибута «${name}» нет значения`, nameStart);
    this.pos++;
    this.skipWs();
    const quote = this.src[this.pos];
    if (quote !== '"' && quote !== "'") throw new XmlError(`Значение атрибута «${name}» должно быть в кавычках`, this.pos);
    const valueStart = this.pos + 1;
    const end = this.src.indexOf(quote, valueStart);
    if (end < 0) throw new XmlError(`Не закрыта кавычка у атрибута «${name}»`, this.pos);
    const raw = this.src.slice(valueStart, end);
    const lt = raw.indexOf('<');
    if (lt >= 0) throw new XmlError(`Символ «<» недопустим в значении атрибута «${name}»`, valueStart + lt);
    assertNoBareAmpersand(raw, valueStart);
    if (el.attrs.some((attr) => attr.name === name)) throw new XmlError(`Атрибут «${name}» указан дважды`, nameStart);
    el.attrs.push({ name, value: decodeEntities(raw.replace(/[\t\r\n]/g, ' '), valueStart) });
    this.pos = end + 1;
  }

  private openElement(el: XmlElement, start: number, selfClosing: boolean): void {
    const parent = this.stack[this.stack.length - 1];
    if (parent) parent.children.push(el);
    else if (this.root) throw new XmlError('В файле больше одного корневого элемента', start);
    else this.root = el;
    if (selfClosing) return;
    if (this.stack.length >= MAX_XML_DEPTH) throw new XmlError(`Слишком глубокая вложенность (больше ${MAX_XML_DEPTH})`, start);
    this.stack.push(el);
    if (PRESERVE_WHITESPACE.has(localName(el.name))) this.preserveDepth++;
  }

  private readName(at: number): string {
    NAME_RE.lastIndex = at;
    const match = NAME_RE.exec(this.src);
    if (!match) throw new XmlError('Ожидалось имя', at);
    this.pos = at + match[0].length;
    return match[0];
  }

  private skipWs(): void {
    WS_RE.lastIndex = this.pos;
    WS_RE.exec(this.src);
    this.pos = WS_RE.lastIndex;
  }

  /** Character data (entity-decoded). */
  private addText(raw: string, at: number): void {
    if (this.stack.length === 0) {
      if (raw.trim() !== '') throw new XmlError('Текст вне корневого элемента', at);
      return;
    }
    assertNoBareAmpersand(raw, at);
    this.appendText(decodeEntities(raw, at));
  }

  private appendText(decoded: string): void {
    this.text += decoded;
  }

  private flushText(): void {
    const parent = this.stack[this.stack.length - 1];
    const text = this.text;
    this.text = '';
    if (!parent || text === '') return;
    if (this.preserveDepth === 0 && text.trim() === '') return;
    parent.children.push({ kind: 'text', text });
  }
}

export function parseXml(source: string): XmlElement {
  if (typeof source !== 'string') throw new XmlError('Ожидалась строка с XML', 0);
  if (source.length > MAX_XML_LENGTH) {
    throw new XmlError(`Файл слишком большой (больше ${MAX_XML_LENGTH / 1024 / 1024} МБ)`, 0);
  }
  return new Parser(source).parse();
}

/* ------------------------------------------------------------------ */
/* Serializer                                                          */
/* ------------------------------------------------------------------ */

/**
 * Characters that may not appear in an XML 1.0 document at all (not even escaped): C0 controls
 * other than tab/LF/CR, U+FFFE/U+FFFF and lone surrogates. User text (headline, palette name)
 * can contain them, e.g. a vertical tab pasted from a word processor.
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripXmlIllegal(text: string): string {
  return text.replace(XML_ILLEGAL, '');
}

export function escapeXmlText(text: string): string {
  return stripXmlIllegal(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttr(value: string): string {
  return stripXmlIllegal(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

export function serializeXml(node: XmlNode): string {
  if (node.kind === 'text') return escapeXmlText(node.text);
  const attrs = node.attrs.map((attr) => ` ${attr.name}="${escapeXmlAttr(attr.value)}"`).join('');
  if (node.children.length === 0) return `<${node.name}${attrs}/>`;
  return `<${node.name}${attrs}>${node.children.map(serializeXml).join('')}</${node.name}>`;
}
