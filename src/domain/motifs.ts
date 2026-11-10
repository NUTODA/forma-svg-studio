import type { MotifId } from './types';

export interface MotifInfo {
  id: MotifId;
  /** Russian display name, nominative singular: «Книга». */
  name: string;
  /** Short Russian description for the catalog: «Раскрытая книга». */
  description: string;
  /** Alternative component names users may type: «книжка», «томик»… */
  aliases: string[];
}

/**
 * Names mode: `aliases` are other names of the same OBJECT (what is drawn).
 * Title mode synonyms («деньги», «идея»…) live in `src/semantics/lexicon.ts` — they describe
 * what a headline MEANS, not which object the user is naming.
 * Descriptions stay generic on purpose: they say what the object stands for.
 */
export const MOTIFS: Record<MotifId, MotifInfo> = {
  book: {
    id: 'book',
    name: 'Книга',
    description: 'Книга — чтение, знания, учёба',
    aliases: ['книжка', 'книжица', 'томик', 'учебник', 'фолиант'],
  },
  phone: {
    id: 'phone',
    name: 'Телефон',
    description: 'Телефон — связь, приложения, новости',
    aliases: [
      'смартфон',
      'мобильник',
      'мобильный',
      'мобильный телефон',
      'сотовый',
      'сотовый телефон',
      'айфон',
      'iphone',
      'телефончик',
    ],
  },
  puzzle: {
    id: 'puzzle',
    name: 'Пазлы',
    description: 'Пазлы — команда, решение, части целого',
    aliases: ['пазл', 'паззл', 'паззлы', 'пазлик', 'кусочек пазла', 'деталь пазла'],
  },
  coin: {
    id: 'coin',
    name: 'Монета',
    description: 'Монета — деньги, цена, накопления',
    aliases: ['монетка', 'рубль', 'копейка', 'пятак', 'доллар', 'евро'],
  },
  headphones: {
    id: 'headphones',
    name: 'Наушники',
    description: 'Наушники — музыка, подкасты, концентрация',
    aliases: ['наушник', 'гарнитура', 'airpods'],
  },
  lamp: {
    id: 'lamp',
    name: 'Лампа',
    description: 'Лампа — идея, свет, озарение',
    aliases: ['лампочка', 'светильник', 'настольная лампа', 'ночник', 'торшер'],
  },
  bouquet: {
    id: 'bouquet',
    name: 'Букет',
    description: 'Букет — цветы, праздник, подарок',
    aliases: [
      'цветы',
      'цветок',
      'цветочки',
      'букетик',
      'цветочный букет',
      'роза',
      'розы',
      'тюльпан',
      'тюльпаны',
      'ромашка',
      'ромашки',
      'пион',
      'пионы',
      'гвоздика',
      'гвоздики',
      'сирень',
    ],
  },
  wallet: {
    id: 'wallet',
    name: 'Кошелёк',
    description: 'Кошелёк — бюджет, покупки, сбережения',
    aliases: ['портмоне', 'бумажник', 'лопатник', 'кошелечек'],
  },
  folder: {
    id: 'folder',
    name: 'Папка',
    description: 'Папка — документы, архив, порядок',
    aliases: ['папочка', 'скоросшиватель', 'файловая папка'],
  },
  pen: {
    id: 'pen',
    name: 'Ручка',
    description: 'Ручка — письмо, заметки, подпись',
    aliases: ['перо', 'авторучка', 'шариковая ручка', 'гелевая ручка', 'перьевая ручка', 'ручечка'],
  },
};

/** Grammatical number/gender of the display name, for correct Russian in messages. */
export const MOTIF_GRAMMAR: Record<MotifId, 'm' | 'f' | 'p'> = {
  book: 'f',
  phone: 'm',
  puzzle: 'p',
  coin: 'f',
  headphones: 'p',
  lamp: 'f',
  bouquet: 'm',
  wallet: 'm',
  folder: 'f',
  pen: 'f',
};

/** «её» / «его» / «их» — to agree with the motif name («Лампа… её файлов нет»). */
export function possessiveFor(id: MotifId): string {
  const grammar = MOTIF_GRAMMAR[id];
  return grammar === 'f' ? 'её' : grammar === 'm' ? 'его' : 'их';
}

/** «подходит» / «подходят» — verb agreement for the motif name. */
export function fitsVerbFor(id: MotifId): string {
  return MOTIF_GRAMMAR[id] === 'p' ? 'подходят' : 'подходит';
}
