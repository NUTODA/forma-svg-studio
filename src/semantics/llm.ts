/**
 * Optional LLM title interpreter (see interpreter.ts). The browser only talks to our own
 * `/api/interpret`; the key stays on the server. Every failure resolves to `null`, and the caller
 * then keeps the deterministic rule-based result.
 */
import { MOTIFS } from '../domain/motifs';
import { MOTIF_IDS, type MotifId, type TitleAnalysis } from '../domain/types';

export interface LlmPick {
  motifs: MotifId[];
  reason: string;
}

/** Slightly above the server's own upstream timeout. */
const TIMEOUT_MS = 10000;
let health: Promise<boolean> | null = null;

/** Whether the server has an LLM configured (cached; false on static hosting). */
export function llmAvailable(): Promise<boolean> {
  health ??= fetch('api/health', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { llm: false }))
    .then((d: { llm?: boolean }) => d.llm === true)
    .catch(() => false);
  return health;
}

export function resetLlmProbe(): void {
  health = null;
}

/** Keeps only known, available, distinct motifs (max 4); null if nothing valid is left. */
export function sanitizePick(raw: unknown, available: ReadonlySet<MotifId>): LlmPick | null {
  if (!raw || typeof raw !== 'object') return null;
  const { objects, reason } = raw as { objects?: unknown; reason?: unknown };
  if (!Array.isArray(objects)) return null;
  const motifs: MotifId[] = [];
  for (const id of objects) {
    if (typeof id === 'string' && (MOTIF_IDS as readonly string[]).includes(id) && available.has(id as MotifId) && !motifs.includes(id as MotifId)) {
      motifs.push(id as MotifId);
    }
    if (motifs.length >= 4) break;
  }
  if (motifs.length === 0) return null;
  return { motifs, reason: typeof reason === 'string' ? reason.trim().slice(0, 160) : '' };
}

export async function requestLlmPick(title: string, available: ReadonlySet<MotifId>): Promise<LlmPick | null> {
  if (!title.trim() || !(await llmAvailable())) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('api/interpret', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        catalog: [...available].map((id) => ({ id, name: MOTIFS[id].name, description: MOTIFS[id].description })),
      }),
    });
    if (!response.ok) return null;
    return sanitizePick(await response.json(), available);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const MAX_MERGED = 3;

/**
 * The rules are instant and deterministic, so the model is asked only when they are unsure:
 * nothing matched, the best match is not a strong one, or a single object was found.
 */
export function needsLlm(analysis: TitleAnalysis): boolean {
  if (analysis.selected.length === 0) return false; // empty or unusable input: nothing to interpret
  return analysis.fallbackUsed || analysis.matches[0]?.strength !== 'strong' || analysis.selected.length < 2;
}

/**
 * Merges the model's pick into the rule-based analysis (the result stays a regular TitleAnalysis).
 * Objects the rules are sure about stay first, objects excluded by «без …» never come back.
 */
export function applyLlmPick(analysis: TitleAnalysis, pick: LlmPick): TitleAnalysis {
  const excluded = new Set(analysis.excluded.map((e) => e.motif));
  const sure = analysis.fallbackUsed
    ? []
    : analysis.selected.filter((id) => analysis.matches.find((m) => m.motif === id)?.strength === 'strong');
  const selected: MotifId[] = [];
  for (const id of [...sure, ...pick.motifs]) {
    if (!excluded.has(id) && !selected.includes(id) && selected.length < MAX_MERGED) selected.push(id);
  }
  if (selected.length === 0) return analysis;
  const names = selected.map((id) => MOTIFS[id].name).join(', ');
  const kept = analysis.issues.filter((i) => !['weak-match', 'no-match', 'unavailable', 'trimmed'].includes(i.code));
  const matches = [...analysis.matches];
  for (const motif of selected) {
    if (!matches.some((m) => m.motif === motif)) {
      matches.push({ motif, score: 0, strength: 'medium', reasons: [{ kind: 'theme', token: '', detail: 'Выбрано ИИ по смыслу заголовка' }], available: true });
    }
  }
  // Chosen objects lead the list (in composition order); the rules' other candidates follow.
  const rank = (id: MotifId): number => (selected.includes(id) ? selected.indexOf(id) : selected.length);
  matches.sort((a, b) => rank(a.motif) - rank(b.motif));
  return {
    ...analysis,
    matches,
    selected,
    fallbackUsed: false,
    summary: `Подобрано с ИИ: ${names}`,
    issues: [
      ...kept,
      ...(pick.reason ? [{ level: 'info' as const, code: 'llm', message: `ИИ: ${pick.reason}` }] : []),
    ],
  };
}
