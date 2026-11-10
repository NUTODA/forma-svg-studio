import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contentType, loadStatic, resolveStaticPath } from './static.mjs';

const dist = path.resolve('/srv/forma/dist');

describe('server/static resolveStaticPath', () => {
  it('maps the root and asset routes into dist', () => {
    expect(resolveStaticPath(dist, '/')).toEqual({ file: dist });
    expect(resolveStaticPath(dist, undefined)).toEqual({ file: dist });
    expect(resolveStaticPath(dist, '/index.html')).toEqual({ file: path.join(dist, 'index.html') });
    expect(resolveStaticPath(dist, '/static/app-1a2b.js?v=3#top')).toEqual({ file: path.join(dist, 'static/app-1a2b.js') });
    expect(resolveStaticPath(dist, '/assets/book-l-main.svg')).toEqual({ file: path.join(dist, 'assets/book-l-main.svg') });
  });

  it('decodes percent-encoded paths', () => {
    expect(resolveStaticPath(dist, '/assets/%D0%BA%D0%BD%D0%B8%D0%B3%D0%B0.svg')).toEqual({ file: path.join(dist, 'assets/книга.svg') });
    expect(resolveStaticPath(dist, '/a%20b.svg')).toEqual({ file: path.join(dist, 'a b.svg') });
  });

  it('answers 400 for a URL it cannot read, instead of throwing', () => {
    // «GET /%ZZ» used to throw URIError from decodeURIComponent and end the process.
    for (const bad of ['/%ZZ', '/%', '/a%2', '/%E0%A4%A', '/%C0%AF', '/%00', '/a%00b', 'http://x/', 'index.html', '*', '']) {
      expect(() => resolveStaticPath(dist, bad), bad).not.toThrow();
      expect(resolveStaticPath(dist, bad), bad).toMatchObject({ status: 400 });
    }
  });

  it('answers 403 for every way out of dist, including a sibling that shares the name prefix', () => {
    for (const escape of [
      '/..',
      '/../',
      '/../secret',
      '/a/../../secret',
      '/%2e%2e/secret',
      '/%2E%2E%2Fsecret',
      '/..%2fsecret',
      '/static/../../dist-secret/token.txt',
      '/../dist-secret/token.txt',
    ]) {
      expect(resolveStaticPath(dist, escape), escape).toMatchObject({ status: 403 });
    }
  });

  it('keeps odd but harmless paths inside dist', () => {
    expect(resolveStaticPath(dist, '//etc/passwd')).toEqual({ file: path.join(dist, 'etc/passwd') });
    expect(resolveStaticPath(dist, '/..hidden')).toEqual({ file: path.join(dist, '..hidden') });
    expect(resolveStaticPath(dist, '/static/../index.html')).toEqual({ file: path.join(dist, 'index.html') });
  });
});

describe('server/static contentType', () => {
  it('knows the build output types and defaults to a binary stream', () => {
    expect(contentType('/d/index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('/d/static/app.js')).toBe('text/javascript');
    expect(contentType('/d/assets/book.svg')).toBe('image/svg+xml');
    expect(contentType('/d/data.bin')).toBe('application/octet-stream');
  });
});

describe('server/static loadStatic', () => {
  // Built while the suite is collected: `it.skipIf` below needs to know whether symlinks work here.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forma-static-'));
  const built = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(built, 'static'), { recursive: true });
  fs.mkdirSync(path.join(built, 'assets', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'dist-secret'));
  fs.writeFileSync(path.join(built, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(built, 'static', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(built, 'assets', 'book.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(built, 'assets', 'nested', 'index.html'), '<p>nested</p>');
  fs.writeFileSync(path.join(tmp, 'dist-secret', 'token.txt'), 'secret');
  let linked = true;
  try {
    // Two links pointing at each other: opening either fails with ELOOP.
    fs.symlinkSync('loop-b', path.join(built, 'loop-a'));
    fs.symlinkSync('loop-a', path.join(built, 'loop-b'));
  } catch {
    linked = false;
  }

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const text = async (url: string) => {
    const found = await loadStatic(built, url);
    return { ...found, body: found.body?.toString('utf8') };
  };

  it('serves the root and the asset routes', async () => {
    expect(await text('/')).toMatchObject({ status: 200, file: path.join(built, 'index.html'), body: '<!doctype html><title>shell</title>' });
    expect(await text('/index.html')).toMatchObject({ status: 200, body: '<!doctype html><title>shell</title>' });
    expect(await text('/static/app.js?x=1')).toMatchObject({ status: 200, file: path.join(built, 'static/app.js'), body: 'console.log(1)' });
    expect(await text('/assets/book.svg')).toMatchObject({ status: 200, body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  });

  it('serves a directory index, and the app shell for routes and directories without one', async () => {
    expect(await text('/assets/nested')).toMatchObject({ status: 200, body: '<p>nested</p>' });
    expect(await text('/assets')).toMatchObject({ status: 200, file: path.join(built, 'index.html') });
    expect(await text('/some/client/route')).toMatchObject({ status: 200, file: path.join(built, 'index.html') });
    expect(await text('/index.html/extra')).toMatchObject({ status: 200, file: path.join(built, 'index.html') });
  });

  it('rejects a broken URL with 400 and never reads outside dist', async () => {
    expect(await loadStatic(built, '/%ZZ')).toEqual({ status: 400, error: 'bad request' });
    expect(await loadStatic(built, '/%E0%A4%A')).toMatchObject({ status: 400 });
    expect(await loadStatic(built, '/../dist-secret/token.txt')).toEqual({ status: 403, error: 'forbidden' });
    expect(await loadStatic(built, '/%2e%2e/dist-secret/token.txt')).toMatchObject({ status: 403 });
  });

  it('answers 404 without a built app instead of throwing', async () => {
    const missing = path.join(tmp, 'not-built');
    expect(await loadStatic(missing, '/')).toEqual({ status: 404, error: 'not found' });
    expect(await loadStatic(missing, '/static/app.js')).toMatchObject({ status: 404 });
  });

  it('treats a path that is far too long as a missing file', async () => {
    expect(await loadStatic(built, `/${'a'.repeat(5000)}`)).toMatchObject({ status: 200, file: path.join(built, 'index.html') });
  });

  it.skipIf(!linked)('answers 500 when a read fails for another reason, instead of throwing', async () => {
    expect(await loadStatic(built, '/loop-a')).toEqual({ status: 500, error: 'server error' });
  });
});
