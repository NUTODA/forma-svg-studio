/**
 * Russian Snowball (Porter) stemmer.
 * Follows the reference algorithm: RV/R2 regions, perfective gerund, reflexive,
 * adjectival (with participle), verb, noun, final «и», derivational (R2) and tidy-up
 * (superlative, «нн», «ь»). Endings are searched longest-first inside RV only.
 */

const VOWELS = 'аеиоуыэюя';

function isVowel(ch: string | undefined): boolean {
  return ch !== undefined && VOWELS.includes(ch);
}

interface Ending {
  suffix: string;
  /** The ending counts only when the preceding letter is «а» or «я». */
  afterAYa: boolean;
}

function endings(plain: string, afterAYa = ''): readonly Ending[] {
  const make = (list: string, flag: boolean): Ending[] =>
    list
      .split(/\s+/)
      .filter(Boolean)
      .map((suffix) => ({ suffix, afterAYa: flag }));
  return [...make(plain, false), ...make(afterAYa, true)];
}

const PERFECTIVE_GERUND = endings('ив ивши ившись ыв ывши ывшись', 'в вши вшись');
const REFLEXIVE = endings('ся сь');
const ADJECTIVE = endings(
  'ее ие ые ое ими ыми ей ий ый ой ем им ым ом его ого ему ому их ых ую юю ая яя ою ею',
);
const PARTICIPLE = endings('ивш ывш ующ', 'ем нн вш ющ щ');
const VERB = endings(
  'ила ыла ена ейте уйте ите или ыли ей уй ил ыл им ым ен ило ыло ено ят ует уют ит ыт ены ить ыть ишь ую ю',
  'ла на ете йте ли й л ем н ло но ет ют ны ть ешь нно',
);
const NOUN = endings(
  'а ев ов ие ье е иями ями ами еи ии и ией ей ой ий й иям ям ием ем ам ом о у ах иях ях ы ь ию ью ю ия ья я',
);
const DERIVATIONAL = endings('ост ость');
const TIDY = endings('ейше ейш нн ь');

/**
 * Snowball `among`: pick the longest matching ending that lies fully inside RV.
 * If that ending requires «а»/«я» before it and doesn't have it, the whole command fails
 * (null) — shorter endings are not tried, exactly like the reference implementation.
 */
function strip(word: string, limit: number, table: readonly Ending[]): string | null {
  let best: Ending | undefined;
  for (const rule of table) {
    if (
      word.endsWith(rule.suffix) &&
      word.length - rule.suffix.length >= limit &&
      (best === undefined || rule.suffix.length > best.suffix.length)
    ) {
      best = rule;
    }
  }
  if (best === undefined) return null;
  const cut = word.length - best.suffix.length;
  if (best.afterAYa) {
    const before = word[cut - 1];
    if (cut - 1 < limit || (before !== 'а' && before !== 'я')) return null;
  }
  return word.slice(0, cut);
}

/** [rv, r2] start offsets (word.length when the region is empty). */
function regions(word: string): { rv: number; r2: number } {
  const n = word.length;
  let rv = n;
  let r2 = n;
  let i = 0;
  while (i < n && !isVowel(word[i])) i++;
  if (i >= n) return { rv, r2 };
  rv = i + 1;
  const afterNonVowel = (from: number): number => {
    let k = from;
    while (k < n && isVowel(word[k])) k++;
    return k < n ? k + 1 : -1;
  };
  const afterVowel = (from: number): number => {
    let k = from;
    while (k < n && !isVowel(word[k])) k++;
    return k < n ? k + 1 : -1;
  };
  const a = afterNonVowel(rv);
  if (a < 0) return { rv, r2 };
  const b = afterVowel(a);
  if (b < 0) return { rv, r2 };
  const c = afterNonVowel(b);
  if (c < 0) return { rv, r2 };
  r2 = c;
  return { rv, r2 };
}

function adjectival(word: string, rv: number): string | null {
  const base = strip(word, rv, ADJECTIVE);
  if (base === null) return null;
  return strip(base, rv, PARTICIPLE) ?? base;
}

/** Stem one lowercase word. Non-Cyrillic words and digits pass through untouched. */
export function stemWord(input: string): string {
  const word = input.toLowerCase().replace(/ё/g, 'е');
  if (!/[а-я]/.test(word)) return word;
  const { rv, r2 } = regions(word);

  let w = word;
  const gerund = strip(w, rv, PERFECTIVE_GERUND);
  if (gerund !== null) {
    w = gerund;
  } else {
    w = strip(w, rv, REFLEXIVE) ?? w;
    w = adjectival(w, rv) ?? strip(w, rv, VERB) ?? strip(w, rv, NOUN) ?? w;
  }

  if (w.endsWith('и') && w.length - 1 >= rv) w = w.slice(0, -1);

  const derivational = strip(w, r2, DERIVATIONAL);
  if (derivational !== null) w = derivational;

  const tidy = strip(w, rv, TIDY);
  if (tidy !== null) {
    const removed = w.slice(tidy.length);
    w = tidy;
    // Superlative removal is followed by undoubling of «нн».
    if ((removed === 'ейш' || removed === 'ейше') && w.endsWith('нн')) w = w.slice(0, -1);
    else if (removed === 'нн') w += 'н';
  }
  return w;
}
