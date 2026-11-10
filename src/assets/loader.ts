import type { AssetFileMeta, PlaneFileMeta } from '../domain/types';
import { buildTemplate, type SvgTemplate } from '../svg/template';
import { isBundledFileName } from './availability';

/** Upper bound for one bundled file (characters); the largest real asset is ~65 KB. */
export const MAX_ASSET_TEXT_LENGTH = 1_000_000;

const cache = new Map<string, SvgTemplate>();
const inflight = new Map<string, Promise<SvgTemplate>>();

/** Public URL of a vetted bundled file (only names present in the manifest are ever requested). */
export function assetUrl(file: string): string {
  if (!isBundledFileName(file)) {
    throw new Error(`Файл «${file}» не входит в библиотеку: имя не соответствует шаблону ресурсов`);
  }
  const base = import.meta.env.BASE_URL || '/';
  return `${base.endsWith('/') ? base : `${base}/`}assets/${file}`;
}

async function fetchTemplate(meta: AssetFileMeta | PlaneFileMeta): Promise<SvgTemplate> {
  const url = assetUrl(meta.file);
  let text: string;
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
    text = await res.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось загрузить «${meta.file}»: ${reason}`);
  }
  if (text.length > MAX_ASSET_TEXT_LENGTH) {
    throw new Error(`Файл «${meta.file}» слишком большой`);
  }
  const source = 'palette' in meta ? meta.palette : 'lavender';
  return buildTemplate(text, { file: meta.file, source });
}

/**
 * Fetch (same-origin), sanitise and cache the template for a manifest entry
 * (objects get source palette `lavender`, planes their own). Concurrent calls share one request.
 */
export function loadTemplate(meta: AssetFileMeta | PlaneFileMeta): Promise<SvgTemplate> {
  const cached = cache.get(meta.file);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(meta.file);
  if (pending) return pending;

  const request = fetchTemplate(meta)
    .then((template) => {
      cache.set(meta.file, template);
      return template;
    })
    .finally(() => {
      inflight.delete(meta.file);
    });
  inflight.set(meta.file, request);
  return request;
}

/** Synchronous cache lookup. */
export function getCachedTemplate(file: string): SvgTemplate | undefined {
  return cache.get(file);
}

/** Drops cached and in-flight templates (tests, hot reload of the manifest). */
export function clearTemplateCache(): void {
  cache.clear();
  inflight.clear();
}
