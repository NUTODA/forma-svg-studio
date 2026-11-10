import { Fragment, useEffect, useId, useMemo, useRef, type JSX } from 'react';
import { detectMac, modKeyLabel, shiftKeyLabel } from './chromeKeys';
import { IconClose } from './icons';
import './ShortcutsDialog.css';

/** One key combination: the caps are shown side by side. */
export type KeyCombo = readonly string[];

export interface ShortcutRow {
  action: string;
  /** Alternative combinations for the same action. */
  combos: readonly KeyCombo[];
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

const ARROWS = '←↑→↓';

/** Shortcut reference; mirrors the global handler in `ui/util/shortcuts.ts`. */
export function shortcutGroups(mac: boolean): ShortcutGroup[] {
  const mod = modKeyLabel(mac);
  const shift = shiftKeyLabel(mac);
  return [
    {
      title: 'Правка',
      rows: [
        { action: 'Отменить', combos: [[mod, 'Z']] },
        { action: 'Повторить', combos: mac ? [[mod, shift, 'Z']] : [[mod, shift, 'Z'], [mod, 'Y']] },
        { action: 'Дублировать объект', combos: [[mod, 'D']] },
        { action: 'Удалить объект', combos: [['Delete'], ['Backspace']] },
        { action: 'Сохранить черновик', combos: [[mod, 'S']] },
      ],
    },
    {
      title: 'Объект',
      rows: [
        { action: 'Сдвинуть на 1 пиксель', combos: [[ARROWS]] },
        { action: 'Сдвинуть на 10 пикселей', combos: [[shift, ARROWS]] },
        { action: 'Повернуть на 1°', combos: [['['], [']']] },
        { action: 'Повернуть на 15°', combos: [[shift, '['], [shift, ']']] },
        { action: 'Слой выше / ниже', combos: [[mod, ']'], [mod, '[']] },
        { action: 'На передний / задний план', combos: [[mod, shift, ']'], [mod, shift, '[']] },
      ],
    },
    {
      title: 'Холст',
      rows: [
        { action: 'Снять выделение', combos: [['Esc']] },
        { action: 'Собрать по описанию', combos: [[mod, '↵']] },
        { action: 'Экспортировать SVG', combos: [[mod, 'E']] },
      ],
    },
  ];
}

export interface ShortcutsDialogProps {
  open: boolean;
  onClose(): void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const headingId = useId();
  const mac = useMemo(() => detectMac(), []);
  const groups = useMemo(() => shortcutGroups(mac), [mac]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleClosed(): void {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts"
      aria-labelledby={headingId}
      onClose={handleClosed}
      onClick={(e) => {
        // Only the backdrop is the dialog element itself; the content fills the rest.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="shortcuts__body">
        <header className="shortcuts__head">
          <h2 id={headingId} className="shortcuts__title">
            Горячие клавиши
          </h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => dialogRef.current?.close()}>
            <IconClose />
          </button>
        </header>

        <div className="shortcuts__scroll scroll">
          <table className="shortcuts__table">
            <thead className="visually-hidden">
              <tr>
                <th scope="col">Действие</th>
                <th scope="col">Клавиши</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody key={group.title}>
                <tr>
                  <th className="shortcuts__group label-caps" colSpan={2} scope="colgroup">
                    {group.title}
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.action} className="shortcuts__row">
                    <th className="shortcuts__action" scope="row">
                      {row.action}
                    </th>
                    <td>
                      <div className="shortcuts__keys">
                        {row.combos.map((combo, i) => (
                          <Fragment key={combo.join('+')}>
                            {i > 0 ? <span className="shortcuts__or">или</span> : null}
                            <span className="shortcuts__combo">
                              {combo.map((cap) => (
                                <kbd key={cap} className="kbd">
                                  {cap}
                                </kbd>
                              ))}
                            </span>
                          </Fragment>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </dialog>
  );
}
