import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteKV } from '../server/sqlite-kv.mjs';

const directory = mkdtempSync(join(tmpdir(), 'tiznetvpn-sqlite-test-'));
const filename = join(directory, 'test.sqlite3');
let kv;

try {
  kv = new SqliteKV(filename);
  await kv.put('user:100', JSON.stringify({ id: 100, name: 'test' }), { expirationTtl: 3600, metadata: { group: 'customer' } });
  await kv.put('user:101', JSON.stringify({ id: 101, name: 'second' }));
  await kv.put('order:1', JSON.stringify({ id: '1' }));

  assert.deepEqual(await kv.get('user:100', { type: 'json' }), { id: 100, name: 'test' });
  assert.equal(await kv.get('user:101'), JSON.stringify({ id: 101, name: 'second' }));
  assert.equal(kv.healthCheck(), true);

  const firstPage = await kv.list({ prefix: 'user:', limit: 1 });
  assert.equal(firstPage.keys.length, 1);
  assert.equal(firstPage.keys[0].name, 'user:100');
  assert.equal(firstPage.list_complete, false);
  assert.equal(firstPage.keys[0].metadata.group, 'customer');
  assert.ok(Number(firstPage.keys[0].expiration) > Math.floor(Date.now() / 1000));

  const secondPage = await kv.list({ prefix: 'user:', limit: 1, cursor: firstPage.cursor });
  assert.equal(secondPage.keys.length, 1);
  assert.equal(secondPage.keys[0].name, 'user:101');
  assert.equal(secondPage.list_complete, true);
  assert.equal(secondPage.cursor, undefined);

  await kv.put('expired:key', 'old', { expiration: Math.floor(Date.now() / 1000) - 1 });
  assert.equal(await kv.get('expired:key'), null);
  assert.equal((await kv.list({ prefix: 'expired:' })).keys.length, 0);

  await assert.rejects(() => kv.list({ cursor: 'not-a-valid-cursor!' }), /cursor/i);
  await kv.delete('user:101');
  assert.equal(await kv.get('user:101'), null);

  kv.close();
  kv = new SqliteKV(filename);
  assert.deepEqual(await kv.get('user:100', { type: 'json' }), { id: 100, name: 'test' });
  assert.equal((await kv.list({ prefix: 'order:' })).keys[0].name, 'order:1');

  console.log('✅ SQLite KV persistence, TTL, metadata, pagination and deletion tests passed.');
} finally {
  try { kv?.close(); } catch { /* test cleanup */ }
  rmSync(directory, { recursive: true, force: true });
}
