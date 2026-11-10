import { useId, useState } from 'react';
import type { JSX } from 'react';
import { EditorContext } from './ui/state/editorContext';
import { useEditor } from './ui/state/useEditor';
import { Artboard } from './ui/Artboard';
import { BriefPanel } from './ui/BriefPanel';
import { CanvasToolbar } from './ui/CanvasToolbar';
import { Catalog } from './ui/Catalog';
import { Inspector } from './ui/Inspector';
import { LayersPanel } from './ui/LayersPanel';
import { PalettePanel } from './ui/PalettePanel';
import { StatusBar } from './ui/StatusBar';
import { TopBar } from './ui/TopBar';

export function App(): JSX.Element {
  const api = useEditor();
  const extrasId = useId();
  // Phone only: CSS hides examples + catalogue until opened; the toggle itself is hidden on larger screens.
  const [extrasOpen, setExtrasOpen] = useState(false);

  return (
    <EditorContext.Provider value={api}>
      <div className="app">
        <a className="app__skip" href="#artboard">
          Перейти к холсту
        </a>
        <header className="app__top">
          <TopBar />
        </header>
        <aside className="app__left scroll" aria-label="Задание и каталог" data-extras={extrasOpen ? 'open' : 'closed'}>
          <BriefPanel />
          <button
            type="button"
            className="btn app__extras-toggle"
            aria-expanded={extrasOpen}
            aria-controls={extrasId}
            onClick={() => setExtrasOpen((open) => !open)}
          >
            {extrasOpen ? 'Скрыть примеры и каталог' : 'Показать примеры и каталог'}
          </button>
          <div className="app__extras" id={extrasId}>
            <Catalog />
          </div>
        </aside>
        <main className="app__workspace" id="workspace" aria-label="Рабочая область">
          <CanvasToolbar />
          <Artboard />
        </main>
        <aside className="app__right scroll" aria-label="Свойства и слои">
          <Inspector />
          <LayersPanel />
          <PalettePanel />
        </aside>
        <footer className="app__status">
          <StatusBar />
        </footer>
      </div>
    </EditorContext.Provider>
  );
}
