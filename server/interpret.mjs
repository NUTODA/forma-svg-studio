// Pure helpers for the optional LLM title interpreter (no I/O, unit-tested).

/** Must equal MOTIF_IDS in src/domain/types.ts (checked by server/interpret.test.ts). */
export const KNOWN_MOTIFS = ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'bouquet', 'wallet', 'folder', 'pen'];

export const MAX_TITLE = 300;
export const MAX_OBJECTS = 4;

/** Validates the client request. Returns { title, catalog } or { error }. */
export function parseRequest(body) {
  if (!body || typeof body !== 'object') return { error: 'bad-body' };
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : '';
  if (!title) return { error: 'empty-title' };
  if (!Array.isArray(body.catalog)) return { error: 'bad-catalog' };
  const seen = new Set();
  const catalog = [];
  for (const item of body.catalog.slice(0, 20)) {
    if (!item || typeof item.id !== 'string' || !KNOWN_MOTIFS.includes(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    catalog.push({
      id: item.id,
      name: String(item.name ?? item.id).slice(0, 40),
      description: String(item.description ?? '').slice(0, 120),
    });
  }
  if (catalog.length === 0) return { error: 'empty-catalog' };
  return { title, catalog };
}

export function buildMessages(title, catalog) {
  const list = catalog.map((m) => `- ${m.id}: ${m.name} — ${m.description}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'Ты арт-директор редакционных иллюстраций в изометрическом стиле. По заголовку или метафоре собери сцену ' +
        'из ФИКСИРОВАННОГО каталога предметов. Нельзя придумывать новые предметы и id.\n' +
        'Сцена = 2–3 главных предмета, которые вместе рассказывают смысл заголовка (первым — главный), ' +
        'и один фоновый предмет, который задаёт обстановку и не повторяет главные. ' +
        'Думай о метафоре, а не о буквальных словах: «копить на поездку» — это деньги и сборы в дорогу, ' +
        '«знания по кусочкам» — книга и пазл. Если в заголовке прямо названы предметы каталога, включи их; ' +
        'предметы после «без» не используй нигде.\n' +
        'Ответь ТОЛЬКО JSON без пояснений и markdown: ' +
        '{"objects":["id1","id2"],"background":"id3","reason":"одно предложение по-русски до 140 символов: как сцена передаёт смысл"}.\n\n' +
        `Каталог:\n${list}`,
    },
    { role: 'user', content: `Заголовок: «${title}»` },
  ];
}

/** Extracts the model answer. Returns { objects, reason } with ids filtered to the catalog, or null. */
export function parseAnswer(text, catalog) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.objects)) return null;
  const allowed = new Set(catalog.map((m) => m.id));
  const objects = [];
  for (const id of data.objects) {
    if (typeof id === 'string' && allowed.has(id) && !objects.includes(id)) objects.push(id);
    if (objects.length >= MAX_OBJECTS) break;
  }
  if (objects.length === 0) return null;
  const reason = typeof data.reason === 'string' ? data.reason.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  const background =
    typeof data.background === 'string' && allowed.has(data.background) && !objects.includes(data.background)
      ? data.background
      : null;
  return background ? { objects, background, reason } : { objects, reason };
}
