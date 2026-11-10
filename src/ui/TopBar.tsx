import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { nothingToExportReason } from '../export/render';
import { ARTBOARD_PRESETS } from '../layout/compose';
import { detectMac, modShortcut, shiftKeyLabel } from './chromeKeys';
import { IconCopy, IconDownload, IconPlus, IconRedo, IconUndo } from './icons';
import { useEditorApi } from './state/editorContext';
import './TopBar.css';

const UNTITLED = 'Без названия';

/** Document title shown in the bar: the headline, or a neutral placeholder. */
export function documentTitle(headline: string): string {
  return headline.trim() || UNTITLED;
}

interface NewDocumentProps {
  onConfirm(): void;
}

/** «Новый» with an inline confirmation popover (no window.confirm). */
function NewDocument({ onConfirm }: NewDocumentProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (!open) return;
    if (e.key === 'Escape') {
      // Closes the popover only; the global «deselect» shortcut must not see it.
      e.stopPropagation();
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div ref={wrapRef} className="topbar__new" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn--ghost topbar__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconPlus />
        <span className="topbar__label">Новый</span>
      </button>
      {open ? (
        <div className="topbar__confirm" role="alertdialog" aria-labelledby={messageId}>
          <p id={messageId} className="topbar__confirm-text">
            <strong>Очистить холст?</strong> Текущая композиция и&nbsp;черновик будут удалены.
          </p>
          <div className="topbar__confirm-actions">
            <button ref={cancelRef} type="button" className="btn btn--sm" onClick={() => close(true)}>
              Отмена
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => {
                close(true);
                onConfirm();
              }}
            >
              Очистить
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TopBar(): JSX.Element {
  const api = useEditorApi();
  const { doc } = api;
  const mac = useMemo(() => detectMac(), []);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);

  const title = documentTitle(doc.headline);
  const presetLabel = ARTBOARD_PRESETS[doc.preset]?.label ?? '';
  // The buttons and the export shortcut share one rule: a file that would be only paper is not offered.
  const nothingToExport = nothingToExportReason(doc, { files: api.files, planes: api.planes, palette: api.palette });
  const empty = nothingToExport !== null;
  const undoLabel = `Отменить (${modShortcut(mac, 'Z')})`;
  const redoLabel = `Повторить (${modShortcut(mac, shiftKeyLabel(mac), 'Z')})`;
  const exportShortcut = modShortcut(mac, 'E');

  async function run(
    busy: boolean,
    setBusy: (busy: boolean) => void,
    action: () => Promise<void>,
    failure: string,
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch {
      api.announce(failure, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="topbar">
      <h1 className="topbar__brand">
        <span className="topbar__wordmark">Форма</span>
        <span className="topbar__descriptor label-caps">студия иллюстраций</span>
      </h1>

      <div className="topbar__center">
        <span className="topbar__title" title={title}>
          {title}
        </span>
        {presetLabel ? <span className="chip topbar__preset">{presetLabel}</span> : null}
      </div>

      <div className="topbar__actions" role="group" aria-label="Действия с документом">
        <button
          type="button"
          className="icon-btn"
          aria-label={undoLabel}
          title={undoLabel}
          disabled={!api.canUndo}
          onClick={api.undo}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={redoLabel}
          title={redoLabel}
          disabled={!api.canRedo}
          onClick={api.redo}
        >
          <IconRedo />
        </button>
        <span className="topbar__divider" aria-hidden="true" />
        <NewDocument onConfirm={api.resetDraft} />
        <button
          type="button"
          className="btn btn--ghost topbar__btn"
          disabled={empty}
          aria-busy={copying}
          title={empty ? `${nothingToExport} — копировать нечего` : 'Скопировать SVG в буфер обмена'}
          onClick={() => void run(copying, setCopying, () => api.copySvg(),'Не удалось скопировать SVG')}
        >
          <IconCopy />
          <span className="topbar__label">Копировать SVG</span>
        </button>
        <button
          type="button"
          className="btn btn--primary topbar__btn"
          disabled={empty}
          aria-busy={exporting}
          title={empty ? `${nothingToExport} — экспортировать нечего` : `Скачать SVG (${exportShortcut})`}
          onClick={() => void run(exporting, setExporting, () => api.exportSvg(),'Не удалось экспортировать SVG')}
        >
          <IconDownload />
          <span className="topbar__label topbar__label--primary">Экспорт SVG</span>
        </button>
      </div>
    </div>
  );
}
