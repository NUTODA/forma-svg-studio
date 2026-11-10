import { describe, expect, it } from 'vitest';
import { MOTIF_IDS, type MotifId } from '../domain/types';
import { readBrief } from './briefMode';
import { parseNames } from './parseNames';

const ALL: ReadonlySet<MotifId> = new Set(MOTIF_IDS);
const without = (...ids: MotifId[]): ReadonlySet<MotifId> => new Set(MOTIF_IDS.filter((id) => !ids.includes(id)));
const modeOf = (text: string, available: ReadonlySet<MotifId> = ALL) => readBrief(text, available).mode;

describe('readBrief: an explicit list', () => {
  it('reads the reported input as a list that builds all five objects', () => {
    const { mode, parse } = readBrief('Книга, 2 монеты, лампа, ручка', ALL);
    expect(mode).toBe('names');
    expect(parse.motifs).toEqual(['book', 'coin', 'coin', 'lamp', 'pen']);
    expect(parse.issues).toEqual([]);
  });

  it.each([
    ['книга, лампа', ['book', 'lamp']],
    ['Книга и ручка', ['book', 'pen']],
    ['книга + лампа + ручка', ['book', 'lamp', 'pen']],
    ['книга\nлампа\nручка', ['book', 'lamp', 'pen']],
    ['1) книга\n2) 2 монеты\n3) лампа', ['book', 'coin', 'coin', 'lamp']],
    ['монета ×2, книга ×3', ['coin', 'coin', 'book', 'book', 'book']],
    ['настольная лампа, смартфон', ['lamp', 'phone']],
    ['ламба, телефан', ['lamp', 'phone']],
  ] as const)('«%s» is a list: %j', (text, motifs) => {
    const { mode, parse } = readBrief(text, ALL);
    expect(mode).toBe('names');
    expect(parse.motifs).toEqual(motifs);
  });

  it.each([
    ['3 монеты', ['coin', 'coin', 'coin']],
    ['монета ×2', ['coin', 'coin']],
    ['две ручки', ['pen', 'pen']],
  ] as const)('a single name with a quantity is a list: «%s»', (text, motifs) => {
    const { mode, parse } = readBrief(text, ALL);
    expect(mode).toBe('names');
    expect(parse.motifs).toEqual(motifs);
  });

  it('keeps the limits of a list: at most four of one object and eight in all, with a warning', () => {
    const many = readBrief('книга, телефон, пазлы, монета, наушники, лампа, букет, кошелёк, папка, ручка', ALL);
    expect(many.mode).toBe('names');
    expect(many.parse.motifs).toHaveLength(8);
    expect(many.parse.issues.some((i) => i.code === 'too-many')).toBe(true);

    const repeated = readBrief('книга ×4, ручка ×4, лампа ×4', ALL);
    expect(repeated.mode).toBe('names');
    expect(repeated.parse.motifs).toHaveLength(8);
    expect(readBrief('монета ×9, книга', ALL).parse.issues.some((i) => i.code === 'count-clamped')).toBe(true);
  });

  it('still lists an object whose files are missing, and says so', () => {
    const { mode, parse } = readBrief('лампа, книга', without('lamp'));
    expect(mode).toBe('names');
    expect(parse.motifs).toEqual(['book']);
    expect(parse.entries[0]).toMatchObject({ status: 'unavailable', motif: 'lamp' });
  });

  it('returns exactly what parseNames returns for the same input', () => {
    for (const text of ['Книга, 2 монеты, лампа, ручка', 'Книга, зонт, лампа', 'Знания по кусочкам']) {
      expect(readBrief(text, ALL).parse).toEqual(parseNames(text, ALL));
    }
  });
});

describe('readBrief: a title or a metaphor', () => {
  it.each([
    'Знания по кусочкам',
    'Как накопить на первую поездку',
    'Финансовая грамотность: как копить с первой зарплаты',
    'Весна, цветы, радость',
    'Цифровой детокс',
    'Книга и ручка: что подарить на выпускной',
    'Телефон, наушники и немного тишины',
  ])('«%s» is a title', (text) => {
    expect(modeOf(text)).toBe('title');
  });

  it('does not take a name inside a phrase for a list item', () => {
    // The parser finds the book, the lamp and the phone in these; the words around them say it is prose.
    expect(readBrief('Книга для чтения', ALL).parse.motifs).toEqual(['book']);
    expect(modeOf('Книга для чтения')).toBe('title');
    expect(modeOf('Лампа для телефона')).toBe('title');
    expect(modeOf('Книга в подарок, лампа для чтения')).toBe('title');
  });

  it('does not take a negation for a list', () => {
    // «без телефона» would otherwise put the phone in the composition.
    expect(readBrief('Книга, лампа без телефона', ALL).parse.motifs).toContain('phone');
    expect(modeOf('Книга, лампа без телефона')).toBe('title');
    expect(modeOf('Смартфон без наушников')).toBe('title');
    expect(modeOf('книга, лампа, не телефон')).toBe('title');
    expect(modeOf('всё, кроме книги и лампы')).toBe('title');
  });

  it('takes one bare name for a topic, not a list: it gets a companion object', () => {
    expect(modeOf('Книга')).toBe('title');
    expect(modeOf('iPhone 15')).toBe('title');
  });

  it('leaves empty input to the title analysis, which reports it', () => {
    expect(modeOf('')).toBe('title');
    expect(modeOf('  , ;')).toBe('title');
  });
});

describe('readBrief: names mixed with words the library does not know', () => {
  it('keeps a list with an unknown item a list, and reports the item instead of dropping it', () => {
    const { mode, parse } = readBrief('Книга, зонт, лампа', ALL);
    expect(mode).toBe('names');
    expect(parse.motifs).toEqual(['book', 'lamp']);
    expect(parse.entries.map((e) => e.status)).toEqual(['matched', 'unmatched', 'matched']);
    expect(parse.issues.some((i) => i.code === 'unmatched' && i.message.includes('зонт'))).toBe(true);
  });

  it('keeps every known object of a longer list, quantities included', () => {
    const { mode, parse } = readBrief('Книга, 2 монеты, лампа, ручка, зонт', ALL);
    expect(mode).toBe('names');
    expect(parse.motifs).toEqual(['book', 'coin', 'coin', 'lamp', 'pen']);
    expect(parse.entries.at(-1)).toMatchObject({ raw: 'зонт', status: 'unmatched' });
  });

  it('reads it as a title once the unknown items are as many as the objects', () => {
    expect(modeOf('Книга, лампа, зонт, шляпа')).toBe('title');
    expect(modeOf('Книга, зонт')).toBe('title');
    expect(modeOf('зонт, шляпа')).toBe('title');
    // «деньги» is a word of the title dictionary, not the name of an object.
    expect(modeOf('Книга, деньги')).toBe('title');
  });
});
