import { PAINT_ROLES, SOURCE_PALETTE_IDS } from '../domain/types';
import type { PaintRole, Palette, SourcePaletteId } from '../domain/types';
import { BUILTIN_PALETTES } from './builtins';
import { contrastRatio, normalizeHex } from './color';
import { ROLE_INFO, SOURCE_PALETTES } from './roles';

export const PALETTE_SCHEMA_ID = 'forma.palette/v1';
/** Max accepted JSON size in bytes. */
export const PALETTE_MAX_BYTES = 20_000;

export interface PaletteError {
  /** JSON path, e.g. `colors.accent`; empty string for the whole document. */
  path: string;
  /** Russian, actionable. */
  message: string;
}

export type PaletteValidation =
  | { ok: true; palette: Palette; warnings: string[] }
  | { ok: false; errors: PaletteError[] };

const NAME_MAX_CHARS = 40;
const ECHO_MAX_CHARS = 40;
const MAX_LISTED_UNKNOWN_KEYS = 5;
const MIN_CONTRAST = 3;
const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['schema', 'name', 'id', 'plane', 'colors']);
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX_INPUT = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// C0/C1 controls plus zero-width and bidi override characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** Ready-to-edit template object (schema, name, plane, colors for every role). */
export function paletteTemplate(): unknown {
  return {
    schema: PALETTE_SCHEMA_ID,
    name: 'Моя палитра',
    plane: 'lavender',
    colors: { ...SOURCE_PALETTES.lavender.colors },
  };
}

/** Pretty-printed template JSON. */
export function paletteTemplateJson(): string {
  return JSON.stringify(paletteTemplate(), null, 2);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownValue(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/** Short, safe-to-display representation of an arbitrary JSON value. */
function echo(value: unknown): string {
  const raw = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  const clean = stripInvisible(raw);
  const chars = Array.from(clean);
  const shown = chars.length > ECHO_MAX_CHARS ? `${chars.slice(0, ECHO_MAX_CHARS).join('')}…` : clean;
  return typeof value === 'string' ? `«${shown}»` : shown;
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function positionToLineColumn(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(position, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

function describeJsonError(error: unknown, text: string): string {
  const message = error instanceof Error ? error.message : '';
  const hint = 'Проверьте запятые, кавычки и скобки рядом с этим местом.';

  const lineColumn = /line (\d+) column (\d+)/.exec(message);
  if (lineColumn?.[1] && lineColumn[2]) {
    return `Ошибка JSON в строке ${lineColumn[1]}, столбце ${lineColumn[2]}. ${hint}`;
  }
  const position = /position (\d+)/.exec(message);
  if (position?.[1]) {
    const { line, column } = positionToLineColumn(text, Number(position[1]));
    return `Ошибка JSON в строке ${line}, столбце ${column}. ${hint}`;
  }
  if (/end of (JSON|data)|unterminated|unexpected end/i.test(message)) {
    const { line, column } = positionToLineColumn(text, text.length);
    return `Ошибка JSON в строке ${line}, столбце ${column}: текст оборван, не хватает закрывающей скобки или кавычки.`;
  }
  return `Ошибка JSON: файл не удалось разобрать. ${hint}`;
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function slugFromName(name: string): string {
  const transliterated = Array.from(name.toLowerCase())
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('');
  const slug = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_MAX_CHARS)
    .replace(/-+$/g, '');
  return slug || 'palette';
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const isTaken = (id: string): boolean => taken.has(id) || BUILTIN_PALETTES.some((p) => p.id === id);
  if (!isTaken(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, NAME_MAX_CHARS - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(1).replace('.', ',');
}

function listUnknownKeys(keys: string[]): string {
  const shown = keys.slice(0, MAX_LISTED_UNKNOWN_KEYS).map(echo).join(', ');
  const rest = keys.length - MAX_LISTED_UNKNOWN_KEYS;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/* ------------------------------------------------------------------ */
/* Field validators                                                    */
/* ------------------------------------------------------------------ */

function validateName(raw: unknown, present: boolean, errors: PaletteError[]): string | null {
  if (!present) {
    errors.push({ path: 'name', message: 'Не хватает названия палитры — добавьте поле name, например "Моя палитра".' });
    return null;
  }
  if (typeof raw !== 'string') {
    errors.push({ path: 'name', message: `Название должно быть строкой, получено ${echo(raw)}.` });
    return null;
  }
  const name = stripInvisible(raw).trim();
  const length = Array.from(name).length;
  if (length === 0) {
    errors.push({ path: 'name', message: 'Название палитры пустое — введите от 1 до 40 символов.' });
    return null;
  }
  if (length > NAME_MAX_CHARS) {
    errors.push({
      path: 'name',
      message: `Название слишком длинное: ${length} симв., допустимо не больше ${NAME_MAX_CHARS}. Сократите его.`,
    });
    return null;
  }
  return name;
}

function validateColors(
  raw: unknown,
  present: boolean,
  errors: PaletteError[],
  warnings: string[],
): Record<PaintRole, string> | null {
  if (!present) {
    errors.push({ path: 'colors', message: 'Не хватает объекта colors — в нём должны быть цвета всех ролей.' });
    return null;
  }
  if (!isPlainObject(raw)) {
    errors.push({ path: 'colors', message: 'Поле colors должно быть объектом вида {"accent": "#RRGGBB", …}.' });
    return null;
  }

  const result: Partial<Record<PaintRole, string>> = {};
  let valid = true;
  for (const role of PAINT_ROLES) {
    const path = `colors.${role}`;
    if (!Object.hasOwn(raw, role)) {
      if (role === 'paper') {
        result.paper = '#ffffff';
      } else {
        valid = false;
        errors.push({
          path,
          message: `Не хватает цвета «${ROLE_INFO[role].label}» — добавьте поле ${role} в формате #RRGGBB.`,
        });
      }
      continue;
    }
    const value = raw[role];
    const hex = typeof value === 'string' && HEX_INPUT.test(value) ? normalizeHex(value) : null;
    if (hex === null) {
      valid = false;
      errors.push({ path, message: `ожидается цвет в формате #RRGGBB, получено ${echo(value)}` });
    } else {
      result[role] = hex;
    }
  }

  const unknown = Object.keys(raw).filter((key) => !(PAINT_ROLES as readonly string[]).includes(key));
  if (unknown.length > 0) {
    warnings.push(`Неизвестные роли в colors проигнорированы: ${listUnknownKeys(unknown)}.`);
  }
  return valid ? (result as Record<PaintRole, string>) : null;
}

function validatePlane(raw: unknown, present: boolean, errors: PaletteError[]): SourcePaletteId | null {
  if (!present) return 'lavender';
  if (typeof raw === 'string' && (SOURCE_PALETTE_IDS as readonly string[]).includes(raw)) return raw as SourcePaletteId;
  errors.push({
    path: 'plane',
    message: `Поле plane должно быть одним из значений «lavender», «peach» или «mint», получено ${echo(raw)}.`,
  });
  return null;
}

function resolveId(
  raw: unknown,
  present: boolean,
  name: string,
  taken: ReadonlySet<string>,
  warnings: string[],
): string {
  const given = present && typeof raw === 'string' && SLUG.test(raw) ? raw : null;
  if (present && given === null) {
    warnings.push(
      `Идентификатор ${echo(raw)} не подходит (нужны латинские буквы, цифры и дефис, до 40 символов) — он создан из названия.`,
    );
  }
  const base = given ?? slugFromName(name);
  const id = uniqueId(base, taken);
  if (id !== base && given !== null) {
    warnings.push(`Идентификатор «${base}» уже занят — использован «${id}».`);
  }
  return id;
}

function contrastWarnings(colors: Record<PaintRole, string>): string[] {
  const warnings: string[] = [];
  const pairs: [PaintRole, PaintRole][] = [
    ['ink', 'tint'],
    ['ink', 'light'],
  ];
  for (const [fg, bg] of pairs) {
    const ratio = contrastRatio(colors[fg], colors[bg]);
    if (ratio < MIN_CONTRAST) {
      warnings.push(
        `Низкий контраст: «${ROLE_INFO[fg].label}» и «${ROLE_INFO[bg].label}» — ${formatRatio(ratio)}:1 (рекомендуется не меньше ${MIN_CONTRAST}:1). ` +
          `Сделайте «${ROLE_INFO[fg].label}» темнее или «${ROLE_INFO[bg].label}» светлее, иначе линии будут плохо видны.`,
      );
    }
  }
  return warnings;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Safely parse and validate user-supplied palette JSON (never eval, size-limited, prototype-pollution safe).
 * `takenIds` — ids already used; a fresh unique id is derived when needed.
 */
export function validatePaletteJson(text: string, takenIds: ReadonlySet<string>): PaletteValidation {
  const fail = (message: string): PaletteValidation => ({ ok: false, errors: [{ path: '', message }] });

  if (typeof text !== 'string') return fail('Ожидается текст JSON.');
  if (text.trim() === '') return fail('Файл палитры пуст. Вставьте JSON или начните с шаблона.');
  if (utf8Length(text) > PALETTE_MAX_BYTES) {
    return fail(`Файл слишком большой: допустимо не больше ${PALETTE_MAX_BYTES / 1000} КБ.`);
  }

  let droppedForbidden = false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, function reviver(key: string, value: unknown): unknown {
      if (FORBIDDEN_KEYS.has(key)) {
        droppedForbidden = true;
        return undefined;
      }
      return value;
    });
  } catch (error) {
    return fail(describeJsonError(error, text));
  }

  if (!isPlainObject(parsed)) {
    return fail('Корень файла должен быть объектом {…} с полями name и colors, а не списком или значением.');
  }

  const errors: PaletteError[] = [];
  const warnings: string[] = [];
  if (droppedForbidden) {
    warnings.push('Служебные ключи __proto__, constructor и prototype проигнорированы.');
  }

  const has = (key: string): boolean => Object.hasOwn(parsed, key);
  const schema = ownValue(parsed, 'schema');
  if (has('schema') && schema !== PALETTE_SCHEMA_ID) {
    errors.push({ path: 'schema', message: `Неизвестная версия схемы ${echo(schema)}, ожидается «${PALETTE_SCHEMA_ID}».` });
  }

  const name = validateName(ownValue(parsed, 'name'), has('name'), errors);
  const plane = validatePlane(ownValue(parsed, 'plane'), has('plane'), errors);
  const colors = validateColors(ownValue(parsed, 'colors'), has('colors'), errors, warnings);

  const unknownTop = Object.keys(parsed).filter((key) => !KNOWN_TOP_LEVEL_KEYS.has(key));
  if (unknownTop.length > 0) {
    warnings.push(`Неизвестные поля проигнорированы: ${listUnknownKeys(unknownTop)}.`);
  }

  if (errors.length > 0 || name === null || plane === null || colors === null) {
    return { ok: false, errors };
  }

  const id = resolveId(ownValue(parsed, 'id'), has('id'), name, takenIds, warnings);
  warnings.push(...contrastWarnings(colors));

  return { ok: true, palette: { id, name, colors, plane, builtIn: false }, warnings };
}
