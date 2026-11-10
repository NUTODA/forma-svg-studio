// Pure helpers for the palette import dialog.
import { PAINT_ROLES } from '../domain/types';
import type { PaintRole } from '../domain/types';
import type { PaletteError } from '../palette/validate';

/** Roles that may be omitted from the imported JSON. */
export const OPTIONAL_ROLES: ReadonlySet<PaintRole> = new Set<PaintRole>(['paper']);

export function isRoleRequired(role: PaintRole): boolean {
  return !OPTIONAL_ROLES.has(role);
}

/** Roles in schema order. */
export const SCHEMA_ROLES: readonly PaintRole[] = PAINT_ROLES;

/** "20 КБ" from a byte count (decimal kilobytes, rounded up for limits). */
export function formatKilobytes(bytes: number): string {
  const kb = bytes / 1000;
  const text = kb >= 10 ? String(Math.ceil(kb)) : String(Math.round(kb * 10) / 10).replace('.', ',');
  return `${text} КБ`;
}

export function isFileTooLarge(size: number, maxBytes: number): boolean {
  return size > maxBytes;
}

export function fileTooLargeMessage(size: number, maxBytes: number): string {
  return `Файл слишком большой: ${formatKilobytes(size)}, допустимо не более ${formatKilobytes(maxBytes)}`;
}

/** Label for the JSON path of an error; the empty path means the whole document. */
export function errorPathLabel(error: PaletteError): string {
  return error.path === '' ? 'JSON' : error.path;
}

/** Russian plural: pluralize(1, ['ошибка','ошибки','ошибок']). */
export function pluralize(n: number, forms: readonly [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

export const TEMPLATE_FILE_NAME = 'forma-palette-template.json';
