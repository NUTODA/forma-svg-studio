// CONTRACT STUB — owned by the palette agent. Signatures are fixed; bodies/values to be implemented.
import type { PaintRole, Variant } from '../domain/types';

export interface RoleInfo {
  /** Russian short label, e.g. «Основной». */
  label: string;
  /** Russian description of where the role is used. */
  description: string;
  /** Which source drawings use it. */
  group: 'artboard' | 'main' | 'background';
}

export const ROLE_INFO: Record<PaintRole, RoleInfo> = {} as Record<PaintRole, RoleInfo>;

/** Roles that main-variant source colours are classified into. */
export const MAIN_ROLES: readonly PaintRole[] = [];
/** Roles that background-variant source colours are classified into. */
export const BACKDROP_ROLES: readonly PaintRole[] = [];

/** Reference colours of the original Figma drawings per role (default palette == these, so it renders 1:1). */
export const SOURCE_REFERENCE: Record<PaintRole, string> = {} as Record<PaintRole, string>;

/** Nearest role (OKLab distance) for a source colour within the role set of the given variant. */
export function classifyColor(_hex: string, _sourceVariant: Variant): PaintRole {
  throw new Error('not implemented');
}
