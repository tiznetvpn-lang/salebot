import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { loadEnvFile } from './env-file.mjs';
import { SqliteKV } from './sqlite-kv.mjs';
import { createLocalAssets } from './assets.mjs';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function loadProjectEnvironment() {
  if (process.env.ENV_FILE) {
    loadEnvFile(process.env.ENV_FILE, { required: true });
  } else {
    loadEnvFile(join(PROJECT_ROOT, '.env'), { required: false });
  }
}

function required(name, source) {
  const value = String(source[name] ?? '').trim();
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

function normalizePublicBase(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  let url;
  try { url = new URL(input); }
  catch { throw new Error('PUBLIC_BASE_URL must be an HTTPS origin, for example https://bot.tiznet.site'); }
  if (url.protocol !== 'https:' || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must be a bare HTTPS origin, without a path, query, or credentials');
  }
  return url.origin;
}

function validateAdminIds(value) {
  const ids = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !/^\d{1,20}$/.test(id))) {
    throw new Error('ADMIN_IDS must be one or more numeric Telegram user IDs separated by commas');
  }
  return [...new Set(ids)].join(',');
}

function validateSecret(value) {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(value)) {
    throw new Error('WEBHOOK_SECRET must be 32–256 characters using only letters, digits, underscore, or hyphen');
  }
  return value;
}

export function createRuntime() {
  loadProjectEnvironment();
  const source = process.env;
  const botToken = required('BOT_TOKEN', source);
  const webhookSecret = validateSecret(required('WEBHOOK_SECRET', source));
  const adminIds = validateAdminIds(required('ADMIN_IDS', source));
  const publicBaseUrl = normalizePublicBase(source.PUBLIC_BASE_URL);

  let miniAppUrl = String(source.MINIAPP_URL || '').trim();
  if (!miniAppUrl && publicBaseUrl) miniAppUrl = `${publicBaseUrl}/miniapp`;
  if (miniAppUrl) {
    let parsed;
    try { parsed = new URL(miniAppUrl); }
    catch { throw new Error('MINIAPP_URL must be a valid HTTPS URL'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error('MINIAPP_URL must use HTTPS and must not contain credentials');
    }
    miniAppUrl = parsed.toString();
  }

  const dataDir = resolve(source.DATA_DIR || join(PROJECT_ROOT, 'data'));
  const databasePath = resolve(source.DB_PATH || join(dataDir, 'tiznetvpn.sqlite3'));
  const publicDir = resolve(source.PUBLIC_DIR || join(PROJECT_ROOT, 'public'));
  const host = String(source.HOST || '127.0.0.1').trim();
  const port = Number(source.PORT || 3000);
  const maxRequestBytes = Number(source.MAX_REQUEST_BYTES || 55 * 1024 * 1024);
  if (!host) throw new Error('HOST cannot be empty');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1024 * 1024) {
    throw new Error('MAX_REQUEST_BYTES must be at least 1 MiB');
  }

  const DB = new SqliteKV(databasePath);
  const ASSETS = createLocalAssets(publicDir);
  const env = {
    BOT_TOKEN: botToken,
    WEBHOOK_SECRET: webhookSecret,
    ADMIN_IDS: adminIds,
    MINIAPP_ONLY_MODE: String(source.MINIAPP_ONLY_MODE ?? 'true'),
    MINIAPP_URL: miniAppUrl,
    SHETAB_API_SECRET: String(source.SHETAB_API_SECRET || '').trim(),
    DB,
    ASSETS
  };

  return {
    config: { host, port, dataDir, databasePath, publicDir, maxRequestBytes, publicBaseUrl },
    env,
    DB
  };
}
