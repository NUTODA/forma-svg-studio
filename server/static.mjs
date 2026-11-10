// Static file lookup for server/index.mjs: pure path resolution plus a read that never throws (unit-tested).
import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.mp4': 'video/mp4' };

export function contentType(file) {
  return TYPES[path.extname(file)] ?? 'application/octet-stream';
}

const BAD_REQUEST = { status: 400, error: 'bad request' };

/**
 * Maps a request URL to an absolute path inside `dist`.
 * Returns { file } (the file may not exist) or { status, error } for a URL that is rejected:
 * 400 for a malformed URL (not an absolute path, broken percent-encoding, NUL), 403 for a path that leaves `dist`.
 */
export function resolveStaticPath(dist, requestUrl) {
  const raw = (requestUrl ?? '/').split(/[?#]/)[0];
  if (!raw.startsWith('/')) return BAD_REQUEST;
  let pathname;
  try {
    pathname = decodeURIComponent(raw);
  } catch {
    return BAD_REQUEST;
  }
  if (pathname.includes('\0')) return BAD_REQUEST;
  const base = path.resolve(dist);
  const file = path.resolve(base, `.${pathname}`);
  const relative = path.relative(base, file);
  // Compare path segments, not string prefixes: «/app/dist-secret» must not pass for «/app/dist».
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return { status: 403, error: 'forbidden' };
  }
  return { file };
}

/** A missing path is not an error: the app shell answers it (client-side routes). */
const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG']);

/**
 * Reads what `requestUrl` asks for from `dist`: the file itself, the index of a directory, otherwise the app's index.html.
 * Never throws: { status: 200, file, body } or { status, error } (400/403 from the resolver, 404 without a built app, 500 on a read failure).
 */
export async function loadStatic(dist, requestUrl) {
  const resolved = resolveStaticPath(dist, requestUrl);
  if (resolved.file === undefined) return resolved;
  const shell = path.join(path.resolve(dist), 'index.html');
  for (const file of [resolved.file, path.join(resolved.file, 'index.html'), shell]) {
    try {
      return { status: 200, file, body: await fs.readFile(file) };
    } catch (error) {
      if (!MISSING.has(error?.code)) return { status: 500, error: 'server error' };
    }
  }
  return { status: 404, error: 'not found' };
}
