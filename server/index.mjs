// Tiny dependency-free server: serves dist/ and proxies POST /api/interpret to an OpenAI-compatible LLM.
// The API key lives only in the environment (or .env.local) and never reaches the browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMessages, parseAnswer, parseRequest } from './interpret.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnvFile(path.join(root, '.env.local'));
loadEnvFile(path.join(root, '.env'));

const { LLM_BASE_URL, LLM_API_KEY, LLM_API_KEY_HEADER, LLM_STEP_MODEL, LLM_EXTRA_BODY } = process.env;
const MODEL = process.env.FORMA_LLM_MODEL || LLM_STEP_MODEL;
const enabled = Boolean(LLM_BASE_URL && LLM_API_KEY && MODEL);
// Extra request fields: FORMA_LLM_EXTRA_BODY wins; LLM_EXTRA_BODY applies only to its own default model.
let extra = {};
try {
  const raw = process.env.FORMA_LLM_EXTRA_BODY ?? (process.env.FORMA_LLM_MODEL ? '' : LLM_EXTRA_BODY);
  extra = raw ? JSON.parse(raw) : {};
} catch {
  extra = {};
}
const PORT = Number(process.env.PORT || 8787);
// Interactive budget: past this the client falls back to the rule-based pick.
const TIMEOUT_MS = 9000;

// Naive per-IP limiter (20 requests / minute) so a public demo cannot drain the quota.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.mp4': 'video/mp4' };

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function interpret(req, res) {
  if (!enabled) return send(res, 503, { error: 'llm-disabled' });
  if (limited(req.socket.remoteAddress ?? '')) return send(res, 429, { error: 'rate-limited' });
  let parsed;
  try {
    parsed = parseRequest(await readJson(req));
  } catch {
    return send(res, 400, { error: 'bad-json' });
  }
  if (parsed.error) return send(res, 400, { error: parsed.error });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`${LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        [LLM_API_KEY_HEADER || 'Authorization']: LLM_API_KEY_HEADER ? LLM_API_KEY : `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: buildMessages(parsed.title, parsed.catalog),
        max_tokens: 800,
        ...extra,
      }),
    });
    if (!upstream.ok) return send(res, 502, { error: 'upstream', status: upstream.status });
    const data = await upstream.json();
    const answer = parseAnswer(data?.choices?.[0]?.message?.content, parsed.catalog);
    if (!answer) return send(res, 502, { error: 'bad-answer' });
    return send(res, 200, { objects: answer.objects, reason: answer.reason, model: MODEL });
  } catch (error) {
    return error?.name === 'AbortError' ? send(res, 504, { error: 'upstream-timeout' }) : send(res, 502, { error: 'upstream-failed' });
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res) {
  const dist = path.join(root, 'dist');
  const url = new URL(req.url ?? '/', 'http://x');
  let file = path.normalize(path.join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) return send(res, 403, 'forbidden', 'text/plain');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) file = path.join(dist, 'index.html');
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(body);
}

http
  .createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { llm: enabled });
    if (pathname === '/api/interpret' && req.method === 'POST') return void interpret(req, res);
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not-found' });
    if (process.env.FORMA_API_ONLY) return send(res, 404, { error: 'not-found' });
    return serveStatic(req, res);
  })
  .listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`Forma server on http://${process.env.HOST || '127.0.0.1'}:${PORT} (LLM ${enabled ? 'on: ' + MODEL : 'off'})`));
