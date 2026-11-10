import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';
import type { Layer } from '../domain/types';
import { MOTIFS } from '../domain/motifs';
import { useEditorApi } from './state/editorContext';
import { IconArrowDown, IconArrowUp, IconBackground, IconEye, IconEyeOff } from './icons';
import { MotifThumb } from './MotifThumb';
import {
  displayOrder,
  layerRowName,
  listKeyIntent,
  movedIndex,
  neighbourAfterRemove,
  reorderAnnouncement,
  tabStopId,
} from './LayersPanel.logic';
import './LayersPanel.css';

/*
 * ARIA pattern: a list of buttons with a single roving tab stop (the selected row).
 * Arrow keys move selection, Alt+Arrows reorder, Space toggles visibility, Delete removes.
 * The per-row icon buttons are mouse/touch/screen-reader affordances: they stay out of the tab
 * order (tabIndex -1) because every action has a keyboard equivalent on the row itself.
 */
export function LayersPanel(): JSX.Element {
  const api = useEditorApi();
  const titleId = useId();
  const helpId = useId();
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLUListElement>(null);
  const refocusRef = useRef(false);

  const order = displayOrder(api.doc.layers);
  const stopId = tabStopId(order, api.selectedId);
  const count = order.length;

  // Re-focus after keyboard-driven DOM moves/removals (reordered nodes can drop focus).
  useLayoutEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    const id = tabStopId(order, api.selectedId);
    if (id) rowRefs.current.get(id)?.focus();
  });

  // Keep the selected row visible by scrolling the list itself. `scrollIntoView` would also scroll every
  // ancestor, and on the stacked phone/tablet layout a canvas selection would then throw the page off the canvas.
  useEffect(() => {
    const list = listRef.current;
    const row = api.selectedId ? rowRefs.current.get(api.selectedId) : undefined;
    if (!list || !row) return;
    const listBox = list.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom;
  }, [api.selectedId]);

  const nameOf = (layer: Layer): string => MOTIFS[layer.motif]?.name ?? layer.motif;

  const move = (layer: Layer, direction: 'up' | 'down'): void => {
    const index = order.findIndex((l) => l.id === layer.id);
    api.reorder(layer.id, direction);
    api.announce(reorderAnnouncement(nameOf(layer), movedIndex(index, direction, count), count));
  };

  const toggle = (layer: Layer): void => {
    api.toggleHidden(layer.id);
    api.announce(`${nameOf(layer)} — ${layer.hidden ? 'показан' : 'скрыт'}`);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, layer: Layer, index: number): void => {
    const intent = listKeyIntent(event, index, count);
    if (!intent) return;
    event.preventDefault();
    event.stopPropagation();
    switch (intent.kind) {
      case 'select': {
        const target = order[intent.index];
        if (!target) return;
        api.select(target.id);
        rowRefs.current.get(target.id)?.focus();
        return;
      }
      case 'reorder':
        api.select(layer.id);
        refocusRef.current = true;
        move(layer, intent.direction);
        return;
      case 'toggle':
        toggle(layer);
        return;
      case 'remove': {
        const neighbour = neighbourAfterRemove(order, index);
        refocusRef.current = true;
        api.remove(layer.id);
        if (neighbour) api.select(neighbour);
        return;
      }
    }
  };

  return (
    <section className="panel-section layers" aria-labelledby={titleId}>
      <div className="panel-section__head">
        <h2 id={titleId} className="label-caps">
          Слои
        </h2>
        <span className="layers__count">
          <span className="visually-hidden">Слоёв: </span>
          {count}
        </span>
      </div>

      {count === 0 ? (
        <p className="layers__empty">Слоёв пока нет</p>
      ) : (
        <>
          <p id={helpId} className="visually-hidden">
            Стрелки — выбор слоя. Alt и стрелки — порядок. Пробел — показать или скрыть. Delete — удалить.
          </p>
          <ul ref={listRef} className="layers__list scroll" role="list" aria-labelledby={titleId} aria-describedby={helpId}>
            {order.map((layer, index) => {
              const selected = layer.id === api.selectedId;
              const name = nameOf(layer);
              return (
                <li
                  key={layer.id}
                  className={`layers__row${selected ? ' is-selected' : ''}${layer.hidden ? ' is-hidden' : ''}`}
                >
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) rowRefs.current.set(layer.id, node);
                      else rowRefs.current.delete(layer.id);
                    }}
                    className="layers__main"
                    tabIndex={layer.id === stopId ? 0 : -1}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => api.select(layer.id)}
                    onKeyDown={(event) => onRowKeyDown(event, layer, index)}
                  >
                    <span className="layers__thumb" aria-hidden="true">
                      <MotifThumb motif={layer.motif} size={24} />
                    </span>
                    <span className={`layers__name${layer.role === 'background' ? ' layers__name--echo' : ''}`}>
                      {layerRowName(name, layer.role)}
                    </span>
                    {layer.hidden ? <span className="visually-hidden">, скрыт</span> : null}
                  </button>
                  <span className="layers__actions">
                    <RowButton
                      label={`${name}: выше`}
                      title="Выше"
                      disabled={index === 0}
                      className="layers__reveal"
                      onClick={() => move(layer, 'up')}
                    >
                      <IconArrowUp />
                    </RowButton>
                    <RowButton
                      label={`${name}: ниже`}
                      title="Ниже"
                      disabled={index === count - 1}
                      className="layers__reveal"
                      onClick={() => move(layer, 'down')}
                    >
                      <IconArrowDown />
                    </RowButton>
                    <RowButton
                      label={`${name}: ${layer.hidden ? 'показать' : 'скрыть'}`}
                      title={layer.hidden ? 'Показать' : 'Скрыть'}
                      className={layer.hidden ? 'layers__eye is-off' : 'layers__eye layers__reveal'}
                      onClick={() => toggle(layer)}
                    >
                      {layer.hidden ? <IconEyeOff /> : <IconEye />}
                    </RowButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {api.doc.showPlane ? (
        <div className="layers__plane">
          <span className="layers__thumb layers__thumb--plane" aria-hidden="true">
            <IconBackground />
          </span>
          <span className="layers__name layers__name--echo">Плоскость · {api.palette.name}</span>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            aria-label="Скрыть плоскость"
            title="Скрыть плоскость"
            onClick={() => api.setShowPlane(false)}
          >
            <IconEye />
          </button>
        </div>
      ) : null}
    </section>
  );
}

interface RowButtonProps {
  label: string;
  title: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function RowButton({ label, title, className, disabled, onClick, children }: RowButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--sm layers__action ${className ?? ''}`}
      aria-label={label}
      title={title}
      tabIndex={-1}
      disabled={disabled}
      // Keep focus on the list row so keyboard use continues seamlessly after a click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
