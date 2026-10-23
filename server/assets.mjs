import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

function plain(text, status) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
  });
}

export function createLocalAssets(publicDirectory) {
  const root = resolve(publicDirectory);

  return {
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return plain('Method Not Allowed', 405);

      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return plain('Bad Request', 400);
      }
      if (pathname.includes('\0') || pathname.includes('\\')) return plain('Forbidden', 403);

      const relative = pathname === '/' ? '/miniapp.html' : pathname;
      const filename = resolve(root, `.${relative}`);
      if (filename !== root && !filename.startsWith(root + sep)) return plain('Forbidden', 403);

      try {
        const info = await stat(filename);
        if (!info.isFile()) return plain('Not Found', 404);
        const headers = {
          'Content-Type': TYPES[extname(filename).toLowerCase()] || 'application/octet-stream',
          'Content-Length': String(info.size),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store, max-age=0'
        };
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
        return new Response(await readFile(filename), { status: 200, headers });
      } catch (error) {
        if (error && error.code === 'ENOENT') return plain('Not Found', 404);
        return plain('Not Found', 404);
      }
    }
  };
}
