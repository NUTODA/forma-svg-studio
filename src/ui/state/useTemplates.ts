import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadTemplate } from '../../assets/loader';
import type { AssetFileMeta, PlaneFileMeta } from '../../domain/types';
import type { SvgTemplate } from '../../svg/template';
import type { StatusLevel } from './editorContext';

type Meta = AssetFileMeta | PlaneFileMeta;
type TemplateMap = ReadonlyMap<string, SvgTemplate>;

/** Coalesces arrivals of several templates into one React update. */
const FLUSH_DELAY_MS = 16;

export interface TemplateStore {
  templates: TemplateMap;
  /** Fire-and-forget loading (thumbnails, artboard). Unknown, loaded, loading and failed files are skipped. */
  requestTemplates(files: readonly string[]): void;
  /** Resolves with every template loaded so far once all `files` are available; rejects naming the first failure. */
  ensureTemplates(files: readonly string[]): Promise<TemplateMap>;
}

export function useTemplates(
  metaByFile: ReadonlyMap<string, Meta>,
  announce: (text: string, level?: StatusLevel) => void,
): TemplateStore {
  const [templates, setTemplates] = useState<TemplateMap>(() => new Map());
  const loaded = useRef(new Map<string, SvgTemplate>());
  const inflight = useRef(new Map<string, Promise<boolean>>());
  const failed = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timer.current !== null) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (mounted.current) setTemplates(new Map(loaded.current));
    }, FLUSH_DELAY_MS);
  }, []);

  /** Starts (or joins) loading of one file; resolves true when the template is available. */
  const start = useCallback(
    (file: string): Promise<boolean> => {
      if (loaded.current.has(file)) return Promise.resolve(true);
      const running = inflight.current.get(file);
      if (running) return running;
      const meta = metaByFile.get(file);
      if (!meta) return Promise.resolve(false);
      // The extra tick turns a synchronous throw inside the loader into a normal failure.
      const task = Promise.resolve()
        .then(() => loadTemplate(meta))
        .then(
          (template) => {
            loaded.current.set(file, template);
            failed.current.delete(file);
            scheduleFlush();
            return true;
          },
          () => {
            failed.current.add(file);
            if (mounted.current) announce(`Не удалось загрузить ${file}`, 'error');
            return false;
          },
        )
        .finally(() => inflight.current.delete(file));
      inflight.current.set(file, task);
      return task;
    },
    [metaByFile, announce, scheduleFlush],
  );

  const requestTemplates = useCallback(
    (files: readonly string[]) => {
      for (const file of new Set(files)) {
        if (failed.current.has(file)) continue;
        void start(file);
      }
    },
    [start],
  );

  const ensureTemplates = useCallback(
    async (files: readonly string[]): Promise<TemplateMap> => {
      const unique = [...new Set(files)];
      for (const file of unique) failed.current.delete(file); // an explicit export retries earlier failures
      const results = await Promise.all(unique.map(start));
      const missing = unique.find((_, i) => !results[i]);
      if (missing !== undefined) throw new Error(`Не удалось загрузить ${missing}`);
      return new Map(loaded.current);
    },
    [start],
  );

  return useMemo(
    () => ({ templates, requestTemplates, ensureTemplates }),
    [templates, requestTemplates, ensureTemplates],
  );
}
