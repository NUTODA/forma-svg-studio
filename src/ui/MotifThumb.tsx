import { useEffect, useId, useMemo, useRef } from 'react';
import type { CSSProperties, JSX } from 'react';
import type { MotifId } from '../domain/types';
import { resolveAsset, variantForLayer } from '../assets/availability';
import { instantiate } from '../svg/template';
import type { SvgTemplate } from '../svg/template';
import { motifName, thumbIdPrefix, thumbViewBox } from './briefFormat';
import { useEditorApi } from './state/editorContext';
import './MotifThumb.css';

export interface MotifThumbProps {
  motif: MotifId;
  /** Square side in px; omitted — fills the parent box. */
  size?: number;
  className?: string;
}

/**
 * Instantiated markup is cached per template object: switching palette/mode back and forth
 * (or re-rendering while dragging on the artboard) never re-runs `instantiate` for known inputs.
 */
const markupCache = new WeakMap<SvgTemplate, Map<string, string>>();
const MAX_KEYS_PER_TEMPLATE = 24;

function cachedMarkup(template: SvgTemplate, key: string, build: () => string): string {
  let byKey = markupCache.get(template);
  if (!byKey) {
    byKey = new Map();
    markupCache.set(template, byKey);
  }
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const markup = build();
  if (byKey.size >= MAX_KEYS_PER_TEMPLATE) {
    const oldest = byKey.keys().next();
    if (!oldest.done) byKey.delete(oldest.value);
  }
  byKey.set(key, markup);
  return markup;
}

export function MotifThumb({ motif, size, className }: MotifThumbProps): JSX.Element {
  const api = useEditorApi();
  const instanceId = useId();
  const idPrefix = thumbIdPrefix(instanceId);
  const name = motifName(motif);

  const { files, doc, palette, templates } = api;
  const variant = variantForLayer('object', doc.colorMode);
  const resolved = useMemo(
    () => resolveAsset(files, motif, doc.detail, variant),
    [files, motif, doc.detail, variant],
  );
  const file = resolved?.meta.file ?? null;
  const template = file ? templates.get(file) : undefined;

  const requestRef = useRef(api.requestTemplates);
  useEffect(() => {
    requestRef.current = api.requestTemplates;
  });
  useEffect(() => {
    if (file) requestRef.current([file]);
  }, [file]);

  // Everything the resolver depends on, so a palette edit under the same id still refreshes.
  const paintKey = `${palette.id}|${doc.colorMode}|${Object.values(palette.colors).join('')}`;
  const colorRef = useRef(api.color);
  colorRef.current = api.color;
  const markup = useMemo(() => {
    if (!template) return null;
    return cachedMarkup(template, `${idPrefix}|${paintKey}`, () =>
      instantiate(template, {
        idPrefix,
        color: (hex) => colorRef.current(hex, template.source),
      }),
    );
  }, [template, idPrefix, paintKey]);

  const classes = ['motif-thumb', className].filter(Boolean).join(' ');
  const style = size ? ({ '--thumb-size': `${size}px` } as CSSProperties) : undefined;

  if (!resolved) {
    return (
      <span className={`${classes} motif-thumb--empty`} style={style} role="img" aria-label={`${name}: нет файла`} />
    );
  }
  if (markup === null || !template) {
    return (
      <span
        className={`${classes} motif-thumb--loading`}
        style={style}
        role="img"
        aria-label={`${name}: загрузка`}
        aria-busy="true"
      />
    );
  }
  return (
    <svg
      className={classes}
      style={style}
      viewBox={thumbViewBox(template.bounds)}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={name}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
