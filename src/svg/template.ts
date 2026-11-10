// CONTRACT STUB — owned by the SVG core agent. Signatures are fixed; bodies to be implemented.
import type { Box, Variant } from '../domain/types';

/**
 * A pre-processed, sanitised bundled SVG ready for fast per-instance rendering.
 * `body` is opaque: wrapper <g> carrying the root presentation attributes + sanitised children,
 * with internal tokens for the per-instance id prefix and for every paint colour.
 */
export interface SvgTemplate {
  file: string;
  variant: Variant;
  viewBox: Box;
  bounds: Box;
  colors: string[];
  body: string;
  warnings: string[];
}

export interface SvgAnalysis {
  viewBox: Box;
  bounds: Box;
  colors: string[];
  warnings: string[];
}

/** Parse + sanitise + measure raw SVG source. Throws `Error` with a Russian message if unusable. */
export function analyzeSvgSource(_source: string): SvgAnalysis {
  throw new Error('not implemented');
}

export function buildTemplate(_source: string, _info: { file: string; variant: Variant }): SvgTemplate {
  throw new Error('not implemented');
}

/**
 * Produce standalone markup (one <g>…</g>) for one instance:
 * every id becomes `${idPrefix}${id}`, every url(#id) / href="#id" / xlink:href="#id" reference
 * is rewritten accordingly, every paint colour is passed through `color`.
 */
export function instantiate(
  _template: SvgTemplate,
  _opts: { idPrefix: string; color: (hex: string) => string },
): string {
  throw new Error('not implemented');
}
