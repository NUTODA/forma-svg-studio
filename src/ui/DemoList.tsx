import { useId } from 'react';
import type { JSX } from 'react';
import { DEMO_PRESETS } from '../doc/doc';
import { ARTBOARD_PRESETS } from '../layout/compose';
import { briefModeLabel, quoted } from './briefFormat';
import { useEditorApi } from './state/editorContext';
import './DemoList.css';

export function DemoList(): JSX.Element | null {
  const api = useEditorApi();
  const headingId = useId();
  if (DEMO_PRESETS.length === 0) return null;

  const currentText = api.doc.brief.text.trim();

  return (
    <section className="demo-list" aria-labelledby={headingId}>
      <h3 id={headingId} className="label-caps demo-list__title">
        Примеры
      </h3>
      <ul className="demo-list__items" role="list">
        {DEMO_PRESETS.map((demo) => {
          const isCurrent = currentText !== '' && demo.brief.text.trim() === currentText;
          const artboard = ARTBOARD_PRESETS[demo.preset]?.label ?? demo.preset;
          const paletteName = api.palettes.find((p) => p.id === demo.paletteId)?.name;
          return (
            <li key={demo.id}>
              <button
                type="button"
                className="demo-list__card"
                aria-current={isCurrent ? 'true' : undefined}
                title={demo.description}
                onClick={() => api.applyDemo(demo.id)}
              >
                <span className="demo-list__label">{demo.label}</span>
                <span className="demo-list__text">{quoted(demo.brief.text)}</span>
                <span className="demo-list__meta">
                  <span className="chip">{briefModeLabel(demo.brief.mode)}</span>
                  <span className="chip">{artboard}</span>
                  {paletteName && <span className="chip">{paletteName}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
