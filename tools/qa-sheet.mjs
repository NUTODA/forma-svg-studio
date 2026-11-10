#!/usr/bin/env node
// Runs QA scenes through the real UI and writes a contact sheet plus layout metrics.
//
//   node tools/qa-sheet.mjs dev|holdout [--url http://127.0.0.1:4190] [--out qa/out]
//
// Needs a running app (`npm start`, or `npm run preview` without the LLM) and Google Chrome
// (CHROME_PATH overrides the macOS default). Nothing is tuned here: the script only observes.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const set = args.find((a) => !a.startsWith('--')) ?? 'dev';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const url = opt('url', 'http://127.0.0.1:4190');
const outDir = opt('out', 'qa/out');
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const scenarios = JSON.parse(fs.readFileSync('qa/scenarios.json', 'utf8'))[set];
if (!scenarios) throw new Error(`unknown set «${set}»`);
const manifest = JSON.parse(fs.readFileSync('public/assets/source-manifest.json', 'utf8'));
const FORMATS = { '1:1': [1080, 1080], '4:5': [1080, 1350], '1200×630': [1200, 630] };

/** Rendered bounds of a draft layer (size = rendered height; width follows the source ratio). */
function boxOf(layer, detail) {
  const variant = manifest.objects[layer.motif].variants[`${detail}-${layer.role === 'object' ? 'main' : 'background'}`];
  const w = (layer.size * variant.width) / variant.height;
  return { x: layer.x - w / 2, y: layer.y - layer.size / 2, w, h: layer.size };
}
const area = (b) => b.w * b.h;
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** Layout metrics of a document: how piled up, spread and centred the objects are. */
function metrics(doc, frame) {
  const objects = doc.layers.filter((l) => l.role === 'object' && !l.hidden).map((l) => boxOf(l, doc.detail));
  let pairs = 0;
  for (let i = 0; i < objects.length; i += 1) for (let j = i + 1; j < objects.length; j += 1) pairs += overlap(objects[i], objects[j]);
  const total = objects.reduce((s, b) => s + area(b), 0) || 1;
  const x0 = Math.min(...objects.map((b) => b.x));
  const y0 = Math.min(...objects.map((b) => b.y));
  const x1 = Math.max(...objects.map((b) => b.x + b.w));
  const y1 = Math.max(...objects.map((b) => b.y + b.h));
  const [W, H] = frame;
  const cx = objects.reduce((s, b) => s + (b.x + b.w / 2) * area(b), 0) / total;
  const cy = objects.reduce((s, b) => s + (b.y + b.h / 2) * area(b), 0) / total;
  return {
    objects: objects.length,
    background: doc.layers.filter((l) => l.role === 'background').map((l) => l.motif).join(',') || '—',
    /** Share of the objects' area that overlaps another object (box estimate; isometric corners are empty). */
    pile: +(pairs / total).toFixed(2),
    /** Share of the frame covered by the objects' bounding box. */
    spread: +(((Math.min(x1, W) - Math.max(x0, 0)) * (Math.min(y1, H) - Math.max(y0, 0))) / (W * H)).toFixed(2),
    /** Distance of the area-weighted centre from the frame centre, as a share of the frame diagonal. */
    offCentre: +(Math.hypot(cx - W / 2, cy - H / 2) / Math.hypot(W, H)).toFixed(2),
  };
}

const browser = await chromium.launch({ executablePath: chrome });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(url);
await page.waitForSelector('[role=application]');

const results = [];
for (const [mode, text, format, layout, detail = 'L'] of scenarios) {
  // One input for both kinds of brief: `mode` is what the scene was written as, the app reads the text itself.
  await page.locator('textarea').fill(text);
  await page.locator(`[role=radio][aria-label^="${format}"]`).click();
  await page.locator(`[role=radio][aria-label^="${detail},"]`).click();
  await page.getByRole('radio', { name: layout, exact: true }).click();
  await page.locator('.brief__run').click();
  await page.waitForTimeout(200);
  await page.waitForFunction(() => !document.querySelector('.brief__run')?.getAttribute('aria-busy'), null, { timeout: 30000 });
  await page.waitForTimeout(700);
  const summary = ((await page.locator('.brief').innerText()).match(/(Подобрано[^\n]*|Распознано[^\n]*|Явных совпадений[^\n]*)/) ?? [''])[0];
  // «Распознано …» is the summary of a list; a title says «Подобрано …» or «Явных совпадений нет …».
  const read = summary.startsWith('Распознано') ? 'names' : 'title';
  if (read !== mode) process.stdout.write(`\n  note: «${text}» was written as ${mode} but the app read it as ${read}\n`);
  const doc = await page.evaluate(() => {
    const raw = localStorage.getItem('forma:draft:v1');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.doc ?? parsed;
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Экспорт SVG/ }).click()]);
  const svg = fs.readFileSync(await download.path(), 'utf8');
  results.push({ mode, text, format, layout, detail, summary, svg, metrics: doc ? metrics(doc, FORMATS[format]) : null });
  process.stdout.write('.');
}
process.stdout.write('\n');

fs.mkdirSync(outDir, { recursive: true });
const sheet = await context.newPage();
await sheet.setViewportSize({ width: 1500, height: 1000 });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
await sheet.setContent(
  `<body style="margin:0;padding:10px;background:#fff;font:12px/1.35 -apple-system,sans-serif;display:flex;flex-wrap:wrap;gap:12px">${results
    .map((r) => {
      const [w, h] = FORMATS[r.format];
      const width = w / h > 1.5 ? 460 : w / h < 0.9 ? 250 : 310;
      const m = r.metrics;
      return `<figure style="margin:0;width:${width}px"><img style="width:100%;display:block;border:1px solid #ccc" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.svg)}"><figcaption><b>${esc(r.text)}</b> · ${r.format} · ${r.layout} · ${r.detail}<br>${esc(r.summary)}<br><span style="color:#666">объектов ${m?.objects} · фон ${m?.background} · наложение ${m?.pile} · охват ${m?.spread} · смещение ${m?.offCentre}</span></figcaption></figure>`;
    })
    .join('')}</body>`,
);
await sheet.waitForTimeout(1200);
const png = path.join(outDir, `${set}.png`);
await sheet.screenshot({ path: png, fullPage: true });
fs.writeFileSync(
  path.join(outDir, `${set}.json`),
  JSON.stringify(results.map(({ svg, ...rest }) => rest), null, 2),
);
await browser.close();

const rows = results.map((r) => ({ brief: r.text.slice(0, 40), format: r.format, picked: r.summary.replace(/^Подобрано( с ИИ)?: /, '').slice(0, 40), ...r.metrics }));
console.table(rows);
console.log(`sheet: ${png}`);
