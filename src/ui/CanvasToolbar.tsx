import { useEffect, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import type { ArtboardPresetId, ColorMode, Detail, LayoutMode } from '../domain/types';
import { ARTBOARD_PRESETS } from '../layout/compose';
import { nextRadioIndex } from './Artboard.geometry';
import {
  IconBackground,
  IconLayers,
  IconRatioLandscape,
  IconRatioPortrait,
  IconRatioSquare,
  IconRefresh,
  IconText,
} from './icons';
import { useEditorApi } from './state/editorContext';
import './CanvasToolbar.css';

interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  title: string;
  /** Accessible name when the visible label is not enough. */
  ariaLabel?: string;
}

interface RadioSegProps<T extends string> {
  label: string;
  value: T;
  options: readonly RadioOption<T>[];
  onChange(value: T): void;
}

/** Segmented radiogroup with a roving tabindex and arrow-key navigation (selection follows focus). */
function RadioSeg<T extends string>({ label, value, options, onChange }: RadioSegProps<T>): JSX.Element {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextRadioIndex(e.key, current < 0 ? 0 : current, items.length);
    const option = next === null ? undefined : options[next];
    if (next === null || !option) return;
    e.preventDefault();
    items[next]?.focus();
    onChange(option.value);
  }

  return (
    <div className="seg canvas-toolbar__seg" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            className="seg__item"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={checked ? 0 : -1}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const PRESET_ICONS: Record<ArtboardPresetId, ReactNode> = {
  square: <IconRatioSquare />,
  portrait: <IconRatioPortrait />,
  og: <IconRatioLandscape />,
};
const PRESET_TEXT: Record<ArtboardPresetId, string> = { square: '1:1', portrait: '4:5', og: '1200×630' };
const PRESET_ORDER: readonly ArtboardPresetId[] = ['square', 'portrait', 'og'];

const DETAIL_OPTIONS: readonly RadioOption<Detail>[] = [
  { value: 's', label: 'S', title: 'Упрощённая детализация', ariaLabel: 'S, упрощённая детализация' },
  { value: 'l', label: 'L', title: 'Подробная детализация', ariaLabel: 'L, подробная детализация' },
];

const LAYOUT_OPTIONS: readonly RadioOption<LayoutMode>[] = [
  { value: 'composed', label: 'По центру', title: 'Натюрморт по центру артборда' },
  { value: 'offset', label: 'Со смещением', title: 'Группа у дальнего угла, свободное место напротив' },
  { value: 'title', label: 'С заголовком', title: 'Место под заголовок и объекты рядом' },
];

const COLOR_OPTIONS: readonly RadioOption<ColorMode>[] = [
  { value: 'color', label: 'Цветной', title: 'Цветные версии объектов' },
  { value: 'mono', label: 'Монохром', title: 'Монохромные версии объектов' },
];

export function CanvasToolbar(): JSX.Element {
  const api = useEditorApi();
  const { doc } = api;
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Publish both pill heights so the artboard keeps clear of them when they wrap. The vars set the
  // artboard's padding, and the artboard is observed too and sits higher in the tree than the pills,
  // so writing them from inside the observer callback ends the delivery loop with undelivered
  // notifications (WebKit reports it). Observed changes are applied on the next frame instead.
  useEffect(() => {
    const top = topRef.current;
    const bottom = bottomRef.current;
    const host = rootRef.current?.parentElement;
    if (!top || !bottom || !host) return undefined;
    const setVar = (name: string, px: number) => {
      const value = `${px}px`;
      if (host.style.getPropertyValue(name) !== value) host.style.setProperty(name, value);
    };
    const publish = () => {
      // Read both heights before writing either, so layout is flushed once.
      const topHeight = top.offsetHeight;
      const bottomHeight = bottom.offsetHeight;
      setVar('--canvas-toolbar-h', topHeight);
      setVar('--canvas-toolbar-bottom-h', bottomHeight);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        publish();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(top);
    observer.observe(bottom);
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      host.style.removeProperty('--canvas-toolbar-h');
      host.style.removeProperty('--canvas-toolbar-bottom-h');
    };
  }, []);

  const presetOptions = PRESET_ORDER.map<RadioOption<ArtboardPresetId>>((id) => {
    const preset = ARTBOARD_PRESETS[id];
    const title = preset ? `${preset.label} — ${preset.hint}` : PRESET_TEXT[id];
    return {
      value: id,
      title,
      ariaLabel: `${PRESET_TEXT[id]}: ${title}`,
      label: (
        <>
          {PRESET_ICONS[id]}
          <span>{PRESET_TEXT[id]}</span>
        </>
      ),
    };
  });

  const headlineAvailable = doc.layout === 'title';

  return (
    <div ref={rootRef} className="canvas-toolbar">
      <div ref={topRef} className="canvas-toolbar__pill" role="group" aria-label="Формат и компоновка">
        <RadioSeg label="Формат" value={doc.preset} options={presetOptions} onChange={api.setPreset} />
        <span className="canvas-toolbar__divider" aria-hidden="true" />
        <RadioSeg label="Детализация" value={doc.detail} options={DETAIL_OPTIONS} onChange={api.setDetail} />
        <span className="canvas-toolbar__divider" aria-hidden="true" />
        <RadioSeg label="Компоновка" value={doc.layout} options={LAYOUT_OPTIONS} onChange={api.setLayout} />
        <span className="canvas-toolbar__divider" aria-hidden="true" />
        <button
          type="button"
          className="icon-btn"
          aria-label="Перекомпоновать"
          title="Перекомпоновать объекты"
          onClick={api.recompose}
        >
          <IconRefresh />
        </button>
      </div>
      <div
        ref={bottomRef}
        className="canvas-toolbar__pill canvas-toolbar__pill--bottom"
        role="group"
        aria-label="Цвет и оформление"
      >
        <RadioSeg label="Цвет" value={doc.colorMode} options={COLOR_OPTIONS} onChange={api.setColorMode} />
        <span className="canvas-toolbar__divider" aria-hidden="true" />
        <div className="seg canvas-toolbar__seg" role="group" aria-label="Слои оформления">
          <button
            type="button"
            className="seg__item"
            aria-pressed={doc.showPlane}
            title="Фоновая плоскость палитры"
            onClick={() => api.setShowPlane(!doc.showPlane)}
          >
            <IconBackground />
            <span>Плоскость</span>
          </button>
          <button
            type="button"
            className="seg__item"
            aria-pressed={doc.backgroundObjects}
            title="Монохромные копии объектов позади"
            onClick={() => api.setBackgroundObjects(!doc.backgroundObjects)}
          >
            <IconLayers />
            <span>Эхо</span>
          </button>
          <button
            type="button"
            className="seg__item"
            aria-pressed={doc.showHeadline && headlineAvailable}
            disabled={!headlineAvailable}
            title={
              headlineAvailable
                ? 'Показать зону заголовка (в экспорт не попадает)'
                : 'Зона заголовка доступна в компоновке «С заголовком»'
            }
            onClick={() => api.setShowHeadline(!doc.showHeadline)}
          >
            <IconText />
            <span>Заголовок</span>
          </button>
        </div>
      </div>
    </div>
  );
}
