#!/usr/bin/env node
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFileSync } from 'node:fs';
import APP from '../src/worker.js';
import { createRuntime } from './runtime.mjs';

const PACKAGE_VERSION = (() => {
  try { return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || 'unknown'); }
  catch { return 'unknown'; }
})();

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function firstHeader(value) {
  if (Array.isArray(value)) value = value[0];
  return String(value || '').split(',')[0].trim();
}

function requestUrl(req) {
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto']).toLowerCase();
  const socketProto = req.socket && req.socket.encrypted ? 'https' : 'http';
  const protocol = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : socketProto;
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  if (!host || /[\s\\]/.test(host)) throw new HttpError(400, 'Invalid Host header');
  let url;
  try { url = new URL(req.url || '/', `${protocol}://${host}`); }
  catch { throw new HttpError(400, 'Invalid request URL'); }
  if (url.username || url.password) throw new HttpError(400, 'Invalid request URL');
  return url;
}

function webHeaders(nodeHeaders) {
  const headers = new Headers();
  const hopByHop = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'expect', 'host', 'content-length'
  ]);
  for (const [name, rawValue] of Object.entries(nodeHeaders)) {
    if (rawValue == null || hopByHop.has(name.toLowerCase())) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) headers.append(name, String(value));
    } else {
      headers.set(name, String(rawValue));
    }
  }
  return headers;
}

async function readRequestBody(req, limit) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    req.resume();
    throw new HttpError(413, 'Request body too large');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return null;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      req.resume();
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

function safeRequestPath(req) {
  try { return new URL(req.url || '/', 'http://localhost').pathname; }
  catch { return '/'; }
}

function sendError(res, statusCode, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify({ ok: false, error: message });
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

async function writeWebResponse(nodeResponse, nodeResponseStream, requestMethod) {
  nodeResponseStream.statusCode = nodeResponse.status;
  for (const [name, value] of nodeResponse.headers) nodeResponseStream.setHeader(name, value);
  if (requestMethod === 'HEAD' || !nodeResponse.body) {
    nodeResponseStream.end();
    return;
  }
  await pipeline(Readable.fromWeb(nodeResponse.body), nodeResponseStream);
}

process.umask(0o027);
const runtime = createRuntime();
const { config, env, DB } = runtime;
const context = {
  waitUntil(promise) {
    Promise.resolve(promise).catch((error) => {
      console.error('[worker waitUntil] background task failed:', error?.message || error);
    });
  }
};

const server = createServer({ maxHeaderSize: 32 * 1024 }, async (req, res) => {
  let url;
  try { url = requestUrl(req); }
  catch (error) {
    return sendError(res, error.statusCode || 400, error.message || 'Bad request');
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/healthz') {
    try {
      const healthy = DB.healthCheck();
      const body = JSON.stringify({ ok: healthy, service: 'tiznetvpn', version: PACKAGE_VERSION });
      res.statusCode = healthy ? 200 : 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', Buffer.byteLength(body));
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return sendError(res, 503, 'Database unavailable');
    }
  }

  try {
    const body = await readRequestBody(req, config.maxRequestBytes);
    const request = new Request(url, {
      method: req.method,
      headers: webHeaders(req.headers),
      ...(body === null ? {} : { body })
    });
    const response = await APP.fetch(request, env, context);
    await writeWebResponse(response, res, req.method);
  } catch (error) {
    const status = error instanceof HttpError ? error.statusCode : 500;
    if (status >= 500) console.error(`[http] ${req.method} ${safeRequestPath(req)} failed:`, error?.message || error);
    if (status === 413) res.setHeader('Connection', 'close');
    sendError(res, status, status === 413 ? 'Request body too large' : status === 400 ? 'Bad request' : 'Internal server error');
  }
});

server.requestTimeout = 180_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;

server.listen(config.port, config.host, () => {
  console.log(`[server] TiznetVPN self-hosted app listening on http://${config.host}:${config.port}`);
  console.log(`[server] Mini App assets: ${config.publicDir}`);
  console.log(`[server] SQLite database: ${config.databasePath}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received; closing cleanly`);
  const closed = new Promise((resolveClose) => server.close(resolveClose));
  const deadline = new Promise((resolveDeadline) => {
    const timer = setTimeout(() => {
      try { server.closeAllConnections(); } catch { /* older Node releases */ }
      resolveDeadline();
    }, 25_000);
    timer.unref();
  });
  await Promise.race([closed, deadline]);
  try { DB.close(); } catch (error) { console.error('[server] SQLite close failed:', error?.message || error); }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
