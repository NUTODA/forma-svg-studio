import { useId } from 'react';
import type { ChangeEvent, JSX, KeyboardEvent } from 'react';
import { AnalysisView } from './AnalysisView';
import { DemoList } from './DemoList';
import { IconSparkle } from './icons';
import { hasErrorIssue, isMacPlatform, runShortcutHint } from './briefFormat';
import { useEditorApi } from './state/editorContext';
import './BriefPanel.css';

const MAX_LENGTH = 300;

/** One field for both kinds of brief: the app reads the text and tells a list of objects from a title itself. */
const COPY = {
  label: 'Заголовок или список объектов',
  placeholder: 'Например: Как накопить на первую поездку — или: книга, 2 монеты, лампа',
  hint: 'Тему подберём по смыслу, а список названий соберём как написан: «книга, 2 монеты, лампа ×2»',
};

export function BriefPanel(): JSX.Element {
  const api = useEditorApi();
  const uid = useId();
  const headingId = `${uid}-heading`;
  const textId = `${uid}-text`;
  const hintId = `${uid}-hint`;
  const feedbackId = `${uid}-feedback`;

  const { text } = api.doc.brief;
  const blank = text.trim() === '';

  const run = () => {
    if (!blank) api.runBrief();
  };

  const handleTextKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      run();
    }
  };

  const mac = isMacPlatform(typeof navigator === 'undefined' ? undefined : navigator.platform);

  return (
    <section className="brief panel-section" aria-labelledby={headingId}>
      <div className="panel-section__head">
        <h2 id={headingId} className="label-caps">
          Задание
        </h2>
      </div>

      <div className="brief__form">
        <div className="field">
          <label className="field__label" htmlFor={textId}>
            {COPY.label}
          </label>
          <textarea
            id={textId}
            className="textarea brief__textarea"
            rows={3}
            maxLength={MAX_LENGTH}
            value={text}
            placeholder={COPY.placeholder}
            aria-describedby={`${hintId} ${feedbackId}`}
            aria-invalid={hasErrorIssue(api.brief) ? true : undefined}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => api.setBriefText(e.target.value)}
            onKeyDown={handleTextKeyDown}
          />
          <div className="brief__meta">
            <p id={hintId} className="field__hint brief__hint">
              {COPY.hint}
            </p>
            <span className="brief__counter" data-near-limit={text.length >= MAX_LENGTH - 30}>
              {text.length} / {MAX_LENGTH}
            </span>
          </div>
        </div>

        <button type="button" className="btn btn--primary btn--block brief__run" disabled={blank || api.briefBusy} aria-busy={api.briefBusy || undefined} onClick={run}>
          <IconSparkle />
          <span className="brief__run-label">{api.briefBusy ? 'Подбираем объекты…' : 'Собрать композицию'}</span>
          <kbd className="kbd brief__kbd" aria-hidden="true">
            {runShortcutHint(mac)}
          </kbd>
        </button>

        <AnalysisView id={feedbackId} />
      </div>

      <DemoList />
    </section>
  );
}
