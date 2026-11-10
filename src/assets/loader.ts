// CONTRACT STUB — owned by the SVG core agent. Signatures are fixed; bodies to be implemented.
import type { AssetFileMeta, PlaneFileMeta } from '../domain/types';
import type { SvgTemplate } from '../svg/template';

/** Public URL of a vetted bundled file (only names present in the manifest are ever requested). */
export function assetUrl(_file: string): string {
  throw new Error('not implemented');
}

/**
 * Fetch (same-origin), sanitise and cache the template for a manifest entry
 * (objects get source palette `lavender`, planes their own). Concurrent calls share one request.
 */
export function loadTemplate(_meta: AssetFileMeta | PlaneFileMeta): Promise<SvgTemplate> {
  throw new Error('not implemented');
}

/** Synchronous cache lookup. */
export function getCachedTemplate(_file: string): SvgTemplate | undefined {
  throw new Error('not implemented');
}
