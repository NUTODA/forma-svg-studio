import { stemWord } from './stem';

export interface Token {
  /** The word as typed (case and «ё» preserved). */
  raw: string;
  /** Lowercase, «ё» → «е». */
  norm: string;
  stem: string;
  /** Position among tokens. */
  index: number;
  /** Character offsets of `raw` in the source text. */
  start: number;
  end: number;
}

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const DASH_GAP = /^[-‐‑‒–]$/u;
const NUMERIC = /^\p{N}+$/u;

export function foldYo(text: string): string {
  return text.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

/** One word: lowercase, ё → е, everything but letters and digits stripped. */
export function normalizeWord(text: string): string {
  return foldYo(text.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Free text: lowercase, ё → е, punctuation/quotes/emoji/hyphens → single spaces. */
export function normalizeText(text: string): string {
  return foldYo(text.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function isNumeric(word: string): boolean {
  return NUMERIC.test(word);
}

/**
 * `replacement` written the way `original` was: «Ламба» → «Лампа», «ЛАМБА» → «ЛАМПА», «ламба» → «лампа».
 * A correction must not drop the capital of a sentence's first word, nor add one in the middle of it.
 */
export function matchCase(original: string, replacement: string): string {
  const letters = [...original].filter((ch) => ch.toLowerCase() !== ch.toUpperCase());
  const first = letters[0];
  if (first === undefined || first === first.toLowerCase()) return replacement;
  if (letters.length > 1 && letters.every((ch) => ch === ch.toUpperCase())) return replacement.toUpperCase();
  const [head = '', ...rest] = [...replacement];
  return head.toUpperCase() + rest.join('');
}

/**
 * Split text into words. Hyphenated words become separate tokens («онлайн-курс»);
 * ordinal suffixes after a number are dropped («8-го марта» → «8», «марта»).
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  for (const match of input.matchAll(WORD_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const norm = foldYo(raw.toLowerCase());
    const prev = tokens[tokens.length - 1];
    if (
      prev !== undefined &&
      isNumeric(prev.norm) &&
      /^\p{L}{1,3}$/u.test(norm) &&
      DASH_GAP.test(input.slice(prev.end, start))
    ) {
      continue;
    }
    tokens.push({ raw, norm, stem: stemWord(norm), index: tokens.length, start, end: start + raw.length });
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Stop words                                                          */
/* ------------------------------------------------------------------ */

function words(list: string): string[] {
  return list.split(/\s+/).filter(Boolean);
}

const FUNCTION_WORDS = words(`
  в во на к ко с со у о об обо от ото до для без безо за из изо над надо под подо по при про через
  между перед передо около после ради сквозь среди кроме вместо вокруг возле вдоль мимо против
  внутри снаружи сверх поверх благодаря согласно навстречу
  и а но да или либо ли же то ни как что чтобы если когда пока хотя потому поэтому тоже также
  зато чем нежели будто словно пускай чтоб итак значит
  не бы вот вон ведь уж уже даже лишь только именно разве неужели ну еще ль нет да нибудь либо
  вроде почти ровно прямо
  я мы ты вы он она оно они меня мне мной мною нас нам нами вас вам вами тебя тебе тобой тобою
  его ему им ее ей ими их них него нему ней нее себя себе собой собою
  свой своя свое свои своего своей своему своим своих своем свою
  мой моя мое мои моего моей моему моим моих мою
  наш наша наше наши нашего нашей нашему нашим наших нашу
  ваш ваша ваше ваши вашего вашей вашему вашим ваших вашу
  твой твоя твое твои твоего твоей твоему твоим твоих твою
  этот эта это эти этого этой этому этим этом этих эту
  тот та те того той тому тем том тех ту
  такой такая такое такие такого такую таким таких такому такой
  какой какая какое какие какого какую каким каких какому
  который которая которое которые которого которой которому которым которых которую котором
  кто кого кому кем ком что чего чему чем
  весь вся все всего всей всем всеми всех всю всему
  сам сама само сами самого самой самим самих самый самая самое самые самую самом
  каждый каждая каждое каждые каждого каждой каждому каждым каждую каждом
  любой любая любое любые любого любой любому любым любую
  другой другая другое другие другого другой другому другим других другую
  иной иная иное иные
  некий некоторый некоторые какой-то
  как так где куда откуда зачем почему тут там здесь сейчас теперь тогда потом всегда никогда
  иногда очень более менее можно нужно надо нельзя вообще просто лучше хуже больше меньше много
  мало немного совсем ещё еще сколько столько чуть пожалуй
  быть был была было были будет будут буду будем будете будешь будь есть суть бывает бывать
  мочь могу можешь может можем можете могут мог могла могло могли смогу сможет сможем смогут
  стать стал стала стало стали станет станут стану станем станете станешь становится становятся
  хотеть хочу хочешь хочет хотим хотите хотят хотел хотела хотели
  надо нужен нужна нужны нужно
  тип вид раз год года году годы лет годов
`);

/** Stems of generic adjectives/verbs that carry no imagery by themselves. */
const GENERIC_LEMMAS = words(`
  новый лучший хороший худший большой нужный важный полезный главный
  выбрать выбирать сделать получить получать начать начинать использовать узнать узнавать
  понять помочь помогать изменить менять создать создавать показать рассказать
`);

export const STOP_WORDS: ReadonlySet<string> = new Set(FUNCTION_WORDS.map((w) => foldYo(w)));

const GENERIC_STEMS: ReadonlySet<string> = new Set(
  GENERIC_LEMMAS.map((w) => stemWord(foldYo(w))).filter((s) => s.length >= 3),
);

export function isStopWord(norm: string): boolean {
  return STOP_WORDS.has(norm);
}

export function isStopToken(token: Token): boolean {
  return STOP_WORDS.has(token.norm) || (token.stem.length >= 3 && GENERIC_STEMS.has(token.stem));
}

/** A word worth reporting when nothing matches it: not a stop word, ≥3 characters, not a number. */
export function isContentToken(token: Token): boolean {
  return !isStopToken(token) && token.norm.length >= 3 && !isNumeric(token.norm);
}

/* ------------------------------------------------------------------ */
/* Negation                                                            */
/* ------------------------------------------------------------------ */

const NEGATORS: ReadonlySet<string> = new Set(['без', 'безо', 'не', 'кроме']);
const COORDINATORS: ReadonlySet<string> = new Set(['и', 'или']);
/** «не только», «не просто» … do not exclude what follows. */
const NON_NEGATING_AFTER_NE: ReadonlySet<string> = new Set([
  'только',
  'просто',
  'лишь',
  'всегда',
  'обязательно',
  'всего',
]);
const CLAUSE_BREAK = /[.!?;:,\n\r]/;

/**
 * Tokens governed by a negator («без», «не», «кроме»): the next content word, skipping stop
 * words in between. After «без»/«кроме» the exclusion continues across «и»/«или» lists
 * («без телефона и наушников»). Returns token index → negator word.
 */
export function findNegations(tokens: readonly Token[], source: string): Map<number, string> {
  const negated = new Map<number, string>();
  const n = tokens.length;
  const gapBreaks = (from: Token, to: Token): boolean =>
    CLAUSE_BREAK.test(source.slice(from.end, to.start));

  for (let i = 0; i < n; i++) {
    const negator = tokens[i];
    if (negator === undefined || !NEGATORS.has(negator.norm)) continue;
    const isNe = negator.norm === 'не';
    const following = tokens[i + 1];
    if (isNe && following !== undefined && NON_NEGATING_AFTER_NE.has(following.norm)) continue;

    let prev: Token = negator;
    let j = i + 1;
    while (j < n) {
      const current = tokens[j];
      if (current === undefined || gapBreaks(prev, current)) break;
      if (isStopToken(current) || NEGATORS.has(current.norm)) {
        prev = current;
        j++;
        continue;
      }
      negated.set(current.index, negator.norm);
      prev = current;
      j++;
      if (isNe) break;
      // «без A и B»: continue over a coordinated list.
      for (;;) {
        const joiner = tokens[j];
        const next = tokens[j + 1];
        if (
          joiner === undefined ||
          next === undefined ||
          !COORDINATORS.has(joiner.norm) ||
          gapBreaks(prev, joiner) ||
          gapBreaks(joiner, next) ||
          isStopToken(next)
        ) {
          break;
        }
        negated.set(next.index, negator.norm);
        prev = next;
        j += 2;
      }
      break;
    }
  }
  return negated;
}
