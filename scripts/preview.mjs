import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const root = resolve(publicDir);
const port = Number(process.env.PORT || 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname === '/' ? '/miniapp.html' : url.pathname);
    const file = resolve(root, `.${relative}`);
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
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
  console.log(`TiznetVPN Mini App preview: http://localhost:${port}/`);
  console.log('Static preview only — demo data, not connected to Telegram or the Worker.');
});
