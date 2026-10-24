#!/usr/bin/env node
/**
 * سرور کوچک «آزمایشگاه طراحی»
 * ریشهٔ سایت خودِ design/ui-samples.html است و همان مینی‌اپ واقعی
 * (public/miniapp.html) را برای قاب‌های پیش‌نمایش سرو می‌کند.
 * فقط برای بازبینی طراحی؛ هیچ داده یا توکنی جابه‌جا نمی‌شود.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const designDir = resolve(here);
const publicDir = resolve(here, '..', 'public');
const port = Number(process.env.PORT || 4180);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const rootFor = (pathname) => {
  if (pathname === '/' || pathname === '/index.html') return { file: join(designDir, 'ui-samples.html'), root: designDir };
  if (pathname === '/miniapp.html' || pathname.startsWith('/assets/')) return { file: join(publicDir, normalize(pathname)), root: publicDir };
  return { file: join(designDir, normalize(pathname)), root: designDir };
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const { file, root } = rootFor(decodeURIComponent(url.pathname));
    if (!file.startsWith(root + sep) && file !== join(designDir, 'ui-samples.html')) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Design lab: http://localhost:${port}/`);
  console.log('چهار نمونهٔ رابط کاربری مینی‌اپ — فقط بازبینی طراحی.');
});
