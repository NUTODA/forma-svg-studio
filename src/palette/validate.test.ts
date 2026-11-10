import { describe, expect, it } from 'vitest';
import { PAINT_ROLES } from '../domain/types';
import { SOURCE_PALETTES } from './roles';
import {
  PALETTE_MAX_BYTES,
  PALETTE_SCHEMA_ID,
  paletteTemplate,
  paletteTemplateJson,
  validatePaletteJson,
} from './validate';
import type { PaletteError, PaletteValidation } from './validate';

const NONE: ReadonlySet<string> = new Set();

function validColors(): Record<string, string> {
  const { paper: _paper, ...rest } = SOURCE_PALETTES.lavender.colors;
  return { ...rest };
}

function doc(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ name: 'Тест', colors: validColors(), ...overrides });
}

function errorsOf(result: PaletteValidation): PaletteError[] {
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

function okOf(result: PaletteValidation): Extract<PaletteValidation, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.errors)}`);
  return result;
}

describe('happy path', () => {
  it('accepts a minimal document and fills defaults', () => {
    const { palette, warnings } = okOf(validatePaletteJson(doc(), NONE));
    expect(palette.name).toBe('Тест');
    expect(palette.plane).toBe('lavender');
    expect(palette.builtIn).toBe(false);
    expect(palette.colors.paper).toBe('#ffffff');
    expect(palette.colors.accent).toBe('#f9a3aa');
    expect(palette.id).toBe('test');
    expect(warnings).toEqual([]);
  });

  it('normalises #RGB and uppercase colours to lowercase #rrggbb', () => {
    const colors = { ...validColors(), accent: '#F0A', tint: '#D7CDF5', paper: '#FFFAF0' };
    const { palette } = okOf(validatePaletteJson(doc({ colors }), NONE));
    expect(palette.colors.accent).toBe('#ff00aa');
    expect(palette.colors.tint).toBe('#d7cdf5');
    expect(palette.colors.paper).toBe('#fffaf0');
  });

  it('accepts schema, plane and a valid id', () => {
    const { palette } = okOf(validatePaletteJson(doc({ schema: PALETTE_SCHEMA_ID, plane: 'mint', id: 'my-pal-1' }), NONE));
    expect(palette.plane).toBe('mint');
    expect(palette.id).toBe('my-pal-1');
  });

  it('trims the name and strips control characters', () => {
    const { palette } = okOf(validatePaletteJson(doc({ name: '  Мо\u0000я‮\n палитра\t ' }), NONE));
    expect(palette.name).toBe('Моя палитра');
  });

  it('allows BOM-free whitespace-padded JSON', () => {
    okOf(validatePaletteJson(`\n  ${doc()}  \n`, NONE));
  });
});

describe('JSON syntax errors', () => {
  it('reports line and column', () => {
    const text = '{\n  "name": "x",\n  "colors": {,}\n}';
    const [error] = errorsOf(validatePaletteJson(text, NONE));
    expect(error?.path).toBe('');
    expect(error?.message).toMatch(/^Ошибка JSON в строке 3, столбце \d+/);
  });

  it('reports a truncated document', () => {
    const [error] = errorsOf(validatePaletteJson('{"name": "x"', NONE));
    expect(error?.message).toMatch(/^Ошибка JSON/);
  });

  it('never throws on garbage', () => {
    for (const text of ['{', '}', 'undefined', "{'a':1}", '[1,', '\u0000', '{"a":}', 'NaN']) {
      expect(validatePaletteJson(text, NONE).ok).toBe(false);
    }
  });
});

describe('document-level rejection', () => {
  it('rejects non-string input', () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(validatePaletteJson(bad as unknown as string, NONE).ok).toBe(false);
    }
  });

  it('rejects blank input', () => {
    expect(validatePaletteJson('', NONE).ok).toBe(false);
    expect(validatePaletteJson('  \n\t ', NONE).ok).toBe(false);
  });

  it('rejects oversize input by UTF-8 byte length before parsing', () => {
    const filler = 'я'.repeat(PALETTE_MAX_BYTES / 2); // 2 bytes each → exactly over the limit with the wrapper
    const text = `{"name":"${filler}"}`;
    expect(text.length).toBeLessThan(PALETTE_MAX_BYTES);
    const [error] = errorsOf(validatePaletteJson(text, NONE));
    expect(error?.message).toMatch(/слишком большой/);
    expect(validatePaletteJson('x'.repeat(PALETTE_MAX_BYTES + 1), NONE).ok).toBe(false);
  });

  it('rejects array, null and primitive roots', () => {
    for (const text of ['[]', '[{"name":"x"}]', 'null', '42', '"text"', 'true']) {
      const [error] = errorsOf(validatePaletteJson(text, NONE));
      expect(error?.path).toBe('');
      expect(error?.message).toMatch(/объект/);
    }
  });
});

describe('field errors', () => {
  it('requires a name', () => {
    const errors = errorsOf(validatePaletteJson(JSON.stringify({ colors: validColors() }), NONE));
    expect(errors.map((e) => e.path)).toEqual(['name']);
  });

  it('rejects non-string, blank and too long names', () => {
    expect(errorsOf(validatePaletteJson(doc({ name: 5 }), NONE))[0]?.path).toBe('name');
    expect(errorsOf(validatePaletteJson(doc({ name: '   ' }), NONE))[0]?.path).toBe('name');
    expect(errorsOf(validatePaletteJson(doc({ name: '\u0000​' }), NONE))[0]?.path).toBe('name');
    expect(errorsOf(validatePaletteJson(doc({ name: 'а'.repeat(41) }), NONE))[0]?.path).toBe('name');
    okOf(validatePaletteJson(doc({ name: 'а'.repeat(40) }), NONE));
  });

  it('rejects an unknown schema', () => {
    const errors = errorsOf(validatePaletteJson(doc({ schema: 'other/v9' }), NONE));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe('schema');
  });

  it('rejects an invalid plane', () => {
    expect(errorsOf(validatePaletteJson(doc({ plane: 'violet' }), NONE))[0]?.path).toBe('plane');
    expect(errorsOf(validatePaletteJson(doc({ plane: 1 }), NONE))[0]?.path).toBe('plane');
  });

  it('requires colors to be an object', () => {
    expect(errorsOf(validatePaletteJson(JSON.stringify({ name: 'x' }), NONE))[0]?.path).toBe('colors');
    for (const colors of [null, [], 'red', 7]) {
      expect(errorsOf(validatePaletteJson(doc({ colors }), NONE))[0]?.path).toBe('colors');
    }
  });

  it('rejects bad colour formats with a Russian message and JSON path', () => {
    const bad: Record<string, string> = {
      accent: 'violet',
      tint: '#12',
      tone: 'rgb(1, 2, 3)',
      deep: '#12345g',
      highlight: '7864d7',
      accentSoft: '#7864d7ff',
    };
    const errors = errorsOf(validatePaletteJson(doc({ colors: { ...validColors(), ...bad } }), NONE));
    expect(errors.map((e) => e.path).sort()).toEqual(Object.keys(bad).map((k) => `colors.${k}`).sort());
    const accent = errors.find((e) => e.path === 'colors.accent');
    expect(accent?.message).toBe('ожидается цвет в формате #RRGGBB, получено «violet»');
  });

  it('rejects non-string colour values', () => {
    const errors = errorsOf(
      validatePaletteJson(doc({ colors: { ...validColors(), accent: 123, ink: null, light: { r: 1 } } }), NONE),
    );
    expect(errors.map((e) => e.path).sort()).toEqual(['colors.accent', 'colors.ink', 'colors.light']);
    expect(errors.find((e) => e.path === 'colors.accent')?.message).toMatch(/получено 123$/);
  });

  it('truncates echoed values to 40 characters', () => {
    const long = '#' + 'z'.repeat(500);
    const errors = errorsOf(validatePaletteJson(doc({ colors: { ...validColors(), accent: long } }), NONE));
    const message = errors[0]?.message ?? '';
    expect(message).toContain('z'.repeat(39) + '…');
    expect(message).not.toContain('z'.repeat(41));
  });

  it('does not echo control characters in error messages', () => {
    const errors = errorsOf(validatePaletteJson(doc({ colors: { ...validColors(), accent: 'a\u0000b‮c' } }), NONE));
    expect(errors[0]?.message).toBe('ожидается цвет в формате #RRGGBB, получено «abc»');
  });

  it('reports every missing role (paper is optional)', () => {
    const errors = errorsOf(validatePaletteJson(doc({ colors: {} }), NONE));
    const expected = PAINT_ROLES.filter((r) => r !== 'paper').map((r) => `colors.${r}`);
    expect(errors.map((e) => e.path)).toEqual(expected);
    expect(errors.every((e) => /[а-яё]/i.test(e.message))).toBe(true);
  });

  it('collects errors from several fields at once', () => {
    const text = JSON.stringify({ name: '', plane: 'x', colors: { tint: 'nope' } });
    const paths = errorsOf(validatePaletteJson(text, NONE)).map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'plane', 'colors.tint', 'colors.accent', 'colors.ink']));
    expect(paths).not.toContain('colors.paper');
  });
});

describe('warnings', () => {
  it('warns about unknown top-level keys and unknown roles but still succeeds', () => {
    const result = okOf(
      validatePaletteJson(doc({ author: 'me', colors: { ...validColors(), sparkle: '#fff' } }), NONE),
    );
    expect(result.warnings.some((w) => w.includes('author'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('sparkle'))).toBe(true);
    expect(Object.keys(result.palette.colors).sort()).toEqual([...PAINT_ROLES].sort());
  });

  it('caps the list of unknown keys', () => {
    const extra = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const result = okOf(validatePaletteJson(doc(extra), NONE));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/и ещё 45/);
  });

  it('warns about low contrast of ink on tint and on light', () => {
    const colors = { ...validColors(), ink: '#d7cdf5', tint: '#d7cdf5', light: '#ffffff' };
    const warnings = okOf(validatePaletteJson(doc({ colors }), NONE)).warnings;
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/Контур.*Светлый фон.*1,0:1/);
    expect(warnings[1]).toMatch(/Контур.*Белый/);
  });

  it('warns only about the failing pair', () => {
    const colors = { ...validColors(), ink: '#181817', light: '#2a2a2a' };
    const warnings = okOf(validatePaletteJson(doc({ colors }), NONE)).warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Белый/);
  });

  it('has no contrast warnings for the built-in swatches', () => {
    expect(okOf(validatePaletteJson(paletteTemplateJson(), NONE)).warnings).toEqual([]);
  });
});

describe('prototype pollution safety', () => {
  it('does not pollute Object.prototype via top-level __proto__', () => {
    const text = `{"__proto__": {"polluted": "yes"}, "name": "x", "colors": ${JSON.stringify(validColors())}}`;
    const result = okOf(validatePaletteJson(text, NONE));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.palette)).toBe(Object.prototype);
    expect((result.palette as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('__proto__'))).toBe(true);
  });

  it('does not pollute via nested __proto__, constructor or prototype in colors', () => {
    const colors = `{"__proto__": {"polluted2": 1}, "constructor": {"prototype": {"polluted3": 1}}, "prototype": {}, ${JSON.stringify(validColors()).slice(1)}`;
    const result = okOf(validatePaletteJson(`{"name":"x","colors":${colors}}`, NONE));
    expect(({} as Record<string, unknown>).polluted2).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted3).toBeUndefined();
    expect(Object.keys(result.palette.colors).sort()).toEqual([...PAINT_ROLES].sort());
  });

  it('does not leak dangerous keys as roles or ids', () => {
    const result = okOf(validatePaletteJson(doc({ id: '__proto__' }), NONE));
    expect(result.palette.id).toBe('test');
  });

  it('ignores inherited properties of the parsed object', () => {
    // A JSON text can never carry inherited properties, but the validator must also not
    // pick up values from a polluted prototype for missing fields.
    Object.defineProperty(Object.prototype, 'name', { value: 'inherited', configurable: true });
    Object.defineProperty(Object.prototype, 'colors', { value: validColors(), configurable: true });
    try {
      const errors = errorsOf(validatePaletteJson('{}', NONE));
      expect(errors.map((e) => e.path)).toEqual(expect.arrayContaining(['name', 'colors']));
    } finally {
      delete (Object.prototype as Record<string, unknown>).name;
      delete (Object.prototype as Record<string, unknown>).colors;
    }
  });

  it('returns a fresh palette whose colors are a plain object', () => {
    const result = okOf(validatePaletteJson(doc(), NONE));
    expect(Object.getPrototypeOf(result.palette.colors)).toBe(Object.prototype);
  });
});

describe('ids', () => {
  it('derives a slug from a transliterated Russian name', () => {
    expect(okOf(validatePaletteJson(doc({ name: 'Морской бриз' }), NONE)).palette.id).toBe('morskoy-briz');
    expect(okOf(validatePaletteJson(doc({ name: 'Щётка № 5 «Ёж»' }), NONE)).palette.id).toBe('shchetka-5-ezh');
    expect(okOf(validatePaletteJson(doc({ name: '★★★' }), NONE)).palette.id).toBe('palette');
  });

  it('replaces an invalid id with a derived one and warns', () => {
    for (const id of ['Bad Id', '-x', '', 7, 'a'.repeat(41)]) {
      const result = okOf(validatePaletteJson(doc({ name: 'Закат', id }), NONE));
      expect(result.palette.id).toBe('zakat');
      expect(result.warnings.some((w) => w.includes('Идентификатор'))).toBe(true);
    }
  });

  it('is unique against built-in ids', () => {
    expect(okOf(validatePaletteJson(doc({ id: 'lavender' }), NONE)).palette.id).toBe('lavender-2');
    expect(okOf(validatePaletteJson(doc({ id: 'mint' }), new Set(['mint-2']))).palette.id).toBe('mint-3');
    expect(okOf(validatePaletteJson(doc({ name: 'Мята' }), NONE)).palette.id).toBe('myata');
    expect(okOf(validatePaletteJson(doc({ name: 'Peach', id: undefined }), new Set(['peach']))).palette.id).toBe('peach-2');
  });

  it('is unique against takenIds, counting upwards', () => {
    const taken = new Set(['mine', 'mine-2', 'mine-3']);
    const result = okOf(validatePaletteJson(doc({ id: 'mine' }), taken));
    expect(result.palette.id).toBe('mine-4');
    expect(result.warnings.some((w) => w.includes('mine-4'))).toBe(true);
  });

  it('keeps unique ids within 40 characters', () => {
    const base = 'a'.repeat(40);
    const id = okOf(validatePaletteJson(doc({ id: base }), new Set([base]))).palette.id;
    expect(id.length).toBeLessThanOrEqual(40);
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
    expect(id.endsWith('-2')).toBe(true);
  });

  it('truncates very long derived ids to a valid slug', () => {
    const id = okOf(validatePaletteJson(doc({ name: 'щщщщщщщщщщ щщщщщщщщщщ' }), NONE)).palette.id;
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
  });
});

describe('template', () => {
  it('has the documented shape', () => {
    const template = paletteTemplate() as Record<string, unknown>;
    expect(template.schema).toBe(PALETTE_SCHEMA_ID);
    expect(template.name).toBe('Моя палитра');
    expect(template.plane).toBe('lavender');
    expect(template.colors).toEqual(SOURCE_PALETTES.lavender.colors);
    expect(Object.keys(template.colors as object)).toEqual([...PAINT_ROLES]);
  });

  it('serialises pretty-printed and round-trips', () => {
    const json = paletteTemplateJson();
    expect(json).toContain('\n  "schema"');
    expect(JSON.parse(json)).toEqual(paletteTemplate());
  });

  it('validates OK without warnings', () => {
    const { palette, warnings } = okOf(validatePaletteJson(paletteTemplateJson(), NONE));
    expect(warnings).toEqual([]);
    expect(palette.name).toBe('Моя палитра');
    expect(palette.id).toBe('moya-palitra');
    expect(palette.colors).toEqual(SOURCE_PALETTES.lavender.colors);
  });
});
