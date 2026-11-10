import { useId } from 'react';
import type { JSX, ReactNode } from 'react';
import type { Layer } from '../domain/types';
import { MOTIFS } from '../domain/motifs';
import { ARTBOARD_PRESETS } from '../layout/compose';
import { layerAsset, layerScale } from '../export/render';
import type { EditorApi } from './state/editorContext';
import { useEditorApi } from './state/editorContext';
import {
  IconArrowDown,
  IconArrowUp,
  IconBringFront,
  IconDuplicate,
  IconEye,
  IconEyeOff,
  IconFile,
  IconSendBack,
  IconTrash,
} from './icons';
import { NumberField } from './NumberField';
import { detectMac, modShortcut } from './chromeKeys';

// Platform is fixed for the session: «⌘D / ⌫» on Mac, «Ctrl+D / Delete» elsewhere.
const IS_MAC = detectMac();
const DUPLICATE_HINT = modShortcut(IS_MAC, 'D');
const DELETE_HINT = IS_MAC ? '⌫' : 'Delete';
import {
  COLOR_MODE_LABEL,
  DETAIL_LABEL,
  LAYOUT_LABEL,
  ROLE_LABEL,
  countObjects,
  fallbackTitle,
  formatDimensions,
  scalePercent,
} from './Inspector.logic';
import './Inspector.css';

export function Inspector(): JSX.Element {
  const api = useEditorApi();
  const titleId = useId();
  const layer = api.selectedId ? (api.doc.layers.find((l) => l.id === api.selectedId) ?? null) : null;

  return (
    <section className="panel-section inspector" aria-labelledby={titleId}>
      <div className="panel-section__head">
        <h2 id={titleId} className="label-caps">
          Свойства
        </h2>
      </div>
      {layer ? <LayerProperties key={layer.id} layer={layer} api={api} /> : <DocumentSummary api={api} />}
    </section>
  );
}

function DocumentSummary({ api }: { api: EditorApi }): JSX.Element {
  const { doc } = api;
  const preset = ARTBOARD_PRESETS[doc.preset];
  const format = preset ? `${preset.label} · ${formatDimensions(preset.width, preset.height)}` : doc.preset;
  const rows: [string, string][] = [
    ['Формат', format],
    ['Компоновка', LAYOUT_LABEL[doc.layout]],
    ['Детализация', DETAIL_LABEL[doc.detail]],
    ['Цвет', COLOR_MODE_LABEL[doc.colorMode]],
    ['Объектов', String(countObjects(doc.layers))],
  ];
  return (
    <>
      <p className="inspector__hint">Выберите объект на холсте или в&nbsp;списке слоёв</p>
      <dl className="inspector__defs">
        {rows.map(([term, description]) => (
          <div key={term} className="inspector__def">
            <dt>{term}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function LayerProperties({ layer, api }: { layer: Layer; api: EditorApi }): JSX.Element {
  const { doc } = api;
  const index = doc.layers.findIndex((l) => l.id === layer.id);
  const isTop = index === doc.layers.length - 1;
  const isBottom = index === 0;
  const asset = layerAsset(layer, { files: api.files, detail: doc.detail, colorMode: doc.colorMode });
  const name = MOTIFS[layer.motif]?.name ?? layer.motif;
  const commit = (key: 'x' | 'y' | 'rotation') => (value: number) =>
    api.updateLayer(layer.id, { [key]: value }, { coalesce: `field:${layer.id}:${key}` });

  return (
    <div className="inspector__layer">
      <div className="inspector__title-row">
        <h3 className="inspector__name">{name}</h3>
        <span className={`chip${layer.role === 'object' ? ' chip--accent' : ''}`}>{ROLE_LABEL[layer.role]}</span>
        {layer.hidden ? <span className="chip">скрыт</span> : null}
      </div>

      <p className="inspector__file">
        <IconFile />
        {asset ? <code className="inspector__file-name">{asset.meta.file}</code> : <span>Нет файлов для этого мотива</span>}
        {asset && !asset.exact ? (
          <span className="chip chip--warn" title={fallbackTitle(asset.meta.file)}>
            замена
            <span className="visually-hidden">. {fallbackTitle(asset.meta.file)}</span>
          </span>
        ) : null}
      </p>

      <div className="inspector__fields">
        <NumberField label="X" value={layer.x} onCommit={commit('x')} />
        <NumberField label="Y" value={layer.y} onCommit={commit('y')} />
        <NumberField
          label="Поворот"
          unit="°"
          unitLabel="градусы"
          value={layer.rotation}
          onCommit={commit('rotation')}
        />
        <div className="inspector__scale">
          <span className="field__label">Масштаб</span>
          <span className="inspector__scale-value">{asset ? `${scalePercent(layerScale(layer, asset.meta))} %` : '—'}</span>
          <span className="field__hint">общий для композиции</span>
        </div>
      </div>

      <div className="inspector__actions" role="group" aria-label="Действия с объектом">
        <ActionButton label="Дублировать" shortcut={DUPLICATE_HINT} icon={<IconDuplicate />} onClick={() => api.duplicate(layer.id)} />
        <span className="inspector__sep" aria-hidden="true" />
        <ActionButton label="Выше" icon={<IconArrowUp />} disabled={isTop} onClick={() => api.reorder(layer.id, 'up')} />
        <ActionButton label="Ниже" icon={<IconArrowDown />} disabled={isBottom} onClick={() => api.reorder(layer.id, 'down')} />
        <ActionButton label="Наверх" icon={<IconBringFront />} disabled={isTop} onClick={() => api.reorder(layer.id, 'top')} />
        <ActionButton label="Вниз" icon={<IconSendBack />} disabled={isBottom} onClick={() => api.reorder(layer.id, 'bottom')} />
        <span className="inspector__sep" aria-hidden="true" />
        <ActionButton
          label={layer.hidden ? 'Показать' : 'Скрыть'}
          icon={layer.hidden ? <IconEyeOff /> : <IconEye />}
          onClick={() => api.toggleHidden(layer.id)}
        />
        <ActionButton label="Удалить" shortcut={DELETE_HINT} icon={<IconTrash />} danger onClick={() => api.remove(layer.id)} />
      </div>
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  shortcut?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

function ActionButton({ label, shortcut, icon, onClick, disabled, danger }: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`icon-btn inspector__action${danger ? ' inspector__action--danger' : ''}`}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
