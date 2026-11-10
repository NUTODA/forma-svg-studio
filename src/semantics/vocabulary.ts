/**
 * Indexes shared by title analysis and names parsing: object names/aliases (stem keyed),
 * the title lexicon (synonyms + themes) and the typo-tolerant candidate pool.
 */
import { MOTIFS } from '../domain/motifs';
import { MOTIF_IDS, type MotifId } from '../domain/types';
import {
  EXACT_FORMS,
  MOTIF_FORMS,
  SYNONYMS,
  SYNONYM_WEIGHT,
  THEMES,
  THEME_KEY_WEIGHT,
  parseKeys,
  type Theme,
} from './lexicon';
import { closest, fuzzyThreshold } from './fuzzy';
import { isNumeric, normalizeText, type Token } from './normalize';
import { stemWord } from './stem';

export const MAX_PHRASE_WORDS = 4;

function stemsOf(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter(Boolean)
    .map((w) => stemWord(w));
}

/** Single-word guard for stems that collide with unrelated words. */
function passesExactForms(token: Token): boolean {
  const allowed = EXACT_FORMS[token.stem];
  return allowed === undefined || allowed.includes(token.norm);
}

/* ------------------------------------------------------------------ */
/* Names and aliases                                                   */
/* ------------------------------------------------------------------ */

export type NameVia = 'name' | 'alias' | 'stem';

interface NameEntry {
  motif: MotifId;
  kind: 'name' | 'alias';
}

const NAME_INDEX = new Map<string, NameEntry[]>();
const NAME_NORMS = new Map<MotifId, string>();
const ALIAS_NORMS = new Map<MotifId, Set<string>>();
let maxNameWords = 1;

function addName(key: string, entry: NameEntry): void {
  const list = NAME_INDEX.get(key);
  if (list === undefined) NAME_INDEX.set(key, [entry]);
  else if (!list.some((e) => e.motif === entry.motif)) list.push(entry);
}

for (const id of MOTIF_IDS) {
  const info = MOTIFS[id];
  const nameNorm = normalizeText(info.name);
  NAME_NORMS.set(id, nameNorm);
  const aliasNorms = new Set<string>();
  ALIAS_NORMS.set(id, aliasNorms);
  const surfaces: { text: string; kind: 'name' | 'alias' }[] = [
    { text: info.name, kind: 'name' },
    ...info.aliases.map((text) => ({ text, kind: 'alias' as const })),
    ...MOTIF_FORMS[id].map((text) => ({ text, kind: 'alias' as const })),
  ];
  for (const { text, kind } of surfaces) {
    const stems = stemsOf(text);
    if (stems.length === 0) continue;
    if (kind === 'alias' && !MOTIF_FORMS[id].includes(text)) aliasNorms.add(normalizeText(text));
    maxNameWords = Math.max(maxNameWords, stems.length);
    addName(stems.join(' '), { motif: id, kind });
  }
}

export interface NameSpan {
  /** Token index range, inclusive. */
  from: number;
  to: number;
  motif: MotifId;
  kind: 'name' | 'alias';
  via: NameVia;
}

function viaFor(motif: MotifId, spanNorm: string): NameVia {
  if (NAME_NORMS.get(motif) === spanNorm) return 'name';
  return ALIAS_NORMS.get(motif)?.has(spanNorm) ? 'alias' : 'stem';
}

/** Left-to-right, longest-first, non-overlapping object names/aliases inside the tokens. */
export function findNameSpans(tokens: readonly Token[]): NameSpan[] {
  const spans: NameSpan[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: NameSpan | null = null;
    for (let n = Math.min(maxNameWords, tokens.length - i); n >= 1 && found === null; n--) {
      const slice = tokens.slice(i, i + n);
      if (n === 1 && !passesExactForms(slice[0] as Token)) continue;
      const entry = NAME_INDEX.get(slice.map((t) => t.stem).join(' '))?.[0];
      if (entry === undefined) continue;
      found = {
        from: i,
        to: i + n - 1,
        motif: entry.motif,
        kind: entry.kind,
        via: viaFor(entry.motif, slice.map((t) => t.norm).join(' ')),
      };
    }
    if (found === null) {
      i++;
    } else {
      spans.push(found);
      i = found.to + 1;
    }
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/* Title lexicon                                                       */
/* ------------------------------------------------------------------ */

export interface LexEntry {
  /** Display form of the key (first spelling seen). */
  surface: string;
  synonyms: { motif: MotifId; weight: number }[];
  themes: { theme: Theme; weight: number }[];
}

export const THEME_BY_ID = new Map<string, Theme>(THEMES.map((t) => [t.id, t]));

const LEX_INDEX = new Map<string, LexEntry>();
const PREFIX_KEYS: string[] = [];
let maxLexWords = 1;

function lexEntry(text: string): LexEntry | null {
  const stems = stemsOf(text);
  if (stems.length === 0) return null;
  const key = stems.join(' ');
  let entry = LEX_INDEX.get(key);
  if (entry === undefined) {
    entry = { surface: normalizeText(text), synonyms: [], themes: [] };
    LEX_INDEX.set(key, entry);
    maxLexWords = Math.max(maxLexWords, stems.length);
    const only = stems[0];
    if (stems.length === 1 && only !== undefined && only.length >= 5 && !isNumeric(only)) PREFIX_KEYS.push(key);
  }
  return entry;
}

for (const id of MOTIF_IDS) {
  for (const key of parseKeys(SYNONYMS[id])) {
    const entry = lexEntry(key.text);
    if (entry === null) continue;
    const weight = key.weight ?? SYNONYM_WEIGHT;
    const existing = entry.synonyms.find((s) => s.motif === id);
    if (existing === undefined) entry.synonyms.push({ motif: id, weight });
    else existing.weight = Math.max(existing.weight, weight);
  }
}
for (const theme of THEMES) {
  for (const key of parseKeys(theme.keys)) {
    const entry = lexEntry(key.text);
    if (entry === null) continue;
    if (!entry.themes.some((t) => t.theme.id === theme.id)) {
      entry.themes.push({ theme, weight: key.weight ?? THEME_KEY_WEIGHT });
    }
  }
}

export interface LexHit {
  from: number;
  to: number;
  entry: LexEntry;
}

/** Verbal prefixes, longest first: «почитать» / «прочитать» → «читать», «написать» → «писать». */
const VERB_PREFIXES = ['пере', 'про', 'под', 'при', 'раз', 'рас', 'по', 'на', 'за', 'вы', 'до', 'от', 'со', 'с', 'у'];
/** Infinitive / finite / past endings: only words that look like verbs lose their prefix. */
const VERB_ENDING = /(?:ть|ться|ти|чь|ешь|ет|ют|ут|ит|ат|ят|ем|им|ете|ите|ал|ала|али|ало|ил|ила|или|ел|ела|ели)$/;
const MIN_ROOT = 3;

/** Lexicon entry of a prefixed verb whose bare form is in the lexicon, or null. */
function lookupPrefixedVerb(token: Token): LexEntry | null {
  if (!VERB_ENDING.test(token.norm)) return null;
  for (const prefix of VERB_PREFIXES) {
    if (!token.stem.startsWith(prefix) || token.stem.length - prefix.length < MIN_ROOT) continue;
    const entry = LEX_INDEX.get(token.stem.slice(prefix.length));
    if (entry !== undefined) return entry;
  }
  return null;
}

/**
 * Lexicon entry for tokens[i .. i+n-1]: exact stem sequence, or (single word) a long-stem prefix,
 * or a prefixed verb of a lexicon verb.
 */
export function lookupLexicon(tokens: readonly Token[], i: number, n: number): LexEntry | null {
  const slice = tokens.slice(i, i + n);
  if (slice.length !== n) return null;
  if (n === 1 && !passesExactForms(slice[0] as Token)) return null;
  const exact = LEX_INDEX.get(slice.map((t) => t.stem).join(' '));
  if (exact !== undefined) return exact;
  if (n !== 1) return null;
  const token = slice[0] as Token;
  const stem = token.stem;
  if (isNumeric(stem)) return null;
  for (const key of PREFIX_KEYS) {
    if (stem.length > key.length && stem.length - key.length <= 4 && stem.startsWith(key)) {
      return LEX_INDEX.get(key) ?? null;
    }
  }
  return lookupPrefixedVerb(token);
}

export function maxLexiconWords(): number {
  return maxLexWords;
}

/* ------------------------------------------------------------------ */
/* Typo tolerance                                                      */
/* ------------------------------------------------------------------ */

export interface FuzzyCandidate {
  stem: string;
  /** Replacement word shown to the user (lowercase dictionary form). */
  word: string;
  motif: MotifId;
  kind: 'name' | 'alias' | 'synonym';
  weight: number;
}

const FUZZY_POOL: FuzzyCandidate[] = [];
const FUZZY_SEEN = new Set<string>();

function addFuzzy(text: string, motif: MotifId, kind: FuzzyCandidate['kind'], weight: number): void {
  const word = normalizeText(text);
  if (word === '' || word.includes(' ') || isNumeric(word)) return;
  const stem = stemWord(word);
  if (stem.length < 5 || FUZZY_SEEN.has(`${motif}:${stem}`)) return;
  FUZZY_SEEN.add(`${motif}:${stem}`);
  FUZZY_POOL.push({ stem, word, motif, kind, weight });
}
for (const id of MOTIF_IDS) addFuzzy(MOTIFS[id].name, id, 'name', 3.5);
for (const id of MOTIF_IDS) for (const alias of MOTIFS[id].aliases) addFuzzy(alias, id, 'alias', 3.5);
for (const id of MOTIF_IDS) for (const key of parseKeys(SYNONYMS[id])) addFuzzy(key.text, id, 'synonym', 3);
const FUZZY_STEMS = FUZZY_POOL.map((c) => c.stem);
const FUZZY_WORDS = FUZZY_POOL.map((c) => c.word);

/** Closest dictionary word within the typo threshold (same first letter), or null. */
export function fuzzyCandidate(token: Token): { candidate: FuzzyCandidate; distance: number } | null {
  if (isNumeric(token.norm) || !/[а-я]/.test(token.norm)) return null;
  // The stemmer can eat a typo's last letter («телефан» → «телефа»), so compare the whole word too.
  const attempts: [string, string[]][] = [
    [token.stem, FUZZY_STEMS],
    [token.norm, FUZZY_WORDS],
  ];
  let best: { index: number; distance: number } | null = null;
  for (const [value, list] of attempts) {
    const threshold = fuzzyThreshold(value.length);
    if (value.length < 5 || threshold === 0) continue;
    const pool = list.map((s) => (s[0] === value[0] ? s : ''));
    const found = closest(value, pool, threshold);
    if (found !== null && (best === null || found.distance < best.distance)) best = found;
  }
  if (best === null || best.distance === 0) return null;
  const candidate = FUZZY_POOL[best.index];
  return candidate === undefined ? null : { candidate, distance: best.distance };
}

/* ------------------------------------------------------------------ */
/* Suggestions for words that matched nothing                          */
/* ------------------------------------------------------------------ */

export type SuggestVia = 'synonym' | 'prefix' | 'fuzzy';

/** Single-word surfaces of names/aliases for loose suggestions. */
const SUGGEST_POOL: { norm: string; motif: MotifId }[] = [];
for (const id of MOTIF_IDS) {
  for (const text of [MOTIFS[id].name, ...MOTIFS[id].aliases]) {
    const norm = normalizeText(text);
    if (norm !== '' && !norm.includes(' ')) SUGGEST_POOL.push({ norm, motif: id });
  }
}

/**
 * Best guess for a word that is not a known object: a lexicon meaning («деньги» → монета),
 * a name prefix («мон» → монета) or a loose typo («кига» → книга). Deterministic.
 */
export function suggestMotif(token: Token): { motif: MotifId; via: SuggestVia; distance?: number } | null {
  if (token.norm.length < 3 || isNumeric(token.norm)) return null;
  const entry = lookupLexicon([token], 0, 1);
  if (entry !== null) {
    const direct = [...entry.synonyms].sort((a, b) => b.weight - a.weight)[0];
    if (direct !== undefined) return { motif: direct.motif, via: 'synonym' };
    let bestTheme: { motif: MotifId; score: number } | null = null;
    for (const { theme, weight } of entry.themes) {
      for (const [motif, affinity] of Object.entries(theme.motifs) as [MotifId, number][]) {
        const score = weight * affinity;
        if (bestTheme === null || score > bestTheme.score) bestTheme = { motif, score };
      }
    }
    if (bestTheme !== null) return { motif: bestTheme.motif, via: 'synonym' };
  }
  if (token.norm.length >= 3) {
    const prefixed = SUGGEST_POOL.find((c) => c.norm.length > token.norm.length && c.norm.startsWith(token.norm));
    if (prefixed !== undefined) return { motif: prefixed.motif, via: 'prefix' };
  }
  if (token.norm.length >= 4) {
    const max = token.norm.length >= 8 ? 3 : token.norm.length >= 6 ? 2 : 1;
    const best = closest(
      token.norm,
      SUGGEST_POOL.map((c) => c.norm),
      max,
    );
    const hit = best === null ? undefined : SUGGEST_POOL[best.index];
    if (hit !== undefined && best !== null) return { motif: hit.motif, via: 'fuzzy', distance: best.distance };
  }
  return null;
}
