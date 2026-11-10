import { describe, expect, it } from 'vitest';
import { KNOWN_MOTIFS, buildMessages, parseAnswer, parseRequest } from './interpret.mjs';
import { MOTIF_IDS } from '../src/domain/types';

const catalog = [
  { id: 'book', name: 'Книга', description: 'чтение' },
  { id: 'puzzle', name: 'Пазлы', description: 'части целого' },
];

describe('server/interpret', () => {
  it('knows exactly the app motifs', () => {
    expect([...KNOWN_MOTIFS].sort()).toEqual([...MOTIF_IDS].sort());
  });

  it('validates requests', () => {
    expect(parseRequest(null)).toEqual({ error: 'bad-body' });
    expect(parseRequest({ title: '  ', catalog })).toEqual({ error: 'empty-title' });
    expect(parseRequest({ title: 'x', catalog: [{ id: 'rocket' }] })).toEqual({ error: 'empty-catalog' });
    const ok = parseRequest({ title: 'a'.repeat(500), catalog: [...catalog, catalog[0], { id: 'evil' }] });
    expect('error' in ok).toBe(false);
    if (!('error' in ok)) {
      expect(ok.title).toHaveLength(300);
      expect(ok.catalog.map((m: { id: string }) => m.id)).toEqual(['book', 'puzzle']);
    }
  });

  it('puts the title in the user message and the catalog in the system prompt', () => {
    const [system, user] = buildMessages('Знания по крупицам', catalog);
    expect(system.content).toContain('puzzle: Пазлы');
    expect(user.content).toContain('Знания по крупицам');
  });

  it('parses answers and drops unknown or repeated ids', () => {
    const text = 'Вот: ```json\n{"objects":["puzzle","rocket","book","puzzle"],"reason":"Части\\n складываются   в целое"}\n```';
    expect(parseAnswer(text, catalog)).toEqual({ objects: ['puzzle', 'book'], reason: 'Части складываются в целое' });
  });

  it('rejects garbage', () => {
    for (const bad of [undefined, '', 'нет json', '{"objects":"book"}', '{"objects":["rocket"]}', '{oops}']) {
      expect(parseAnswer(bad as string, catalog)).toBeNull();
    }
  });
});
