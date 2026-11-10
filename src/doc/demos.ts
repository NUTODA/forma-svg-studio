import type { DemoPreset } from '../domain/types';

/** Demonstrative presets: one by title (with headline zone), one by title (echoes), one by object names. */
export const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: 'spring-bouquet',
    label: 'Букет к 8 Марта',
    description: 'Заголовок → композиция с зоной для текста',
    brief: { mode: 'title', text: 'Весенний букет: как выбрать цветы к 8 Марта' },
    preset: 'og',
    layout: 'title',
    detail: 'l',
    paletteId: 'lavender',
    colorMode: 'color',
    backgroundObjects: false,
    showPlane: true,
  },
  {
    id: 'first-salary',
    label: 'Первая зарплата',
    description: 'Метафора финансов → подбор объектов',
    brief: { mode: 'title', text: 'Финансовая грамотность: как копить с первой зарплаты' },
    preset: 'portrait',
    layout: 'composed',
    detail: 'l',
    paletteId: 'peach',
    colorMode: 'color',
    backgroundObjects: true,
    showPlane: true,
  },
  {
    id: 'study-kit',
    label: 'Набор для учёбы',
    description: 'Названия объектов → смещённая компоновка',
    brief: { mode: 'names', text: 'книга, наушники, лампа, ручка' },
    preset: 'square',
    layout: 'offset',
    detail: 's',
    paletteId: 'mint',
    colorMode: 'color',
    backgroundObjects: false,
    // Each demo shows its own palette plane: lavender, peach, mint.
    showPlane: true,
  },
];
