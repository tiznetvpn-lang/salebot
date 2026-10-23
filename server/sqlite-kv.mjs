import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as sqlite from 'node:sqlite';

const Database = sqlite.DatabaseSync ?? sqlite.Database;
const MAX_KEY_BYTES = 512;
const MAX_VALUE_BYTES = 25 * 1024 * 1024;
const MAX_LIST_LIMIT = 1000;

if (typeof Database !== 'function') {
  throw new Error('node:sqlite is unavailable. Install Node.js 24.15+ or a current supported Node.js LTS release.');
}

function prefixEnd(prefix) {
  const chars = Array.from(prefix);
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const codePoint = chars[i].codePointAt(0);
    if (codePoint < 0x10ffff) {
      chars[i] = String.fromCodePoint(codePoint + 1);
      return chars.slice(0, i + 1).join('');
    }
  }
  return null;
}

function encodeCursor(key) {
  return Buffer.from(key, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (cursor == null || cursor === '') return null;
  const text = String(cursor);
  let key;
  try {
    key = Buffer.from(text, 'base64url').toString('utf8');
  } catch {
    throw new TypeError('Invalid SQLite KV cursor');
  }
  if (!key || Buffer.from(key, 'utf8').toString('base64url') !== text) {
    throw new TypeError('Invalid SQLite KV cursor');
  }
  return key;
}

function normalizeKey(key) {
  const value = String(key);
  if (!value || Buffer.byteLength(value, 'utf8') > MAX_KEY_BYTES || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Invalid KV key');
  }
  return value;
}

function normalizeValue(value) {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  return JSON.stringify(value);
}

/**
 * Persistent Cloudflare-KV-compatible store backed by Node's built-in SQLite.
 * The worker only relies on get/put/delete/list; those methods are preserved here.
 */
export class SqliteKV {
  constructor(filename) {
    if (!filename || filename === ':memory:') {
      this.filename = filename || ':memory:';
    } else {
      this.filename = resolve(filename);
      mkdirSync(dirname(this.filename), { recursive: true, mode: 0o750 });
    }

    this.db = new Database(this.filename);
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (this.filename !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
      this.db.exec('PRAGMA synchronous = FULL;');
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY COLLATE BINARY,
        value TEXT NOT NULL,
        expiration INTEGER,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS kv_expiration_idx ON kv(expiration);
    `);

    this.selectStatement = this.db.prepare('SELECT value, expiration FROM kv WHERE key = ?');
    this.upsertStatement = this.db.prepare(`
      INSERT INTO kv (key, value, expiration, metadata)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        expiration = excluded.expiration,
        metadata = excluded.metadata
    `);
    this.deleteStatement = this.db.prepare('DELETE FROM kv WHERE key = ?');
    this.expiredStatement = this.db.prepare('DELETE FROM kv WHERE expiration IS NOT NULL AND expiration <= ?');
    this.pingStatement = this.db.prepare('SELECT 1 AS ok');

    if (this.filename !== ':memory:') {
      try { chmodSync(this.filename, 0o640); } catch { /* file may be created lazily by SQLite */ }
    }
  }

  async get(key, options = undefined) {
    const normalizedKey = normalizeKey(key);
    const row = this.selectStatement.get(normalizedKey);
    if (!row) return null;

    if (row.expiration != null && Number(row.expiration) <= Math.floor(Date.now() / 1000)) {
      this.deleteStatement.run(normalizedKey);
      return null;
    }

    const value = String(row.value);
    if (options && options.type === 'json') return JSON.parse(value);
    if (options && options.type === 'arrayBuffer') {
      const bytes = Buffer.from(value, 'utf8');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return value;
  }

  async put(key, value, options = undefined) {
    const normalizedKey = normalizeKey(key);
    const normalizedValue = normalizeValue(value);
    if (Buffer.byteLength(normalizedValue, 'utf8') > MAX_VALUE_BYTES) {
      throw new RangeError('KV value exceeds the 25 MiB limit');
    }

    let expiration = null;
    if (options && options.expiration != null) {
      expiration = Math.floor(Number(options.expiration));
      if (!Number.isFinite(expiration) || expiration <= 0) throw new TypeError('Invalid KV expiration');
    } else if (options && options.expirationTtl != null) {
      const ttl = Number(options.expirationTtl);
      if (!Number.isFinite(ttl)) throw new TypeError('Invalid KV expirationTtl');
      expiration = Math.floor(Date.now() / 1000 + ttl);
      if (expiration <= Math.floor(Date.now() / 1000)) {
        this.deleteStatement.run(normalizedKey);
        return;
      }
    }

    let metadata = null;
    if (options && options.metadata != null) metadata = JSON.stringify(options.metadata);
    this.upsertStatement.run(normalizedKey, normalizedValue, expiration, metadata);
  }

  async delete(key) {
    this.deleteStatement.run(normalizeKey(key));
  }

  async list(options = {}) {
    const prefix = options.prefix == null ? '' : String(options.prefix);
    const requestedLimit = Number(options.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(MAX_LIST_LIMIT, Math.floor(requestedLimit))
      : MAX_LIST_LIMIT;
    const cursorKey = decodeCursor(options.cursor);

    // Cloudflare KV does not return expired keys. Remove them opportunistically.
    this.expiredStatement.run(Math.floor(Date.now() / 1000));

    const clauses = [];
    const bindings = [];
    if (prefix) {
      const upper = prefixEnd(prefix);
      if (upper == null) {
        clauses.push('substr(key, 1, ?) = ?');
        bindings.push(Array.from(prefix).length, prefix);
      } else {
        clauses.push('key >= ? AND key < ?');
        bindings.push(prefix, upper);
      }
    }
    if (cursorKey != null) {
      clauses.push('key > ?');
      bindings.push(cursorKey);
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const rows = this.db.prepare(`
      SELECT key, expiration, metadata
      FROM kv ${where}
      ORDER BY key COLLATE BINARY
      LIMIT ?
    `).all(...bindings, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const keys = pageRows.map((row) => {
      const item = { name: String(row.key) };
      if (row.expiration != null) item.expiration = Number(row.expiration);
      if (row.metadata != null) {
        try { item.metadata = JSON.parse(String(row.metadata)); }
        catch { item.metadata = null; }
      }
      return item;
    });

    return {
      keys,
      list_complete: !hasMore,
      ...(hasMore && pageRows.length ? { cursor: encodeCursor(String(pageRows[pageRows.length - 1].key)) } : {})
    };
  }

  healthCheck() {
    return Number(this.pingStatement.get().ok) === 1;
  }

  close() {
    if (!this.db || !this.db.isOpen) return;
    if (this.filename !== ':memory:') {
      try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* close still needs to proceed */ }
    }
    this.db.close();
  }
}
