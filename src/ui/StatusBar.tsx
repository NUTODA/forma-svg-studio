import { useMemo, useState, type JSX } from 'react';
import { IconKeyboard } from './icons';
import { ShortcutsDialog } from './ShortcutsDialog';
import { useEditorApi } from './state/editorContext';
import './StatusBar.css';

const NBSP = ' ';

/** «Черновик сохранён в 14:32», or a quiet note when nothing has been saved. */
export function draftLabel(savedAt: number | null, locale = 'ru-RU'): string {
  if (savedAt === null) return 'Черновик ещё не сохранён';
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(savedAt);
  return `Черновик сохранён в${NBSP}${time}`;
}

/** «Мотивов: 10 · файлов: 40 · плоскостей: 6». */
export function inventoryLabel(motifs: number, files: number, planes: number): string {
  return `Мотивов: ${motifs} · файлов: ${files} · плоскостей: ${planes}`;
}

export function StatusBar(): JSX.Element {
  const api = useEditorApi();
  const { status } = api;
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const inventory = useMemo(
    () => inventoryLabel(api.available.size, api.files.length, api.planes.length),
    [api.available, api.files, api.planes],
  );

  return (
    <div className="statusbar">
      <div className="statusbar__message" role="status" aria-live="polite" aria-atomic="true">
        {status ? (
          // Errors are announced once, by the alert below; the polite region only shows them.
          <span key={status.id} className="statusbar__text" aria-hidden={status.level === 'error' ? true : undefined}>
            <span className="statusbar__dot" data-level={status.level} aria-hidden="true" />
            <span className="statusbar__label">{status.text}</span>
          </span>
        ) : null}
      </div>
      {status?.level === 'error' ? (
        <div role="alert" className="visually-hidden">
          {status.text}
        </div>
      ) : null}

      <div className="statusbar__meta">
        <span className="statusbar__inventory">{inventory}</span>
        <span className="statusbar__draft">{draftLabel(api.savedAt)}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm statusbar__keys"
          aria-haspopup="dialog"
          onClick={() => setShortcutsOpen(true)}
        >
          <IconKeyboard />
          <span>Клавиши</span>
        </button>
      </div>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
