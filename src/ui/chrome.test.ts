// Server-render smoke tests for the workspace chrome (TopBar, CanvasToolbar, Artboard, StatusBar, ShortcutsDialog).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createDoc } from '../doc/doc';
import type { AssetFileMeta, DocState, Layer, MotifId, PlaneFileMeta } from '../domain/types';
import { getZones, ARTBOARD_PRESETS } from '../layout/compose';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { createColorResolver, paperColor } from '../palette/resolve';
import { buildTemplate, type SvgTemplate } from '../svg/template';
import { Artboard } from './Artboard';
import { CanvasToolbar } from './CanvasToolbar';
import { shortcutGroups, ShortcutsDialog } from './ShortcutsDialog';
import { draftLabel, inventoryLabel, StatusBar } from './StatusBar';
import { EditorContext, type EditorApi } from './state/editorContext';
import { documentTitle, TopBar } from './TopBar';

const NBSP = ' ';

function meta(motif: MotifId, file: string): AssetFileMeta {
  return {
    file,
    motif,
    detail: 'l',
    variant: 'main',
    viewBox: { x: 0, y: 0, width: 200, height: 100 },
    bounds: { x: 0, y: 0, width: 200, height: 100 },
    colors: ['#7864d7'],
    bytes: 100,
    warnings: [],
  };
}

const FILES = [meta('book', 'book-l-main.svg')];
const BOOK_TEMPLATE: SvgTemplate = buildTemplate(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#7864D7"/></svg>',
  { file: 'book-l-main.svg', source: 'lavender' },
);

function layer(id: string, motif: MotifId, extra: Partial<Layer> = {}): Layer {
  return { id, motif, role: 'object', x: 600, y: 315, rotation: 0, size: 200, rank: 0, ...extra };
}

function makeApi(overrides: Partial<EditorApi> = {}, doc: DocState = createDoc()): EditorApi {
  const palette = BUILTIN_PALETTES[0]!;
  const noop = () => undefined;
  const api: EditorApi = {
    doc,
    selectedId: null,
    canUndo: false,
    canRedo: false,
    files: FILES,
    planes: [],
    available: new Set<MotifId>(['book']),
    templates: new Map([['book-l-main.svg', BOOK_TEMPLATE]]),
    palettes: BUILTIN_PALETTES,
    palette,
    color: createColorResolver(palette),
    paper: paperColor(palette),
    zones: getZones(ARTBOARD_PRESETS[doc.preset], doc.layout),
    brief: null,
    status: null,
    savedAt: null,
    setBriefMode: noop,
    setBriefText: noop,
    runBrief: () => true,
    applyIssueAction: noop,
    applyDemo: noop,
    addMotif: noop,
    select: noop,
    updateLayer: noop,
    commitGesture: noop,
    cancelGesture: noop,
    nudge: noop,
    rotateBy: noop,
    duplicate: noop,
    remove: noop,
    reorder: noop,
    toggleHidden: noop,
    undo: noop,
    redo: noop,
    setPreset: noop,
    setDetail: noop,
    setLayout: noop,
    setColorMode: noop,
    setPalette: noop,
    setBackgroundObjects: noop,
    setShowPlane: noop,
    setShowHeadline: noop,
    setHeadline: noop,
    recompose: noop,
    addCustomPalette: () => 'saved',
    removeCustomPalette: () => 'saved',
    requestTemplates: noop,
    exportSvg: () => Promise.resolve(),
    copySvg: () => Promise.resolve(),
    resetDraft: noop,
    announce: noop,
    ...overrides,
  };
  return api;
}

function render(component: () => ReturnType<typeof Artboard>, api: EditorApi): string {
  return renderToStaticMarkup(createElement(EditorContext.Provider, { value: api }, createElement(component)));
}

describe('Artboard', () => {
  const doc: DocState = { ...createDoc(), layers: [layer('l1', 'book')], nextId: 2 };

  it('renders the export structure: paper, then #artwork with one group per layer', () => {
    const html = render(Artboard, makeApi({}, doc));
    const art = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
    expect(art).toContain('role="img"');
    expect(art).toContain('viewBox="0 0 1200 630"');
    expect(art.indexOf('id="paper"')).toBeGreaterThan(-1);
    expect(art.indexOf('id="paper"')).toBeLessThan(art.indexOf('id="artwork"'));
    expect(art.indexOf('id="artwork"')).toBeLessThan(art.indexOf('id="book-1"'));
    expect(art).toContain('data-forma-motif="book"');
    expect(art).not.toMatch(/artboard__(hit|selection|hover|ring|zone|placeholder)/);
  });

  it('keeps overlay graphics out of the artwork and exposes an accessible stage', () => {
    const html = render(Artboard, makeApi({ selectedId: 'l1' }, doc));
    expect(html).toContain('id="artboard"');
    expect(html).toContain('role="application"');
    expect(html).toContain('aria-roledescription="холст"');
    expect(html).toContain('aria-describedby="artboard-hint"');
    expect(html).toContain('id="artboard-hint"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/aria-label="Книга, объект, слой 1 из 1"|aria-label="[^"]*, объект, слой/);
    expect(html).toContain('data-layer-id="l1"');
    expect(html).toContain('artboard__selection-frame');
  });

  it('shows a placeholder while the template is loading', () => {
    const html = render(Artboard, makeApi({ templates: new Map() }, doc));
    expect(html).toContain('artboard__placeholder');
    expect(html).not.toContain('id="book-1"');
  });

  it('skips motifs without files', () => {
    const noFiles: DocState = { ...doc, layers: [layer('l1', 'coin')] };
    const html = render(Artboard, makeApi({}, noFiles));
    expect(html).not.toContain('data-layer-id');
    expect(html).not.toContain('artboard__placeholder');
  });

  it('shows the empty state only without layers', () => {
    const empty = render(Artboard, makeApi());
    expect(empty).toContain('Пустой холст');
    expect(empty).toContain('Опишите тему слева или добавьте объект из каталога');
    expect(render(Artboard, makeApi({}, doc))).not.toContain('Пустой холст');
  });

  it('shows the headline zone only in the title layout, outside the artwork svg', () => {
    const titled: DocState = { ...doc, layout: 'title', showHeadline: true, headline: 'Книга и монета' };
    const html = render(Artboard, makeApi({}, titled));
    expect(html).toContain('Зона заголовка · не в экспорте');
    expect(html).toContain('Книга и монета');
    expect(html.slice(html.indexOf('<svg'), html.indexOf('</svg>'))).not.toContain('Книга и монета');
    const hidden = render(Artboard, makeApi({}, { ...titled, showHeadline: false }));
    expect(hidden).not.toContain('Зона заголовка');
    const composed = render(Artboard, makeApi({}, { ...titled, layout: 'composed' }));
    expect(composed).not.toContain('Зона заголовка');
  });

  it('labels the caption with the zoom readout', () => {
    const html = render(Artboard, makeApi());
    expect(html).toMatch(/100 %/);
    expect(html).toContain('1200');
  });

  it('does not render hidden layers', () => {
    const hiddenDoc: DocState = { ...doc, layers: [layer('l1', 'book', { hidden: true })] };
    const html = render(Artboard, makeApi({}, hiddenDoc));
    expect(html).not.toContain('id="book-1"');
    expect(html).not.toContain('data-layer-id');
  });
});

describe('CanvasToolbar', () => {
  it('renders four radiogroups with a roving tabindex', () => {
    const html = render(CanvasToolbar, makeApi());
    expect((html.match(/role="radiogroup"/g) ?? []).length).toBe(4);
    for (const label of ['Формат', 'Детализация', 'Компоновка', 'Цвет']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    const checked = html.match(/<button[^>]*aria-checked="true"[^>]*>/g) ?? [];
    expect(checked.length).toBe(4);
    for (const button of checked) expect(button).toContain('tabindex="0"');
    const unchecked = html.match(/<button[^>]*aria-checked="false"[^>]*>/g) ?? [];
    for (const button of unchecked) expect(button).toContain('tabindex="-1"');
  });

  it('disables the headline toggle outside the title layout', () => {
    const composed = render(CanvasToolbar, makeApi());
    const headlineButton = (composed.match(/<button[^>]*>(?:(?!<\/button>).)*Заголовок<\/span><\/button>/) ?? [''])[0];
    expect(headlineButton).toContain('disabled');
    expect(headlineButton).toContain('aria-pressed="false"');

    const titled = render(CanvasToolbar, makeApi({}, { ...createDoc(), layout: 'title' }));
    const enabled = (titled.match(/<button[^>]*>(?:(?!<\/button>).)*Заголовок<\/span><\/button>/) ?? [''])[0];
    expect(enabled).not.toContain('disabled');
    expect(enabled).toContain('aria-pressed="true"');
  });

  it('exposes the toggles and the recompose button by name', () => {
    const html = render(CanvasToolbar, makeApi());
    expect(html).toContain('Плоскость');
    expect(html).toContain('title="Монохромные копии объектов позади"');
    expect(html).toContain('aria-label="Перекомпоновать"');
    expect(html).toContain(`С${NBSP}заголовком`);
  });
});

describe('TopBar', () => {
  it('shows the wordmark, an untitled placeholder and disabled history buttons', () => {
    const html = render(TopBar, makeApi());
    expect(html).toContain('Форма');
    expect(html).toContain('студия иллюстраций');
    expect(html).toContain('Без названия');
    expect(html).toMatch(/<button[^>]*aria-label="Отменить \([^)]+\)"[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*aria-label="Повторить \([^)]+\)"[^>]*disabled/);
  });

  it('enables undo, uses the headline as the title and disables export on an empty canvas', () => {
    const html = render(TopBar, makeApi({ canUndo: true }, { ...createDoc(), headline: 'Лампа и книга' }));
    expect(html).toContain('Лампа и книга');
    expect(html).not.toMatch(/<button[^>]*aria-label="Отменить[^>]*disabled/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Экспорт SVG/);
  });

  it('enables export once there are layers', () => {
    const doc: DocState = { ...createDoc(), layers: [layer('l1', 'book')] };
    const html = render(TopBar, makeApi({}, doc));
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Экспорт SVG/);
    expect(html).toContain('Копировать SVG');
  });

  describe('export buttons follow what the file would contain', () => {
    const PLANE: PlaneFileMeta = {
      file: 'plane-lavender-l.svg',
      palette: 'lavender',
      detail: 'l',
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      colors: [],
      bytes: 100,
      warnings: [],
    };
    const buttonOf = (html: string, label: string): string =>
      (html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}</span></button>`)) ?? [''])[0];
    const buttons = (api: EditorApi) => {
      const html = render(TopBar, api);
      return { exportButton: buttonOf(html, 'Экспорт SVG'), copyButton: buttonOf(html, 'Копировать SVG') };
    };

    it('disables both when every layer is hidden and there is no plane (the file would be only paper)', () => {
      const doc: DocState = { ...createDoc(), layers: [layer('l1', 'book', { hidden: true })], showPlane: false };
      const { exportButton, copyButton } = buttons(makeApi({}, doc));
      expect(exportButton).toContain('disabled');
      expect(exportButton).toContain('Все объекты скрыты');
      expect(copyButton).toContain('disabled');
      expect(copyButton).toContain('Все объекты скрыты');
    });

    it('enables both when a visible plane is all there is', () => {
      const doc: DocState = { ...createDoc(), layers: [], showPlane: true };
      const { exportButton, copyButton } = buttons(makeApi({ planes: [PLANE] }, doc));
      expect(exportButton).not.toContain('disabled');
      expect(copyButton).not.toContain('disabled');
    });

    it('enables both for a visible plane under hidden layers, and disables them when the plane is off', () => {
      const hidden = [layer('l1', 'book', { hidden: true })];
      const withPlane = buttons(makeApi({ planes: [PLANE] }, { ...createDoc(), layers: hidden, showPlane: true }));
      expect(withPlane.exportButton).not.toContain('disabled');
      const planeOff = buttons(makeApi({ planes: [PLANE] }, { ...createDoc(), layers: hidden, showPlane: false }));
      expect(planeOff.exportButton).toContain('disabled');
    });

    it('does not count a plane that the palette has no file for', () => {
      const doc: DocState = { ...createDoc(), layers: [], showPlane: true };
      expect(buttons(makeApi({ planes: [] }, doc)).exportButton).toContain('disabled');
    });

    it('says the canvas is empty when there are no layers at all', () => {
      expect(buttons(makeApi()).exportButton).toContain('Холст пуст');
    });
  });

  it('keeps the confirmation popover closed until «Новый» is pressed', () => {
    const html = render(TopBar, makeApi());
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Начать заново?');
  });

  it('falls back to a neutral title for blank headlines', () => {
    expect(documentTitle('   ')).toBe('Без названия');
    expect(documentTitle(' Книга ')).toBe('Книга');
  });
});

describe('StatusBar', () => {
  it('renders the status in a polite live region', () => {
    const html = render(
      StatusBar,
      makeApi({ status: { id: 1, text: 'Собрано: книга', level: 'success' } }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Собрано: книга');
    expect(html).toContain('data-level="success"');
    expect(html).not.toContain('role="alert"');
  });

  it('mirrors errors into a visually hidden alert', () => {
    const html = render(StatusBar, makeApi({ status: { id: 2, text: 'Сбой экспорта', level: 'error' } }));
    expect(html).toMatch(/role="alert"[^>]*class="visually-hidden"[^>]*>Сбой экспорта/);
  });

  it('shows inventory, draft state and the shortcuts button', () => {
    const html = render(StatusBar, makeApi({ savedAt: Date.UTC(2026, 10, 10, 11, 32) }));
    expect(html).toContain('Мотивов: 1 · файлов: 1 · плоскостей: 0');
    expect(html).toContain('Клавиши');
    expect(html).toContain('Горячие клавиши');
    expect(html).toContain('Черновик сохранён в');
  });

  it('formats the labels', () => {
    expect(inventoryLabel(10, 40, 6)).toBe('Мотивов: 10 · файлов: 40 · плоскостей: 6');
    expect(draftLabel(null)).toBe('Черновик ещё не сохранён');
    const label = draftLabel(new Date(2026, 10, 10, 14, 32).getTime());
    expect(label).toBe(`Черновик сохранён в${NBSP}14:32`);
  });
});

describe('ShortcutsDialog', () => {
  it('renders a labelled dialog with a table of shortcuts', () => {
    const html = renderToStaticMarkup(createElement(ShortcutsDialog, { open: false, onClose: vi.fn() }));
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby');
    expect(html).toContain('Горячие клавиши');
    expect(html).toContain('<table');
    expect(html).toContain('Отменить');
    expect(html).toContain('aria-label="Закрыть"');
  });

  it('uses ⌘ on Mac and Ctrl elsewhere', () => {
    const mac = JSON.stringify(shortcutGroups(true));
    const other = JSON.stringify(shortcutGroups(false));
    expect(mac).toContain('⌘');
    expect(mac).not.toContain('Ctrl');
    expect(other).toContain('Ctrl');
    expect(other).not.toContain('⌘');
  });

  it('covers every required action', () => {
    const actions = shortcutGroups(false).flatMap((g) => g.rows.map((r) => r.action));
    for (const needle of ['Отменить', 'Повторить', 'Дублировать', 'Удалить', 'Сдвинуть', 'Повернуть', 'Слой', 'Экспортировать', 'Снять выделение', 'Собрать']) {
      expect(actions.some((a) => a.includes(needle))).toBe(true);
    }
  });
});
