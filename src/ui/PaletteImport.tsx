import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import { PAINT_ROLES } from '../domain/types';
import { PALETTE_MAX_BYTES, PALETTE_SCHEMA_ID, paletteTemplateJson, validatePaletteJson } from '../palette/validate';
import type { PaletteValidation } from '../palette/validate';
import { ROLE_INFO } from '../palette/roles';
import { useEditorApi } from './state/editorContext';
import { IconAlert, IconCheck, IconClose, IconCopy, IconDownload, IconInfo, IconUpload } from './icons';
import { copyText, roleGroupLabel } from './PalettePanel.logic';
import {
  TEMPLATE_FILE_NAME,
  errorPathLabel,
  fileTooLargeMessage,
  formatKilobytes,
  isFileTooLarge,
  isRoleRequired,
  pluralize,
} from './PaletteImport.logic';
import './PaletteImport.css';

const DEBOUNCE_MS = 250;
const PLACEHOLDER = '{\n  "name": "Моя палитра",\n  "colors": { … }\n}';

interface Note {
  tone: 'info' | 'success' | 'error';
  text: string;
}

export interface PaletteImportProps {
  /** Called when the dialog is dismissed (Esc, backdrop, close buttons) or after a successful import. */
  onClose: () => void;
}

/** Mounted only while open: every opening starts from a clean state and showModal() runs once. */
export function PaletteImport({ onClose }: PaletteImportProps): JSX.Element {
  const api = useEditorApi();
  const titleId = useId();
  const hintId = useId();
  const feedbackId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLPreElement>(null);
  const downOnBackdrop = useRef(false);

  const [text, setText] = useState('');
  const [checkedText, setCheckedText] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [alertOn, setAlertOn] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [copied, setCopied] = useState(false);

  const takenIds = useMemo(() => new Set(api.palettes.map((p) => p.id)), [api.palettes]);
  const template = useMemo(() => paletteTemplateJson(), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setCheckedText(text), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  const result: PaletteValidation | null = useMemo(
    () => (checkedText.trim() === '' && attempt === 0 ? null : validatePaletteJson(checkedText, takenIds)),
    [checkedText, takenIds, attempt],
  );
  const stale = checkedText !== text;
  const showErrors = result !== null && !result.ok;

  const edit = (value: string): void => {
    setText(value);
    setAlertOn(false);
  };

  const loadFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (isFileTooLarge(file.size, PALETTE_MAX_BYTES)) {
      setNote({ tone: 'error', text: fileTooLargeMessage(file.size, PALETTE_MAX_BYTES) });
      return;
    }
    file
      .text()
      .then((content) => {
        setText(content);
        setCheckedText(content);
        setAlertOn(false);
        setNote({ tone: 'success', text: `Файл «${file.name}» загружен` });
        textareaRef.current?.focus();
      })
      .catch(() => setNote({ tone: 'error', text: 'Не удалось прочитать файл' }));
  };

  const copyTemplate = async (): Promise<void> => {
    if (await copyText(template)) {
      setCopied(true);
      setNote({ tone: 'success', text: 'Шаблон скопирован в буфер обмена' });
      return;
    }
    const pre = templateRef.current;
    const selection = window.getSelection();
    if (pre && selection) {
      const range = document.createRange();
      range.selectNodeContents(pre);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setNote({ tone: 'info', text: 'Скопировать автоматически не удалось. Шаблон выделен: нажмите ⌘C или Ctrl+C.' });
  };

  const downloadTemplate = (): void => {
    const url = URL.createObjectURL(new Blob([template], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = TEMPLATE_FILE_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const insertTemplate = (): void => {
    edit(template);
    setCheckedText(template);
    textareaRef.current?.focus();
  };

  const submit = (): void => {
    const validation = validatePaletteJson(text, takenIds);
    setCheckedText(text);
    if (!validation.ok) {
      setAlertOn(true);
      setAttempt((n) => n + 1);
      return;
    }
    const { palette } = validation;
    api.addCustomPalette(palette);
    api.setPalette(palette.id);
    // Close the modal first; its `close` event calls onClose, which can then return focus to the opener
    // (focusing while the modal is still open is a no-op because the page behind it is inert).
    dialogRef.current?.close();
    api.announce(`Палитра «${palette.name}» добавлена`, 'success');
  };

  return (
    <dialog
      ref={dialogRef}
      className="palette-import"
      aria-labelledby={titleId}
      onClose={onClose}
      onMouseDown={(event) => {
        downOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (downOnBackdrop.current && event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="palette-import__shell">
        <header className="palette-import__head">
          <h2 id={titleId} className="palette-import__title">
            Импорт палитры
          </h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={() => dialogRef.current?.close()}
          >
            <IconClose />
          </button>
        </header>

        <div className="palette-import__body">
          <div className="palette-import__main">
            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-json`}>
                JSON палитры
              </label>
              <textarea
                id={`${titleId}-json`}
                ref={textareaRef}
                className="textarea palette-import__json"
                rows={12}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                placeholder={PLACEHOLDER}
                value={text}
                aria-invalid={showErrors && !stale}
                aria-describedby={`${hintId} ${feedbackId}`}
                onChange={(event) => edit(event.target.value)}
              />
              <p id={hintId} className="field__hint">
                Вставьте JSON или загрузите файл — до&nbsp;{formatKilobytes(PALETTE_MAX_BYTES)}. Проверка идёт сразу
                при&nbsp;вводе.
              </p>
            </div>

            <div className="palette-import__file">
              <input
                ref={fileRef}
                type="file"
                className="visually-hidden"
                accept=".json,application/json"
                tabIndex={-1}
                aria-label="Файл палитры JSON"
                onChange={loadFile}
              />
              <button type="button" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
                <IconUpload />
                Загрузить файл…
              </button>
            </div>

            <div className="palette-import__live" role="status" aria-live="polite">
              {note ? (
                <p className={`notice notice--${note.tone}`}>
                  {note.tone === 'error' ? <IconAlert /> : note.tone === 'success' ? <IconCheck /> : <IconInfo />}
                  <span>{note.text}</span>
                </p>
              ) : null}
            </div>

            <div id={feedbackId} className={`palette-import__feedback${stale ? ' is-stale' : ''}`} aria-busy={stale}>
              {result && !result.ok ? (
                <div
                  key={attempt}
                  ref={summaryRef}
                  className="notice notice--error palette-import__errors"
                  role={alertOn ? 'alert' : undefined}
                  tabIndex={-1}
                >
                  <IconAlert />
                  <div>
                    <p className="palette-import__errors-title">
                      {result.errors.length} {pluralize(result.errors.length, ['ошибка', 'ошибки', 'ошибок'])} в&nbsp;палитре
                    </p>
                    <ul className="palette-import__list">
                      {result.errors.map((error, index) => (
                        <li key={`${error.path}:${index}`}>
                          <code>{errorPathLabel(error)}</code> — {error.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              {result && result.ok ? (
                <div className="palette-import__preview">
                  <div className="palette-import__preview-head">
                    <span className="chip chip--ok">
                      <IconCheck />
                      JSON в порядке
                    </span>
                    <strong className="palette-import__preview-name">{result.palette.name}</strong>
                  </div>
                  <p className="palette-import__meta">
                    <span>
                      id <code>{result.palette.id}</code>
                    </span>
                    <span>
                      плоскость <code>{result.palette.plane}</code>
                    </span>
                  </p>
                  <ul className="palette-import__swatches" aria-label="Предпросмотр палитры">
                    {PAINT_ROLES.map((role) => (
                      <li key={role} className="palette-import__swatch">
                        <span
                          className="palette-import__chip"
                          style={{ backgroundColor: result.palette.colors[role] }}
                          aria-hidden="true"
                        />
                        <span className="palette-import__swatch-label">{ROLE_INFO[role]?.label ?? role}</span>
                        <code className="palette-import__swatch-hex">{result.palette.colors[role].toUpperCase()}</code>
                      </li>
                    ))}
                  </ul>
                  {result.warnings.length > 0 ? (
                    <div className="notice notice--warning">
                      <IconAlert />
                      <ul className="palette-import__list">
                        {result.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="palette-import__ref">
            <section aria-labelledby={`${titleId}-schema`} className="palette-import__section">
              <h3 id={`${titleId}-schema`} className="label-caps">
                Схема
              </h3>
              <div className="palette-import__scroll scroll" role="region" aria-label="Поля файла палитры" tabIndex={0}>
                <table className="palette-import__table">
                  <caption className="visually-hidden">Поля верхнего уровня</caption>
                  <thead>
                    <tr>
                      <th scope="col">Поле</th>
                      <th scope="col">Обязательно</th>
                      <th scope="col">Описание</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">
                        <code>schema</code>
                      </th>
                      <td>нет</td>
                      <td>
                        Версия схемы. Если указана, то только <code>{PALETTE_SCHEMA_ID}</code>.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        <code>name</code>
                      </th>
                      <td>да</td>
                      <td>Название палитры, от&nbsp;1 до&nbsp;40&nbsp;символов.</td>
                    </tr>
                    <tr>
                      <th scope="row">
                        <code>id</code>
                      </th>
                      <td>нет</td>
                      <td>
                        Короткий идентификатор: строчная латиница, цифры, дефис. Если не указан или занят, подбирается
                        автоматически.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        <code>plane</code>
                      </th>
                      <td>нет</td>
                      <td>
                        Плоскость-подложка: <code>lavender</code>, <code>peach</code> или&nbsp;<code>mint</code>. По
                        умолчанию <code>lavender</code>.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        <code>colors</code>
                      </th>
                      <td>да</td>
                      <td>Объект с цветами ролей в&nbsp;формате <code>#RRGGBB</code>.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="palette-import__scroll scroll" role="region" aria-label="Роли цвета в colors" tabIndex={0}>
                <table className="palette-import__table">
                  <caption className="visually-hidden">Роли в объекте colors</caption>
                  <thead>
                    <tr>
                      <th scope="col">Ключ</th>
                      <th scope="col">Роль</th>
                      <th scope="col">Группа</th>
                      <th scope="col">Обязательно</th>
                      <th scope="col">Описание</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PAINT_ROLES.map((role) => {
                      const info = ROLE_INFO[role];
                      return (
                        <tr key={role}>
                          <th scope="row">
                            <code>colors.{role}</code>
                          </th>
                          <td>{info?.label ?? role}</td>
                          <td>{info ? roleGroupLabel(info.group) : '—'}</td>
                          <td>{isRoleRequired(role) ? 'да' : 'нет'}</td>
                          <td>{info?.description ?? ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby={`${titleId}-template`} className="palette-import__section">
              <h3 id={`${titleId}-template`} className="label-caps">
                Шаблон
              </h3>
              <pre
                ref={templateRef}
                className="palette-import__template scroll"
                tabIndex={0}
                aria-label="Шаблон палитры в формате JSON"
              >
                {template}
              </pre>
              <div className="palette-import__tools">
                <button type="button" className="btn btn--sm" onClick={() => void copyTemplate()}>
                  {copied ? <IconCheck /> : <IconCopy />}
                  {copied ? 'Скопировано' : 'Скопировать шаблон'}
                </button>
                <button type="button" className="btn btn--sm" onClick={downloadTemplate}>
                  <IconDownload />
                  Скачать шаблон
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={insertTemplate}>
                  Подставить в&nbsp;поле
                </button>
              </div>
            </section>
          </div>
        </div>

        <footer className="palette-import__foot">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            Отмена
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            Добавить палитру
          </button>
        </footer>
      </div>
    </dialog>
  );
}
