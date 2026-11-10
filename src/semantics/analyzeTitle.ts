import { MOTIFS, fitsVerbFor } from '../domain/motifs';
import {
  MOTIF_IDS,
  type InputIssue,
  type MatchKind,
  type MatchReason,
  type MatchStrength,
  type MotifId,
  type MotifMatch,
  type TitleAnalysis,
} from '../domain/types';
import { EXAMPLE_TITLE, FALLBACK_ORDER, PRIMARY_THEME } from './lexicon';
import { findNegations, isContentToken, matchCase, tokenize, type Token } from './normalize';
import {
  THEME_BY_ID,
  findNameSpans,
  fuzzyCandidate,
  lookupLexicon,
  maxLexiconWords,
} from './vocabulary';

export interface AnalyzeOptions {
  /** Max motifs to select (default 3, clamp 1..5). */
  max?: number;
}

const DEFAULT_MAX = 3;
const NAME_SCORE = 10;
const ALIAS_SCORE = 9;
/** Primary-theme credit for name hits and synonym hits (a nudge, never a decision). */
const NAME_THEME_WEIGHT = 2;
const SYNONYM_THEME_WEIGHT = 3;

const STRONG_AT = 7;
const MEDIUM_AT = 4;
/** Below this a motif is not worth showing at all. */
const LISTED_AT = 1.2;
/** Minimum score for a motif to be picked on its own. */
const SELECTABLE_AT = 2.5;
const SECONDARY_AT = 3.5;
const SECONDARY_SHARE = 0.3;
const SCORE_CAP = 20;
const THEME_CAP = 10;
const THEME_REPORT_AT = 2.5;
const MAX_THEMES = 4;

interface Contribution {
  motif: MotifId;
  score: number;
  reason: MatchReason;
}

interface ThemeCredit {
  themeId: string;
  weight: number;
}

interface Hit {
  from: number;
  to: number;
  /** Source text covered by the hit, as typed. */
  text: string;
  /** Hit is a direct statement about an object (name, alias, synonym, typo) and may be negated. */
  direct: boolean;
  contributions: Contribution[];
  themes: ThemeCredit[];
  typo?: { token: string; word: string; start: number; end: number };
}

const q = (text: string): string => `„${text}“`;
const name = (id: MotifId): string => MOTIFS[id].name;

function reason(kind: MatchKind, token: string, detail: string, themeId?: string): MatchReason {
  return themeId === undefined ? { kind, token, detail } : { kind, token, detail, themeId };
}

function strengthOf(score: number): MatchStrength {
  return score >= STRONG_AT ? 'strong' : score >= MEDIUM_AT ? 'medium' : 'weak';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampMax(max: number | undefined): number {
  if (max === undefined || !Number.isFinite(max)) return DEFAULT_MAX;
  return Math.min(5, Math.max(1, Math.trunc(max)));
}

function spanText(source: string, tokens: readonly Token[], from: number, to: number): string {
  const a = tokens[from];
  const b = tokens[to];
  return a === undefined || b === undefined ? '' : source.slice(a.start, b.end);
}

function collectHits(source: string, tokens: readonly Token[]): Hit[] {
  const hits: Hit[] = [];
  const consumed: boolean[] = tokens.map(() => false);
  const take = (from: number, to: number): void => {
    for (let i = from; i <= to; i++) consumed[i] = true;
  };
  const free = (from: number, to: number): boolean => {
    for (let i = from; i <= to; i++) if (consumed[i]) return false;
    return true;
  };

  // 1. Object names and aliases.
  for (const span of findNameSpans(tokens)) {
    const text = spanText(source, tokens, span.from, span.to);
    const kind: MatchKind = span.kind;
    hits.push({
      from: span.from,
      to: span.to,
      text,
      direct: true,
      contributions: [
        {
          motif: span.motif,
          score: kind === 'name' ? NAME_SCORE : ALIAS_SCORE,
          reason: reason(
            kind,
            text,
            kind === 'name'
              ? `${q(text)} — название объекта «${name(span.motif)}»`
              : `${q(text)} — другое название объекта «${name(span.motif)}»`,
          ),
        },
      ],
      themes: [{ themeId: PRIMARY_THEME[span.motif], weight: NAME_THEME_WEIGHT }],
    });
    take(span.from, span.to);
  }

  // 2. Lexicon: phrases first, then single words.
  for (let n = maxLexiconWords(); n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      if (!free(i, i + n - 1)) continue;
      const first = tokens[i] as Token;
      if (n === 1 && !isContentToken(first)) continue;
      const entry = lookupLexicon(tokens, i, n);
      if (entry === null) continue;
      const text = spanText(source, tokens, i, i + n - 1);
      const contributions: Contribution[] = [];
      const themes: ThemeCredit[] = [];
      for (const syn of entry.synonyms) {
        contributions.push({
          motif: syn.motif,
          score: syn.weight,
          reason: reason('synonym', text, `${q(text)} — синоним: «${name(syn.motif)}»`),
        });
        themes.push({ themeId: PRIMARY_THEME[syn.motif], weight: SYNONYM_THEME_WEIGHT });
        // A synonym also nudges the siblings of its primary theme (money → wallet).
        const primary = THEME_BY_ID.get(PRIMARY_THEME[syn.motif]);
        for (const [motif, affinity] of Object.entries(primary?.motifs ?? {}) as [MotifId, number][]) {
          if (motif === syn.motif) continue;
          contributions.push({
            motif,
            score: SYNONYM_THEME_WEIGHT * affinity,
            reason: reason('theme', text, `${q(text)} — тема «${primary?.label ?? ''}»`, primary?.id),
          });
        }
      }
      for (const { theme, weight } of entry.themes) {
        themes.push({ themeId: theme.id, weight });
        for (const [motif, affinity] of Object.entries(theme.motifs) as [MotifId, number][]) {
          contributions.push({
            motif,
            score: weight * affinity,
            reason: reason('theme', text, `${q(text)} — тема «${theme.label}»`, theme.id),
          });
        }
      }
      hits.push({ from: i, to: i + n - 1, text, direct: entry.synonyms.length > 0, contributions, themes });
      take(i, i + n - 1);
    }
  }

  // 3. Typos of known words.
  for (const token of tokens) {
    if (consumed[token.index] || !isContentToken(token)) continue;
    const fuzzy = fuzzyCandidate(token);
    if (fuzzy === null) continue;
    const { candidate } = fuzzy;
    hits.push({
      from: token.index,
      to: token.index,
      text: token.raw,
      direct: true,
      contributions: [
        {
          motif: candidate.motif,
          score: candidate.weight,
          reason: reason(
            'fuzzy',
            token.raw,
            `${q(token.raw)} — похоже на ${q(candidate.word)} («${name(candidate.motif)}»)`,
          ),
        },
      ],
      themes: [{ themeId: PRIMARY_THEME[candidate.motif], weight: 1 }],
      typo: { token: token.raw, word: candidate.word, start: token.start, end: token.end },
    });
    take(token.index, token.index);
  }
  return hits;
}

function listNames(ids: readonly MotifId[]): string {
  return ids.map((id) => `«${name(id)}»`).join(', ');
}

function emptyAnalysis(input: string, issues: InputIssue[], summary: string): TitleAnalysis {
  return {
    input,
    matches: [],
    selected: [],
    excluded: [],
    themes: [],
    unknownTokens: [],
    fallbackUsed: false,
    summary,
    issues,
  };
}

/** Deterministic Russian title → motif interpretation (no network). */
export function analyzeTitle(
  input: string,
  available: ReadonlySet<MotifId>,
  opts?: AnalyzeOptions,
): TitleAnalysis {
  const max = clampMax(opts?.max);
  const tokens = tokenize(input);

  if (input.trim() === '') {
    return emptyAnalysis(
      input,
      [{ level: 'error', code: 'empty', message: 'Введите заголовок — по нему подберутся объекты.' }],
      'Заголовок пуст',
    );
  }
  if (!tokens.some(isContentToken)) {
    return emptyAnalysis(
      input,
      [
        {
          level: 'error',
          code: 'no-content',
          message: 'В заголовке нет слов, по которым можно подобрать объекты. Опишите тему словами.',
          action: { kind: 'example', label: 'Попробовать пример', replacement: EXAMPLE_TITLE },
        },
      ],
      'Нет слов для анализа',
    );
  }

  const negations = findNegations(tokens, input);
  const hits = collectHits(input, tokens);

  /* ---- negation: only direct statements about an object exclude it ---- */
  const excluded: { motif: MotifId; token: string }[] = [];
  const excludedSet = new Set<MotifId>();
  const negatedTokens = new Set<number>();
  const positive: Hit[] = [];
  for (const hit of hits) {
    let negated = false;
    for (let i = hit.from; i <= hit.to; i++) if (negations.has(i)) negated = true;
    if (!negated) {
      positive.push(hit);
      continue;
    }
    for (let i = hit.from; i <= hit.to; i++) negatedTokens.add(i);
    if (!hit.direct) continue;
    const best = [...hit.contributions].sort((a, b) => b.score - a.score)[0];
    if (best !== undefined && !excludedSet.has(best.motif)) {
      excludedSet.add(best.motif);
      excluded.push({ motif: best.motif, token: hit.text });
    }
  }

  /* ---- scoring ---- */
  const perMotif = new Map<MotifId, Contribution[]>();
  const themeScore = new Map<string, number>();
  positive.forEach((hit) => {
    // Best contribution per motif per hit; theme credit per hit counts once per theme.
    const bestPerMotif = new Map<MotifId, Contribution>();
    for (const c of hit.contributions) {
      if (excludedSet.has(c.motif)) continue;
      const cur = bestPerMotif.get(c.motif);
      if (cur === undefined || c.score > cur.score) bestPerMotif.set(c.motif, c);
    }
    for (const [motif, c] of bestPerMotif) {
      const list = perMotif.get(motif) ?? [];
      list.push(c);
      perMotif.set(motif, list);
    }
    const bestTheme = new Map<string, number>();
    for (const t of hit.themes) bestTheme.set(t.themeId, Math.max(bestTheme.get(t.themeId) ?? 0, t.weight));
    for (const [id, weight] of bestTheme) themeScore.set(id, (themeScore.get(id) ?? 0) + weight);
  });

  // Ties go to the motif mentioned first («Документы для налогового вычета» → папка, then монета).
  const firstPosition = new Map<MotifId, number>();
  positive.forEach((hit) => {
    for (const c of hit.contributions) {
      firstPosition.set(c.motif, Math.min(firstPosition.get(c.motif) ?? Infinity, hit.from));
    }
  });
  const order = (a: MotifMatch, b: MotifMatch): number =>
    b.score - a.score ||
    (firstPosition.get(a.motif) ?? Infinity) - (firstPosition.get(b.motif) ?? Infinity) ||
    MOTIF_IDS.indexOf(a.motif) - MOTIF_IDS.indexOf(b.motif);

  const matches: MotifMatch[] = [];
  for (const [motif, list] of perMotif) {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const head = sorted[0];
    if (head === undefined) continue;
    const rest = sorted.slice(1).reduce((sum, c) => sum + c.score, 0);
    const score = round(Math.min(SCORE_CAP, head.score + rest * 0.5));
    if (score < LISTED_AT) continue;
    const seen = new Set<string>();
    const reasons: MatchReason[] = [];
    for (const c of sorted) {
      if (!seen.has(c.reason.detail) && reasons.length < 4) {
        seen.add(c.reason.detail);
        reasons.push(c.reason);
      }
    }
    matches.push({ motif, score, strength: strengthOf(score), reasons, available: available.has(motif) });
  }
  matches.sort(order);

  /* ---- selection (available motifs only) ---- */
  const issues: InputIssue[] = [];
  const pickable = matches.filter((m) => m.available && m.score >= SELECTABLE_AT);
  let selected: MotifId[] = [];
  let fallbackUsed = false;
  let trimmed = 0;

  if (available.size === 0) {
    issues.push({
      level: 'error',
      code: 'no-assets',
      message: 'В библиотеке пока нет ни одного объекта — подбирать нечего.',
    });
  } else if (pickable.length > 0) {
    const top = pickable[0] as MotifMatch;
    const eligible = [top];
    if (top.strength !== 'weak') {
      for (const m of pickable.slice(1)) {
        if (m.score >= Math.max(SECONDARY_AT, top.score * SECONDARY_SHARE)) eligible.push(m);
      }
    }
    trimmed = Math.max(0, eligible.length - max);
    selected = eligible.slice(0, max).map((m) => m.motif);
    // A single guessed object makes a poor illustration: add the best companion (never for strong, explicit matches) (a listed match, else a sibling from the hero's topic).
    if (selected.length < 2 && max >= 2 && top.strength !== 'strong') {
      const hero = selected[0] as MotifId;
      const listed = matches.find((m) => m.motif !== hero && m.available && !excludedSet.has(m.motif));
      let companion: MotifId | undefined = listed?.motif;
      if (companion === undefined) {
        const sibling = (Object.entries(THEME_BY_ID.get(PRIMARY_THEME[hero])?.motifs ?? {}) as [MotifId, number][])
          .filter(([id]) => id !== hero && available.has(id) && !excludedSet.has(id))
          .sort((a, b) => b[1] - a[1])[0];
        companion = sibling?.[0];
      }
      if (companion !== undefined) {
        selected.push(companion);
        if (listed === undefined) {
          matches.push({
            motif: companion,
            score: 0,
            strength: 'weak',
            reasons: [reason('theme', '', `Дополняет «${name(hero)}» по теме`)],
            available: true,
          });
        }
      }
    }
  } else {
    const neutral = FALLBACK_ORDER.find((id) => available.has(id)) ?? MOTIF_IDS.find((id) => available.has(id));
    if (neutral !== undefined) {
      fallbackUsed = true;
      selected = [neutral];
      const idx = matches.findIndex((m) => m.motif === neutral);
      const fallbackReason = reason('fallback', '', 'Явных совпадений нет — взят нейтральный объект');
      if (idx >= 0) {
        const m = matches[idx] as MotifMatch;
        m.reasons = [...m.reasons, fallbackReason];
      } else {
        matches.push({ motif: neutral, score: 0, strength: 'weak', reasons: [fallbackReason], available: true });
      }
    }
  }

  /* ---- unknown words ---- */
  const matchedTokens = new Set<number>();
  for (const hit of positive) for (let i = hit.from; i <= hit.to; i++) matchedTokens.add(i);
  const unknownTokens: string[] = [];
  const unknownSeen = new Set<string>();
  for (const token of tokens) {
    if (matchedTokens.has(token.index) || negatedTokens.has(token.index) || !isContentToken(token)) continue;
    if (!unknownSeen.has(token.norm)) {
      unknownSeen.add(token.norm);
      unknownTokens.push(token.raw);
    }
  }

  /* ---- themes: only topics that speak for at least one selected motif ---- */
  const explainsSelection = (id: string): boolean =>
    !fallbackUsed && selected.some((motif) => (THEME_BY_ID.get(id)?.motifs[motif] ?? 0) > 0);
  const heroTheme = selected[0] === undefined ? undefined : PRIMARY_THEME[selected[0]];
  const themes = [...themeScore.entries()]
    .map(([id, score]) => ({ id, label: THEME_BY_ID.get(id)?.label ?? id, score: round(Math.min(THEME_CAP, score)) }))
    .filter((t) => t.score >= THEME_REPORT_AT && explainsSelection(t.id))
    // Equal scores: the hero's own topic names the composition best.
    .sort((a, b) => b.score - a.score || Number(b.id === heroTheme) - Number(a.id === heroTheme) || a.id.localeCompare(b.id))
    .slice(0, MAX_THEMES);

  /* ---- issues ---- */
  const top = matches[0];
  const unavailableTop = matches.filter((m) => !m.available && m.score >= SELECTABLE_AT);
  for (const m of unavailableTop.slice(0, 2)) {
    const picked = selected.length > 0 && !fallbackUsed;
    issues.push({
      level: 'warning',
      code: 'unavailable',
      message: `«${name(m.motif)}» ${fitsVerbFor(m.motif)} по смыслу, но в библиотеке нет подходящих файлов${picked ? ' — выбраны другие объекты' : ''}.`,
    });
  }
  if (fallbackUsed) {
    const chosen = selected[0];
    issues.push({
      level: 'warning',
      code: 'no-match',
      message:
        `Не нашлось объектов, подходящих по смыслу${unknownTokens.length > 0 ? ` (не распознано: ${unknownTokens.slice(0, 4).join(', ')})` : ''}. ` +
        `Для начала показан нейтральный объект «${chosen === undefined ? '' : name(chosen)}» — это не толкование заголовка. ` +
        'Назовите предмет или тему: деньги, идея, музыка, документы, цветы.',
      action: { kind: 'example', label: 'Попробовать пример', replacement: EXAMPLE_TITLE },
    });
  } else if (selected.length > 0 && top !== undefined && top.strength === 'weak') {
    issues.push({
      level: 'warning',
      code: 'weak-match',
      message: `Совпадение слабое: «${name(selected[0] as MotifId)}» выбран по единственной догадке (${top.reasons[0]?.detail ?? 'косвенный признак'}). Уточните тему или назовите объект напрямую.`,
    });
  }
  for (const hit of positive) {
    if (hit.typo === undefined) continue;
    // Written the way the typo was: a capitalised first word stays capitalised, a mid-sentence word stays lower case.
    const replacement = matchCase(hit.typo.token, hit.typo.word);
    issues.push({
      level: 'info',
      code: 'typo',
      message: `Возможно, опечатка: ${q(hit.typo.token)} — вы имели в виду ${q(replacement)}?`,
      action: {
        kind: 'replace',
        label: `Заменить на ${q(replacement)}`,
        token: hit.typo.token,
        replacement,
        range: { start: hit.typo.start, end: hit.typo.end },
      },
    });
  }
  if (excluded.length > 0) {
    issues.push({
      level: 'info',
      code: 'excluded',
      message: `Исключено по слову «без»/«не»: ${listNames(excluded.map((e) => e.motif))}.`,
    });
  }
  if (trimmed > 0) {
    issues.push({
      level: 'info',
      code: 'trimmed',
      message: `Подходящих объектов больше, чем помещается (${max}): показаны самые релевантные. Остальные можно добавить из каталога.`,
    });
  }
  // Unrecognised words of a successful run are reported only through `unknownTokens` (shown as chips).

  /* ---- summary ---- */
  let summary: string;
  if (selected.length === 0) {
    summary = 'Объекты не подобраны';
  } else if (fallbackUsed) {
    summary = `Явных совпадений нет — взят нейтральный объект «${name(selected[0] as MotifId)}»`;
  } else {
    const themeNote = themes[0] === undefined ? '' : ` · тема: ${themes[0].label}`;
    const weakNote = top?.strength === 'weak' ? ' (слабое совпадение)' : '';
    summary = `Подобрано: ${selected.map(name).join(', ')}${weakNote}${themeNote}`;
  }

  return { input, matches, selected, excluded, themes, unknownTokens, fallbackUsed, summary, issues };
}
