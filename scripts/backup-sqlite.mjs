#!/usr/bin/env node
import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sqlite from 'node:sqlite';
import { loadProjectEnvironment } from '../server/runtime.mjs';

const Database = sqlite.DatabaseSync ?? sqlite.Database;
if (typeof Database !== 'function') throw new Error('node:sqlite is unavailable; install Node.js 24.15+ or a current supported LTS release.');

loadProjectEnvironment();
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = resolve(process.env.DATA_DIR || join(root, 'data'));
const source = resolve(process.env.DB_PATH || join(dataDir, 'tiznetvpn.sqlite3'));
const backupDir = resolve(process.env.DB_BACKUP_DIR || '/var/backups/tiznetvpn');
const retentionDays = Math.min(365, Math.max(1, Number(process.env.DB_BACKUP_RETENTION_DAYS || 14)));

mkdirSync(dirname(source), { recursive: true, mode: 0o750 });
mkdirSync(backupDir, { recursive: true, mode: 0o700 });
try { chmodSync(backupDir, 0o700); } catch { /* permissions may be managed by the operator */ }

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDir, `tiznetvpn-${timestamp}.sqlite3`);
if (source === target) throw new Error('Backup path must differ from the live database');

let db;
try {
  db = new Database(source);
  db.exec('PRAGMA busy_timeout = 15000;');
  const escapedTarget = target.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedTarget}'`);
} finally {
  try { db?.close(); } catch { /* preserve the primary result */ }
}

chmodSync(target, 0o600);
const verifyDb = new Database(target);
try {
  const result = verifyDb.prepare('PRAGMA integrity_check').get();
  if (!result || String(result.integrity_check).toLowerCase() !== 'ok') throw new Error('SQLite backup integrity check failed');
} finally {
  verifyDb.close();
}

const cutoff = Date.now() - retentionDays * 86400 * 1000;
let removed = 0;
for (const name of readdirSync(backupDir)) {
  if (!/^tiznetvpn-.*\.sqlite3$/.test(name) || name === basename(target)) continue;
  const filename = join(backupDir, name);
  try {
    if (statSync(filename).mtimeMs < cutoff) {
      unlinkSync(filename);
      removed += 1;
    }
  } catch { /* ignore files concurrently removed or inaccessible */ }
}

console.log(`[db-backup] Snapshot created: ${target}`);
console.log(`[db-backup] Retention: ${retentionDays} days; old snapshots removed: ${removed}`);
