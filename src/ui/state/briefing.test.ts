import { describe, expect, it } from 'vitest';
import { DEMO_PRESETS, createDoc, docFromMotifs, objectMotifs, validateDoc } from '../../doc/doc';
import { MOTIF_IDS, type MotifId } from '../../domain/types';
import { allFileMetas } from '../../layout/testMetas';
import { readBrief } from '../../semantics/briefMode';
import type { LlmPick } from '../../semantics/llm';
import {
  analyseBrief,
  analyseInput,
  buildDemo,
  composedMessage,
  composedStatus,
  emptyBriefMessage,
  planBrief,
  skippedFromList,
  withLlmPick,
} from './briefing';
import { headlineForBrief } from './useEditor';

const ALL: ReadonlySet<MotifId> = new Set(MOTIF_IDS);
const without = (...ids: MotifId[]): ReadonlySet<MotifId> => new Set(MOTIF_IDS.filter((id) => !ids.includes(id)));

/** The list from the bug report: five objects, one of them twice. */
const LIST = 'Книга, 2 монеты, лампа, ручка';
const FIVE: MotifId[] = ['book', 'coin', 'coin', 'lamp', 'pen'];
/** An answer that would cut the list down to a single object if it were allowed to. */
const SHRINKING_PICK: LlmPick = { motifs: ['puzzle'], reason: 'Одна метафора', scenery: 'phone' };
/** Words the dictionary cannot place: the model's pick is the only thing that sets the objects. */
const UNPLACEABLE = 'asdfgh qwerty';
const NBSP = ' ';

/** What a run composes: the model is asked only when the plan says so, and its answer only reshapes a title. */
function compose(text: string, llmOn: boolean, pick: LlmPick | null) {
  const plan = planBrief(text, ALL, llmOn);
  return withLlmPick(plan.analysis, plan.askLlm ? pick : null);
}

describe('analyseInput', () => {
  it('builds every object of an explicit list, quantities included, not the three a title is cut to', () => {
    const { motifs, result } = analyseInput(LIST, ALL);
    expect(result.mode).toBe('names');
    expect(motifs).toEqual(FIVE);
    // The cause of the report: the same words read as a title give at most three objects.
    expect(analyseBrief(LIST, 'title', ALL).motifs.length).toBeLessThanOrEqual(3);
  });

  it('interprets a title by meaning: the dictionary picks the objects', () => {
    const learning = analyseInput('Знания по кусочкам', ALL);
    expect(learning.result.mode).toBe('title');
    expect(learning.motifs).toEqual(['puzzle', 'book']);
    const salary = analyseInput('Финансовая грамотность: как копить с первой зарплаты', ALL);
    expect(salary.result.mode).toBe('title');
    expect(salary.motifs).toEqual(['coin', 'wallet']);
  });

  it('keeps the exclusions of a title that names objects', () => {
    const { motifs, result } = analyseInput('Смартфон без наушников', ALL);
    expect(result.mode).toBe('title');
    expect(motifs).toContain('phone');
    expect(motifs).not.toContain('headphones');
  });

  it('builds the known objects of a list with an unknown item and reports the item', () => {
    const { motifs, result } = analyseInput('Книга, зонт, лампа', ALL);
    expect(result.mode).toBe('names');
    expect(motifs).toEqual(['book', 'lamp']);
    expect(skippedFromList(result)).toEqual(['«зонт»']);
  });
});

describe('planBrief: the model reads titles, never lists', () => {
  it('never asks the model about a list, so the list is the same with the model on or off', () => {
    for (const llmOn of [true, false]) {
      const plan = planBrief(LIST, ALL, llmOn);
      expect(plan.askLlm).toBe(false);
      expect(plan.analysis.motifs).toEqual(FIVE);
    }
  });

  it('asks the model about a title only when one is configured, and not about nothing', () => {
    expect(planBrief('Знания по кусочкам', ALL, true).askLlm).toBe(true);
    expect(planBrief('Знания по кусочкам', ALL, false).askLlm).toBe(false);
    expect(planBrief('   ', ALL, true).askLlm).toBe(false);
  });

  it('asks about a mixed text only when it reads as a title', () => {
    // One unknown item among objects is still a list; unknown items as many as the objects make it prose.
    expect(planBrief('Книга, зонт, лампа', ALL, true).askLlm).toBe(false);
    expect(planBrief('Книга, лампа, зонт, шляпа', ALL, true).askLlm).toBe(true);
  });
});

describe('withLlmPick', () => {
  it('lets the model reshape a title and choose its scenery', () => {
    const pick: LlmPick = { motifs: ['lamp', 'pen'], reason: 'Идея и запись', scenery: 'book' };
    const merged = withLlmPick(analyseInput(UNPLACEABLE, ALL), pick);
    expect(merged.result.mode).toBe('title');
    expect(merged.motifs).toEqual(['lamp', 'pen']);
    expect(merged.scenery).toBe('book');
  });

  it('leaves a list as written: the answer neither shrinks it nor sets its scenery', () => {
    const list = analyseInput(LIST, ALL);
    const merged = withLlmPick(list, SHRINKING_PICK);
    expect(merged).toBe(list);
    expect(merged.motifs).toEqual(FIVE);
    expect(merged.scenery).toBeUndefined();
  });

  it('keeps the rule-based reading when the model gave no answer', () => {
    const title = analyseInput(UNPLACEABLE, ALL);
    expect(withLlmPick(title, null)).toBe(title);
    expect(withLlmPick(title, undefined)).toBe(title);
  });
});

describe('a run with the model on and off', () => {
  it('composes all five objects of the list either way, whatever the model would say', () => {
    const files = allFileMetas();
    for (const llmOn of [true, false]) {
      const { motifs } = compose(LIST, llmOn, SHRINKING_PICK);
      expect(motifs).toEqual(FIVE);
      const doc = docFromMotifs(createDoc(), motifs, files);
      expect([...objectMotifs(doc)].sort()).toEqual([...FIVE].sort());
    }
  });

  it('keeps the known objects of a list with an unknown item either way', () => {
    for (const llmOn of [true, false]) {
      expect(compose('Книга, 2 монеты, лампа, ручка, зонт', llmOn, SHRINKING_PICK).motifs).toEqual(FIVE);
    }
  });

  it('still sends a title to the model: its answer sets the objects, and without a model the dictionary does', () => {
    const pick: LlmPick = { motifs: ['lamp', 'pen'], reason: '' };
    const on = compose(UNPLACEABLE, true, pick);
    const off = compose(UNPLACEABLE, false, pick);
    expect(on.motifs).toEqual(['lamp', 'pen']);
    expect(off.result.mode).toBe('title');
    expect(off.motifs).not.toEqual(['lamp', 'pen']);
    expect(off.motifs.length).toBeGreaterThan(0);
  });
});

describe('what the user is told after a run', () => {
  it('counts the objects, with the plural right', () => {
    const text = composedMessage(FIVE, 'composed');
    expect(text).toContain(`Собрано 5${NBSP}объектов`);
    expect(text).toContain('×2');
    expect(text).toContain('Иллюстрация');
    expect(composedMessage(['book'], 'composed')).toContain(`Собрано 1${NBSP}объект:`);
    expect(composedMessage(['book', 'lamp'], 'title')).toContain(`Собрано 2${NBSP}объекта`);
  });

  it('is plain success when every name made it into the composition', () => {
    const { result, motifs } = analyseInput(LIST, ALL);
    const done = composedStatus(result, motifs, 'composed');
    expect(done.level).toBe('success');
    expect(done.text).toContain(`Собрано 5${NBSP}объектов`);
    expect(done.text).not.toContain('Не вошло');
  });

  it('says which names were left out instead of dropping them silently', () => {
    const unknown = analyseInput('Книга, зонт, лампа', ALL);
    const done = composedStatus(unknown.result, unknown.motifs, 'composed');
    expect(done.level).toBe('warning');
    expect(done.text).toContain(`Собрано 2${NBSP}объекта`);
    expect(done.text).toContain('Не вошло: «зонт»');

    const noFiles = analyseInput('лампа, книга', without('lamp'));
    expect(noFiles.result.mode).toBe('names');
    const missing = composedStatus(noFiles.result, noFiles.motifs, 'composed');
    expect(missing.level).toBe('warning');
    expect(missing.text).toContain('Не вошло: «лампа»');
  });

  it('says when the limit of eight objects cut a list', () => {
    const many = analyseInput('книга, телефон, пазлы, монета, наушники, лампа, букет, кошелёк, папка, ручка', ALL);
    expect(many.motifs).toHaveLength(8);
    const done = composedStatus(many.result, many.motifs, 'composed');
    expect(done.level).toBe('warning');
    expect(done.text).toContain(`Собрано 8${NBSP}объектов`);
    expect(done.text).toContain('не больше 8 объектов');
  });

  it('has no list notes for a title', () => {
    const { result, motifs } = analyseInput('Знания по кусочкам', ALL);
    expect(skippedFromList(result)).toEqual([]);
    expect(composedStatus(result, motifs, 'composed').level).toBe('success');
  });

  it('asks for text, or for a clearer brief', () => {
    expect(emptyBriefMessage('  ')).toContain('список объектов');
    expect(emptyBriefMessage('зонт')).toBe('Не удалось подобрать объекты — уточните задание');
  });
});

describe('headline of a composition', () => {
  it('is the title for a title and nothing for a list, as before', () => {
    expect(headlineForBrief(analyseInput(LIST, ALL).result.mode, LIST)).toBe('');
    const title = ' Знания по кусочкам ';
    expect(headlineForBrief(analyseInput(title, ALL).result.mode, title)).toBe('Знания по кусочкам');
  });
});

describe('demos and old drafts', () => {
  it.each(DEMO_PRESETS.map((preset) => [preset.id, preset] as const))('demo «%s» keeps its mode and headline', (_id, preset) => {
    const built = buildDemo(preset, allFileMetas(), ALL);
    expect(built.brief.mode).toBe(preset.brief.mode);
    expect(built.doc.brief).toEqual(preset.brief);
    expect(built.doc.headline).toBe(preset.brief.mode === 'title' ? preset.brief.text.trim() : '');
    // The one input reads each example the way the example was written.
    expect(readBrief(preset.brief.text, ALL).mode).toBe(preset.brief.mode);
  });

  it('builds the study kit from its four names', () => {
    const study = DEMO_PRESETS.find((preset) => preset.id === 'study-kit');
    if (!study) throw new Error('no study-kit demo');
    const built = buildDemo(study, allFileMetas(), ALL);
    expect([...objectMotifs(built.doc)].sort()).toEqual(['book', 'headphones', 'lamp', 'pen']);
  });

  it('opens a draft saved in either mode, and a list saved in the old title tab now builds all its objects', () => {
    for (const mode of ['title', 'names'] as const) {
      const saved = JSON.parse(JSON.stringify({ ...createDoc(), brief: { mode, text: LIST } })) as unknown;
      const doc = validateDoc(saved);
      expect(doc?.brief).toEqual({ mode, text: LIST });
      expect(analyseInput(doc?.brief.text ?? '', ALL).motifs).toEqual(FIVE);
    }
  });
});
