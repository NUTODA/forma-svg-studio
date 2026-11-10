import { useEffect, useId, useRef } from 'react';
import type { ChangeEvent, JSX, KeyboardEvent } from 'react';
import type { BriefMode } from '../domain/types';
import { AnalysisView } from './AnalysisView';
import { DemoList } from './DemoList';
import { IconSparkle } from './icons';
import { hasErrorIssue, isMacPlatform, nextTabIndex, runShortcutHint } from './briefFormat';
import { useEditorApi } from './state/editorContext';
import './BriefPanel.css';

const MAX_LENGTH = 300;

interface ModeCopy {
  tab: string;
  label: string;
  placeholder: string;
  hint: string;
}

const MODES: readonly BriefMode[] = ['title', 'names'];

const COPY: Record<BriefMode, ModeCopy> = {
  title: {
    tab: 'По заголовку',
    label: 'Заголовок или тема',
    placeholder: 'Например: Как накопить на первую поездку',
    hint: 'Подберём объекты по смыслу: синонимы, темы, исключения «без …»',
  },
  names: {
    tab: 'По названиям',
    label: 'Названия объектов',
    placeholder: 'Например: книга, 2 монеты, лампа',
    hint: 'Через запятую, «и» или с новой строки. Количество: «2 монеты», «лампа ×2»',
  },
};

export function BriefPanel(): JSX.Element {
  const api = useEditorApi();
  const uid = useId();
  const headingId = `${uid}-heading`;
  const tabId = (mode: BriefMode) => `${uid}-tab-${mode}`;
  const panelId = `${uid}-panel`;
  const textId = `${uid}-text`;
  const hintId = `${uid}-hint`;
  const feedbackId = `${uid}-feedback`;

  const { mode, text } = api.doc.brief;
  const copy = COPY[mode];
  const blank = text.trim() === '';

  // Each mode remembers what was typed in it; the doc only holds the active one.
  const memory = useRef<Record<BriefMode, string>>({ title: '', names: '' });
  useEffect(() => {
    memory.current[mode] = text;
  }, [mode, text]);

  const tabRefs = useRef<Record<BriefMode, HTMLButtonElement | null>>({ title: null, names: null });

  const switchMode = (next: BriefMode) => {
    if (next === mode) return;
    memory.current[mode] = text;
    api.setBriefMode(next, memory.current[next]);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const target = nextTabIndex(event.key, MODES.indexOf(mode), MODES.length);
    if (target === null) return;
    const next = MODES[target];
    if (!next) return;
    event.preventDefault();
    switchMode(next);
    tabRefs.current[next]?.focus();
  };

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

      <div className="brief__tabs seg" role="tablist" aria-label="Способ задать объекты">
        {MODES.map((m) => (
          <button
            key={m}
            ref={(el) => {
              tabRefs.current[m] = el;
            }}
            type="button"
            role="tab"
            id={tabId(m)}
            className="seg__item brief__tab"
            aria-selected={m === mode}
            aria-controls={panelId}
            tabIndex={m === mode ? 0 : -1}
            onClick={() => switchMode(m)}
            onKeyDown={handleTabKeyDown}
          >
            {COPY[m].tab}
          </button>
        ))}
      </div>

      <div className="brief__form" role="tabpanel" id={panelId} aria-labelledby={tabId(mode)}>
        <div className="field">
          <label className="field__label" htmlFor={textId}>
            {copy.label}
          </label>
          <textarea
            id={textId}
            className="textarea brief__textarea"
            rows={3}
            maxLength={MAX_LENGTH}
            value={text}
            placeholder={copy.placeholder}
            aria-describedby={`${hintId} ${feedbackId}`}
            aria-invalid={hasErrorIssue(api.brief) ? true : undefined}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => api.setBriefText(e.target.value)}
            onKeyDown={handleTextKeyDown}
          />
          <div className="brief__meta">
            <p id={hintId} className="field__hint brief__hint">
              {copy.hint}
            </p>
            <span className="brief__counter" data-near-limit={text.length >= MAX_LENGTH - 30}>
              {text.length} / {MAX_LENGTH}
            </span>
          </div>
        </div>

        <button type="button" className="btn btn--primary btn--block brief__run" disabled={blank} onClick={run}>
          <IconSparkle />
          <span className="brief__run-label">Собрать композицию</span>
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
