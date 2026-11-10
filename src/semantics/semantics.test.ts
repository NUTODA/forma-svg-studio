import { describe, expect, it } from 'vitest';
import { MOTIFS } from '../domain/motifs';
import { MOTIF_IDS, type MotifId } from '../domain/types';
import { analyzeTitle } from './analyzeTitle';
import { damerauLevenshtein } from './fuzzy';
import { findNegations, matchCase, tokenize } from './normalize';
import { parseNames } from './parseNames';
import { stemWord } from './stem';

const ALL: ReadonlySet<MotifId> = new Set(MOTIF_IDS);
const without = (...ids: MotifId[]): ReadonlySet<MotifId> => new Set(MOTIF_IDS.filter((id) => !ids.includes(id)));

describe('motif catalogue', () => {
  it('describes every motif with a name and aliases', () => {
    for (const id of MOTIF_IDS) {
      expect(MOTIFS[id].id).toBe(id);
      expect(MOTIFS[id].name.length).toBeGreaterThan(2);
      expect(MOTIFS[id].aliases.length).toBeGreaterThan(0);
    }
  });
});

describe('helpers', () => {
  it('stems Russian inflections together', () => {
    expect(stemWord('монеты')).toBe(stemWord('монета'));
    expect(stemWord('наушников')).toBe(stemWord('наушники'));
    expect(stemWord('деньгами')).toBe(stemWord('деньги'));
  });

  it('counts adjacent transpositions as one edit', () => {
    expect(damerauLevenshtein('книга', 'кнгиа', 2)).toBe(1);
    expect(damerauLevenshtein('книга', 'кнгиа')).toBe(1);
    expect(damerauLevenshtein('телефон', 'телефно')).toBe(1);
  });

  it('matches the case of the word a correction replaces', () => {
    expect(matchCase('Ламба', 'лампа')).toBe('Лампа');
    expect(matchCase('ЛАМБА', 'лампа')).toBe('ЛАМПА');
    expect(matchCase('ламба', 'лампа')).toBe('лампа');
    expect(matchCase('Л', 'лампа')).toBe('Лампа');
    expect(matchCase('', 'лампа')).toBe('лампа');
  });

  it('negates the object after «без», including coordinated lists', () => {
    const input = 'Подарок без телефона и наушников';
    const tokens = tokenize(input);
    const negated = findNegations(tokens, input);
    const words = [...negated.keys()].map((i) => tokens[i]?.norm);
    expect(words).toEqual(['телефона', 'наушников']);
  });
});

describe('analyzeTitle', () => {
  it('rejects empty and wordless input with an error', () => {
    for (const text of ['', '   ', '123 !!!', 'и в на']) {
      const result = analyzeTitle(text, ALL);
      expect(result.selected).toEqual([]);
      expect(result.issues.some((i) => i.level === 'error')).toBe(true);
    }
  });

  it('picks the bouquet for the spring demo headline', () => {
    const result = analyzeTitle('Весенний букет: как выбрать цветы к 8 Марта', ALL);
    expect(result.selected[0]).toBe('bouquet');
    expect(result.matches[0]?.strength).toBe('strong');
    expect(result.fallbackUsed).toBe(false);
    expect(result.themes.map((t) => t.id)).toContain('holiday');
  });

  it('reads the money headline as coin + wallet', () => {
    const result = analyzeTitle('Финансовая грамотность: как копить с первой зарплаты', ALL);
    expect(result.selected).toEqual(['coin', 'wallet']);
    expect(result.themes[0]?.id).toBe('money');
  });

  it.each([
    ['Знания по кусочкам', ['puzzle', 'book']],
    ['Как мы учились по шагам', ['puzzle', 'book']],
    ['Эффект домино', ['puzzle']],
    ['Учиться слышать себя', ['headphones']],
  ] as const)('interprets «%s» as %j', (title, motifs) => {
    const result = analyzeTitle(title, ALL);
    expect(result.selected).toEqual(motifs);
    expect(result.fallbackUsed).toBe(false);
  });

  it.each([
    ['Как найти идею для стартапа', 'lamp'],
    ['Лучшие подкасты для дороги', 'headphones'],
    ['Командная работа: собираем решение вместе', 'puzzle'],
    ['Архив документов: наводим порядок', 'folder'],
    ['Как вести дневник и делать заметки', 'pen'],
    ['Десять книг, которые стоит прочитать', 'book'],
    ['Мобильное приложение для звонков', 'phone'],
    ['Планируем бюджет и покупки', 'wallet'],
  ] as const)('«%s» → %s first', (title, motif) => {
    expect(analyzeTitle(title, ALL).selected[0]).toBe(motif);
  });

  it('handles case, ё and inflected forms of names', () => {
    expect(analyzeTitle('КОШЕЛЁК и КОШЕЛЬКА', ALL).selected).toContain('wallet');
    expect(analyzeTitle('О пользе наушников', ALL).selected).toEqual(['headphones']);
    expect(analyzeTitle('Без ё: кошелек', ALL).selected).toContain('wallet');
  });

  it('does not take a colour for flowers', () => {
    const result = analyzeTitle('Какой цвет выбрать для сайта', ALL);
    expect(result.selected).not.toContain('bouquet');
  });

  it('excludes negated objects and says so', () => {
    const result = analyzeTitle('Книга и лампа, но без телефона', ALL);
    expect(result.selected).toEqual(['book', 'lamp']);
    expect(result.excluded).toEqual([{ motif: 'phone', token: 'телефона' }]);
    expect(result.issues.some((i) => i.code === 'excluded')).toBe(true);
  });

  it('understands «по крупицам» like «по кусочкам»: puzzle and book', () => {
    for (const title of ['Знания по крупицам', 'Собирать опыт по крупицам']) {
      const r = analyzeTitle(title, ALL);
      expect(r.selected).toContain('puzzle');
      expect(r.selected.length).toBeGreaterThanOrEqual(2);
      expect(r.fallbackUsed).toBe(false);
    }
  });

  it('is honest about a weak match', () => {
    const result = analyzeTitle('Полезные навыки для работы', ALL);
    expect(result.matches[0]?.strength).toBe('weak');
    // A weak guess is never shown alone: it gets a companion.
    expect(result.selected).toHaveLength(2);
    expect(result.fallbackUsed).toBe(false);
    expect(result.issues.find((i) => i.code === 'weak-match')?.level).toBe('warning');
    expect(result.summary).toContain('слабое совпадение');
  });

  it('falls back to a neutral available object with a warning when nothing matches', () => {
    const result = analyzeTitle('Квантовая хромодинамика', ALL);
    expect(result.fallbackUsed).toBe(true);
    expect(result.selected).toHaveLength(1);
    expect(result.matches.find((m) => m.motif === result.selected[0])?.reasons[0]?.kind).toBe('fallback');
    expect(result.issues.find((i) => i.code === 'no-match')?.level).toBe('warning');
    expect(result.unknownTokens).toEqual(['Квантовая', 'хромодинамика']);
  });

  it('never selects a motif without files, and reports it', () => {
    const result = analyzeTitle('Идея и лампа для уюта', without('lamp'));
    expect(result.selected).not.toContain('lamp');
    const lamp = result.matches.find((m) => m.motif === 'lamp');
    expect(lamp?.available).toBe(false);
    expect(result.issues.some((i) => i.code === 'unavailable' && i.message.includes('Лампа'))).toBe(true);
  });

  it('errors when the library is empty', () => {
    const result = analyzeTitle('Книга', new Set());
    expect(result.selected).toEqual([]);
    expect(result.issues.some((i) => i.code === 'no-assets' && i.level === 'error')).toBe(true);
  });

  it('suggests a replacement for a typo', () => {
    const result = analyzeTitle('Новый телефан в подарок', ALL);
    expect(result.selected).toContain('phone');
    const typo = result.issues.find((i) => i.code === 'typo');
    expect(typo?.action).toMatchObject({
      kind: 'replace',
      token: 'телефан',
      replacement: 'телефон',
      range: { start: 6, end: 13 },
    });
    expect(result.matches.find((m) => m.motif === 'phone')?.reasons.some((r) => r.kind === 'fuzzy')).toBe(true);
  });

  it('writes the correction the way the typo was written', () => {
    const action = (title: string) => analyzeTitle(title, ALL).issues.find((i) => i.code === 'typo')?.action;
    // The first word of a title keeps its capital …
    expect(action('Телефан в подарок')).toMatchObject({
      token: 'Телефан',
      replacement: 'Телефон',
      range: { start: 0, end: 7 },
    });
    expect(action('Телефан в подарок')?.label).toContain('Телефон');
    // … a word in the middle does not gain one …
    expect(action('Новый телефан в подарок')?.replacement).toBe('телефон');
    // … and capitals that were typed on purpose stay.
    expect(action('Купить ТЕЛЕФАН')?.replacement).toBe('ТЕЛЕФОН');
  });

  it('points each typo of a repeated word at its own place', () => {
    const ranges = analyzeTitle('телефан, телефан', ALL)
      .issues.filter((i) => i.code === 'typo')
      .map((i) => i.action?.range);
    expect(ranges).toEqual([
      { start: 0, end: 7 },
      { start: 9, end: 16 },
    ]);
  });

  it('respects and clamps the selection limit, reporting trimming', () => {
    const title = 'Книга, наушники, лампа, ручка, папка';
    expect(analyzeTitle(title, ALL).selected).toHaveLength(3);
    expect(analyzeTitle(title, ALL, { max: 5 }).selected).toHaveLength(5);
    expect(analyzeTitle(title, ALL, { max: 99 }).selected).toHaveLength(5);
    expect(analyzeTitle(title, ALL, { max: 0 }).selected).toHaveLength(1);
    expect(analyzeTitle(title, ALL, { max: Number.NaN }).selected).toHaveLength(3);
    expect(analyzeTitle(title, ALL).issues.some((i) => i.code === 'trimmed')).toBe(true);
  });

  it('is deterministic and keeps matches sorted best-first', () => {
    const title = 'Деньги, идеи и музыка для стартапа';
    const a = analyzeTitle(title, ALL);
    expect(analyzeTitle(title, ALL)).toEqual(a);
    const scores = a.matches.map((m) => m.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(a.selected.every((m) => a.matches.find((x) => x.motif === m)?.available)).toBe(true);
  });

  it('explains each match with reasons', () => {
    const result = analyzeTitle('Деньги любят счёт', ALL);
    const coin = result.matches.find((m) => m.motif === 'coin');
    expect(coin?.reasons[0]?.kind).toBe('synonym');
    expect(coin?.reasons[0]?.token).toBe('Деньги');
  });
});

describe('parseNames', () => {
  it('parses a plain list', () => {
    const result = parseNames('книга, наушники, лампа, ручка', ALL);
    expect(result.motifs).toEqual(['book', 'headphones', 'lamp', 'pen']);
    expect(result.entries.map((e) => e.status)).toEqual(['matched', 'matched', 'matched', 'matched']);
    expect(result.issues).toEqual([]);
  });

  it('is tolerant of case, ё, quotes, separators and aliases', () => {
    // «Портмоне» is another name of the wallet: the repeat merges into the first position.
    const result = parseNames('«КОШЕЛЁК»; Смартфон + настольная лампа\nПортмоне', ALL);
    expect(result.motifs).toEqual(['wallet', 'wallet', 'phone', 'lamp']);
    expect(result.entries.map((e) => e.via)).toEqual(['name', 'alias', 'alias', 'alias']);
    expect(parseNames('кошелек', ALL).motifs).toEqual(['wallet']);
    expect(parseNames('кошелька', ALL).entries[0]?.via).toBe('stem');
  });

  it('understands quantities', () => {
    expect(parseNames('3 монеты', ALL).motifs).toEqual(['coin', 'coin', 'coin']);
    expect(parseNames('монета ×2, книга x2', ALL).motifs).toEqual(['coin', 'coin', 'book', 'book']);
    expect(parseNames('две ручки', ALL).entries[0]?.count).toBe(2);
    const big = parseNames('9 монет', ALL);
    expect(big.entries[0]?.count).toBe(4);
    expect(big.issues.some((i) => i.code === 'count-clamped')).toBe(true);
  });

  it('does not read list numbering as a quantity', () => {
    const lists = [
      '1) книга\n2) монета',
      '(1) книга; (2) монета',
      '[1] книга, [2] монета',
      '1: книга\n2: монета',
      '1- книга\n2- монета',
      '1.) книга\n2.) монета',
      '#1 книга, #2 монета',
      'а) книга\nб) монета',
    ];
    for (const list of lists) {
      const result = parseNames(list, ALL);
      expect(result.motifs, list).toEqual(['book', 'coin']);
      expect(result.entries.map((e) => e.count), list).toEqual([1, 1]);
    }
  });

  it('keeps intentional quantities, also behind a list marker', () => {
    expect(parseNames('2 монеты', ALL).entries[0]?.count).toBe(2);
    expect(parseNames('2 монеты, книга ×3', ALL).motifs).toEqual(['coin', 'coin', 'book', 'book', 'book']);
    expect(parseNames('1) 2 монеты\n2) книга', ALL).motifs).toEqual(['coin', 'coin', 'book']);
  });

  it('points every replace action at the exact fragment it was raised for', () => {
    const rangeOf = (input: string) =>
      parseNames(input, ALL)
        .issues.filter((i) => i.action?.kind === 'replace')
        .map((i) => i.action?.range);

    expect(rangeOf('ламба, ламба')).toEqual([
      { start: 0, end: 5 },
      { start: 7, end: 12 },
    ]);
    expect(rangeOf('деньги, книга, деньги')).toEqual([
      { start: 0, end: 6 },
      { start: 15, end: 21 },
    ]);
    // A list marker and a quantity in front of the word do not shift the range.
    expect(rangeOf('1) 2 ламба, 2) ламба')).toEqual([
      { start: 5, end: 10 },
      { start: 15, end: 20 },
    ]);

    for (const input of ['ламба, ламба', 'деньги, книга, деньги', '1) 2 ламба, 2) ламба', '  телефан ;  ламба']) {
      for (const issue of parseNames(input, ALL).issues) {
        const { action } = issue;
        if (action?.kind !== 'replace') continue;
        expect(action.range, input).toBeDefined();
        expect(input.slice(action.range?.start, action.range?.end), input).toBe(action.token);
      }
    }
  });

  it('merges exact repeats instead of duplicating entries silently', () => {
    const result = parseNames('книга, Книга, КНИГА', ALL);
    expect(result.entries).toHaveLength(3);
    expect(result.motifs).toEqual(['book', 'book', 'book']);
    expect(result.issues.find((i) => i.code === 'repeat')?.message).toContain('×3');
    expect(parseNames('книга, книга', ALL)).toEqual(parseNames('книга, книга', ALL));
  });

  it('caps one object at four copies', () => {
    expect(parseNames('книга ×3, книга ×3', ALL).motifs).toHaveLength(4);
  });

  it('suggests the closest object for unknown names', () => {
    const result = parseNames('деньги, фонарь', ALL);
    expect(result.entries[0]).toMatchObject({ status: 'unmatched', suggestion: 'coin' });
    expect(result.entries[1]?.status).toBe('unmatched');
    const issue = result.issues.find((i) => i.action?.token === 'деньги');
    expect(issue?.action).toMatchObject({ kind: 'replace', replacement: 'Монета' });
    expect(result.issues.find((i) => i.message.includes('фонарь'))?.message).toContain('Доступные:');
    expect(result.issues.some((i) => i.code === 'nothing-recognized')).toBe(true);
  });

  it('treats one-letter typos as weak matches that still compose', () => {
    const result = parseNames('ламба, телефан', ALL);
    expect(result.entries.map((e) => e.status)).toEqual(['weak', 'weak']);
    expect(result.entries.map((e) => e.via)).toEqual(['fuzzy', 'fuzzy']);
    expect(result.motifs).toEqual(['lamp', 'phone']);
    expect(result.issues.filter((i) => i.code === 'typo')).toHaveLength(2);
  });

  it('reports motifs without files and leaves them out', () => {
    const result = parseNames('лампа, книга', without('lamp'));
    expect(result.entries[0]).toMatchObject({ status: 'unavailable', motif: 'lamp' });
    expect(result.motifs).toEqual(['book']);
    expect(result.issues.find((i) => i.code === 'unavailable')?.message).toContain('её');
  });

  it('errors on empty input and an empty library', () => {
    expect(parseNames('  , ;', ALL).issues[0]?.level).toBe('error');
    expect(parseNames('книга', new Set()).issues.some((i) => i.code === 'no-assets')).toBe(true);
  });

  it('does not read «iPhone 15» as a quantity', () => {
    const result = parseNames('iPhone 15', ALL);
    expect(result.entries[0]).toMatchObject({ status: 'matched', motif: 'phone', count: 1 });
  });

  it('splits glued names and says so', () => {
    const result = parseNames('книга ручка', ALL);
    expect(result.motifs).toEqual(['book', 'pen']);
    expect(result.issues.some((i) => i.code === 'missing-separator')).toBe(true);
  });

  it('limits the total number of objects', () => {
    const result = parseNames('книга ×4, ручка ×4, лампа ×4', ALL);
    expect(result.motifs).toHaveLength(8);
    expect(result.issues.some((i) => i.code === 'too-many')).toBe(true);
  });

  it('counts a name repeated without a separator as several instances', () => {
    const result = parseNames('телефон телефон', ALL);
    expect(result.motifs).toEqual(['phone', 'phone']);
    expect(result.issues.some((i) => i.code === 'missing-separator')).toBe(true);
  });

  it('suggests the nearest real object for drawings the library does not have', () => {
    const result = parseNames('карандаш, блокнот', ALL);
    expect(result.entries.map((e) => [e.status, e.suggestion])).toEqual([
      ['unmatched', 'pen'],
      ['unmatched', 'book'],
    ]);
    expect(result.issues.some((i) => i.action?.replacement === 'Ручка')).toBe(true);
  });
});

describe('analyzeTitle regressions', () => {
  const cases: { title: string; first?: MotifId; includes?: MotifId[]; theme?: string }[] = [
    { title: 'Лучшие подкасты для долгой дороги', first: 'headphones', theme: 'Музыка и звук' },
    { title: 'Документы для налогового вычета', first: 'folder', includes: ['coin'] },
    { title: 'Что почитать в отпуске', first: 'book' },
    { title: 'Как написать резюме, которое прочитают', includes: ['pen', 'folder'] },
    { title: 'Удалённая работа: как не потеряться в чатах', includes: ['phone', 'folder'] },
    { title: 'Бюрократия без боли: оформляем справки онлайн', first: 'folder' },
    { title: 'Ночь в библиотеке', first: 'book', theme: 'Чтение и знания' },
    { title: 'Кэшбэк, скидки и подписки: куда утекают деньги', includes: ['wallet', 'coin'] },
    { title: 'Подарок учителю на 1 сентября', first: 'bouquet', includes: ['book'] },
  ];
  for (const c of cases) {
    it(c.title, () => {
      const a = analyzeTitle(c.title, ALL, { max: 3 });
      if (c.first) expect(a.selected[0]).toBe(c.first);
      for (const motif of c.includes ?? []) expect(a.selected).toContain(motif);
      if (c.theme) expect(a.themes[0]?.label).toBe(c.theme);
    });
  }

  it('only reports themes that explain a selected motif', () => {
    for (const c of cases) {
      const a = analyzeTitle(c.title, ALL, { max: 3 });
      expect(a.themes.every((t) => !t.label.includes('Деньги') || a.selected.some((m) => m === 'coin' || m === 'wallet'))).toBe(true);
    }
  });

  it('short stems do not collide with unrelated words', () => {
    expect(analyzeTitle('Долгой дороги', ALL).themes.map((t) => t.id)).not.toContain('money');
    expect(analyzeTitle('Итоги 10 лет', ALL).themes.map((t) => t.id)).not.toContain('flowers');
  });

  it('never calls a valid prefixed verb a typo', () => {
    for (const title of ['Что почитать в отпуске', 'Как написать письмо', 'Прочитают ли это']) {
      expect(analyzeTitle(title, ALL).issues.some((i) => i.code === 'typo')).toBe(false);
    }
  });

  it('the rule interpreter is the default plug-in and matches analyzeTitle', async () => {
    const { ruleInterpreter } = await import('./interpreter');
    const title = 'Идея, которая изменит команду';
    expect(await ruleInterpreter.interpret(title, ALL, { max: 3 })).toEqual(analyzeTitle(title, ALL, { max: 3 }));
  });
});
