// Server-render smoke tests for the brief / catalog panels against a fake EditorApi.
import { createElement } from 'react';
import type { JSX } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  BriefMode,
  DemoPreset,
  MotifId,
  NamesParse,
  Palette,
  TitleAnalysis,
} from '../domain/types';
import { MOTIF_IDS } from '../domain/types';

vi.mock('../domain/motifs', () => {
  const names: Record<string, string> = {
    book: 'Книга',
    phone: 'Телефон',
    puzzle: 'Пазл',
    coin: 'Монета',
    headphones: 'Наушники',
    lamp: 'Лампа',
    bouquet: 'Букет',
    wallet: 'Кошелёк',
    folder: 'Папка',
    pen: 'Ручка',
  };
  return {
    MOTIFS: Object.fromEntries(
      Object.entries(names).map(([id, name]) => [id, { id, name, description: '', aliases: [] }]),
    ),
  };
});

vi.mock('../assets/availability', () => ({
  variantForLayer: () => 'main',
  // The pen only has a fallback file in this fake library.
  resolveAsset: (_files: unknown, motif: string) => ({
    meta: { file: `${motif}-l-main.svg`, bounds: { x: 0, y: 0, width: 100, height: 100 } },
    exact: motif !== 'pen',
  }),
  motifAvailability: () => ({ 's-main': false, 's-background': false, 'l-main': true, 'l-background': true }),
}));

vi.mock('../svg/template', () => ({
  instantiate: (_t: unknown, opts: { idPrefix: string }) => `<g data-prefix="${opts.idPrefix}"></g>`,
}));

const DEMOS: DemoPreset[] = [
  {
    id: 'trip',
    label: 'Накопить на поездку',
    description: 'Заголовок',
    brief: { mode: 'title', text: 'Как накопить на первую поездку' },
    preset: 'og',
    layout: 'composed',
    detail: 'l',
    paletteId: 'lavender',
    colorMode: 'color',
    backgroundObjects: false,
    showPlane: false,
  },
  {
    id: 'desk',
    label: 'Рабочий стол',
    description: 'Названия',
    brief: { mode: 'names', text: 'книга, 2 монеты, лампа' },
    preset: 'square',
    layout: 'composed',
    detail: 's',
    paletteId: 'lavender',
    colorMode: 'mono',
    backgroundObjects: true,
    showPlane: false,
  },
];

vi.mock('../doc/doc', () => ({ get DEMO_PRESETS() { return DEMOS; } }));
vi.mock('../layout/compose', () => ({
  ARTBOARD_PRESETS: {
    og: { id: 'og', label: 'Обложка 1200×630' },
    square: { id: 'square', label: 'Квадрат 1:1' },
    portrait: { id: 'portrait', label: 'Портрет' },
  },
}));

import { AnalysisView } from './AnalysisView';
import { BriefPanel } from './BriefPanel';
import { Catalog } from './Catalog';
import { DemoList } from './DemoList';
import { MotifThumb } from './MotifThumb';
import { EditorContext } from './state/editorContext';
import type { BriefResult, EditorApi } from './state/editorContext';

const PALETTE: Palette = {
  id: 'lavender',
  name: 'Лаванда',
  builtIn: true,
  plane: 'lavender',
  colors: {
    paper: '#ffffff',
    tint: '#ffffff',
    tone: '#ffffff',
    deep: '#ffffff',
    ink: '#000000',
    highlight: '#ffffff',
    accent: '#7864d7',
    accentSoft: '#d7cdf5',
    light: '#ffffff',
  },
};

interface FakeOptions {
  mode?: BriefMode;
  text?: string;
  brief?: BriefResult | null;
  available?: readonly MotifId[];
  withTemplates?: boolean;
}

function fakeApi(opts: FakeOptions = {}): EditorApi {
  const available = new Set<MotifId>(opts.available ?? MOTIF_IDS);
  const templates = new Map(
    opts.withTemplates
      ? MOTIF_IDS.map((id) => [
          `${id}-l-main.svg`,
          {
            file: `${id}-l-main.svg`,
            source: 'lavender',
            viewBox: { x: 0, y: 0, width: 100, height: 100 },
            bounds: { x: 10, y: 20, width: 100, height: 50 },
            colors: [],
            body: '',
            warnings: [],
          },
        ])
      : [],
  );
  const api: Partial<EditorApi> = {
    doc: {
      detail: 'l',
      colorMode: 'color',
      brief: { mode: opts.mode ?? 'title', text: opts.text ?? '' },
    } as EditorApi['doc'],
    files: [],
    available,
    templates: templates as EditorApi['templates'],
    palettes: [PALETTE],
    palette: PALETTE,
    color: (hex) => hex,
    brief: opts.brief ?? null,
    requestTemplates: () => undefined,
  };
  return api as EditorApi;
}

function render(api: EditorApi, component: (props: { id?: string }) => JSX.Element | null): string {
  return renderToStaticMarkup(createElement(EditorContext.Provider, { value: api }, createElement(component)));
}

const analysis = (patch: Partial<TitleAnalysis>): TitleAnalysis => ({
  input: 'книга без телефона',
  matches: [],
  selected: [],
  excluded: [],
  themes: [],
  unknownTokens: [],
  fallbackUsed: false,
  summary: 'Понял: учёба и чтение',
  issues: [],
  ...patch,
});

describe('MotifThumb', () => {
  it('renders the bundled svg with padded bounds and a unique prefix', () => {
    const html = render(fakeApi({ withTemplates: true }), () => createElement(MotifThumb, { motif: 'book', size: 32 }));
    expect(html).toContain('viewBox="4 14 112 62"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Книга"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toMatch(/data-prefix="thumb-[A-Za-z0-9_-]+__"/);
    expect(html).toContain('--thumb-size:32px');
  });

  it('shows a skeleton until the template arrives', () => {
    const html = render(fakeApi(), () => createElement(MotifThumb, { motif: 'book' }));
    expect(html).toContain('motif-thumb--loading');
    expect(html).toContain('aria-busy="true"');
  });
});

describe('Catalog', () => {
  it('lists only available motifs with plural count and a footer note', () => {
    const html = render(fakeApi({ available: ['book', 'lamp', 'pen'] }), Catalog);
    expect(html).toContain('3 мотива');
    expect(html).toContain('aria-label="Добавить «Книга» на холст"');
    expect(html).toContain('aria-label="Добавить «Лампа» на холст"');
    expect(html).not.toContain('Добавить «Телефон»');
    expect(html).toContain('Доступно 3 из 10 мотивов');
    expect(html.match(/draggable="true"/g)).toHaveLength(3);
  });

  it('marks fallback thumbnails with «≈» and describes file availability', () => {
    const html = render(fakeApi({ available: ['book', 'pen'] }), Catalog);
    expect(html.match(/catalog__approx/g)).toHaveLength(1);
    expect(html).toContain('подробная — основной есть, фон есть');
    expect(html).toContain('Упрощённая детализация, основной (цветной) вариант: файла нет');
  });

  it('has no footer note when every motif is available', () => {
    const html = render(fakeApi(), Catalog);
    expect(html).toContain('10 мотивов');
    expect(html).not.toContain('catalog__note');
  });
});

describe('AnalysisView', () => {
  it('shows a muted explainer before the first run', () => {
    const html = render(fakeApi(), () => createElement(AnalysisView, { id: 'fb' }));
    expect(html).toContain('id="fb"');
    expect(html).toContain('По заголовку');
    expect(html).toContain('По названиям');
    expect(html).not.toContain('analysis__match');
  });

  it('renders title matches, exclusions, themes, unknown tokens and issue actions', () => {
    const brief: BriefResult = {
      mode: 'title',
      analysis: analysis({
        matches: [
          {
            motif: 'book',
            score: 9,
            strength: 'strong',
            available: true,
            reasons: [
              { kind: 'name', token: 'книга', detail: 'название «книга»' },
              { kind: 'theme', token: 'учёба', detail: 'тема «учёба»' },
            ],
          },
          { motif: 'lamp', score: 2, strength: 'weak', available: true, reasons: [] },
          { motif: 'wallet', score: 3, strength: 'medium', available: false, reasons: [] },
        ],
        selected: ['book'],
        excluded: [{ motif: 'phone', token: 'телефона' }],
        themes: [{ id: 'study', label: 'Учёба', score: 3 }],
        unknownTokens: ['фиксики'],
        issues: [
          {
            level: 'warning',
            code: 'w',
            message: 'Не нашли подходящих объектов',
            action: { kind: 'example', label: 'Показать пример' },
          },
        ],
      }),
    };
    const html = render(fakeApi({ brief }), AnalysisView);
    expect(html).toContain('Понял: учёба и чтение');
    expect(html).toContain('название «книга» · тема «учёба»');
    expect(html).toContain('сильное совпадение');
    expect(html).toContain('слабое совпадение');
    expect(html).toContain('В композиции');
    expect(html.match(/analysis__match--selected/g)).toHaveLength(1);
    expect(html).toContain('analysis__match--unavailable');
    expect(html).toContain('нет в библиотеке');
    expect(html).toContain('без: <s>Телефон</s>');
    expect(html).toContain('не распознано: фиксики');
    expect(html).toContain('notice--warning');
    expect(html).toContain('Показать пример');
    expect(html).toContain('aria-live="polite"');
  });

  it('caps the match list at six rows', () => {
    const matches = MOTIF_IDS.map((motif) => ({
      motif,
      score: 1,
      strength: 'weak' as const,
      available: true,
      reasons: [],
    }));
    const html = render(fakeApi({ brief: { mode: 'title', analysis: analysis({ matches }) } }), AnalysisView);
    expect(html.match(/<li class="analysis__match/g)).toHaveLength(6);
  });

  it('renders one row per entry in names mode', () => {
    const parse: NamesParse = {
      input: 'книга, 2 монеты, наушнеки, ручка, зонт',
      motifs: ['book', 'coin', 'coin', 'headphones'],
      issues: [{ level: 'error', code: 'e', message: 'Не нашли «зонт»', action: { kind: 'remove', label: 'Убрать «зонт»' } }],
      entries: [
        { raw: 'книга', status: 'matched', motif: 'book', count: 1 },
        { raw: 'монеты', status: 'matched', motif: 'coin', count: 2 },
        { raw: 'наушнеки', status: 'weak', motif: 'headphones', count: 1 },
        { raw: 'ручка', status: 'unavailable', motif: 'pen', count: 1 },
        { raw: 'зонт', status: 'unmatched', count: 1 },
      ],
    };
    const html = render(fakeApi({ mode: 'names', brief: { mode: 'names', parse } }), AnalysisView);
    expect(html.match(/<li class="analysis__entry"/g)).toHaveLength(5);
    expect(html).toContain('«книга»');
    expect(html).toContain('chip chip--ok');
    expect(html).toContain('×2');
    expect(html).toContain('похоже на «Наушники»');
    expect(html).toContain('нет в библиотеке');
    expect(html).toContain('не найдено');
    expect(html).toContain('Распознано 3 из 5');
    expect(html).toContain('Убрать «зонт»');
    expect(html).toContain('notice--error');
  });
});

describe('DemoList', () => {
  it('renders compact cards with meta chips and marks the current brief', () => {
    const html = render(fakeApi({ text: 'книга, 2 монеты, лампа', mode: 'names' }), DemoList);
    expect(html).toContain('Примеры');
    expect(html).toContain('«Как накопить на первую поездку»');
    expect(html).toContain('Заголовок');
    expect(html).toContain('Названия');
    expect(html).toContain('Обложка 1200×630');
    expect(html).toContain('Лаванда');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it('marks nothing as current for an unrelated or empty brief', () => {
    expect(render(fakeApi({ text: 'другое' }), DemoList)).not.toContain('aria-current');
    expect(render(fakeApi({ text: '' }), DemoList)).not.toContain('aria-current');
  });
});

describe('BriefPanel', () => {
  it('title mode: tabs, label, placeholder, counter and a disabled run button when blank', () => {
    const html = render(fakeApi(), BriefPanel);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>По заголовку/);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"[^>]*>По названиям/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('Заголовок или тема');
    expect(html).toContain('placeholder="Например: Как накопить на первую поездку"');
    expect(html).toContain('maxLength="300"');
    expect(html).toContain('rows="3"');
    expect(html).toContain('0 / 300');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Собрать композицию/);
  });

  it('names mode: its own label, placeholder, hint and enabled run button', () => {
    const html = render(fakeApi({ mode: 'names', text: 'книга, лампа' }), BriefPanel);
    expect(html).toContain('Названия объектов');
    expect(html).toContain('Например: книга, 2 монеты, лампа');
    expect(html).toContain('Через запятую, «и» или с новой строки.');
    expect(html).toContain('12 / 300');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Собрать композицию/);
  });

  it('flags the textarea invalid after an error-level result and links its descriptions', () => {
    const brief: BriefResult = {
      mode: 'title',
      analysis: analysis({ issues: [{ level: 'error', code: 'e', message: 'Пусто' }] }),
    };
    const html = render(fakeApi({ text: 'x', brief }), BriefPanel);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/aria-describedby="[^"]+-hint [^"]+-feedback"/);
    expect(html).toContain('aria-keyshortcuts="Control+Enter Meta+Enter"');
  });

  it('includes the demo list', () => {
    expect(render(fakeApi(), BriefPanel)).toContain('Примеры');
  });
});
