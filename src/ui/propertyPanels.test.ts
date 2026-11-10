// Logic + server-render smoke tests for Inspector, LayersPanel, PalettePanel and PaletteImport.
import { createElement } from 'react';
import type { JSX } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DocState, Layer, Palette } from '../domain/types';
import { PAINT_ROLES } from '../domain/types';
import { BUILTIN_PALETTES } from '../palette/builtins';
import { EditorContext } from './state/editorContext';
import type { EditorApi } from './state/editorContext';
import {
  clampValue,
  formatNumberValue,
  parseNumberInput,
  stepValue,
} from './NumberField.logic';
import {
  displayOrder,
  layerRowName,
  listKeyIntent,
  movedIndex,
  neighbourAfterRemove,
  reorderAnnouncement,
  tabStopId,
} from './LayersPanel.logic';
import { PREVIEW_ROLES, orderPalettes, radioKeyTarget } from './PalettePanel.logic';
import {
  errorPathLabel,
  fileTooLargeMessage,
  formatKilobytes,
  isFileTooLarge,
  isRoleRequired,
  pluralize,
} from './PaletteImport.logic';
import { fallbackTitle, scalePercent, countObjects, formatDimensions } from './Inspector.logic';

vi.mock('../domain/motifs', () => ({
  MOTIFS: {
    book: { id: 'book', name: 'Книга', description: '', aliases: [] },
    bouquet: { id: 'bouquet', name: 'Букет', description: '', aliases: [] },
    coin: { id: 'coin', name: 'Монета', description: '', aliases: [] },
  },
}));

vi.mock('../export/render', () => ({
  layerAsset: (layer: { motif: string }) => ({
    meta: { file: `${layer.motif}-l-main.svg`, bounds: { x: 0, y: 0, width: 100, height: 200 } },
    exact: layer.motif !== 'bouquet',
  }),
  layerScale: (layer: { size: number }, meta: { bounds: { height: number } }) => layer.size / meta.bounds.height,
}));

vi.mock('./MotifThumb', () => ({
  MotifThumb: ({ motif }: { motif: string }) => createElement('span', { 'data-thumb': motif }),
}));

const { Inspector } = await import('./Inspector');
const { LayersPanel } = await import('./LayersPanel');
const { PalettePanel } = await import('./PalettePanel');
const { PaletteImport } = await import('./PaletteImport');

describe('NumberField logic', () => {
  it('parses plain numbers, decimal commas, typographic minus and units', () => {
    expect(parseNumberInput('12')).toBe(12);
    expect(parseNumberInput(' 12,5 ')).toBe(12.5);
    expect(parseNumberInput('−3')).toBe(-3);
    expect(parseNumberInput('15°')).toBe(15);
    expect(parseNumberInput('1 200')).toBe(1200);
    expect(parseNumberInput('.5')).toBe(0.5);
  });

  it('rejects anything that is not a number', () => {
    for (const bad of ['', '  ', 'abc', '1,2,3', '1e5', '--1', '12px', 'Infinity', '0x10']) {
      expect(parseNumberInput(bad)).toBeNull();
    }
  });

  it('formats with a decimal comma and without trailing zeros or negative zero', () => {
    expect(formatNumberValue(100.04)).toBe('100');
    expect(formatNumberValue(12.5)).toBe('12,5');
    expect(formatNumberValue(-0.01)).toBe('0');
    expect(formatNumberValue(-6)).toBe('-6');
  });

  it('steps by 1, Shift by 10, Alt by 0.1 without float drift', () => {
    expect(stepValue(5, 1, 1)).toBe(6);
    expect(stepValue(5, -1, 1, { shift: true })).toBe(-5);
    expect(stepValue(0.2, 1, 1, { alt: true })).toBe(0.3);
  });

  it('clamps to optional bounds', () => {
    expect(clampValue(5, 0, 3)).toBe(3);
    expect(clampValue(-5, 0, 3)).toBe(0);
    expect(clampValue(2)).toBe(2);
  });
});

const layer = (id: string, motif: Layer['motif'], extra: Partial<Layer> = {}): Layer => ({
  id,
  motif,
  role: 'object',
  x: 100.04,
  y: 50,
  rotation: -6,
  size: 250,
  rank: 0,
  ...extra,
});

describe('LayersPanel logic', () => {
  const layers = [layer('a', 'coin'), layer('b', 'book'), layer('c', 'bouquet')];

  it('displays top-most first', () => {
    expect(displayOrder(layers).map((l) => l.id)).toEqual(['c', 'b', 'a']);
    expect(layers.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('maps keys to intents', () => {
    expect(listKeyIntent({ key: 'ArrowDown' }, 0, 3)).toEqual({ kind: 'select', index: 1 });
    expect(listKeyIntent({ key: 'ArrowDown' }, 2, 3)).toEqual({ kind: 'select', index: 2 });
    expect(listKeyIntent({ key: 'ArrowUp' }, 0, 3)).toEqual({ kind: 'select', index: 0 });
    expect(listKeyIntent({ key: 'ArrowUp', altKey: true }, 1, 3)).toEqual({ kind: 'reorder', direction: 'up' });
    expect(listKeyIntent({ key: 'ArrowDown', altKey: true }, 1, 3)).toEqual({ kind: 'reorder', direction: 'down' });
    expect(listKeyIntent({ key: 'Home' }, 2, 3)).toEqual({ kind: 'select', index: 0 });
    expect(listKeyIntent({ key: 'End' }, 0, 3)).toEqual({ kind: 'select', index: 2 });
    expect(listKeyIntent({ key: 'Delete' }, 0, 3)).toEqual({ kind: 'remove' });
    expect(listKeyIntent({ key: 'Backspace' }, 0, 3)).toEqual({ kind: 'remove' });
    expect(listKeyIntent({ key: ' ' }, 0, 3)).toEqual({ kind: 'toggle' });
    expect(listKeyIntent({ key: 'a' }, 0, 3)).toBeNull();
    expect(listKeyIntent({ key: 'Delete', metaKey: true }, 0, 3)).toBeNull();
    expect(listKeyIntent({ key: 'Delete' }, 0, 0)).toBeNull();
  });

  it('announces the new position counted from the top', () => {
    expect(movedIndex(1, 'up', 4)).toBe(0);
    expect(movedIndex(0, 'up', 4)).toBe(0);
    expect(movedIndex(3, 'down', 4)).toBe(3);
    expect(reorderAnnouncement('Букет', 1, 4)).toBe('Букет — слой 2 из 4');
  });

  it('names echo rows, picks the next selection and the roving tab stop', () => {
    expect(layerRowName('Букет', 'background')).toBe('Букет · эхо');
    expect(layerRowName('Букет', 'object')).toBe('Букет');
    const order = displayOrder(layers);
    expect(neighbourAfterRemove(order, 0)).toBe('b');
    expect(neighbourAfterRemove(order, 2)).toBe('b');
    expect(neighbourAfterRemove([order[0]!], 0)).toBeNull();
    expect(tabStopId(order, 'b')).toBe('b');
    expect(tabStopId(order, 'zzz')).toBe('c');
    expect(tabStopId(order, null)).toBe('c');
    expect(tabStopId([], null)).toBeNull();
  });
});

describe('palette logic', () => {
  const custom: Palette = { ...BUILTIN_PALETTES[0]!, id: 'mine', name: 'Моя', builtIn: false };

  it('puts built-in palettes first', () => {
    const ordered = orderPalettes([custom, ...BUILTIN_PALETTES]);
    expect(ordered.map((p) => p.id)).toEqual(['lavender', 'peach', 'mint', 'mine']);
  });

  it('wraps radio navigation', () => {
    expect(radioKeyTarget('ArrowDown', 3, 4)).toBe(0);
    expect(radioKeyTarget('ArrowRight', 0, 4)).toBe(1);
    expect(radioKeyTarget('ArrowUp', 0, 4)).toBe(3);
    expect(radioKeyTarget('ArrowLeft', 2, 4)).toBe(1);
    expect(radioKeyTarget('Home', 2, 4)).toBe(0);
    expect(radioKeyTarget('End', 0, 4)).toBe(3);
    expect(radioKeyTarget('x', 0, 4)).toBeNull();
    expect(radioKeyTarget('ArrowDown', 0, 0)).toBeNull();
  });

  it('previews five swatches', () => {
    expect(PREVIEW_ROLES).toEqual(['tint', 'tone', 'deep', 'accent', 'highlight']);
  });
});

describe('import dialog logic', () => {
  it('formats sizes and detects oversized files', () => {
    expect(formatKilobytes(20_000)).toBe('20 КБ');
    expect(formatKilobytes(2_500)).toBe('2,5 КБ');
    expect(isFileTooLarge(20_001, 20_000)).toBe(true);
    expect(isFileTooLarge(20_000, 20_000)).toBe(false);
    expect(fileTooLargeMessage(150_000, 20_000)).toContain('150 КБ');
  });

  it('marks only paper as optional', () => {
    expect(PAINT_ROLES.filter((role) => !isRoleRequired(role))).toEqual(['paper']);
  });

  it('pluralizes and labels error paths', () => {
    const forms = ['ошибка', 'ошибки', 'ошибок'] as const;
    expect([1, 2, 5, 11, 21, 24].map((n) => pluralize(n, forms))).toEqual([
      'ошибка',
      'ошибки',
      'ошибок',
      'ошибок',
      'ошибка',
      'ошибки',
    ]);
    expect(errorPathLabel({ path: '', message: '' })).toBe('JSON');
    expect(errorPathLabel({ path: 'colors.accent', message: '' })).toBe('colors.accent');
  });
});

describe('Inspector helpers', () => {
  it('formats the inspector values', () => {
    expect(scalePercent(1.2549)).toBe(125);
    expect(formatDimensions(1200, 630)).toBe('1200 × 630');
    expect(fallbackTitle('pen-s-main.svg')).toBe('Нет точного файла — показан ближайший: pen-s-main.svg');
    expect(countObjects([{ role: 'object' }, { role: 'background' }, { role: 'object' }])).toBe(2);
  });
});

/* ---------------- server-render smoke tests ---------------- */

interface FakeOptions {
  layers?: Layer[];
  selectedId?: string | null;
  showPlane?: boolean;
  palettes?: Palette[];
  paletteId?: string;
}

function fakeApi(options: FakeOptions = {}): EditorApi {
  const palettes = options.palettes ?? [...BUILTIN_PALETTES];
  const doc = {
    version: 1,
    preset: 'og',
    detail: 'l',
    layout: 'composed',
    colorMode: 'color',
    paletteId: options.paletteId ?? 'lavender',
    backgroundObjects: false,
    showPlane: options.showPlane ?? false,
    showHeadline: false,
    headline: '',
    brief: { mode: 'title', text: '' },
    layers: options.layers ?? [],
    nextId: 10,
  } satisfies DocState;
  const palette = palettes.find((p) => p.id === doc.paletteId) ?? palettes[0]!;
  return {
    doc,
    selectedId: options.selectedId ?? null,
    files: [],
    palettes,
    palette,
    // Unused functions fail loudly if a render path calls them by accident.
    updateLayer: vi.fn(),
    announce: vi.fn(),
  } as unknown as EditorApi;
}

function render(api: EditorApi, component: () => JSX.Element): string {
  return renderToStaticMarkup(createElement(EditorContext.Provider, { value: api }, createElement(component)));
}

describe('Inspector render', () => {
  it('shows guidance and the document summary without a selection', () => {
    const html = render(fakeApi({ layers: [layer('a', 'coin'), layer('b', 'book', { role: 'background' })] }), Inspector);
    expect(html).toContain('Свойства');
    expect(html).toContain('Выберите объект на холсте или в списке слоёв');
    for (const term of ['Формат', 'Компоновка', 'Детализация', 'Цвет', 'Объектов']) expect(html).toContain(term);
    expect(html).toContain('Обложка');
  });

  it('shows fields, scale, file and a replacement chip for the selected layer', () => {
    const layers = [layer('a', 'bouquet', { role: 'background' }), layer('b', 'book')];
    const html = render(fakeApi({ layers, selectedId: 'a' }), Inspector);
    expect(html).toContain('Букет');
    expect(html).toContain('>Эхо<');
    expect(html).toContain('bouquet-l-main.svg');
    expect(html).toContain('замена');
    expect(html).toContain('Нет точного файла — показан ближайший: bouquet-l-main.svg');
    expect(html).toContain('Поворот');
    expect(html).toContain('125 %');
    expect(html).toContain('общий для композиции');
    for (const label of ['Дублировать', 'Выше', 'Ниже', 'Наверх', 'Вниз', 'Скрыть', 'Удалить']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('title="Дублировать (⌘D)"');
    expect(html).toContain('title="Удалить (⌫)"');
  });

  it('has no replacement chip for an exact file and offers «Показать» for hidden layers', () => {
    const html = render(fakeApi({ layers: [layer('b', 'book', { hidden: true })], selectedId: 'b' }), Inspector);
    expect(html).not.toContain('замена');
    expect(html).toContain('aria-label="Показать"');
    expect(html).toContain('>скрыт<');
  });
});

describe('LayersPanel render', () => {
  it('lists layers top-first with a single roving tab stop and the selected row marked', () => {
    const layers = [layer('a', 'coin'), layer('b', 'book'), layer('c', 'bouquet', { role: 'background', hidden: true })];
    const html = render(fakeApi({ layers, selectedId: 'b' }), LayersPanel);
    expect(html.indexOf('Букет · эхо')).toBeLessThan(html.indexOf('Книга'));
    expect(html.indexOf('Книга')).toBeLessThan(html.indexOf('Монета'));
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html.match(/class="layers__main" tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('Слоёв: ');
    expect(html).toContain('>, скрыт<');
    expect(html).toContain('aria-label="Букет: показать"');
    expect(html).toContain('aria-label="Книга: выше"');
  });

  it('puts the first row into the tab order when nothing is selected', () => {
    const html = render(fakeApi({ layers: [layer('a', 'coin'), layer('b', 'book')] }), LayersPanel);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.indexOf('tabindex="0"')).toBeLessThan(html.indexOf('Монета'));
  });

  it('shows the empty state and the plane pseudo-row', () => {
    const html = render(fakeApi({ showPlane: true }), LayersPanel);
    expect(html).toContain('Слоёв пока нет');
    expect(html).toContain('Плоскость · Сирень');
    expect(html).toContain('aria-label="Скрыть плоскость"');
    expect(render(fakeApi(), LayersPanel)).not.toContain('Плоскость');
  });
});

describe('PalettePanel render', () => {
  const custom: Palette = { ...BUILTIN_PALETTES[1]!, id: 'mine', name: 'Моя «тёплая»', builtIn: false };

  it('renders a radiogroup with the active option checked and custom palettes removable', () => {
    const html = render(fakeApi({ palettes: [custom, ...BUILTIN_PALETTES], paletteId: 'peach' }), PalettePanel);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(4);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html.match(/class="palette__option" tabindex="0"/g)).toHaveLength(1);
    expect(html.indexOf('Сирень')).toBeLessThan(html.indexOf('Моя «тёплая»'));
    expect(html).toContain('aria-label="Удалить палитру «Моя «тёплая»»"');
    expect(html.match(/palette__remove/g)).toHaveLength(1);
    expect(html.match(/class="palette__swatch"/g)).toHaveLength(20);
  });

  it('has a collapsed role table wired with aria-expanded / aria-controls and an import button', () => {
    const html = render(fakeApi(), PalettePanel);
    expect(html).toMatch(/aria-expanded="false" aria-controls="([^"]+)"/);
    expect(html).toContain('Роли цвета');
    expect(html).toContain('Импортировать палитру…');
    for (const role of PAINT_ROLES) expect(html).toContain(BUILTIN_PALETTES[0]!.colors[role].toUpperCase());
  });
});

describe('PaletteImport render', () => {
  it('renders the schema, template and input controls', () => {
    const html = render(fakeApi(), () => createElement(PaletteImport, { onClose: () => undefined }));
    expect(html).toContain('<dialog');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain('Импорт палитры');
    expect(html).toContain('JSON палитры');
    expect(html).toContain('accept=".json,application/json"');
    expect(html).toContain('Загрузить файл…');
    expect(html).toContain('Скопировать шаблон');
    expect(html).toContain('Скачать шаблон');
    expect(html).toContain('Добавить палитру');
    expect(html).toContain('forma.palette/v1');
    for (const role of PAINT_ROLES) expect(html).toContain(`colors.${role}`);
    for (const field of ['schema', 'name', 'plane', 'colors']) expect(html).toContain(`<code>${field}</code>`);
    expect(html).toContain('lavender');
    // Nothing is validated before the user types.
    expect(html).not.toContain('в палитре');
  });
});
