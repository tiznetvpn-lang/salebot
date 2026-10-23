import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function unquote(value) {
  const text = value.trim();
  if (text.length >= 2 && text[0] === text[text.length - 1] && (text[0] === '"' || text[0] === "'")) {
    const body = text.slice(1, -1);
    if (text[0] === '"') return body.replace(/\\([\\"nrt])/g, (_, char) => ({ '\\': '\\', '"': '"', n: '\n', r: '\r', t: '\t' })[char]);
    return body;
  }
  return text;
}

/** Load the simple KEY=value format also used by this project's systemd env file. */
export function loadEnvFile(filePath, { required = false } = {}) {
  if (!filePath) return false;
  const absolute = resolve(filePath);
  let contents;
  try {
    contents = readFileSync(absolute, 'utf8');
  } catch (error) {
    if (!required && error && error.code === 'ENOENT') return false;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = unquote(line.slice(separator + 1));
  }
  return true;
}
