import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { InputIssue, MotifMatch, NameEntry, NamesParse, TitleAnalysis } from '../domain/types';
import { IconAlert, IconCheck, IconInfo } from './icons';
import {
  briefAnnouncement,
  motifName,
  nameStatusChip,
  namesSummary,
  noticeClass,
  reasonsLine,
  strengthBars,
  strengthLabel,
} from './briefFormat';
import { MotifThumb } from './MotifThumb';
import { useEditorApi } from './state/editorContext';
import './AnalysisView.css';

const MAX_MATCH_ROWS = 6;
const MAX_UNKNOWN_CHIPS = 6;

/** Smoothly follows the content height so the panels below do not jump when a result appears. */
function useFollowHeight() {
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { innerRef, height };
}

function IssueNotice({ issue }: { issue: InputIssue }): JSX.Element {
  const api = useEditorApi();
  const { action } = issue;
  return (
    <div className={`analysis__issue ${noticeClass(issue.level)}`}>
      {issue.level === 'info' ? <IconInfo className="analysis__issue-icon" /> : <IconAlert className="analysis__issue-icon" />}
      <div className="analysis__issue-body">
        <p>{issue.message}</p>
        {action && (
          <button type="button" className="btn btn--sm" onClick={() => api.applyIssueAction(action)}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Issues({ issues }: { issues: readonly InputIssue[] }): JSX.Element | null {
  if (issues.length === 0) return null;
  return (
    <div className="analysis__issues">
      {issues.map((issue, i) => (
        <IssueNotice key={`${issue.code}-${i}`} issue={issue} />
      ))}
    </div>
  );
}

function StrengthMeter({ strength }: { strength: MotifMatch['strength'] }): JSX.Element {
  const filled = strengthBars(strength);
  return (
    <span className="analysis__meter">
      <span aria-hidden="true" className="analysis__bars">
        {[1, 2, 3].map((n) => (
          <span key={n} className="analysis__bar" data-on={n <= filled} />
        ))}
      </span>
      <span className="visually-hidden">{strengthLabel(strength)}</span>
    </span>
  );
}

function MatchRow({ match, selected }: { match: MotifMatch; selected: boolean }): JSX.Element {
  const reasons = reasonsLine(match.reasons);
  const classes = ['analysis__match'];
  if (selected) classes.push('analysis__match--selected');
  if (!match.available) classes.push('analysis__match--unavailable');
  return (
    <li className={classes.join(' ')}>
      <span className="analysis__thumb">
        <MotifThumb motif={match.motif} size={32} />
      </span>
      <span className="analysis__match-text">
        <span className="analysis__match-name">{motifName(match.motif)}</span>
        {reasons && (
          <span className="analysis__reasons" title={reasons}>
            {reasons}
          </span>
        )}
      </span>
      <span className="analysis__match-end">
        {!match.available ? (
          <span className="analysis__unavailable">нет в библиотеке</span>
        ) : (
          <>
            <StrengthMeter strength={match.strength} />
            {selected && (
              <>
                <IconCheck className="analysis__check" />
                <span className="visually-hidden">В композиции</span>
              </>
            )}
          </>
        )}
      </span>
    </li>
  );
}

/** How the input was read: the user does not pick a mode, so the result says which one applied. */
function ReadAs({ kind }: { kind: 'list' | 'title' }): JSX.Element {
  return <p className="analysis__kind">{kind === 'list' ? 'Прочитано как список объектов' : 'Прочитано как заголовок или тема'}</p>;
}

function TitleResult({ analysis }: { analysis: TitleAnalysis }): JSX.Element {
  const selected = new Set(analysis.selected);
  const rows = analysis.matches.slice(0, MAX_MATCH_ROWS);
  const unknown = analysis.unknownTokens.slice(0, MAX_UNKNOWN_CHIPS);
  const unknownRest = analysis.unknownTokens.length - unknown.length;
  const hasChips = analysis.excluded.length + analysis.themes.length + unknown.length > 0;
  return (
    <>
      <ReadAs kind="title" />
      {analysis.summary && <p className="analysis__summary">{analysis.summary}</p>}
      {rows.length > 0 && (
        <ul className="analysis__matches" role="list">
          {rows.map((m) => (
            <MatchRow key={m.motif} match={m} selected={selected.has(m.motif)} />
          ))}
        </ul>
      )}
      {hasChips && (
        <div className="analysis__chips">
          {analysis.excluded.map((e) => (
            <span key={`x-${e.motif}`} className="chip analysis__chip--excluded">
              без: <s>{motifName(e.motif)}</s>
            </span>
          ))}
          {analysis.themes.map((t) => (
            <span key={`t-${t.id}`} className="chip">
              {t.label}
            </span>
          ))}
          {unknown.map((token) => (
            <span key={`u-${token}`} className="chip analysis__chip--unknown">
              не распознано: {token}
            </span>
          ))}
          {unknownRest > 0 && <span className="chip analysis__chip--unknown">ещё {unknownRest}</span>}
        </div>
      )}
      <Issues issues={analysis.issues} />
    </>
  );
}

function NameRow({ entry }: { entry: NameEntry }): JSX.Element {
  const chip = nameStatusChip(entry);
  const chipClass = chip.tone === 'neutral' ? 'chip' : `chip chip--${chip.tone}`;
  const showName = entry.motif !== undefined && (entry.status === 'matched' || entry.status === 'unavailable');
  return (
    <li className="analysis__entry">
      <span className="analysis__raw" title={entry.raw}>
        «{entry.raw}»
      </span>
      <span className="analysis__entry-meta">
        <span className={chipClass}>{chip.label}</span>
        {entry.count > 1 && <span className="analysis__count">×{entry.count}</span>}
        {showName && entry.motif && <span className="analysis__resolved">{motifName(entry.motif)}</span>}
      </span>
    </li>
  );
}

function NamesResult({ parse }: { parse: NamesParse }): JSX.Element {
  return (
    <>
      <ReadAs kind="list" />
      <p className="analysis__summary">{namesSummary(parse.entries, parse.motifs.length)}</p>
      {parse.entries.length > 0 && (
        <ul className="analysis__entries" role="list">
          {parse.entries.map((entry, i) => (
            <NameRow key={`${entry.raw}-${i}`} entry={entry} />
          ))}
        </ul>
      )}
      <Issues issues={parse.issues} />
    </>
  );
}

function Explainer(): JSX.Element {
  return (
    <div className="analysis__explainer">
      <p>
        <strong>Заголовок или тема</strong> — опишите её словами, а мы подберём объекты по смыслу.
      </p>
      <p>
        <strong>Список объектов</strong> — перечислите их через запятую, а мы соберём ровно эти объекты, с количеством.
      </p>
    </div>
  );
}

export interface AnalysisViewProps {
  /** Id for `aria-describedby` references from the textarea. */
  id?: string;
}

export function AnalysisView({ id }: AnalysisViewProps): JSX.Element {
  const { brief } = useEditorApi();
  const { innerRef, height } = useFollowHeight();
  const announcement = briefAnnouncement(brief);

  return (
    <div id={id} className="analysis">
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="analysis__frame" style={height === null ? undefined : { height }}>
        <div ref={innerRef} className="analysis__inner">
          <div className="analysis__body" key={brief?.mode ?? 'empty'}>
            {brief === null ? (
              <Explainer />
            ) : brief.mode === 'title' ? (
              <TitleResult analysis={brief.analysis} />
            ) : (
              <NamesResult parse={brief.parse} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
