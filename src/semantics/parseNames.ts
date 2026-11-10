import { MOTIFS, possessiveFor } from '../domain/motifs';
import { MOTIF_IDS, type InputIssue, type MotifId, type NameEntry, type NamesParse } from '../domain/types';
import { isNumeric, tokenize, type Token } from './normalize';
import { findNameSpans, fuzzyCandidate, suggestMotif } from './vocabulary';

const MAX_COUNT = 4;
/** Hard cap on objects in one composition built from a names list. */
const MAX_TOTAL = 8;

const SEPARATORS = /\s*(?:[,;+&/\\|\n\r.!?•·]+|\s[—–-]\s|\s(?:и|или|плюс)\s)\s*/giu;

const NUMBER_WORDS: Record<string, number> = {
  один: 1,
  одна: 1,
  одно: 1,
  два: 2,
  две: 2,
  пара: 2,
  пару: 2,
  парочка: 2,
  три: 3,
  несколько: 3,
  четыре: 4,
  пять: 5,
  шесть: 6,
};

const q = (text: string): string => `„${text}“`;
const name = (id: MotifId): string => MOTIFS[id].name;

interface Quantity {
  text: string;
  /** Number the user wrote (may be out of range); undefined when none. */
  requested?: number;
}

/** «3 монеты», «3х монеты», «монета ×2», «монета 2 шт», «две монеты», «монета 2». */
function extractQuantity(fragment: string): Quantity {
  const text = fragment.trim();
  const trailing = /^(.*?)[\s(]*(?:[x×*х]\s*(\d+)|(\d+)\s*(?:шт\.?|штук[аи]?|[x×*х]))\)?$/iu.exec(text);
  if (trailing?.[1] !== undefined && /\p{L}/u.test(trailing[1])) {
    return { text: trailing[1].trim(), requested: Number(trailing[2] ?? trailing[3]) };
  }
  const leading = /^(\d+)\s*(?:шт\.?|штук[аи]?|[x×*х])?\s*(.+)$/iu.exec(text);
  if (leading?.[2] !== undefined && /\p{L}/u.test(leading[2])) {
    return { text: leading[2].trim(), requested: Number(leading[1]) };
  }
  const word = /^(\p{L}+)\s+(.+)$/u.exec(text);
  const wordValue = word?.[1] === undefined ? undefined : NUMBER_WORDS[word[1].toLowerCase().replace(/ё/g, 'е')];
  if (word?.[2] !== undefined && wordValue !== undefined) {
    return { text: word[2].trim(), requested: wordValue };
  }
  const bare = /^(.*\p{L})\s+(\d)$/u.exec(text);
  if (bare?.[1] !== undefined && bare[2] !== undefined && Number(bare[2]) >= 1 && Number(bare[2]) <= MAX_COUNT) {
    return { text: bare[1].trim(), requested: Number(bare[2]) };
  }
  return { text };
}

function splitFragments(input: string): string[] {
  return input
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
}

function sourceSlice(text: string, tokens: readonly Token[], from: number, to: number): string {
  const a = tokens[from];
  const b = tokens[to];
  return a === undefined || b === undefined ? text : text.slice(a.start, b.end);
}

interface Resolved {
  entry: Omit<NameEntry, 'count'>;
  /** Fragment word that produced the entry (for the replace action). */
  token: string;
}

function resolveFragment(text: string, available: ReadonlySet<MotifId>): Resolved[] {
  const tokens = tokenize(text);
  const content = tokens.filter((t) => !isNumeric(t.norm));
  if (content.length === 0) return [];

  const spans = findNameSpans(tokens);
  if (spans.length > 0) {
    const seen = new Set<MotifId>();
    const distinct = spans.filter((s) => (seen.has(s.motif) ? false : (seen.add(s.motif), true)));
    return distinct.map((span) => {
      const raw = distinct.length === 1 ? text : sourceSlice(text, tokens, span.from, span.to);
      return {
        token: raw,
        entry: {
          raw,
          status: available.has(span.motif) ? 'matched' : 'unavailable',
          motif: span.motif,
          via: span.via,
        },
      };
    });
  }

  const typos = new Map<MotifId, Token>();
  for (const token of content) {
    const fuzzy = fuzzyCandidate(token);
    if (fuzzy !== null && !typos.has(fuzzy.candidate.motif)) typos.set(fuzzy.candidate.motif, token);
  }
  if (typos.size > 0) {
    return [...typos].map(([motif, token]) => {
      const raw = typos.size === 1 ? text : token.raw;
      return {
        token: raw,
        entry: {
          raw,
          status: available.has(motif) ? 'weak' : 'unavailable',
          motif,
          via: 'fuzzy',
          suggestion: motif,
        },
      };
    });
  }

  for (const token of content) {
    const guess = suggestMotif(token);
    if (guess === null) continue;
    // One-letter slips on short words («ламба») are typos, everything else is only a hint.
    if (guess.via === 'fuzzy' && (guess.distance ?? 9) <= 1) {
      return [
        {
          token: text,
          entry: {
            raw: text,
            status: available.has(guess.motif) ? 'weak' : 'unavailable',
            motif: guess.motif,
            via: 'fuzzy',
            suggestion: guess.motif,
          },
        },
      ];
    }
    return [{ token: text, entry: { raw: text, status: 'unmatched', suggestion: guess.motif } }];
  }
  return [{ token: text, entry: { raw: text, status: 'unmatched' } }];
}

function availableList(available: ReadonlySet<MotifId>): string {
  return MOTIF_IDS.filter((id) => available.has(id))
    .map(name)
    .join(', ');
}

/** Parse a list of component names/aliases («книга, 2 монеты + наушники»). */
export function parseNames(input: string, available: ReadonlySet<MotifId>): NamesParse {
  const issues: InputIssue[] = [];
  const fragments = splitFragments(input);

  if (fragments.length === 0) {
    return {
      input,
      entries: [],
      motifs: [],
      issues: [{ level: 'error', code: 'empty', message: 'Введите названия объектов через запятую: книга, наушники, лампа.' }],
    };
  }

  const entries: NameEntry[] = [];
  const clamped: string[] = [];
  for (const fragment of fragments) {
    const quantity = extractQuantity(fragment);
    const resolved = resolveFragment(quantity.text, available);
    const requested = quantity.requested;
    const single = resolved.length === 1;
    for (const { entry, token } of resolved) {
      let count = 1;
      if (single && requested !== undefined) {
        count = Math.min(MAX_COUNT, Math.max(1, requested));
        if (requested < 1 || requested > MAX_COUNT) clamped.push(entry.raw);
      }
      entries.push({ ...entry, count });
      collectEntryIssues(entry, token, available, issues);
    }
    if (resolved.length > 1) {
      issues.push({
        level: 'info',
        code: 'missing-separator',
        message: `В «${quantity.text}» несколько названий подряд — они разобраны по отдельности. Разделяйте названия запятыми.`,
      });
    }
  }

  for (const raw of clamped) {
    issues.push({
      level: 'warning',
      code: 'count-clamped',
      message: `«${raw}»: количество ограничено — от 1 до ${MAX_COUNT} экземпляров одного объекта.`,
    });
  }

  /* Merge repeats: first appearance fixes the position, counts add up to the cap. */
  const totals = new Map<MotifId, number>();
  const repeated = new Set<MotifId>();
  for (const entry of entries) {
    if (entry.motif === undefined || entry.status === 'unmatched' || entry.status === 'unavailable') continue;
    if (totals.has(entry.motif)) repeated.add(entry.motif);
    totals.set(entry.motif, Math.min(MAX_COUNT, (totals.get(entry.motif) ?? 0) + entry.count));
  }
  for (const motif of repeated) {
    issues.push({
      level: 'info',
      code: 'repeat',
      message: `«${name(motif)}» указан несколько раз — в композиции будет ×${totals.get(motif) ?? 1}.`,
    });
  }

  let motifs: MotifId[] = [];
  for (const [motif, count] of totals) {
    if (available.has(motif)) for (let i = 0; i < count; i++) motifs.push(motif);
  }
  if (motifs.length > MAX_TOTAL) {
    motifs = motifs.slice(0, MAX_TOTAL);
    issues.push({
      level: 'warning',
      code: 'too-many',
      message: `Объектов слишком много: в композицию попали первые ${MAX_TOTAL}.`,
    });
  }

  if (available.size === 0) {
    issues.push({ level: 'error', code: 'no-assets', message: 'В библиотеке пока нет ни одного объекта — собирать нечего.' });
  } else if (motifs.length === 0) {
    issues.push({
      level: 'error',
      code: 'nothing-recognized',
      message: `Ни одно название не распознано. Доступные объекты: ${availableList(available)}.`,
    });
  }

  return { input, entries, motifs, issues };
}

function collectEntryIssues(
  entry: Omit<NameEntry, 'count'>,
  token: string,
  available: ReadonlySet<MotifId>,
  issues: InputIssue[],
): void {
  const { motif, suggestion } = entry;
  switch (entry.status) {
    case 'unavailable':
      if (motif !== undefined) {
        issues.push({
          level: 'warning',
          code: 'unavailable',
          message: `«${name(motif)}» распознан${entry.via === 'fuzzy' ? ' (по похожему слову)' : ''}, но ${possessiveFor(motif)} файлов в библиотеке нет — объект пропущен.`,
        });
      }
      return;
    case 'weak':
      if (motif !== undefined) {
        issues.push({
          level: 'info',
          code: 'typo',
          message: `${q(token)} — похоже на «${name(motif)}». Проверьте, что это то, что нужно.`,
          action: {
            kind: 'replace',
            label: `Заменить на ${q(name(motif))}`,
            motif,
            token,
            replacement: name(motif),
          },
        });
      }
      return;
    case 'unmatched':
      if (suggestion !== undefined && available.has(suggestion)) {
        issues.push({
          level: 'warning',
          code: 'unmatched',
          message: `${q(token)} — такого объекта в библиотеке нет. Ближе всего «${name(suggestion)}».`,
          action: {
            kind: 'replace',
            label: `Заменить на ${q(name(suggestion))}`,
            motif: suggestion,
            token,
            replacement: name(suggestion),
          },
        });
      } else {
        const list = availableList(available);
        issues.push({
          level: 'warning',
          code: 'unmatched',
          message: `${q(token)} — такого объекта в библиотеке нет${list ? `. Доступные: ${list}` : ''}.`,
        });
      }
      return;
    case 'matched':
      return;
  }
}
