// تست یکپارچه‌سازی ربات با تلگرام و هیدیفایِ شبیه‌سازی‌شده
// اجرا: node test/run.mjs  (از ریشه پروژه)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, gunzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.join(here, '..', 'src', 'worker.js');
let src = fs.readFileSync(srcPath, 'utf8');
if (!src.includes('export default APP;')) throw new Error('export default APP not found');
const webhookScript = fs.readFileSync(path.join(here, '..', 'scripts', 'setup-webhook.mjs'), 'utf8');
if (!webhookScript.includes('drop_pending_updates: false') || src.includes('bot_token_head') || !src.includes('tiznetvpn-menu-button-ubuntu-v1')) throw new Error('Self-hosting safety changes are missing from src/worker.js or scripts/setup-webhook.mjs');
if (src.includes("'/setup'") || src.includes("'/diag'")) throw new Error('Legacy /setup and /diag routes must stay removed from src/worker.js');
const pkgVersion = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;
if (!src.includes("const VERSION = '" + pkgVersion + "';")) throw new Error('VERSION در src/worker.js با package.json یکی نیست');

// زمان‌بندی بکاپ خودکار KV: worker، اسکریپت cron و timer باید همه یک بازه داشته باشند،
// وگرنه اجرای دستی backup بی‌صدا به مسیر یادآوری می‌رود یا ارسال‌ها رد می‌شوند.
const workerSource = fs.readFileSync(srcPath, 'utf8');
const cronScriptSource = fs.readFileSync(path.join(here, '..', 'scripts', 'run-cron.mjs'), 'utf8');
const backupTimerUnit = fs.readFileSync(path.join(here, '..', 'systemd', 'tiznetvpn-backup.timer'), 'utf8');
const backupCronMatch = workerSource.match(/const KV_BACKUP_CRON = '([^']+)'/);
if (!backupCronMatch || backupCronMatch[1] !== '0 */3 * * *') throw new Error('KV_BACKUP_CRON باید هر ۳ ساعت باشد');
if (!cronScriptSource.includes("'0 */3 * * *'")) throw new Error('زمان‌بندی scripts/run-cron.mjs با KV_BACKUP_CRON یکی نیست');
if (!backupTimerUnit.includes('OnCalendar=*-*-* 00/3:00:00 UTC')) throw new Error('systemd timer بکاپ باید هر ۳ ساعت اجرا شود');
if (!workerSource.includes('KV_BACKUP_MIN_INTERVAL_MS') || workerSource.includes('11 * 60 * 60 * 1000')) throw new Error('فاصلهٔ ایمنی بکاپ با بازهٔ ۳ ساعته هماهنگ نیست');
src = src.replace('export default APP;', 'globalThis.APP = APP; globalThis.__subscriptionQrPng = subscriptionQrPng; globalThis.__createKvBackupFile = createKvBackupFile; globalThis.__adminNotifyOrder = adminNotifyOrder; globalThis.__applyCommission = applyCommission; globalThis.__hCreateUser = hCreateUser;');
// eslint-disable-next-line no-eval
eval(src);
const APP = globalThis.APP;

// ---------- موک KV ----------
class MockKV {
  constructor() { this.m = new Map(); this.meta = new Map(); }
  async get(k, opt) {
    const v = this.m.get(k);
    if (v === undefined) return null;
    if (opt && opt.type === 'json') return JSON.parse(v);
    return v;
  }
  async put(k, v, options) {
    this.m.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    if (options) {
      const meta = {};
      if (options.expiration != null) meta.expiration = Number(options.expiration);
      else if (options.expirationTtl != null) meta.expiration = Math.floor(Date.now() / 1000) + Number(options.expirationTtl);
      if (options.metadata != null) meta.metadata = options.metadata;
      if (Object.keys(meta).length) this.meta.set(k, meta); else this.meta.delete(k);
    } else this.meta.delete(k);
  }
  async delete(k) { this.m.delete(k); this.meta.delete(k); }
  async list({ prefix, cursor, limit } = {}) {
    const startsWith = prefix == null ? '' : String(prefix);
    const all = [...this.m.keys()].filter((k) => k.startsWith(startsWith)).sort();
    const size = Math.max(1, Number(limit) || 1000);
    const start = Math.max(0, Number(cursor) || 0);
    const names = all.slice(start, start + size);
    const complete = start + names.length >= all.length;
    return { keys: names.map((name) => Object.assign({ name }, this.meta.get(name) || {})), list_complete: complete, cursor: complete ? undefined : String(start + names.length) };
  }
}

// ---------- موک هیدیفای ----------
const hUsers = new Map(); // uuid -> user json
let hSeq = 1;
let hCreateFailStatus = 0; // تست رگرسیون: پاسخ مصنوعی خطا برای POST /user/
function hToday() { return new Date().toISOString().slice(0, 10); }
function mockHiddify(url, method, body, headers) {
  const u = new URL(url);
  const p = u.pathname; // /PROXY/api/v2/admin/...
  const api = p.slice(p.indexOf('/api/v2/admin'));
  if (api === '/api/v2/admin/me/' && method === 'GET') {
    if ((headers || {})['Hiddify-API-Key'] !== 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
      return { status: 401, json: { detail: {}, message: 'Unauthorized' } };
    return { status: 200, json: { name: 'TestAdmin', mode: 'super_admin', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } };
  }
  if (api === '/api/v2/admin/server_status/' && method === 'GET')
    return { status: 200, json: { cpu: 12, ram: 34 } };
  if (api === '/api/v2/admin/user/' && method === 'POST') {
    if (hCreateFailStatus === 422 && !String(body).includes('start_date')) { /* پنل قدیمی این فیلد را نمی‌شناسد */ }
    else if (hCreateFailStatus) return { status: hCreateFailStatus, json: { message: 'synthetic failure' } };
    const b = JSON.parse(body);
    const uuid = `11111111-2222-3333-4444-55555555555${hSeq++}`;
    const rec = {
      uuid, name: b.name, usage_limit_GB: b.usage_limit_GB, package_days: b.package_days,
      mode: b.mode || 'no_reset', telegram_id: b.telegram_id, comment: b.comment || '',
      enable: b.enable !== false, current_usage_GB: 0, start_date: b.start_date || hToday(),
      is_active: true, deleted: false
    };
    hUsers.set(uuid, rec);
    return { status: 200, json: rec };
  }
  if (api === '/api/v2/admin/user/' && method === 'GET')
    return { status: 200, json: [...hUsers.values()] };
  const m1 = api.match(/^\/api\/v2\/admin\/user\/([0-9a-f-]+)\/$/);
  if (m1) {
    const uuid = m1[1];
    if (method === 'GET') {
      const rec = hUsers.get(uuid);
      if (!rec) return { status: 404, json: { msg: 'User not found' } };
      return { status: 200, json: rec };
    }
    if (method === 'PATCH') {
      const rec = hUsers.get(uuid);
      if (!rec) return { status: 404, json: { msg: 'User not found' } };
      Object.assign(rec, JSON.parse(body));
      return { status: 200, json: rec };
    }
    if (method === 'DELETE') {
      hUsers.delete(uuid);
      return { status: 200, json: { status: 200, msg: 'ok' } };
    }
  }
  return { status: 404, json: { msg: 'no mock for ' + api } };
}

// ---------- موک fetch ----------
const TG = []; // لاگ متدهای تلگرام
let midSeq = 100;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.telegram.org/file/botTEST/')) return new Response(new Uint8Array([137,80,78,71,13,10,26,10]), { status: 200, headers: { 'Content-Type': 'image/png' } });
  if (u.startsWith('https://api.telegram.org/')) {
    const method = u.split('/').pop();
    let params = {};
    try {
      if (init.body && typeof init.body.entries === 'function') {
        for (const [k, v] of init.body.entries()) { params[k] = typeof v === 'string' ? v : '[file:' + (v && v.size || 0) + ']'; if (typeof v !== 'string' && v) { params[k + '_type'] = v.type || ''; params[k + '_name'] = v.name || ''; } }
      } else params = init.body ? JSON.parse(init.body) : {};
    } catch { params = { _raw: true }; }
    TG.push({ method, params });
    if (method === 'getMe') return Response.json({ ok: true, result: { username: 'TestShopBot' } });
    if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'photos/receipt.png' } });
    if (method === 'setWebhook') return Response.json({ ok: true, result: true });
    if (method === 'sendMessage' || method === 'sendDocument')
      return Response.json({ ok: true, result: { message_id: ++midSeq, chat: { id: params.chat_id } } });
    if (method === 'sendPhoto')
      return Response.json({ ok: true, result: { message_id: ++midSeq, chat: { id: params.chat_id }, photo: [{ file_id: 'TEST-RECEIPT-FILE', width: 400, height: 300 }] } });
    if (method === 'answerCallbackQuery' || method === 'editMessageText')
      return Response.json({ ok: true, result: true });
    return Response.json({ ok: true, result: true });
  }
  if (u.startsWith('https://panel.test/')) {
    // لینک یوزر / all-configs
    if (u.includes('/all-configs/')) return new Response('vless://fake-config-line-aaaaaaaaaaaaaaaaaaaaaaaa\nvless://fake-config-line-bbbbbbbbbbbbbbbbbbbbbbbb\nvless://fake-config-line-cccccccccccccccccccccccc\n', { status: 200 });
    const r = mockHiddify(u, init.method || 'GET', init.body, init.headers || {});
    return Response.json(r.json, { status: r.status });
  }
  throw new Error('unexpected fetch: ' + u);
};

const kv = new MockKV();
const env = { BOT_TOKEN: 'TEST', ADMIN_IDS: '999', WEBHOOK_SECRET: 's3cret', SHETAB_API_SECRET: 'shetab-test-secret', MINIAPP_ONLY_MODE: 'false', DB: kv, ASSETS: { fetch: async (request) => new URL(request.url).pathname === '/miniapp.html' ? new Response('<!doctype html><title>TiznetVPN Mini App</title>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : new Response('not found', { status: 404 }) } };
const ADMIN = 999, U1 = 100, U2 = 101, U3 = 102, U4 = 103, U5 = 104, U6 = 105, U7 = 106, U8 = 107, U9 = 108, U10 = 109, U11 = 110, U12 = 111, U13 = 112;
let qSeq = 1;

async function get(path) {
  const r = await APP.fetch(new Request('https://t.test' + path), env, {});
  return { status: r.status, text: await r.text() };
}
async function signedInitData(tgid, userExtra = {}, ageSeconds = 0) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000) - ageSeconds));
  params.set('query_id', 'AAE-test-query');
  params.set('user', JSON.stringify(Object.assign({ id: Number(tgid), first_name: 'User' + tgid, username: 'u' + tgid }, userExtra)));
  const check = [...params.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([k,v]) => k + '=' + v).join('\n');
  const enc = new TextEncoder();
  const hmac = async (key, data) => {
    const raw = key instanceof Uint8Array ? key : enc.encode(String(key));
    const ck = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', ck, enc.encode(String(data))));
  };
  // Telegram specifies HMAC-SHA256(key="WebAppData", data=bot_token).
  const secret = await hmac('WebAppData', 'TEST');
  const hash = [...await hmac(secret, check)].map(x => x.toString(16).padStart(2, '0')).join('');
  params.set('hash', hash);
  return params.toString();
}
async function miniApi(path, initData, options = {}) {
  const headers = Object.assign({}, options.headers || {}, initData ? { 'X-Telegram-Init-Data': initData } : {});
  const requestOptions = Object.assign({}, options, { headers });
  const r = await APP.fetch(new Request('https://t.test' + path, requestOptions), env, {});
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, text, json };
}
async function shetabPostAt(route, payload, token = 'shetab-test-secret', contentType = 'application/json') {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return await APP.fetch(new Request('https://t.test' + route, {
    method: 'POST', headers: { 'Content-Type': contentType, Authorization: token }, body
  }), env, {});
}
async function shetabPost(payload, token = 'shetab-test-secret', contentType = 'application/json') {
  return shetabPostAt('/wp-json/webdide-cv/v1/confirm', payload, token, contentType);
}
async function upd(body) {
  const r = await APP.fetch(new Request('https://t.test/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 's3cret' },
    body: JSON.stringify(body)
  }), env, {});
  if (r.status !== 200) throw new Error('webhook status ' + r.status);
}
async function sendText(tgid, text) {
  await upd({ message: { message_id: ++midSeq, chat: { id: tgid, type: 'private' }, from: { id: tgid, first_name: 'U' + tgid, username: 'u' + tgid }, text } });
}
async function press(tgid, data) {
  await upd({ callback_query: { id: 'q' + (qSeq++), from: { id: tgid, first_name: 'U' + tgid, username: 'u' + tgid }, message: { message_id: 50, chat: { id: tgid, type: 'private' } }, data } });
}
function lastMsgTo(tgid, method = 'sendMessage') {
  const f = TG.filter((x) => x.method === method && String(x.params.chat_id) === String(tgid));
  return f[f.length - 1];
}
function assert(cond, name, extra) {
  if (cond) console.log('  ✅ ' + name);
  else { console.error('  ❌ ' + name + (extra ? ' — ' + extra : '')); process.exitCode = 1; }
}
async function kvJson(k) { return kv.get(k, { type: 'json' }); }
async function gzipText(text) { return await new Response(new Blob([String(text)]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); }
async function restoreRequest(targetEnv, initData, file, confirm = 'RESTORE') {
  const form = new FormData();
  form.append('file', file, 'tiznetvpn-kv-backup.json.gz');
  form.append('confirm', confirm);
  return await APP.fetch(new Request('https://t.test/api/miniapp/admin/restore', { method: 'POST', headers: { 'X-Telegram-Init-Data': initData }, body: form }), targetEnv, {});
}

// ================= تست‌ها =================
console.log('— TiznetVPN Shop Bot integration test —');
const miniAppSource = fs.readFileSync(path.join(here, '..', 'public', 'miniapp.html'), 'utf8');
assert(miniAppSource.includes('const remain=s.days_remaining') && miniAppSource.includes('${esc(remain)}') && !miniAppSource.includes('${esc(rem)}'), 'قالب اشتراک مشتری متغیر روزهای باقی‌مانده را بدون ReferenceError نشان می‌دهد');
const yekanLicense = fs.readFileSync(path.join(here, '..', 'public', 'assets', 'Yekan-OFL.txt'), 'utf8');
assert(miniAppSource.includes('--bg:#04152e') && miniAppSource.includes('--brand-blue:#00409a') && miniAppSource.includes("'Yekan',Vazirmatn") && miniAppSource.includes('/assets/Yekan.woff2') && fs.statSync(path.join(here, '..', 'public', 'assets', 'Yekan.woff2')).size > 10000 && yekanLicense.includes('SIL Open Font License, Version 1.1') && miniAppSource.includes('/assets/Vazirmatn-Arabic.woff2') && miniAppSource.includes('/assets/Vazirmatn-Latin.woff2'), 'فونت جایگزین Yekan با فایل و مجوز OFL 1.1 محلی جاسازی شده و Vazirmatn fallback آن است');
assert(!miniAppSource.includes('#87182f') && !miniAppSource.includes('#ff343d') && !miniAppSource.includes('--ruby-') && miniAppSource.includes('subscription-delivery-card') && miniAppSource.includes('cv-plan-foot'), 'رنگ‌های برند قدیمی از Mini App پاک شده‌اند؛ پالت آبی و کارت فروش جدید حفظ شده است');
assert(!miniAppSource.includes('id="menuToggle"') && !miniAppSource.includes('id="notifyBtn"') && miniAppSource.includes('id="mobileNav"') && miniAppSource.includes('id="accountTrigger"'), 'دکمهٔ همبرگری و زنگ حذف شده‌اند؛ ناوبری پایین و جزئیات حساب حفظ شده‌اند');
assert(miniAppSource.includes('data-dashboard-drill="revenue"') && miniAppSource.includes('data-drill-method') && miniAppSource.includes('data-drill-plan') && miniAppSource.includes('clearDashboardDrill'), 'مدیر می‌تواند از KPIها، روش پرداخت و پلن‌ها به فهرست جزئیات drill-down کند');
assert(miniAppSource.includes('customerTransactionsList') && miniAppSource.includes('data-subscription-delete') && miniAppSource.includes('data-upgrade-sub') && miniAppSource.includes('data-upgrade-plan') && miniAppSource.includes("mode==='upgrade'") && miniAppSource.includes('مبلغ کامل پلن جدید') && miniAppSource.includes('کپی مبلغ ریالی'), 'نمای مشتری سابقهٔ تراکنش، حذف امن، انتخاب پلن جدید با قیمت کامل و کپی مبلغ ریالی دارد');
assert(miniAppSource.includes('id="settingsForm"') && miniAppSource.includes('id="serversPage"') && !miniAppSource.includes('id="withdrawalsPage"') && !miniAppSource.includes('data-page="withdrawals"') && miniAppSource.includes('data-order-admin-action'), 'رابط مدیریت تنظیمات، سرورها و سفارش‌ها را دارد و صفحهٔ برداشت از UI حذف شده است');
assert(!miniAppSource.includes('هویت رسمی TiznetVPN') && miniAppSource.includes('brand-mark') && miniAppSource.includes('data:image/png;base64,'), 'کارت هویت رسمی از تنظیمات حذف شده اما لوگوی TiznetVPN در پوسته حفظ شده است');
assert(!miniAppSource.includes('.customer-mode #roleToggle { display:none'), 'تغییر به نمای مشتری، کلید بازگشت ادمین را پنهان نمی‌کند');
assert(miniAppSource.includes('.table-wrap tbody tr { display:grid') && miniAppSource.includes('customer-detail-grid') && miniAppSource.includes('data-order-recheck'), 'رابط موبایل جدول‌ها را به کارت تبدیل می‌کند و جزئیات مشتری/وضعیت سفارش را بدون هم‌پوشانی نشان می‌دهد');
assert(miniAppSource.includes('showAdminActionStatus') && miniAppSource.includes('Worker نتوانست عملیات سفارش را تکمیل کند') && miniAppSource.includes('پرداخت دوباره را توصیه نکنید'), 'خطای تأیید با جزئیات Worker در صفحه نمایش داده می‌شود و وضعیت نامعلوم به تلاش کورکورانه تبدیل نمی‌شود');
assert(miniAppSource.includes('approve_manual') && miniAppSource.includes('manualPaymentReceivedConfirm') && miniAppSource.includes('manual_approval_available') && miniAppSource.includes('واریز را مستقل از تصویر رسید'), 'تأیید دستی سفارش از رابط ادمین با تأیید دریافت واقعی وجه و محدودیت Worker انجام می‌شود');
assert(miniAppSource.includes('subscriptionQrMarkup') && miniAppSource.includes('/api/miniapp/subscriptions/') && miniAppSource.includes('data-copy-text=') && miniAppSource.includes('subscription-qr-frame') && miniAppSource.includes('cv-quick-tile'), 'رابط فروش شامل کارت‌های مدرن آبی و نمای نتیجهٔ QR/کپی لینک است؛ QR از Worker امن واکشی می‌شود');
const qrLicense = fs.readFileSync(path.join(here, '..', 'src', 'vendor', 'QRCODE-MIT.txt'), 'utf8');
assert(src.includes('subscriptionQrPng') && qrLicense.includes('MIT License') && src.includes('QR Code Generator for JavaScript') && !fs.existsSync(path.join(here, '..', 'src', 'vendor', 'qrcode-generator.js')), 'کتابخانهٔ QR فقط یک نسخه (جاسازی‌شده در Worker) با مجوز MIT دارد');
const testQrUrl = 'https://subscription.example.test/abcdefghijklmnop';
const testQrPng = await globalThis.__subscriptionQrPng(testQrUrl);
let qrCursor = 8, qrWidth = 0, qrIdat = [];
while (qrCursor + 12 <= testQrPng.length) {
  const chunkLength = new DataView(testQrPng.buffer, testQrPng.byteOffset + qrCursor, 4).getUint32(0);
  const type = new TextDecoder().decode(testQrPng.subarray(qrCursor + 4, qrCursor + 8));
  const payload = testQrPng.subarray(qrCursor + 8, qrCursor + 8 + chunkLength);
  if (type === 'IHDR') qrWidth = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
  if (type === 'IDAT') qrIdat.push(payload);
  qrCursor += 12 + chunkLength;
  if (type === 'IEND') break;
}
const qrCompressed = new Uint8Array(qrIdat.reduce((n, x) => n + x.length, 0));
let qrIdatOffset = 0; for (const chunk of qrIdat) { qrCompressed.set(chunk, qrIdatOffset); qrIdatOffset += chunk.length; }
const qrPixels = inflateSync(qrCompressed);
assert(testQrPng.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10' && qrWidth >= 200 && qrPixels.length === (qrWidth + 1) * qrWidth && qrPixels.some((x, i) => i % (qrWidth + 1) !== 0 && x === 0), 'PNG تولیدشده برای QR دارای هدر معتبر، ماتریس قابل‌خواندن و پیکسل‌های QR است');

let r = await get('/');
assert(r.status === 200 && r.text.includes('Tiznet'), 'GET / سلامت برند تیزنت را نشان می‌دهد');
const shetabHealth = await get('/wp-json/webdide-cv/v1/confirm');
const powerPsShetabHealth = await get('/api/shetab-verify/');
const shetabHealthWrongKey = await APP.fetch(new Request('https://t.test/api/shetab-verify', { headers: { Authorization: 'Bearer wrong-key' } }), env, {});
const shetabHealthBlankKey = await APP.fetch(new Request('https://t.test/api/shetab-verify', { headers: { Authorization: 'Bearer' } }), env, {});
const shetabUnconfiguredEnv = Object.assign({}, env, { SHETAB_API_SECRET: '' });
const shetabHealthUnconfigured = await APP.fetch(new Request('https://t.test/api/shetab-verify'), shetabUnconfiguredEnv, {});
assert(shetabHealth.status === 200 && JSON.parse(shetabHealth.text).success === true && powerPsShetabHealth.status === 200 && JSON.parse(powerPsShetabHealth.text).success === true && shetabHealthWrongKey.status === 401 && shetabHealthBlankKey.status === 401 && shetabHealthUnconfigured.status === 503, 'تست اتصال GET روی هر دو مسیر Shetab پاسخ درست می‌دهد؛ کلید اشتباه و secret پیکربندی‌نشده هم آشکارا رد می‌شوند');
const miniAsset = await get('/miniapp');
assert(miniAsset.status === 200 && miniAsset.text.includes('TiznetVPN Mini App'), 'GET /miniapp فایل Mini App را از binding دارایی Worker می‌خواند');
const noInitData = await miniApi('/api/miniapp/bootstrap');
assert(noInitData.status === 401, 'API مینی‌اپ بدون initData تلگرام را رد می‌کند');
const badInitData = await signedInitData(U1);
const badApi = await miniApi('/api/miniapp/bootstrap', badInitData + '&tampered=1');
assert(badApi.status === 401, 'API مینی‌اپ دست‌کاری initData را رد می‌کند');

await sendText(U1, '/start');
assert((lastMsgTo(U1) || {}).params && lastMsgTo(U1).params.text.includes('تیزنت VPN | TiznetVPN'), '/start صفحهٔ اصلی برند تیزنت را نشان می‌دهد');
const homeMarkup = lastMsgTo(U1).params.reply_markup.inline_keyboard;
assert(homeMarkup.some(row => row.some(button => button.web_app && button.web_app.url === 'https://t.test/miniapp' && button.text === 'ورود به اپ')), 'منوی ربات دکمهٔ Web App «ورود به اپ» با URL همین Worker دارد');
const privateMenuButton = TG.find(x => x.method === 'setChatMenuButton' && String(x.params.chat_id) === String(U1));
assert(privateMenuButton && privateMenuButton.params.menu_button.type === 'web_app' && privateMenuButton.params.menu_button.text === 'tiznet' && privateMenuButton.params.menu_button.web_app.url === 'https://t.test/miniapp' && (await kvJson('u:' + U1)).miniapp_menu_set_version === 'tiznetvpn-menu-button-ubuntu-v1', 'MenuButtonWebApp عنوان دقیق tiznet با حروف کوچک دارد و نسخهٔ برچسب به‌روزرسانی می‌شود');
assert(homeMarkup.some(row => row.some(button => button.web_app && button.text === 'ورود به اپ')), 'دکمهٔ Web App در پیام چت هم عنوان «ورود به اپ» دارد');
await upd({ callback_query: { id: 'q' + (qSeq++), from: { id: U7, first_name: 'GroupUser' }, message: { message_id: 77, chat: { id: -10001, type: 'group' } }, data: 'home' } });
const groupHome = TG.filter(x => x.method === 'editMessageText' && String(x.params.chat_id) === '-10001').at(-1);
const groupMarkup = groupHome && groupHome.params.reply_markup && groupHome.params.reply_markup.inline_keyboard || [];
assert(groupHome && !groupMarkup.some(row => row.some(button => button.web_app)), 'در گروه، دکمهٔ Web App خصوصی ارسال نمی‌شود تا Telegram درخواست را رد نکند');
const u1a = await kvJson('u:' + U1);
assert(u1a && u1a.ref_code, 'کاربر جدید با کد معرف ساخته شد');

await sendText(U2, '/start ref_' + u1a.ref_code);
const u2a = await kvJson('u:' + U2);
assert(u2a && u2a.referred_by === U1 && u2a.referral_join_eligible && u2a.referral_join_rewarded, 'لینک معرف برای عضو تازه به‌صورت یک‌باره ثبت و پاداش عضویت علامت‌گذاری شد');
const u1AfterFirstInvite = await kvJson('u:' + U1);
await sendText(U2, '/start ref_' + u1a.ref_code);
assert((await kvJson('u:' + U1)).referral_join_count === 1 && (await kvJson('u:' + U1)).referral_points_balance === 5 && (await kvJson('u:' + U2)).referred_by === U1, 'بازکردن دوبارهٔ همان لینک نه امتیاز عضویت می‌دهد و نه معرف را عوض می‌کند');
for (const invitedId of [U9, U10, U11]) await sendText(invitedId, '/start ref_' + u2a.ref_code);
const u2AfterInvites = await kvJson('u:' + U2);
assert(u2AfterInvites.referral_join_count === 3 && u2AfterInvites.referral_points_balance === 15 && !u2AfterInvites.referral_free_rewards_claimed, 'سه عضو تازه برای U2 ثبت شده‌اند؛ هدیهٔ دعوت تا انتخاب پنل مدیر حفظ می‌شود');

// حالت Mini App-only: /start با ورود به اپ و شش گزینهٔ ثابت؛ callback قدیمی خنثی می‌ماند.
env.MINIAPP_ONLY_MODE = 'true';
const miniOnlyStartIndex = TG.length;
await sendText(U5, '/start ref_' + u1a.ref_code);
const miniOnlyStartMessages = TG.slice(miniOnlyStartIndex).filter(x => x.method === 'sendMessage' && String(x.params.chat_id) === String(U5));
const miniOnlyEntry = miniOnlyStartMessages[0];
const miniOnlyKeyboardMessage = miniOnlyStartMessages[1];
const miniOnlyCommands = TG.filter(x => x.method === 'setMyCommands').at(-1);
const miniOnlyMenu = TG.find(x => x.method === 'setChatMenuButton' && String(x.params.chat_id) === String(U5));
const exactRobotButtons = ['خرید اشتراک','پشتیبانی','اشتراک رایگان','راهنما','اطلاعات حساب','دریافت نمایندگی'];
const replyTexts = miniOnlyKeyboardMessage?.params.reply_markup?.keyboard?.flat().map(x => x.text) || [];
assert(miniOnlyEntry && miniOnlyEntry.params.text === 'جهت خرید وارد اپ فروش شوید.' && miniOnlyEntry.params.reply_markup?.inline_keyboard?.flat().some(x => x.text === 'ورود به اپ' && x.web_app?.url === 'https://t.test/miniapp') && miniOnlyKeyboardMessage?.params.reply_markup?.keyboard && JSON.stringify(replyTexts) === JSON.stringify(exactRobotButtons), '/start در Mini App-only پیام ورود به اپ و در پیام جداگانه دقیقاً شش reply button مجاز را نشان می‌دهد');
assert(miniOnlyMenu && miniOnlyMenu.params.menu_button.text === 'tiznet' && miniOnlyCommands && miniOnlyCommands.params.commands.length === 1 && miniOnlyCommands.params.commands[0].command === 'start', 'در حالت Mini App-only Menu Button دقیقاً tiznet است و فهرست دستورها به /start محدود می‌شود');
assert((await kvJson('u:' + U5)).referred_by === U1, 'خاموش‌بودن منوی legacy انتساب لینک معرف را حفظ می‌کند');
await sendText(U4, '/start ref_' + u1a.ref_code);
const u1AfterThirdInvite = await kvJson('u:' + U1);
assert(u1AfterThirdInvite.referral_join_count === 3 && u1AfterThirdInvite.referral_points_balance === 15 && Math.floor(u1AfterThirdInvite.referral_join_count / 3) - (u1AfterThirdInvite.referral_free_rewards_claimed || 0) === 1, 'هر سه عضو یکتای دعوت، پنج امتیاز می‌دهند و یک هدیهٔ ۳ گیگ/۳ روز را مستقل از سیاست عمومی آزاد می‌کنند');
await press(U5, 'buy');
assert(lastMsgTo(U5).params.text === 'جهت خرید وارد اپ فروش شوید.' && !lastMsgTo(U5).params.reply_markup, 'callback دکمهٔ قدیمی خرید اجرا نمی‌شود و کیبورد تازه نمی‌سازد');
assert(TG.some(x => x.method === 'editMessageReplyMarkup' && String(x.params.chat_id) === String(U5) && x.params.reply_markup?.inline_keyboard?.length === 0), 'با لمس دکمهٔ legacy، همان کیبورد قدیمی هم از پیام حذف می‌شود');
env.MINIAPP_ONLY_MODE = 'false';
await sendText(U5, '/start');
const restoredCommands = TG.filter(x => x.method === 'setMyCommands').at(-1);
assert(restoredCommands && restoredCommands.params.commands.some(x => x.command === 'admin') && lastMsgTo(U5).params.reply_markup, 'با خاموش‌کردن flag، فرمان‌ها و منوی legacy دوباره فعال می‌شوند');

// ادمین: افزودن پنل
await sendText(ADMIN, '/admin');
assert(lastMsgTo(ADMIN).params.text.includes('پنل مدیریت'), '/admin برای ادمین باز شد');
await press(ADMIN, 'a_pa_add');
await sendText(ADMIN, 'آلمان - سرور ۱');
await sendText(ADMIN, 'https://panel.test/PROXY123');
await sendText(ADMIN, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
await sendText(ADMIN, 'https://panel.test/USERPATH');
const panels = await kvJson('panels');
const pid = Object.keys(panels)[0];
assert(pid && panels[pid].name.includes('آلمان'), 'پنل با تست اتصال موفق اضافه شد');
assert(TG.some((x) => x.method === 'sendMessage' && (x.params.text || '').includes('اتصال به پنل تأیید شد')), 'تأیید اتصال بلافاصله بعد از کلید');
assert(lastMsgTo(ADMIN).params.text.includes('پنل اضافه شد'), 'پیام نهایی اضافه شدن پنل');

// ادمین: افزودن پلن
await press(ADMIN, 'a_pla_add');
await sendText(ADMIN, 'یک‌ماهه ۵۰ گیگ');
await sendText(ADMIN, '50');
await sendText(ADMIN, '30');
await sendText(ADMIN, '120000');
await sendText(ADMIN, 'all');
const plans = await kvJson('plans');
const plid = Object.keys(plans)[0];
assert(plid && plans[plid].price === 120000, 'پلن ساخته شد');

// افزودن پنل دوم با ورودی کثیف: کاراکتر نامرئی + لینک کامل یوزر با uuid + متن اضافه
await press(ADMIN, 'a_pa_add');
await sendText(ADMIN, 'فرانسه - سرور ۲');
await sendText(ADMIN, '‏https://panel.test/PROXY456‏');
await sendText(ADMIN, '‎aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee‎');
await sendText(ADMIN, 'لینک یوزر اینه: https://panel.test/USERPATH2/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/ ممنون');
const panels2 = await kvJson('panels');
const p2 = Object.values(panels2).find((p) => p.name.includes('فرانسه'));
assert(p2 && p2.user_base === 'https://panel.test/USERPATH2' && p2.api_base === 'https://panel.test/PROXY456', 'تمیزسازی خودکار ورودی پنل کار کرد');

// افزودن پنل سوم با آدرس بدون https
await press(ADMIN, 'a_pa_add');
await sendText(ADMIN, 'هلند - سرور ۳');
await sendText(ADMIN, 'panel.test/PROXY789');
await sendText(ADMIN, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
await sendText(ADMIN, 'panel.test/USERPATH3');
const panels3 = await kvJson('panels');
const p3 = Object.values(panels3).find((p) => p.name.includes('هلند'));
assert(p3 && p3.api_base === 'https://panel.test/PROXY789' && p3.user_base === 'https://panel.test/USERPATH3', 'تکمیل خودکار https کار کرد');

// ویزارد با کلید اشتباه: باید همان‌جا خطای واضح بدهد
await press(ADMIN, 'a_pa_add');
await sendText(ADMIN, 'ایتالیا - سرور ۴');
await sendText(ADMIN, 'https://panel.test/PROXY000');
await sendText(ADMIN, 'bbbbbbbb-1111-2222-3333-444444444444');
assert(lastMsgTo(ADMIN).params.text.includes('کلید API اشتباه'), 'خطای 401 کلید، واضح گزارش شد');
await sendText(ADMIN, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
await sendText(ADMIN, 'https://panel.test/USERPATH4');
const panels4 = await kvJson('panels');
assert(Object.values(panels4).some((p) => p.name.includes('ایتالیا')), 'بعد از اصلاح کلید، پنل اضافه شد');

// ادمین: ثبت کارت
await press(ADMIN, 'a_card_num');
await sendText(ADMIN, '6037991122334455');
await press(ADMIN, 'a_card_hold');
await sendText(ADMIN, 'علی تست');
const cfg1 = await kvJson('cfg');
assert(cfg1.card_number === '6037991122334455', 'شماره کارت ذخیره شد');

// تنظیمات روش‌های پرداخت کارت‌به‌کارت
await press(ADMIN, 'a_set');
assert(lastMsgTo(ADMIN, 'editMessageText').params.text.includes('کارت‌به‌کارت دستی: روشن') && lastMsgTo(ADMIN, 'editMessageText').params.text.includes('کارت‌به‌کارت خودکار: خاموش'), 'تنظیمات وضعیت پیش‌فرض هر دو روش را نشان می‌دهد');
await press(ADMIN, 's_pay_manual');
assert((await kvJson('cfg')).card_manual_enabled === false, 'ادمین کارت‌به‌کارت دستی را خاموش کرد');
await press(U1, 'buy');
await press(U1, 'bp:' + pid);
await press(U1, `bl:${pid}:${plid}`);
assert(!JSON.stringify(lastMsgTo(U1, 'editMessageText').params.reply_markup).includes('payc:'), 'روش دستی خاموش از صفحه پرداخت مخفی شد');
await press(U1, `payc:${pid}:${plid}`);
assert(lastMsgTo(U1).params.text.includes('غیرفعال شده'), 'callback قدیمی روش دستی خاموش را نمی‌تواند اجرا کند');
await press(ADMIN, 'a_set');
await press(ADMIN, 's_pay_manual');
assert((await kvJson('cfg')).card_manual_enabled === true, 'ادمین کارت‌به‌کارت دستی را دوباره روشن کرد');

// کاربر: خرید با کارت + رسید متنی
await press(U1, 'buy');
await press(U1, 'bp:' + pid);
await press(U1, `bl:${pid}:${plid}`);
await press(U1, `payc:${pid}:${plid}`);
assert(lastMsgTo(U1).params.text.includes('6037991122334455'), 'شماره کارت به خریدار نمایش داده شد');
await sendText(U1, 'رسید ۱۲۳۴۵۶');
const pend = await kvJson('pend');
assert(pend.length === 1, 'سفارش در انتظار ثبت شد');
const oid = pend[0];
assert(lastMsgTo(ADMIN).params.text.includes('سفارش جدید'), 'ادمین از سفارش جدید باخبر شد');

// ادمین: تأیید سفارش → ساخت در پنل
const approvalEditStart = TG.length;
await press(ADMIN, 'a_ok:' + oid);
const approvalEditCalls = TG.slice(approvalEditStart).filter(x => x.method === 'editMessageText');
assert(approvalEditCalls.some(x => String(x.params.text || '').includes('\n🧾 شماره:') && !String(x.params.text || '').includes('\\n🧾 شماره:')) && approvalEditCalls.some(x => String(x.params.text || '').includes('✅') && String(x.params.reply_markup?.inline_keyboard?.length || 0) === '0'), 'تأیید کلاسیک نتیجه را در همان پیام مدیریت با خط‌شکنی واقعی نشان می‌دهد');
const o1 = await kvJson('o:' + oid);
assert(o1.status === 'approved' && o1.sub_sid, 'سفارش تأیید شد');
const manualSaleLedger = await kvJson('ledger:sale:' + oid);
assert(manualSaleLedger && manualSaleLedger.type === 'buy' && manualSaleLedger.payment_method === 'manual' && manualSaleLedger.amount === 120000, 'خرید دستی در دفتر فروش ثبت شد');
assert(hUsers.size === 1, 'یوزر در هیدیفای ساخته شد');
const dlv = TG.filter(x => x.method === 'sendPhoto' && String(x.params.chat_id) === String(U1) && x.params.photo_name === 'tiznetvpn-subscription-qr.png').at(-1);
assert(dlv && dlv.params.photo_type === 'image/png' && dlv.params.photo !== '[file:0]' && dlv.params.caption.includes('فعال شد') && dlv.params.caption.includes('panel.test'), 'پیام تحویل ربات شامل PNG محلی QR و کپشن دارای لینک اشتراک است');
const sid = o1.sub_sid;

// اشتراک‌های من + جزئیات زنده
await press(U1, 'mysubs');
await press(U1, 'sub:' + sid);
const det = lastMsgTo(U1, 'editMessageText') || { params: {} };
const detText = det.params.text || '';
assert(detText.includes('جزئیات اشتراک') && detText.includes('مصرف'), 'جزئیات اشتراک با مصرف نمایش داده شد');

// دریافت کانفیگ‌ها
await press(U1, 'cfg:' + sid);
assert(TG.some((x) => x.method === 'sendDocument'), 'فایل کانفیگ‌ها ارسال شد');

// خرید فوری با کیف پول
let u1 = await kvJson('u:' + U1);
u1.balance = 500000;
await kv.put('u:' + U1, JSON.stringify(u1));
await press(U1, `payw:${pid}:${plid}`);
u1 = await kvJson('u:' + U1);
assert(hUsers.size === 2 && u1.balance === 380000, 'خرید با کیف پول انجام و کسر شد');
let salesLedgerKeys = (await kv.list({ prefix: 'ledger:sale:' })).keys;
let salesLedgerRows = await Promise.all(salesLedgerKeys.map((k) => kvJson(k.name)));
assert(salesLedgerRows.some((x) => x && x.tg_id === String(U1) && x.type === 'buy' && x.payment_method === 'wallet'), 'خرید کیف‌پولی در دفتر فروش ثبت شد');

// تمدید با کیف پول
await press(U1, 'rnw:' + sid);
await press(U1, `rp:${sid}:${plid}`);
await press(U1, `rpayw:${sid}:${plid}`);
u1 = await kvJson('u:' + U1);
assert(u1.balance === 260000, 'تمدید با کیف پول انجام شد');
salesLedgerKeys = (await kv.list({ prefix: 'ledger:sale:' })).keys;
salesLedgerRows = await Promise.all(salesLedgerKeys.map((k) => kvJson(k.name)));
assert(salesLedgerRows.some((x) => x && x.tg_id === String(U1) && x.type === 'renew' && x.payment_method === 'wallet'), 'تمدید کیف‌پولی در دفتر فروش ثبت شد');

// شارژ کیف پول با رسید
await press(U1, 'chg:50000');
await sendText(U1, 'پیگیری ۹۹۹');
const pend2 = await kvJson('pend');
const coid = pend2[pend2.length - 1];
await press(ADMIN, 'a_ok:' + coid);
u1 = await kvJson('u:' + U1);
assert(u1.balance === 310000, 'شارژ کیف پول تأیید و اضافه شد');
const topupLedger = await kvJson('ledger:wallet_topup:' + coid);
assert(topupLedger && topupLedger.amount === 50000 && topupLedger.tg_id === String(U1), 'واریز کیف پول جدا از درآمد فروش ثبت شد');

// پورسانت معرف: کاربر دوم (معرفی‌شده) خرید می‌کند
let u2 = await kvJson('u:' + U2);
u2.balance = 200000;
await kv.put('u:' + U2, JSON.stringify(u2));
await press(U2, `payw:${pid}:${plid}`);
salesLedgerKeys = (await kv.list({ prefix: 'ledger:sale:' })).keys;
salesLedgerRows = await Promise.all(salesLedgerKeys.map((k) => kvJson(k.name)));
u1 = await kvJson('u:' + U1);
assert(u1.balance === 310000 + 12000, 'پورسانت ۱۰٪ به معرف اضافه شد'); // ۱۲۰٬۰۰۰ * ۱۰٪
assert(u1.referral_points_balance === 25 && u1.referral_join_count === 3 && u1.referral_purchase_count === 1, 'خرید موفق زیرمجموعه ۱۰ امتیاز می‌دهد و شمارش اعضای یکتا جدا می‌ماند');
assert(lastMsgTo(U1).params.text.includes('پورسانت'), 'اطلاع پورسانت به معرف رسید');
const u2WalletSale = salesLedgerRows.find(x => x && x.tg_id === String(U2) && x.type === 'buy' && x.payment_method === 'wallet');
const u1BeforeCommissionReplay = await kvJson('u:' + U1);
await globalThis.__applyCommission(env, await kvJson('cfg'), await kvJson('u:' + U2), Number(u2WalletSale.amount), u2WalletSale.id);
const u1AfterCommissionReplay = await kvJson('u:' + U1);
assert(u2WalletSale && u1AfterCommissionReplay.referral_points_balance === u1BeforeCommissionReplay.referral_points_balance && u1AfterCommissionReplay.balance === u1BeforeCommissionReplay.balance && await kvJson('referral_points_event:purchase:' + u2WalletSale.id), 'تکرار همان رویداد خرید نه امتیاز می‌دهد و نه پورسانت را دوباره واریز می‌کند');

// برداشت
await press(U1, 'wd');
await sendText(U1, '50000');
await sendText(U1, '6219861122334455');
const wpend = await kvJson('wpend');
assert(wpend.length === 1, 'درخواست برداشت ثبت شد');
u1 = await kvJson('u:' + U1);
const balBefore = u1.balance;
await press(ADMIN, 'w_ok:' + wpend[0]);
const w1 = await kvJson('w:' + wpend[0]);
assert(w1.status === 'approved' && (await kvJson('u:' + U1)).balance === balBefore, 'برداشت تأیید شد');

// رد سفارش و کپی مبلغ ریالی در مسیر دستی
await press(U2, `payc:${pid}:${plid}`);
const manualPayMsg = lastMsgTo(U2);
const manualCopy = manualPayMsg.params.reply_markup.inline_keyboard.flat().find((b) => b.copy_text);
assert(manualCopy && manualCopy.copy_text.text === '1200000' && manualPayMsg.params.text.includes('1,200,000 ریال'), 'پرداخت دستی معادل ریالی و دکمهٔ کپی را نشان می‌دهد');
await sendText(U2, 'رسید تستی رد');
const pend3 = await kvJson('pend');
const roid = pend3[pend3.length - 1];
await press(ADMIN, 'a_nogo:' + roid);
assert((await kvJson('o:' + roid)).status === 'rejected', 'رد سفارش کار کرد');
await press(U2, `payc:${pid}:${plid}`);
await sendText(U2, 'رسید برای لغو');
const cancelPend = await kvJson('pend');
const cancelId = cancelPend[cancelPend.length - 1];
await press(ADMIN, 'a_orddel:' + cancelId);
const cancelledOrder = await kvJson('o:' + cancelId);
assert(cancelledOrder && cancelledOrder.status === 'cancelled' && cancelledOrder.cancelled_at, 'لغو سفارش سابقه را برای گزارش حفظ می‌کند');

// مدیریت کاربر توسط ادمین
await press(ADMIN, 'a_users');
await sendText(ADMIN, String(U2));
assert(lastMsgTo(ADMIN).params.text.includes('کاربر'), 'جستجوی کاربر کار کرد');
await press(ADMIN, 'u_add:' + U2);
await sendText(ADMIN, '10000');
assert((await kvJson('u:' + U2)).balance === 90000, 'افزودن موجودی دستی کار کرد'); // ۲۰۰−۱۲۰+۱۰

// بن و رفع بن
await press(ADMIN, 'u_ban:' + U2);
assert((await kvJson('u:' + U2)).banned === true, 'مسدودسازی کار کرد');
await press(ADMIN, 'u_ban:' + U2);
assert((await kvJson('u:' + U2)).banned === false, 'رفع مسدودیت کار کرد');

// ادمین قابل مسدود شدن نیست + خودترمیم بن قبلی
await sendText(ADMIN, '/start');
await press(ADMIN, 'u_ban:' + ADMIN);
assert((await kvJson('u:' + ADMIN)).banned !== true, 'ادمین مسدود نشد');
let admU = await kvJson('u:' + ADMIN);
admU.banned = true;
await kv.put('u:' + ADMIN, JSON.stringify(admU));
await sendText(ADMIN, '/start');
assert((await kvJson('u:' + ADMIN)).banned === false, 'بن ادمین خودکار پاک شد');
assert(lastMsgTo(ADMIN).params.text.includes('تیزنت VPN | TiznetVPN'), 'ادمین بعد از خودترمیم منوی برند تیزنت را گرفت');
await press(ADMIN, 'a_users');
await sendText(ADMIN, String(ADMIN));
assert(!JSON.stringify(lastMsgTo(ADMIN).params.reply_markup || {}).includes('u_ban:'), 'دکمه مسدود برای ادمین نمایش داده نشد');

// تنظیمات
await press(ADMIN, 's_com');
await sendText(ADMIN, '15');
assert((await kvJson('cfg')).commission === 15, 'تغییر پورسانت کار کرد');

// پیام همگانی
await press(ADMIN, 'a_bc');
await sendText(ADMIN, 'تست همگانی');
await press(ADMIN, 'a_bcgo');
assert(TG.filter((x) => x.method === 'sendMessage' && x.params.text === 'تست همگانی').length >= 2, 'پیام همگانی ارسال شد');

// کرون یادآوری: اشتراکی که ۲ روز مانده
const past = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
const firstUuid = [...hUsers.keys()][0];
hUsers.get(firstUuid).start_date = past;
hUsers.get(firstUuid).package_days = 30;
TG.length = 0;
await APP.scheduled({}, env, {});
assert(TG.some((x) => x.method === 'sendMessage' && (x.params.text || '').includes('یادآوری تمدید')), 'یادآوری انقضا در کرون ارسال شد');
const backupFile = await globalThis.__createKvBackupFile(env, Date.now());
const backupJson = gunzipSync(Buffer.from(await backupFile.blob.arrayBuffer())).toString('utf8');
const backupData = JSON.parse(backupJson);
assert(backupFile.filename.endsWith('.json.gz') && backupData.format === 'tiznetvpn-kv-backup' && backupData.entry_count === backupData.entries.length && backupData.entries.some(x => x.key === 'o:' + oid), 'فایل بکاپ فشرده تمام رکوردهای KV شامل سفارش‌ها را نگه می‌دارد');
assert(backupJson.includes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') && !backupJson.includes('shetab-test-secret') && !backupJson.includes('s3cret'), 'بکاپ بی‌رمز credential ذخیره‌شده در KV را دارد، اما Secretهای محیط Worker را استخراج نمی‌کند');
const scheduledBackupStart = TG.length;
await APP.scheduled({ cron: backupCronMatch[1], scheduledTime: Date.now() + 1000 }, env, {});
const backupDocument = TG.slice(scheduledBackupStart).find(x => x.method === 'sendDocument' && String(x.params.chat_id) === String(ADMIN));
assert(backupDocument && String(backupDocument.params.document_name || '').endsWith('.json.gz') && backupDocument.params.document_type === 'application/gzip' && (await kvJson('system:kv_backup_last_at')), 'کرون بکاپ (هر ۳ ساعت) فایل JSON gzip را به مدیر می‌فرستد و زمان ارسال را ثبت می‌کند');

// فاصلهٔ ایمنی: با بازهٔ ۳ ساعته، ارسال بعدی پس از ۳ ساعت باید انجام شود و پس از ۱ ساعت رد شود.
const HOUR = 60 * 60 * 1000;
const backupBase = Date.now() + 1000;
const after3hStart = TG.length;
await APP.scheduled({ cron: backupCronMatch[1], scheduledTime: backupBase + 3 * HOUR }, env, {});
assert(TG.slice(after3hStart).some((x) => x.method === 'sendDocument'), 'بکاپ بعدی پس از ۳ ساعت دوباره ارسال می‌شود');
const after1hStart = TG.length;
await APP.scheduled({ cron: backupCronMatch[1], scheduledTime: backupBase + 3 * HOUR + HOUR }, env, {});
assert(!TG.slice(after1hStart).some((x) => x.method === 'sendDocument'), 'بکاپ زودتر از بازهٔ ۳ ساعته ارسال تکراری نمی‌کند');

// ادمین روش خودکار را از تنظیمات روشن می‌کند
await press(ADMIN, 'a_set');
assert((await kvJson('cfg')).card_auto_enabled !== true, 'روش خودکار به‌صورت پیش‌فرض خاموش است');
await press(ADMIN, 's_pay_auto');
assert((await kvJson('cfg')).card_auto_enabled === true, 'ادمین کارت‌به‌کارت خودکار را روشن کرد');

// کارت‌به‌کارت خودکار با اپ Shetab: سفارش یکتا، تطبیق مبلغ و تحویل خودکار
await sendText(U3, '/start');
await press(U3, 'buy');
await press(U3, 'bp:' + pid);
await press(U3, `bl:${pid}:${plid}`);
const detailButtons = lastMsgTo(U3, 'editMessageText').params.reply_markup;
assert(JSON.stringify(detailButtons).includes('payx:' + pid + ':' + plid), 'گزینه کارت‌به‌کارت خودکار فقط با secret فعال نمایش داده شد');
await press(U3, `payx:${pid}:${plid}`);
const pendAuto = await kvJson('pend');
const autoId = pendAuto.find((id) => { const x = kv.m.get('o:' + id); return x && JSON.parse(x).tg_id === U3; });
const autoOrder = await kvJson('o:' + autoId);
assert(autoOrder && autoOrder.payment_method === 'shetab' && autoOrder.pay_amount >= autoOrder.amount + 10 && autoOrder.pay_amount <= autoOrder.amount + 999, 'مبلغ یکتای خرید ۱۰ تا ۹۹۹ تومان بیشتر از مبلغ پایه است');
const autoPayMsg = lastMsgTo(U3);
const autoCopy = autoPayMsg.params.reply_markup.inline_keyboard.flat().find((b) => b.copy_text);
assert(autoCopy && autoCopy.copy_text.text === String(autoOrder.pay_amount * 10) && autoPayMsg.params.text.includes((autoOrder.pay_amount * 10).toLocaleString('en-US') + ' ریال'), 'پرداخت خودکار معادل ریالی و دکمهٔ کپی را نشان می‌دهد');
const hBeforeAuto = hUsers.size;
let badKeyResp = await shetabPostAt('/api/shetab-verify', { amount: autoOrder.pay_amount, recipeId: 'BADKEY' }, 'wrong-key');
assert(badKeyResp.status === 401 && hUsers.size === hBeforeAuto, 'secret اشتباه درخواست پرداخت را رد کرد');
let noMatchResp = await shetabPost({ amount: autoOrder.pay_amount + 12345, recipeId: 'NOMATCH' });
assert(noMatchResp.status === 404 && hUsers.size === hBeforeAuto, 'مبلغ نامنطبق سفارشی را تأیید نکرد');
let paidResp = await shetabPost({ amount: String(autoOrder.pay_amount), recipeId: 'BANK-REF-001' });
const paidJson = await paidResp.json();
const paidOrder = await kvJson('o:' + autoId);
assert(paidResp.status === 200 && paidJson.payment_confirmed && paidJson.message === 'Payment confirmed successfully.' && paidOrder.status === 'approved' && paidOrder.payment_status === 'paid', 'مسیر confirm پلاگین با پاسخ مورد انتظار، پرداخت تطبیق‌یافته را تأیید می‌کند');
const autoSaleLedger = await kvJson('ledger:sale:' + autoId);
assert(autoSaleLedger && autoSaleLedger.payment_method === 'shetab' && autoSaleLedger.type === 'buy', 'فروش خودکار در دفتر فروش ثبت شد');
assert(hUsers.size === hBeforeAuto + 1, 'بعد از پرداخت تطبیق‌یافته یوزر هیدیفای ساخته شد');
let duplicateResp = await shetabPost({ amount: autoOrder.pay_amount, recipeId: 'BANK-REF-001' });
const duplicateJson = await duplicateResp.json();
assert(duplicateResp.status === 200 && duplicateJson.already_processed && duplicateJson.message === 'Payment confirmed successfully.' && hUsers.size === hBeforeAuto + 1, 'callback تکراری مسیر پلاگین پاسخ موفق می‌گیرد و دوباره سرویس تحویل نمی‌دهد');

// پشتیبانی از اپ قدیمی که مبلغ را ریال می‌فرستد و فرم URL-encoded
await press(U3, 'rnw:' + paidOrder.sub_sid);
await press(U3, `rp:${paidOrder.sub_sid}:${plid}`);
await press(U3, `rpayx:${paidOrder.sub_sid}:${plid}`);
const pendAuto2 = await kvJson('pend');
const autoId2 = pendAuto2.find((id) => { const x = kv.m.get('o:' + id); return x && JSON.parse(x).tg_id === U3 && JSON.parse(x).type === 'renew'; });
const autoOrder2 = await kvJson('o:' + autoId2);
assert(autoOrder2 && autoOrder2.pay_amount >= autoOrder2.amount + 10 && autoOrder2.pay_amount <= autoOrder2.amount + 999, 'مبلغ یکتای تمدید ۱۰ تا ۹۹۹ تومان بیشتر از مبلغ پایه است');
const formBody = new URLSearchParams({ amount: String(autoOrder2.pay_amount * 10), recipeId: 'BANK-REF-002' }).toString();
let rialResp = await shetabPostAt('/api/shetab-verify', formBody, 'shetab-test-secret', 'application/x-www-form-urlencoded');
const rialJson = await rialResp.json();
assert(rialResp.status === 200 && rialJson.payment_confirmed && rialJson.message === 'Shetab verify is verified' && (await kvJson('o:' + autoId2)).status === 'approved', 'مسیر Laravel/PowerPs با فرم URL-encoded، Authorization خام و تبدیل ریال به تومان پرداخت را تأیید می‌کند');
const autoRenewLedger = await kvJson('ledger:sale:' + autoId2);
assert(autoRenewLedger && autoRenewLedger.type === 'renew' && autoRenewLedger.payment_method === 'shetab', 'تمدید خودکار در دفتر فروش ثبت شد');
await press(ADMIN, 'a_set');
await press(ADMIN, 's_pay_auto');
assert((await kvJson('cfg')).card_auto_enabled === false, 'ادمین کارت‌به‌کارت خودکار را خاموش کرد');

// مسیرهای قدیمی /setup و /diag باید کاملاً حذف شده باشند؛ حتی با secret درست هم چیزی برنمی‌گردانند.
for (const legacyPath of ['/setup?key=s3cret', '/diag?key=s3cret']) {
  const legacy = await get(legacyPath);
  assert(legacy.status === 404 && !legacy.text.includes('webhook') && !legacy.text.includes('kv_ok'), 'مسیر قدیمی ' + legacyPath.split('?')[0] + ' از برنامه حذف شده است');
}

// رگرسیون: خطای 5xx در ساخت یوزر Hiddify نباید با payload ساده‌تر تکرار شود (خطر یوزر تکراری)
const hPanel = { api_base: 'https://panel.test/PROXY789', api_key: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const hUsersBefore = hUsers.size;
hCreateFailStatus = 500;
let createThrew = false;
try { await globalThis.__hCreateUser(hPanel, { name: 'regress-500', gb: 10, days: 30, telegram_id: 555 }); }
catch (e) { createThrew = true; }
hCreateFailStatus = 0;
assert(createThrew && hUsers.size === hUsersBefore, 'خطای 5xx در ساخت یوزر بلافاصله بالا می‌رود و یوزر تکراری نمی‌سازد');

// اگر پنل فیلدها را رد کند (422)، کاهش تدریجی payload مجاز است
hCreateFailStatus = 422;
let createOk = null;
try { createOk = await globalThis.__hCreateUser(hPanel, { name: 'regress-422', gb: 5, days: 30, telegram_id: 556 }); }
catch (e) { createOk = null; }
hCreateFailStatus = 0;
assert(createOk && createOk.uuid && hUsers.size === hUsersBefore + 1, 'خطای 422 با payload ساده‌تر دوباره تلاش می‌شود و فقط یک یوزر می‌سازد');

const adminInit = await signedInitData(ADMIN, { first_name: 'Admin', username: 'tiznet_admin' });
const userInit = await signedInitData(U1, { first_name: 'Customer', username: 'customer1' });
const adminBoot = await miniApi('/api/miniapp/bootstrap', adminInit);
assert(adminBoot.status === 200 && adminBoot.json.role === 'admin', 'initData امضاشده نقش ادمین را از ADMIN_IDS می‌گیرد');
const adminSummary = await miniApi('/api/miniapp/admin/summary?days=30', adminInit);
assert(adminSummary.status === 200 && adminSummary.json.totals.sales > 0 && adminSummary.json.totals.renewals > 0, 'داشبورد Mini App درآمد خرید/تمدید را از ledger می‌خواند');
assert(Array.isArray(adminSummary.json.chart) && adminSummary.json.chart.length === 30, 'API گزارش فروش سری روزانهٔ ۳۰روزه می‌دهد');
const adminOrders = await miniApi('/api/miniapp/admin/orders?days=90&limit=50', adminInit);
assert(adminOrders.status === 200 && adminOrders.json.items.some(x => x.status === 'approved'), 'API سفارش‌ها رکوردهای پرداخت‌شده و نوع/روش پرداخت را برمی‌گرداند');
const u1CustomerProfile = await miniApi('/api/miniapp/admin/customers/' + U1, adminInit);
const u1WalletTopups = (u1CustomerProfile.json && u1CustomerProfile.json.transactions || []).filter(x => x.kind === 'wallet_topup');
assert(u1CustomerProfile.status === 200 && u1WalletTopups.length === 1 && u1WalletTopups[0].order_id === coid, 'پروندهٔ مشتری شارژ کیف پول را با سفارش/دفتر مالی deduplicate می‌کند');
const u2CustomerProfile = await miniApi('/api/miniapp/admin/customers/' + U2, adminInit);
assert(u2CustomerProfile.status === 200 && u2CustomerProfile.json.transactions.some(x => x.kind === 'wallet_adjustment' && x.label === 'افزایش دستی کیف پول') && u2CustomerProfile.json.activity.some(x => x.action === 'wallet_credit_admin'), 'تغییر موجودی قدیمی مدیر هم در تاریخچهٔ کیف پول و فعالیت مشتری ثبت شده است');
const adminPlans = await miniApi('/api/miniapp/admin/plans?days=30', adminInit);
assert(adminPlans.status === 200 && adminPlans.json.items.some(x => x.count > 0), 'API گزارش پلن‌ها خرید و تمدید را تفکیک می‌کند');
const adminSettingsView = await miniApi('/api/miniapp/admin/settings', adminInit);
assert(adminSettingsView.status === 200 && adminSettingsView.json.settings && adminSettingsView.json.settings.card_number === '6037991122334455' && !adminSettingsView.text.includes('shetab-test-secret') && !adminSettingsView.text.includes('BOT_TOKEN\":\"TEST'), 'تنظیمات مدیر قابل‌خواندن است اما Secretها و توکن را افشا نمی‌کند');
const deniedSettings = await miniApi('/api/miniapp/admin/settings', userInit);
const deniedPanels = await miniApi('/api/miniapp/admin/panels', userInit);
const deniedOrders = await miniApi('/api/miniapp/admin/orders', userInit);
assert(deniedSettings.status === 403 && deniedPanels.status === 403 && deniedOrders.status === 403, 'کاربر عادی به تنظیمات، پنل‌ها و سفارش‌های مدیر دسترسی ندارد');
const currentCfgForSettings = await kvJson('cfg') || {};
const settingsPayload = { bot_username: currentCfgForSettings.bot_username || 'TestShopBot', support: currentCfgForSettings.support || '',
  welcome: currentCfgForSettings.welcome || '', card_number: currentCfgForSettings.card_number || '', card_holder: currentCfgForSettings.card_holder || '',
  commission: currentCfgForSettings.commission, min_withdraw: currentCfgForSettings.min_withdraw,
  card_manual_enabled: currentCfgForSettings.card_manual_enabled !== false, card_auto_enabled: false };
const settingsSaved = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsPayload) });
assert(settingsSaved.status === 200 && settingsSaved.json.settings.card_manual_enabled && (await kvJson('cfg')).bot_username === settingsPayload.bot_username, 'مدیر تنظیمات فروشگاه را از Mini App ذخیره می‌کند');
assert(adminSettingsView.json.settings.free_subscription_enabled === false && adminSettingsView.json.settings.free_subscription_claim_policy === '', 'اشتراک رایگان به‌صورت پیش‌فرض خاموش است و سیاست دریافت را بدون انتخاب مدیر فرض نمی‌کند');
const enableWithoutPolicy = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_enabled: true }) });
const freeSettingsSaved = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_enabled: true, free_subscription_gb: 2, free_subscription_days: 5, free_subscription_panel_id: pid, free_subscription_claim_policy: 'once_lifetime' }) });
const freeOffForReferral = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_enabled: false }) });
const hUsersBeforeReferralAutoReward = hUsers.size;
await sendText(U8, '/start ref_' + u1a.ref_code);
await sendText(U12, '/start ref_' + u1a.ref_code);
await sendText(U13, '/start ref_' + u1a.ref_code);
const hUsersAfterReferralAutoReward = hUsers.size;
const u1AfterReferralAuto = await kvJson('u:' + U1);
const user2Init = await signedInitData(U2, { first_name: 'InviterCustomer', username: 'inviter_customer' });
const hUsersBeforeReferralManualReward = hUsers.size;
const u2ManualReferralReward = await miniApi('/api/miniapp/referrals/free-reward', user2Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const u2AfterReferralReward = await kvJson('u:' + U2);
const u2ReferralSub = u2ManualReferralReward.json && u2ManualReferralReward.json.sid ? await kvJson('s:' + u2ManualReferralReward.json.sid) : null;
const freeReenabledAfterReferral = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_enabled: true }) });
const u1GenericFreeAfterReferral = await miniApi('/api/miniapp/customer', userInit);
assert(u1GenericFreeAfterReferral.status === 200 && u1GenericFreeAfterReferral.json.free_subscription.can_claim && u1GenericFreeAfterReferral.json.referral.free_rewards_claimed === 2, 'هدیهٔ دعوت در سابقهٔ اشتراک رایگان عمومی شمرده نمی‌شود و سیاست مدیر دست‌نخورده است');
assert(freeOffForReferral.status === 200 && !freeOffForReferral.json.settings.free_subscription_enabled && u1AfterReferralAuto.referral_join_count === 6 && u1AfterReferralAuto.referral_points_balance === 40 && u1AfterReferralAuto.referral_free_rewards_claimed === 2 && hUsersAfterReferralAutoReward === hUsersBeforeReferralAutoReward + 2 && (await Promise.all((u1AfterReferralAuto.subs || []).map(sid => kvJson('s:' + sid)))).filter(sub => sub && sub.kind === 'referral_free_subscription' && sub.free_gb === 3 && sub.free_days === 3).length === 2, 'پس از هر سه عضو، برای هر گروه هدیهٔ ۳ گیگ/۳ روز خودکار صادر می‌شود و خاموش‌بودن اشتراک عمومی مانعش نیست');
assert(u2ManualReferralReward.status === 200 && u2ManualReferralReward.json.ok && u2ReferralSub.kind === 'referral_free_subscription' && u2ReferralSub.free_gb === 3 && u2ReferralSub.free_days === 3 && hUsers.size === hUsersBeforeReferralManualReward + 1 && !u2AfterReferralReward.free_claimed && freeReenabledAfterReferral.status === 200 && freeReenabledAfterReferral.json.settings.free_subscription_enabled, 'هدیهٔ آماده از Mini App هم دستی قابل‌دریافت است و سیاست اشتراک رایگان عمومی جدا باقی می‌ماند');
const invalidFreeSettings = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_days: 0 }) });
assert(enableWithoutPolicy.status === 400 && enableWithoutPolicy.json.error === 'free_subscription_policy_required' && freeSettingsSaved.status === 200 && freeSettingsSaved.json.settings.free_subscription_enabled && freeSettingsSaved.json.settings.free_subscription_panel_id === pid && freeSettingsSaved.json.settings.free_subscription_gb === 2 && freeSettingsSaved.json.settings.free_subscription_days === 5 && freeSettingsSaved.json.settings.free_subscription_claim_policy === 'once_lifetime' && invalidFreeSettings.status === 400, 'مدیر باید پیش از فعال‌سازی سیاست را انتخاب کند؛ حجم، مدت، پنل و سیاست قابل‌تنظیم هستند و ورودی نامعتبر رد می‌شود');
const panelListForAdmin = await miniApi('/api/miniapp/admin/panels', adminInit);
assert(panelListForAdmin.status === 200 && panelListForAdmin.json.items.length >= 1 && panelListForAdmin.json.items.every(x => !('api_key' in x) && !('api_key_hint' in x)) && !panelListForAdmin.text.includes('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), 'فهرست پنل‌ها جزئیات اتصال می‌دهد اما کلید API را برنمی‌گرداند');
const testPanelResult = await miniApi('/api/miniapp/admin/panels', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id: pid, name: panels[pid].name, api_base: panels[pid].api_base, api_key: '' }) });
assert(testPanelResult.status === 200 && testPanelResult.json.test, 'آزمون اتصال پنل از API مدیریتی قابل‌اجراست بدون افشای کلید');
const deniedPanelWrite = await miniApi('/api/miniapp/admin/panels', userInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive', id: pid }) });
const panelCreateFromMiniApp = await miniApi('/api/miniapp/admin/panels', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', name: 'سرور آزمایشی Mini App', api_base: panels[pid].api_base, user_base: panels[pid].user_base, api_key: panels[pid].api_key }) });
const managedPanelId = panelCreateFromMiniApp.json && panelCreateFromMiniApp.json.panel && panelCreateFromMiniApp.json.panel.id;
const panelEditFromMiniApp = await miniApi('/api/miniapp/admin/panels', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: managedPanelId, name: 'ویرایش سرور Mini App', api_base: panels[pid].api_base, user_base: panels[pid].user_base, api_key: '' }) });
const panelOffFromMiniApp = await miniApi('/api/miniapp/admin/panels', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id: managedPanelId }) });
const panelOnFromMiniApp = await miniApi('/api/miniapp/admin/panels', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id: managedPanelId }) });
const panelArchivedFromMiniApp = await miniApi('/api/miniapp/admin/panels', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive', id: managedPanelId }) });
assert(deniedPanelWrite.status === 403 && panelCreateFromMiniApp.status === 200 && panelEditFromMiniApp.status === 200 && panelEditFromMiniApp.json.panel.name === 'ویرایش سرور Mini App' && panelOffFromMiniApp.json.panel.enabled === false && panelOnFromMiniApp.json.panel.enabled && panelArchivedFromMiniApp.json.panel.archived, 'ادمین می‌تواند پنل را بسازد، ویرایش، تست، غیرفعال و آرشیو کند؛ کاربر عادی نمی‌تواند');
const currentPanelsForCleanup = await kvJson('panels') || {};delete currentPanelsForCleanup[managedPanelId];await kv.put('panels', JSON.stringify(currentPanelsForCleanup));
const managedPlanList = await miniApi('/api/miniapp/admin/plans/manage', adminInit);
assert(managedPlanList.status === 200 && managedPlanList.json.items.length > 0 && managedPlanList.json.panels.some(x => x.id === pid), 'فهرست مدیریت پلن‌ها همراه با گزینه‌های سرور بارگذاری می‌شود');
const existingCfg = await kvJson('cfg') || {};
await kv.put('cfg', Object.assign({}, existingCfg, { bot_username: 'TestShopBot' }));
const deniedAdmin = await miniApi('/api/miniapp/admin/summary?days=30', userInit);
assert(deniedAdmin.status === 403, 'کاربر عادی به API گزارش مدیر دسترسی ندارد');
const plansBeforeLegacy = await kvJson('plans') || {};
const activePanelCount = Object.values(await kvJson('panels') || {}).filter(p => p && p.enabled !== false).length;
const legacyPlans = Object.assign({}, plansBeforeLegacy, {
  legacy_no_assignment_test: { id: 'legacy_no_assignment_test', title: 'پلن قدیمی بدون تخصیص', gb: 5, days: 10, price: 50000000, enabled: true },
  legacy_string_assignment_test: { id: 'legacy_string_assignment_test', title: 'پلن قدیمی با تخصیص متنی', gb: 6, days: 12, price: 50000001, panel_ids: 'all', enabled: true },
  legacy_empty_assignment_test: { id: 'legacy_empty_assignment_test', title: 'پلن قدیمی با تخصیص خالی', gb: 7, days: 14, price: 50000002, panel_ids: [], enabled: true },
  legacy_object_assignment_test: { id: 'legacy_object_assignment_test', title: 'پلن قدیمی با تخصیص شیء', gb: 8, days: 16, price: 50000003, panel_ids: { [pid]: true }, enabled: true },
  legacy_json_assignment_test: { id: 'legacy_json_assignment_test', title: 'پلن قدیمی با تخصیص JSON متنی', gb: 9, days: 18, price: 50000004, panel_ids: JSON.stringify([pid]), enabled: true },
  legacy_empty_json_assignment_test: { id: 'legacy_empty_json_assignment_test', title: 'پلن قدیمی با آرایهٔ JSON خالی', gb: 10, days: 20, price: 50000005, panel_ids: '[]', enabled: true }
});
await kv.put('plans', JSON.stringify(legacyPlans));
const legacyCustomer = await miniApi('/api/miniapp/customer', userInit);
const legacyVisible = legacyCustomer.json && legacyCustomer.json.plans.filter(p => p.plan_id === 'legacy_no_assignment_test');
const legacyEmptyJson = legacyCustomer.json && legacyCustomer.json.plans.filter(p => p.plan_id === 'legacy_empty_json_assignment_test');
const legacyScoped = legacyCustomer.json && legacyCustomer.json.plans.filter(p => p.plan_id === 'legacy_object_assignment_test' || p.plan_id === 'legacy_json_assignment_test');
assert(legacyCustomer.status === 200 && legacyVisible.length === activePanelCount && legacyEmptyJson.length === activePanelCount && legacyCustomer.json.plans.some(p => p.plan_id === 'legacy_string_assignment_test') && legacyScoped.length === 2 && legacyScoped.every(p => p.panel_id === pid), 'پلن‌های قدیمی با تخصیص حذف‌شده، خالی، رشتهٔ «[]»، JSON یا شیء در سرور درست نمایش داده می‌شوند');
await kv.put('plans', JSON.stringify(plansBeforeLegacy));
const customerData = await miniApi('/api/miniapp/customer', userInit);
assert(customerData.status === 200 && customerData.json.customer.tg_id === String(U1) && customerData.json.subscriptions.length > 0 && customerData.json.orders.length > 0, 'فروشگاه مشتری فقط کیف پول، سفارش‌ها و اشتراک‌های همان کاربر را برمی‌گرداند');
assert(customerData.json.referral && customerData.json.referral.invite_link.includes('?start=ref_') && customerData.json.referral.joined_count === 6 && customerData.json.referral.points_balance === 40 && customerData.json.referral.purchase_count === 1 && customerData.json.referral.free_rewards_claimed === 2 && customerData.json.referral.redeem_rule.points === 100 && customerData.json.referral.redeem_rule.toman === 200000, 'Mini App لینک اختصاصی، آمار دعوت/خرید، هدیه و نرخ تبدیل دستی امتیاز را برمی‌گرداند');
assert(customerData.json.orders.some(x => x.type === 'renew') && customerData.json.orders.length <= 50, 'تاریخچهٔ مشتری تمدید را نشان می‌دهد و تا ۵۰ سفارش اخیر را می‌خواند');
assert(!customerData.text.includes('api_key') && customerData.json.plans.length > 0, 'پاسخ مشتری اطلاعات کلید پنل را افشا نمی‌کند و پلن واقعی می‌دهد');
const inviterBeforeRedeem = await kvJson('u:' + U1);
const walletBeforeRedeem = Number(inviterBeforeRedeem.balance || 0);
inviterBeforeRedeem.referral_points_balance = 235;
await kv.put('u:' + U1, JSON.stringify(inviterBeforeRedeem));
const referralRedeem = await miniApi('/api/miniapp/referrals/redeem', userInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const referralRedeemDuplicate = await miniApi('/api/miniapp/referrals/redeem', userInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const inviterAfterRedeem = await kvJson('u:' + U1);
assert(referralRedeem.status === 200 && referralRedeem.json.points_redeemed === 200 && referralRedeem.json.credited === 400000 && referralRedeem.json.points_balance === 35 && inviterAfterRedeem.balance === walletBeforeRedeem + 400000 && referralRedeemDuplicate.status === 409 && referralRedeemDuplicate.json.error === 'referral_points_insufficient' && (await kvJson('u:' + U1)).balance === walletBeforeRedeem + 400000, 'تبدیل با اقدام دستی، هر ۱۰۰ امتیاز را به ۲۰۰٬۰۰۰ تومان می‌دهد، باقیمانده را نگه می‌دارد و تکراری نمی‌شود');
const customerAfterRedeem = await miniApi('/api/miniapp/customer', userInit);
assert(customerAfterRedeem.json.transactions.some(x => x.kind === 'wallet_adjustment' && x.label === 'تبدیل امتیاز عضوگیری' && x.amount === 400000), 'تبدیل امتیاز در تاریخچهٔ مشترک کیف پول با عنوان صحیح ثبت می‌شود');
const purchasable = customerData.json.plans.find(p => p.panel_id && p.plan_id);
assert(purchasable && Number(purchasable.price) > 0 && customerData.json.plans.every(p => !p.buy_url), 'API مشتری شناسهٔ واقعی پلن و سرور را می‌دهد و لینک خرید به ربات افشا نمی‌کند');
const user5Init = await signedInitData(U5, { first_name: 'FreeCustomer', username: 'free_customer' });
const freeAvailability = await miniApi('/api/miniapp/customer', user5Init);
assert(freeAvailability.status === 200 && freeAvailability.json.free_subscription.enabled && freeAvailability.json.free_subscription.can_claim && freeAvailability.json.free_subscription.gb === 2 && freeAvailability.json.free_subscription.days === 5 && freeAvailability.json.free_subscription.panel_name, 'Mini App وضعیت دریافت اشتراک رایگان را با حجم، روز و پنل اختصاصی نشان می‌دهد');
const hUsersBeforeFree = hUsers.size;
const miniFreeClaim = await miniApi('/api/miniapp/free-subscription', user5Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const miniFreeRecord = miniFreeClaim.json && miniFreeClaim.json.sid ? await kvJson('s:' + miniFreeClaim.json.sid) : null;
const miniFreeHiddify = miniFreeRecord && hUsers.get(miniFreeRecord.uuid);
const miniFreeDuplicate = await miniApi('/api/miniapp/free-subscription', user5Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
assert(miniFreeClaim.status === 200 && miniFreeClaim.json.ok && miniFreeRecord.free_subscription && miniFreeRecord.plan_name === 'اشتراک رایگان' && miniFreeHiddify.usage_limit_GB === 2 && miniFreeHiddify.package_days === 5 && hUsers.size === hUsersBeforeFree + 1 && miniFreeDuplicate.status === 409 && miniFreeDuplicate.json.error === 'free_subscription_already_claimed', 'اشتراک رایگان در Mini App به Hiddify صادر می‌شود و سیاست یک‌بار‌برای‌همیشه از دریافت تکراری جلوگیری می‌کند');
const oneActivePolicy = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_claim_policy: 'one_active' }) });
const oneActiveAvailability = await miniApi('/api/miniapp/customer', user5Init);
const oneActiveDuplicate = await miniApi('/api/miniapp/free-subscription', user5Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
assert(oneActivePolicy.status === 200 && oneActiveAvailability.json.free_subscription.can_claim === false && oneActiveAvailability.json.free_subscription.reason === 'already_active' && oneActiveDuplicate.json.error === 'free_subscription_already_active', 'سیاست «فقط یک اشتراک فعال» وضعیت زندهٔ Hiddify را بررسی و دریافت دوم را مسدود می‌کند');
const repeatPolicy = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_claim_policy: 'repeat' }) });
const user6Init = await signedInitData(U6, { first_name: 'RepeatCustomer', username: 'repeat_customer' });
const repeatFreeOne = await miniApi('/api/miniapp/free-subscription', user6Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const repeatFreeTwo = await miniApi('/api/miniapp/free-subscription', user6Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
const repeatFreeUser = await kvJson('u:' + U6);
const repeatFreeRecords = await Promise.all((repeatFreeUser.subs || []).map(sid => kvJson('s:' + sid)));
assert(repeatPolicy.status === 200 && repeatFreeOne.status === 200 && repeatFreeTwo.status === 200 && repeatFreeRecords.filter(x => x && x.free_subscription).length === 2 && repeatFreeOne.json.sid !== repeatFreeTwo.json.sid, 'سیاست «هر بار» دریافت چند اشتراک رایگان مجزا را امکان‌پذیر می‌کند');
const freeDisabled = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_enabled: false }) });
const disabledFreeClaim = await miniApi('/api/miniapp/free-subscription', user6Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
assert(freeDisabled.status === 200 && !freeDisabled.json.settings.free_subscription_enabled && disabledFreeClaim.status === 409 && disabledFreeClaim.json.error === 'free_subscription_disabled', 'مدیر می‌تواند صدور رایگان را غیرفعال کند و Worker درخواست جدید را رد می‌کند');
const freeReenabled = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ free_subscription_enabled: true }) });
assert(freeReenabled.status === 200 && freeReenabled.json.settings.free_subscription_enabled, 'مدیر می‌تواند صدور اشتراک رایگان را دوباره فعال کند');
const hUsersBeforeBotFree = hUsers.size;
env.MINIAPP_ONLY_MODE = 'true';
await sendText(U7, '/start');
const botFreeStartMessages = TG.filter(x => x.method === 'sendMessage' && String(x.params.chat_id) === String(U7)).slice(-2);
const botFreeStartKb = botFreeStartMessages[1]?.params.reply_markup?.keyboard?.flat().map(x => x.text) || [];
const botFreeDeliveryStart = TG.length;
await sendText(U7, 'اشتراک رایگان');
const botFreeDelivery = TG.slice(botFreeDeliveryStart).filter(x => x.method === 'sendPhoto' && String(x.params.chat_id) === String(U7)).at(-1);
const botFreeMarkup = botFreeDelivery ? JSON.parse(botFreeDelivery.params.reply_markup || '{}') : {};
const botFreeReplyTexts = botFreeMarkup.keyboard?.flat().map(x => x.text) || [];
assert(botFreeStartMessages[0]?.params.reply_markup?.inline_keyboard?.flat().some(x => x.text === 'ورود به اپ') && botFreeStartKb.join('|') === exactRobotButtons.join('|') && botFreeDelivery?.params.caption.includes('اشتراک رایگان شما فعال شد') && botFreeReplyTexts.join('|') === exactRobotButtons.join('|') && hUsers.size === hUsersBeforeBotFree + 1, 'ربات از شش‌گزینه‌ای Mini App-only اشتراک رایگان را صادر می‌کند و reply keyboard را حفظ می‌کند');
env.MINIAPP_ONLY_MODE = 'false';

const restoreKv = new MockKV();
await restoreKv.put('sentinel:old', JSON.stringify({ state: 'before' }));
await restoreKv.put('custom:metadata', 'before-restore', { expiration: Math.floor(Date.now()/1000)+86400, metadata: { source: 'old' } });
const restoreEnv = Object.assign({}, env, { DB: restoreKv });
const manualBackupResponse = await APP.fetch(new Request('https://t.test/api/miniapp/admin/backup', { headers: { 'X-Telegram-Init-Data': adminInit } }), restoreEnv, {});
const manualBackupBlob = await manualBackupResponse.blob();
const manualBackupData = JSON.parse(gunzipSync(Buffer.from(await manualBackupBlob.arrayBuffer())).toString('utf8'));
const deniedManualBackup = await APP.fetch(new Request('https://t.test/api/miniapp/admin/backup', { headers: { 'X-Telegram-Init-Data': userInit } }), restoreEnv, {});
assert(manualBackupResponse.status === 200 && manualBackupResponse.headers.get('content-type') === 'application/gzip' && manualBackupData.format === 'tiznetvpn-kv-backup' && manualBackupData.entries.some(x => x.key === 'sentinel:old') && !manualBackupData.entries.some(x => ['system:kv_backup_lock','system:kv_restore_lock'].includes(x.key)) && deniedManualBackup.status === 403 && !(await restoreKv.get('system:kv_backup_lock')), 'بکاپ دستی کامل به‌شکل gzip بدون رمزگذاری دانلود می‌شود، قفل پاک می‌شود و فقط مدیر مجاز است');
const backupGrantResponse = await APP.fetch(new Request('https://t.test/api/miniapp/admin/backup-link', { headers: { 'X-Telegram-Init-Data': adminInit } }), restoreEnv, {});
const backupGrant = await backupGrantResponse.json();
const backupDownloadResponse = await APP.fetch(new Request(backupGrant.url, { headers: { Origin: 'https://web.telegram.org' } }), restoreEnv, {});
const backupDownloadData = JSON.parse(gunzipSync(Buffer.from(await (await backupDownloadResponse.blob()).arrayBuffer())).toString('utf8'));
const reusedBackupDownload = await APP.fetch(new Request(backupGrant.url), restoreEnv, {});
const deniedBackupGrant = await APP.fetch(new Request('https://t.test/api/miniapp/admin/backup-link', { headers: { 'X-Telegram-Init-Data': userInit } }), restoreEnv, {});
const backupInflightGone = !(await restoreKv.get('system:kv_backup_download_inflight:' + new URL(backupGrant.url).searchParams.get('token')));
assert(backupGrantResponse.status === 200 && backupGrant.ok && backupGrant.url.includes('/api/miniapp/admin/backup-download?token=') && backupDownloadResponse.status === 200 && backupDownloadResponse.headers.get('content-type') === 'application/gzip' && backupDownloadResponse.headers.get('content-disposition').includes('attachment') && backupDownloadResponse.headers.get('access-control-allow-origin') === 'https://web.telegram.org' && backupDownloadData.entries.some(x => x.key === 'sentinel:old') && !backupDownloadData.entries.some(x => x.key.startsWith('system:kv_backup_download')) && reusedBackupDownload.status === 410 && deniedBackupGrant.status === 403 && backupInflightGone, 'لینک یک‌بارمصرف بکاپ برای Telegram دانلود gzip می‌دهد، توکن را در snapshot نمی‌گذارد و پس از مصرف/برای کاربر عادی رد می‌شود');
await restoreKv.put('system:kv_backup_lock', JSON.stringify({ started_at: Date.now() }));
const duplicateManualBackup = await APP.fetch(new Request('https://t.test/api/miniapp/admin/backup', { headers: { 'X-Telegram-Init-Data': adminInit } }), restoreEnv, {});
await restoreKv.delete('system:kv_backup_lock');
assert(duplicateManualBackup.status === 409 && (await duplicateManualBackup.json()).error === 'backup_busy', 'بکاپ دستی هم‌زمان از گرفتن snapshot دوم جلوگیری می‌کند');
const tinyRestoreBackup = await gzipText(JSON.stringify({ format: 'tiznetvpn-kv-backup', schema_version: 1, worker_version: '1.8.0', created_at: new Date().toISOString(), entry_count: 1, entries: [{ key: 'new:restored', value: JSON.stringify({ state: 'after' }), expiration: null, metadata: null }] }));
const noRestoreConfirm = await restoreRequest(restoreEnv, adminInit, tinyRestoreBackup, 'NO');
assert(noRestoreConfirm.status === 400 && (await restoreKv.get('sentinel:old', { type: 'json' })).state === 'before', 'ریستور بدون عبارت تأیید نهایی رد می‌شود و KV موجود را تغییر نمی‌دهد');
const restoreStamp = Math.floor(Date.now()/1000);
const restoreEntries = [
  { key: 'new:restored', value: JSON.stringify({ state: 'after' }), expiration: null, metadata: null },
  { key: 'new:metadata', value: 'restored metadata', expiration: restoreStamp + 3600, metadata: { source: 'restore-test' } },
  { key: 'new:expired', value: 'expired', expiration: restoreStamp - 5, metadata: null },
  { key: 'system:kv_restore_lock', value: JSON.stringify({ forged: true }), expiration: null, metadata: null },
  { key: 'system:kv_backup_lock', value: JSON.stringify({ started_at: Date.now() }), expiration: null, metadata: null }
];
const completeRestoreBackup = await gzipText(JSON.stringify({ format: 'tiznetvpn-kv-backup', schema_version: 1, worker_version: '1.8.0', created_at: new Date().toISOString(), entry_count: restoreEntries.length, entries: restoreEntries }));
const safetyBackupStart = TG.length;
const restoreResponse = await restoreRequest(restoreEnv, adminInit, completeRestoreBackup);
const restoreResult = await restoreResponse.json();
const safetyBackupDocument = TG.slice(safetyBackupStart).find(x => x.method === 'sendDocument' && String(x.params.chat_id) === String(ADMIN));
assert(restoreResponse.status === 200 && restoreResult.ok && restoreResult.restored_entries === 2 && restoreResult.skipped_expired === 1 && safetyBackupDocument?.params.caption.includes('پیش از ریستور'), 'ریستور پس از ارسال بکاپ ایمنی برای مدیر، محتوای KV را کامل جایگزین و رکورد منقضی را نادیده می‌گیرد');
assert((await restoreKv.get('new:restored', { type: 'json' })).state === 'after' && await restoreKv.get('new:metadata') === 'restored metadata' && restoreKv.meta.get('new:metadata')?.metadata?.source === 'restore-test' && !(await restoreKv.get('sentinel:old')) && !(await restoreKv.get('system:kv_restore_lock')) && !(await restoreKv.get('system:kv_backup_lock')), 'ریستور مقدار/metadata را برمی‌گرداند، کلیدهای قدیمی و lock موقت را باقی نمی‌گذارد');
await restoreKv.put('system:kv_restore_lock', JSON.stringify({ started_at: Date.now() }));
const manualBackupDuringRestore = await APP.fetch(new Request('https://t.test/api/miniapp/admin/backup', { headers: { 'X-Telegram-Init-Data': adminInit } }), restoreEnv, {});
const restoreCronStart = TG.length;
await APP.scheduled({ cron: '0 */12 * * *', scheduledTime: Date.now()+1000 }, restoreEnv, {});
assert(manualBackupDuringRestore.status === 409 && (await manualBackupDuringRestore.json()).error === 'restore_busy' && !TG.slice(restoreCronStart).some(x => x.method === 'sendDocument'), 'بکاپ دستی و زمان‌بندی‌شده هنگام ریستور فعال متوقف می‌شوند');
await restoreKv.delete('system:kv_restore_lock');

const managedPlanCreate = await miniApi('/api/miniapp/admin/plans', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', title: 'پلن مدیریتی آزمایشی', gb: 15, days: 20, price: Number(purchasable.price) + 12345, panel_ids: [purchasable.panel_id] }) });
const managedPlanId = managedPlanCreate.json && managedPlanCreate.json.plan && managedPlanCreate.json.plan.id;
assert(managedPlanCreate.status === 200 && managedPlanId && managedPlanCreate.json.plan.enabled, 'ادمین می‌تواند از Mini App پلن تازه بسازد');
const managedPlanDisabled = await miniApi('/api/miniapp/admin/plans', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id: managedPlanId }) });
const managedPlanEnabled = await miniApi('/api/miniapp/admin/plans', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id: managedPlanId }) });
const customerWithManagedPlan = await miniApi('/api/miniapp/customer', userInit);
assert(managedPlanDisabled.status === 200 && managedPlanDisabled.json.plan.enabled === false && managedPlanEnabled.json.plan.enabled && customerWithManagedPlan.json.plans.some(p => p.plan_id === managedPlanId), 'فعال‌سازی و غیرفعال‌سازی پلن مدیریتی کار می‌کند و پلن فعال به فروشگاه مشتری می‌رسد');
const deniedPlanWrite = await miniApi('/api/miniapp/admin/plans', userInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive', id: managedPlanId }) });
assert(deniedPlanWrite.status === 403, 'کاربر عادی امکان ایجاد یا تغییر پلن ندارد');
assert(miniAppSource.includes('/api/miniapp/checkout') && miniAppSource.includes('data-buy-panel') && miniAppSource.includes('data-pay-method'), 'رابط مشتری مسیر انتخاب پلن و پرداخت مستقیم Mini App را دارد');
assert(!miniAppSource.includes('ادامه خرید در ربات') && !miniAppSource.includes('تمدید در ربات'), 'خرید و تمدید از رابط مشتری به ربات هدایت نمی‌شود');
assert(!miniAppSource.includes('data-customer-manage') && miniAppSource.includes('data-customer-open') && miniAppSource.includes('function openCustomerManager'), 'دکمهٔ مدیریت مشتری حذف شده و ردیف مشتری برای بازکردن پرونده قابل کلیک است');
assert(['data-customer-tab="buy"','data-customer-tab="orders"','data-customer-tab="history"','data-customer-tab="referrals"'].every(x => miniAppSource.includes(x)) && miniAppSource.includes('function setCustomerTab') && ['customerTabBuy','customerTabOrders','customerTabHistory','customerTabReferrals'].every(id => miniAppSource.split('id="'+id+'"').length === 2) && miniAppSource.includes('>عضوگیری</button>'), 'نمای مشتری تب‌های خرید، سفارشات، تاریخچه و عضوگیری دارد و برای هر تب فقط یک پنل شناسه‌دار وجود دارد');
assert(miniAppSource.includes('id="customerKpis"') && miniAppSource.includes('id="customerWalletCard"') && miniAppSource.includes('id="customerWalletCharge"') && miniAppSource.includes('id="customerWalletHistory"') && miniAppSource.includes('id="customerRefresh"') && miniAppSource.includes('id="customerGreeting"') && miniAppSource.includes('function renderCustomerOverview') && miniAppSource.includes('function handleCustomerQuick') && ['plans','mysubs','wallet','support'].every(x => miniAppSource.includes('data-customer-quick="'+x+'"')), 'نمای مشتری کارت خوش‌آمد، KPI، کارت کیف پول با شارژ/تاریخچه و میان‌برهای خرید/سرویس/کیف پول/پشتیبانی دارد');
assert(/\.customer-mode \.customer-tabs \{[^}]*position:fixed/.test(miniAppSource) && /\.customer-mode \.customer-tabs \{[^}]*bottom:0/.test(miniAppSource) && miniAppSource.includes('padding-bottom:86px;') && miniAppSource.includes('padding-bottom:calc(86px + var(--safe-bottom));') && miniAppSource.includes('mask-image:url("data:image/svg+xml') && miniAppSource.includes('function renderPendingOrders') && miniAppSource.includes('cv-pending-icon') && miniAppSource.includes('data-customer-tab="buy"]::before') && miniAppSource.includes('.customer-mode .customer-tabs [role="tab"] {') && (miniAppSource.match(/padding-bottom:calc\(6px \+ var\(--safe-bottom\)\)/g)||[]).length === 1, 'نوار ناوبری مشتری ثابتِ پایین صفحه است (در همهٔ اندازه‌ها)، فضای خالی انتهای محتوا دارد و آیکن تب‌ها و بنر سفارش در انتظار حفظ شده‌اند');
assert(!miniAppSource.includes('.customer-mode .main { max-width:600px') && !miniAppSource.includes('.customer-mode .plans-grid { grid-template-columns:minmax(0,1fr) !important') && !miniAppSource.includes('.customer-mode .store-plan { min-height:0; padding:16px'), 'نمای مشتری چیدمان ریسپانسیو پایه (عرض صفحه و گرید پلن‌ها) را بازنویسی نمی‌کند');
assert(miniAppSource.indexOf('id="customerTabBuy"') < miniAppSource.indexOf('class="cv-card cv-hero"') && miniAppSource.indexOf('class="cv-card cv-hero"') < miniAppSource.indexOf('id="customerTabOrders"') && miniAppSource.indexOf('class="customer-tabs"') > miniAppSource.indexOf('id="customerTabReferrals"'), 'خلاصهٔ حساب داخل تب خانه است و نوار ناوبری بعد از پنل‌ها قرار دارد تا در میانهٔ صفحه نیفتد');
assert(/\.customer-mode #storePage \{[^}]*animation-name:fadeInNoTransform/.test(miniAppSource) && miniAppSource.includes('@keyframes fadeInNoTransform { from { opacity:0; } to { opacity:1; } }') && !/\.customer-mode #storePage \{[^}]*transform/.test(miniAppSource), 'صفحهٔ فروشگاه در نمای مشتری فقط opacity را انیمیت می‌کند؛ ترنسفورم ماندگار fadeIn نوار پایین را از حالت fixed خارج نمی‌کند');
assert(miniAppSource.indexOf('class="customer-tabs"') > miniAppSource.indexOf('id="mobileNav"') - 4000 && !/class="page[^"]*"[^]*?class="customer-tabs"/.test(miniAppSource.slice(miniAppSource.indexOf('id="storePage"'))), 'نوار ناوبری مشتری بیرون از المان‌های .page قرار دارد تا ترنسفورم انیمیشن آن را از حالت ثابت خارج نکند');
assert(miniAppSource.includes('.customer-tabs { display:none; }') && miniAppSource.includes('.customer-mode .mobile-nav { display:none !important; }'), 'نوار ناوبری مشتری فقط در نمای مشتری دیده می‌شود و نوار موبایل قدیمی در این حالت غیرفعال است');
assert(miniAppSource.includes('body.customer-mode {') && miniAppSource.includes('#02091c') && miniAppSource.includes('background-attachment:fixed') && miniAppSource.includes('backdrop-filter:blur(18px)') && miniAppSource.includes('.customer-mode .customer-tabs [role="tab"][aria-selected="true"]::after'), 'طرح جدید مشتری از پس‌زمینهٔ آبی عمیق، کارت‌های شیشه‌ای و نشانگر تب فعال استفاده می‌کند');
assert((miniAppSource.match(/class="cv-stat"/g)||[]).length === 4 && miniAppSource.includes("`<div class=\"cv-stat\"><small>") && miniAppSource.includes('.cv-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr))') && !miniAppSource.includes('kpiIcons'), 'نوار آمار مشتری سه شاخص فشرده را در یک ردیف نشان می‌دهد (بدون تکرار موجودی کیف پول)');
assert(!miniAppSource.includes('.customer-mode .main { max-width:600px') && !miniAppSource.includes('.customer-mode .plans-grid { grid-template-columns:minmax(0,1fr) !important') && !miniAppSource.includes('.customer-mode .store-plan { min-height:0; padding:16px') && !miniAppSource.includes('padding-bottom:calc(122px + var(--safe-bottom)) !important'), 'نمای مشتری چیدمان ریسپانسیو پایه (عرض، گرید پلن‌ها، کارت‌ها و حاشیهٔ پایین) را بازنویسی نمی‌کند');
assert(miniAppSource.includes('function subscriptionQrMarkup') && miniAppSource.includes('function loadSubscriptionQrInto') && miniAppSource.includes('subscriptionQrSlot') && miniAppSource.includes('function showFreeSubscriptionDelivery') && miniAppSource.includes('data-subscription-qr="${esc(s.sid)}"') && miniAppSource.includes('qr_data_url:sub.qr_data_url'), 'صفحهٔ اطلاعات اشتراک و تحویل اشتراک رایگان/هدیه، QR و لینک قابل کپی را نشان می‌دهند');
assert(miniAppSource.includes('HIDDIFY_DOWNLOADS') && miniAppSource.includes('function hiddifyDownloadsMarkup') && ['android','ios','windows','github'].every(k => miniAppSource.includes('HIDDIFY_DOWNLOADS.'+k)) && miniAppSource.includes('apps.apple.com/app/hiddify-proxy-vpn') && miniAppSource.includes('Hiddify-Android-universal.apk') && miniAppSource.includes('Hiddify-Windows-Setup-x64.exe') && miniAppSource.includes('github.com/hiddify/hiddify-app/releases/latest') && miniAppSource.includes('data-open-url'), 'دکمه‌های دانلود هیدیفای برای اندروید، آیفون، ویندوز و صفحهٔ گیت‌هاب در کارت اشتراک وجود دارد');
assert(src.includes('function qrZlibStored') && src.includes('function qrDeflate') && src.includes("qrcode(0, 'L')") && src.includes('function safeQrDataUrl') && src.includes("qr_data_url: await safeQrDataUrl(link)"), 'تولید QR در Worker بدون وابستگی به CompressionStream هم کار می‌کند و برای لینک‌های بلند تلاش دوباره دارد');
assert(miniAppSource.includes('function legacyCopy') && miniAppSource.includes('execCommand') && miniAppSource.includes('height:auto; margin:0 auto; object-fit:contain'), 'کپی لینک در وب‌ویو تلگرام جایگزین دارد و تصویر QR بدون وابستگی به aspect-ratio اندازه می‌گیرد');
assert(miniAppSource.includes('--bg:#04152e') && miniAppSource.includes('--brand-blue:#00409a') && miniAppSource.includes('.cv-wallet') && !miniAppSource.includes('#6d4aff') && !miniAppSource.includes('#1b1626'), 'پالت آبی تیزنت (زمینهٔ تیرهٔ آبی) در بازطراحی نمای مشتری حفظ شده و رنگ بنفش مرجع کپی نشده است');
assert(miniAppSource.includes('customer-tabs') && miniAppSource.includes('overflow-wrap:anywhere') && miniAppSource.includes('grid-template-columns:repeat(4,minmax(0,1fr))') && miniAppSource.includes('.referral-stats-grid'), 'CSS برای چهار تب مشتری، متن چندخطی و چیدمان موبایل بررسی شده است');
assert(!miniAppSource.includes('<div class="store-hero">') && !miniAppSource.includes('اتصال امن Telegram') && !miniAppSource.includes('حساب مشتری · دادهٔ زنده') && miniAppSource.includes('/assets/tiznetvpn-logo.png') && miniAppSource.includes('customer-brand'), 'بنر خوشامد و متن‌های اتصال/دادهٔ زنده از نمای مشتری حذف شده‌اند و لوگوی TiznetVPN حفظ شده است');
assert(!miniAppSource.includes('plan-summary') && !miniAppSource.includes('بدون هزینه') && !miniAppSource.includes('اتصال آسان با Hiddify و دسترسی به وضعیت اشتراک'), 'جملهٔ «اتصال آسان با Hiddify…» و چیپ «بدون هزینهٔ پنهان» از کارت پلن حذف شده‌اند');
assert(!/\.cv-plan \{[^}]*min-height/.test(miniAppSource) && !/\.cv-plan \{[^}]*height:/.test(miniAppSource) && !miniAppSource.includes('min-height:370px') && !miniAppSource.includes('min-height:248px') && miniAppSource.includes('.cv-plan { display:grid; gap:8px; padding:12px; align-content:start; }'), 'کارت پلن هیچ ارتفاع یا حداقل ارتفاع ثابتی ندارد و با فاصله‌های فشرده رندر می‌شود');
assert(miniAppSource.includes('.cv-quick { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; min-width:0; }') && /\.cv-quick-tile \{[^}]*min-width:0/.test(miniAppSource) && !/\.cv-quick[^{]*\{[^}]*position:/.test(miniAppSource) && miniAppSource.includes('text-overflow:ellipsis; white-space:nowrap; }') && /\.cv-quick-tile strong \{[^}]*white-space:nowrap/.test(miniAppSource), 'میان‌برهای بالای صفحه در یک گرید چهارستونهٔ بدون عرض ثابت و با متن تک‌خطی قرار می‌گیرند؛ هیچ موقعیت absolute در این بلوک نیست');
assert(miniAppSource.includes('@media (hover:hover) and (pointer:fine) {') && !/\.cv-quick-tile:hover/.test(miniAppSource.split('@media (hover:hover) and (pointer:fine) {')[0]), 'افکت‌های hover میان‌برها فقط برای دستگاه‌های ماوس‌دار فعال‌اند و روی لمس باقی نمی‌مانند');
assert(!/\.customer-quick|\.customer-hero|\.customer-kpi|\.store-plan|\.plan-card|\.plan-spec|\.plan-buy|\.customer-sub-card|\.customer-transaction|\.pending-order-|\.customer-wallet/.test(miniAppSource), 'هیچ قانون CSS قدیمیِ نمای مشتری باقی نمانده است؛ طرح جدید یک لایهٔ مستقل با پیشوند cv- است');
assert(miniAppSource.includes('id="customerFreeClaim"') && miniAppSource.includes('/api/miniapp/free-subscription') && miniAppSource.includes('id="settingFreeClaimPolicy"') && miniAppSource.includes('id="settingFreePanel"'), 'مشتری می‌تواند اشتراک رایگان بگیرد و مدیر سیاست، پنل، حجم و مدت را تنظیم می‌کند');
assert(miniAppSource.includes('id="kvBackupDownload"') && miniAppSource.includes('id="kvRestoreConfirmBtn"') && miniAppSource.includes('RESTORE') && miniAppSource.includes('جایگزینی کامل'), 'مدیریت Mini App بکاپ دستی و ریستور کامل با تأیید نهایی دارد');
assert(miniAppSource.includes('/api/miniapp/admin/backup-link') && miniAppSource.includes('tg.downloadFile({url:grant.url,file_name:grant.file_name})') && miniAppSource.includes('fileDownloadRequested') && !miniAppSource.includes('بکاپ دستی آماده و دانلود شد'), 'دانلود بکاپ در تلگرام از downloadFile و لینک موقت استفاده می‌کند و پیام موفقیت کاذب نشان نمی‌دهد');
assert(miniAppSource.includes('referralRedeemButton') && miniAppSource.includes('/api/miniapp/referrals/redeem') && miniAppSource.includes('/api/miniapp/referrals/free-reward') && miniAppSource.includes('referralCopyLink') && miniAppSource.includes('۲۰۰٬۰۰۰ تومان'), 'تب عضوگیری کپی لینک، دریافت هدیه و تبدیل دستی امتیاز به کیف پول را دارد');

const user4Init = await signedInitData(U4, { first_name: 'ReceiptCustomer', username: 'receipt_customer' });
const cfgForMiniApp = await kvJson('cfg') || {};
await kv.put('cfg', Object.assign({}, cfgForMiniApp, { card_manual_enabled: true, card_auto_enabled: false }));
const autoDisabledMiniCheckout = await miniApi('/api/miniapp/checkout', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'shetab', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-auto-disabled-0001' })
});
assert(autoDisabledMiniCheckout.status === 403 && autoDisabledMiniCheckout.json.error === 'automatic_payment_disabled', 'سوییچ خودکار مستقل است و روش خودکار خاموش را در Mini App رد می‌کند');
const pointsBeforePendingMiniBuy = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
const manualMiniCheckout = await miniApi('/api/miniapp/checkout', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-manual-order-0001' })
});
const manualMiniOrder = manualMiniCheckout.json && manualMiniCheckout.json.order;
assert(manualMiniCheckout.status === 200 && manualMiniOrder && manualMiniOrder.status === 'pending' && manualMiniOrder.payment_method === 'manual' && Number((await kvJson('u:' + U1)).referral_points_balance) === pointsBeforePendingMiniBuy, 'سفارش دستیِ در انتظار رسید تا پرداخت موفق هیچ امتیاز عضوگیری نمی‌دهد');
const miniAppNewOrderAlert = TG.filter(x => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN) && String(x.params.text || '').includes('سفارش جدید #' + (manualMiniOrder && manualMiniOrder.id || ''))).at(-1);
assert(miniAppNewOrderAlert && miniAppNewOrderAlert.params.reply_markup?.inline_keyboard?.length, 'ایجاد سفارش Mini App در نقطهٔ مرکزی به مدیران اعلان می‌دهد');
const noKeyboardNoticeStart = TG.length;
env.MINIAPP_ONLY_MODE = 'true';
await globalThis.__adminNotifyOrder(env, manualMiniOrder);
const miniOnlyAdminAlert = TG.slice(noKeyboardNoticeStart).find(x => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN));
assert(miniOnlyAdminAlert && !miniOnlyAdminAlert.params.reply_markup, 'اعلان سفارش در حالت Mini App-only به مدیران می‌رسد اما دکمهٔ legacy ندارد');
env.MINIAPP_ONLY_MODE = 'false';
assert(manualMiniCheckout.json.payment && manualMiniCheckout.json.payment.card_number === '6037991122334455' && manualMiniCheckout.json.payment.amount_toman >= manualMiniOrder.amount + 10 && manualMiniCheckout.json.payment.amount_toman <= manualMiniOrder.amount + 999 && manualMiniCheckout.json.payment.amount_rial === manualMiniCheckout.json.payment.amount_toman * 10, 'پرداخت Mini App شماره کارت و مبلغ یکتا با معادل ریالی را روشن برمی‌گرداند');
const duplicateMiniCheckout = await miniApi('/api/miniapp/checkout', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-manual-order-0001' })
});
assert(duplicateMiniCheckout.status === 200 && duplicateMiniCheckout.json.order.id === manualMiniOrder.id, 'شناسهٔ idempotency همان سفارش را برمی‌گرداند و سفارش تکراری نمی‌سازد');
const adminOrderDetail = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id, adminInit);
const customerCannotReadAdminOrder = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id, user4Init);
assert(adminOrderDetail.status === 200 && adminOrderDetail.json.order.can_edit_product && customerCannotReadAdminOrder.status === 403, 'ادمین جزئیات سفارش را می‌بیند و کاربر عادی به همان endpoint دسترسی ندارد');
const manualFilteredOrders = await miniApi('/api/miniapp/admin/orders?method=manual&status=pending&days=0', adminInit);
assert(manualFilteredOrders.status === 200 && manualFilteredOrders.json.items.some(x => x.id === manualMiniOrder.id) && manualFilteredOrders.json.items.every(x => x.method === 'دستی' && x.status === 'pending'), 'فیلتر drill-down روش دستی در فهرست مشترک سفارش‌های Worker اعمال می‌شود');
const manualSuffix = Number(manualMiniOrder.pay_amount) - Number(manualMiniOrder.amount);
const editManualOrder = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit', change_product: true, plan_id: managedPlanId, panel_id: purchasable.panel_id, admin_note: 'ویرایش قبل از دریافت رسید' }) });
assert(editManualOrder.status === 200 && editManualOrder.json.order.plan_id === managedPlanId && editManualOrder.json.order.amount === Number(purchasable.price) + 12345 && editManualOrder.json.order.pay_amount - editManualOrder.json.order.amount === manualSuffix, 'ادمین محصول سفارش پرداخت‌نشده را ویرایش می‌کند و افزودهٔ مبلغ یکتا حفظ می‌شود');
const receiptForm = new FormData();
receiptForm.append('reference', 'MINI-APP-RECEIPT-123');
receiptForm.append('receipt', new Blob(['fake png receipt'], { type: 'image/png' }), 'receipt.png');
const receiptResp = await miniApi('/api/miniapp/orders/' + manualMiniOrder.id + '/receipt', user4Init, { method: 'POST', body: receiptForm });
const receiptOrder = await kvJson('o:' + manualMiniOrder.id);
assert(receiptResp.status === 200 && receiptResp.json.order.receipt_submitted && receiptOrder.receipt_file_id === 'TEST-RECEIPT-FILE' && receiptOrder.payment_status === 'review', 'عکس رسید به تلگرام ارسال و وضعیت سفارش برای بررسی ادمین ثبت شد');
assert(TG.some(x => x.method === 'sendPhoto' && String(x.params.chat_id) === String(ADMIN) && String(x.params.caption || '').includes('رسید خرید از Mini App')), 'رسید تصویری همراه جزئیات سفارش برای ادمین ارسال شد');
const adminReceiptImage = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id + '/receipt', adminInit);
const customerCannotReadReceipt = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id + '/receipt', user4Init);
assert(adminReceiptImage.status === 200 && adminReceiptImage.text.length > 0 && customerCannotReadReceipt.status === 403, 'تصویر رسید از مسیر امنِ ادمین دریافت می‌شود و برای مشتری افشا نمی‌شود');
const lockedOrderEdit = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'edit', change_product: true, plan_id: purchasable.plan_id, panel_id: purchasable.panel_id, admin_note: 'ویرایش پس از رسید' }) });
assert(lockedOrderEdit.status === 409 && lockedOrderEdit.json.error === 'financial_order_locked', 'پس از ثبت رسید، ویرایش مالی سفارش به‌طور امن قفل می‌شود');
const photoCallsBeforeRetry = TG.filter(x => x.method === 'sendPhoto').length;
const receiptRetry = await miniApi('/api/miniapp/orders/' + manualMiniOrder.id + '/receipt', user4Init, { method: 'POST', body: receiptForm });
assert(receiptRetry.status === 200 && TG.filter(x => x.method === 'sendPhoto').length === photoCallsBeforeRetry, 'ارسال مجدد همان رسید اعلان تکراری برای ادمین نمی‌فرستد');
const wrongOwnerOrder = await miniApi('/api/miniapp/orders/' + manualMiniOrder.id, userInit);
assert(wrongOwnerOrder.status === 404, 'کاربر دیگر نمی‌تواند سفارش یا وضعیت پرداخت مشتری را بخواند');
const adminApproveOrder = await miniApi('/api/miniapp/admin/orders/' + manualMiniOrder.id, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
const manualMiniStatus = await miniApi('/api/miniapp/orders/' + manualMiniOrder.id, user4Init);
assert(adminApproveOrder.status === 200 && adminApproveOrder.json.order.status === 'approved' && manualMiniStatus.status === 200 && manualMiniStatus.json.order.status === 'approved' && manualMiniStatus.json.delivery && manualMiniStatus.json.delivery.qr_data_url.startsWith('data:image/png;base64,') && manualMiniStatus.json.delivery.link.includes('panel.test') && (await kvJson('ledger:sale:' + manualMiniOrder.id)).payment_method === 'manual', 'ادمین از Mini App پرداخت معتبر را تأیید می‌کند و نتیجهٔ پیگیری QR محلی و لینک اشتراک را نمایش می‌دهد');
const ownerSubscriptionQr = await miniApi('/api/miniapp/subscriptions/' + manualMiniStatus.json.order.sub_sid + '/qr', user4Init);
const otherCustomerSubscriptionQr = await miniApi('/api/miniapp/subscriptions/' + manualMiniStatus.json.order.sub_sid + '/qr', userInit);
assert(ownerSubscriptionQr.status === 200 && ownerSubscriptionQr.json.delivery.qr_data_url.startsWith('data:image/png;base64,') && ownerSubscriptionQr.json.delivery.link.includes('panel.test') && otherCustomerSubscriptionQr.status === 404, 'QR اشتراک از مسیر مالک‌محور قابل دریافت است و به مشتری دیگر افشا نمی‌شود');
const u1AfterFirstU4Sale = await kvJson('u:' + U1);
assert(u1AfterFirstU4Sale.referral_points_balance === 45 && u1AfterFirstU4Sale.referral_purchase_count === 2, 'خرید دستی موفق کاربر معرفی‌شده ۱۰ امتیاز اضافه می‌کند');
const pointsBeforeU4Topup = Number(u1AfterFirstU4Sale.referral_points_balance || 0);
await press(U4, 'chg');await press(U4, 'chg:50000');await sendText(U4, 'رسید شارژ کیف پول زیرمجموعه');
const u4PendingIds = await kvJson('pend');let u4TopupId = '';
for (const pendingId of u4PendingIds.slice().reverse()) { const pendingOrder = await kvJson('o:' + pendingId); if (pendingOrder && String(pendingOrder.tg_id) === String(U4) && pendingOrder.type === 'charge') { u4TopupId = pendingId; break; } }
await press(ADMIN, 'a_ok:' + u4TopupId);
assert(u4TopupId && (await kvJson('o:' + u4TopupId)).status === 'approved' && Number((await kvJson('u:' + U4)).balance) === 50000 && Number((await kvJson('u:' + U1)).referral_points_balance) === pointsBeforeU4Topup, 'شارژ کیف پول زیرمجموعه پس از تأیید ثبت می‌شود اما هیچ امتیاز عضوگیری نمی‌دهد');
const pointsBeforeRejectedOrder = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
const rejectCheckout = await miniApi('/api/miniapp/checkout', user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'manual', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-manual-reject-0001' }) });
const rejectOrderId = rejectCheckout.json && rejectCheckout.json.order && rejectCheckout.json.order.id;
const unverifiedApproval = await miniApi('/api/miniapp/admin/orders/' + rejectOrderId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
const manualOverrideCheckout = await miniApi('/api/miniapp/checkout', user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'manual', panel_id: purchasable.panel_id, plan_id: managedPlanId, request_id: 'miniapp-manual-override-0001' }) });
const manualOverrideId = manualOverrideCheckout.json && manualOverrideCheckout.json.order && manualOverrideCheckout.json.order.id;
const manualOverrideView = await miniApi('/api/miniapp/admin/orders/' + manualOverrideId, adminInit);
const manualOverrideCustomerAction = await miniApi('/api/miniapp/admin/orders/' + manualOverrideId, user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve_manual', payment_received_confirmed: true }) });
const manualOverrideWithoutAck = await miniApi('/api/miniapp/admin/orders/' + manualOverrideId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve_manual' }) });
const manualOverridePending = await kvJson('o:' + manualOverrideId);
const u1PointsBeforeManualOverride = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
const manualOverrideApprove = await miniApi('/api/miniapp/admin/orders/' + manualOverrideId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve_manual', payment_received_confirmed: true, manual_note: 'رسید بانکی مقصد بررسی شد' }) });
const u1AfterManualOverride = await kvJson('u:' + U1);
const manualOverrideStored = await kvJson('o:' + manualOverrideId);
const manualOverrideLedger = await kvJson('ledger:sale:' + manualOverrideId);
assert(manualOverrideView.status === 200 && manualOverrideView.json.order.manual_approval_available && manualOverrideCustomerAction.status === 403 && manualOverrideWithoutAck.status === 400 && manualOverrideWithoutAck.json.error === 'manual_payment_confirmation_required' && manualOverridePending.status === 'pending' && manualOverridePending.payment_status !== 'paid' && u1PointsBeforeManualOverride === pointsBeforeRejectedOrder && manualOverrideApprove.status === 200 && manualOverrideApprove.json.order.status === 'approved' && manualOverrideStored.manual_approval && manualOverrideStored.manual_approved_by === String(ADMIN) && manualOverrideStored.manual_approval_note === 'رسید بانکی مقصد بررسی شد' && manualOverrideLedger.manual_approval && manualOverrideLedger.manual_approved_by === String(ADMIN) && u1AfterManualOverride.referral_points_balance === u1PointsBeforeManualOverride + 10, 'تأیید دستی فقط پس از تأیید صریح ادمین انجام می‌شود، ۱۰ امتیاز خرید موفق را می‌دهد و ثبت حسابرسی می‌شود');
const failedReceiptCheckout = await miniApi('/api/miniapp/checkout', user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'manual', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-receipt-forward-failed-01' }) });
const failedReceiptOrder = failedReceiptCheckout.json && failedReceiptCheckout.json.order;
const failedReceiptRecord = failedReceiptOrder && await kvJson('o:' + failedReceiptOrder.id);
failedReceiptRecord.receipt_text = 'تصویر رسید از Mini App پیوست شد'; failedReceiptRecord.receipt_upload_attempt_at = Date.now(); failedReceiptRecord.payment_status = 'awaiting_receipt'; await kv.put('o:' + failedReceiptOrder.id, JSON.stringify(failedReceiptRecord));
const failedReceiptView = await miniApi('/api/miniapp/admin/orders/' + failedReceiptOrder.id, adminInit);
const failedReceiptApproval = await miniApi('/api/miniapp/admin/orders/' + failedReceiptOrder.id, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) });
assert(failedReceiptView.status === 200 && !failedReceiptView.json.order.receipt_verified && failedReceiptApproval.status === 409 && failedReceiptApproval.json.error === 'payment_not_verified', 'تلاش ناموفق برای ارسال رسید Mini App به‌اشتباه به‌عنوان رسید تأییدشده قابل‌قبول نیست');
const adminRejectOrder = await miniApi('/api/miniapp/admin/orders/' + rejectOrderId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject', reason: 'رسید/واریز پیدا نشد' }) });
const repeatedReject = await miniApi('/api/miniapp/admin/orders/' + rejectOrderId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject', reason: 'تکرار' }) });
assert(rejectOrderId && unverifiedApproval.status === 409 && unverifiedApproval.json.error === 'payment_not_verified' && adminRejectOrder.status === 200 && adminRejectOrder.json.order.status === 'rejected' && repeatedReject.status === 409 && Number((await kvJson('u:' + U1)).referral_points_balance) === pointsBeforeRejectedOrder + 10, 'سفارش معلق/تأییدنشده/ردشده امتیاز نمی‌دهد و فقط خرید موفقِ دستیِ جداگانه ۱۰ امتیاز داشت');
const managedArchive = await miniApi('/api/miniapp/admin/plans', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'archive', id: managedPlanId }) });
const managedRestore = await miniApi('/api/miniapp/admin/plans', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle', id: managedPlanId }) });
assert(managedArchive.status === 200 && managedArchive.json.plan.archived && managedArchive.json.plan.enabled === false && managedRestore.json.plan.enabled && !managedRestore.json.plan.archived, 'آرشیو پلن سابقه را نگه می‌دارد و مدیر می‌تواند دوباره فعالش کند');

const u4Credit = await miniApi('/api/miniapp/admin/customers/' + U4, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 1000 }) });
const u4Debit = await miniApi('/api/miniapp/admin/customers/' + U4, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'debit', amount: 400 }) });
const u4CustomerDetail = await miniApi('/api/miniapp/admin/customers/' + U4, adminInit);
const deniedCustomerDetail = await miniApi('/api/miniapp/admin/customers/' + U4, user4Init);
assert(u4CustomerDetail.status === 200 && u4CustomerDetail.json.customer.tg_id === String(U4) && u4CustomerDetail.json.summary.last_purchase?.type === 'buy' && u4CustomerDetail.json.orders.some(x => x.status === 'approved') && u4CustomerDetail.json.subscriptions.length > 0, 'پروندهٔ مشتری آخرین خرید، سفارش‌ها و وضعیت اشتراک را تجمیع می‌کند');
assert(u4CustomerDetail.json.transactions.filter(x => x.kind === 'wallet_adjustment').length >= 2 && u4CustomerDetail.json.activity.some(x => x.action === 'receipt_submitted') && u4CustomerDetail.json.activity.some(x => x.action === 'order_approved') && u4CustomerDetail.json.coverage.activity_retention_days === 180 && deniedCustomerDetail.status === 403 && !u4CustomerDetail.text.includes('api_key'), 'تراکنش‌های کیف پول و فعالیت‌های پایشی ثبت و فقط به مدیر نمایش داده می‌شوند؛ Secrets افشا نمی‌شوند');
const u4CustomerHistory = await miniApi('/api/miniapp/customer', user4Init);
assert(u4CustomerHistory.status === 200 && Array.isArray(u4CustomerHistory.json.transactions) && u4CustomerHistory.json.transactions.some(x => x.kind === 'sale') && u4CustomerHistory.json.transactions.some(x => x.kind === 'wallet_adjustment') && !u4CustomerHistory.text.includes('card_number') && !u4CustomerHistory.text.includes('receipt_file_id'), 'مشتری سابقهٔ خرید و اصلاح کیف پول مشترک با Worker را می‌بیند؛ شماره کارت و شناسه فایل رسید افشا نمی‌شوند');
const adminBanSelf = await miniApi('/api/miniapp/admin/customers/' + ADMIN, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ban' }) });
const customerBan = await miniApi('/api/miniapp/admin/customers/' + U4, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ban' }) });
const bannedCustomerApi = await miniApi('/api/miniapp/customer', user4Init);
const customerUnban = await miniApi('/api/miniapp/admin/customers/' + U4, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unban' }) });
const deniedCustomerWrite = await miniApi('/api/miniapp/admin/customers/' + U4, user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 100000 }) });
assert(u4Credit.status === 200 && u4Debit.json.customer.balance === u4Credit.json.customer.balance - 400 && adminBanSelf.status === 403 && customerBan.status === 200 && bannedCustomerApi.status === 403 && customerUnban.status === 200 && deniedCustomerWrite.status === 403, 'ابزار مشتری/کیف پول نقش‌محور است؛ مدیر محافظت می‌شود و مشتری مسدود/آزاد می‌شود');

const walletBeforeMiniWithdrawal = Number((await kvJson('u:' + U1)).balance || 0);
await press(U1, 'wd');await sendText(U1, '50000');await sendText(U1, '6219861122334455');
const miniWithdrawalsPending = await miniApi('/api/miniapp/admin/withdrawals', adminInit);
const rejectWithdrawId = miniWithdrawalsPending.json.items.find(x => x.tg_id === String(U1))?.id;
const rejectedWithdrawal = rejectWithdrawId ? await miniApi('/api/miniapp/admin/withdrawals/' + rejectWithdrawId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reject' }) }) : { status: 0 };
const balanceAfterWithdrawReject = Number((await kvJson('u:' + U1)).balance || 0);
assert(miniWithdrawalsPending.status === 200 && rejectWithdrawId && rejectedWithdrawal.status === 200 && (await kvJson('w:' + rejectWithdrawId)).status === 'rejected' && balanceAfterWithdrawReject === walletBeforeMiniWithdrawal, 'رد برداشت از Mini App مبلغ را به کیف پول مشتری برمی‌گرداند');
await press(U1, 'wd');await sendText(U1, '50000');await sendText(U1, '6219861122334455');
const secondPending = await miniApi('/api/miniapp/admin/withdrawals', adminInit);
const approveWithdrawId = secondPending.json.items.find(x => x.tg_id === String(U1))?.id;
const approvedWithdrawal = approveWithdrawId ? await miniApi('/api/miniapp/admin/withdrawals/' + approveWithdrawId, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) }) : { status: 0 };
assert(approveWithdrawId && approvedWithdrawal.status === 200 && (await kvJson('w:' + approveWithdrawId)).status === 'approved', 'ادمین می‌تواند درخواست برداشت را از Mini App تأیید کند');

const cfgAutoForMiniApp = await kvJson('cfg') || {};
await kv.put('cfg', Object.assign({}, cfgAutoForMiniApp, { card_manual_enabled: true, card_auto_enabled: true }));
const autoMiniCheckout = await miniApi('/api/miniapp/checkout', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'shetab', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-auto-order-0001' })
});
const autoMiniOrder = autoMiniCheckout.json && autoMiniCheckout.json.order;
assert(autoMiniCheckout.status === 200 && autoMiniOrder && autoMiniOrder.payment_method === 'shetab' && autoMiniCheckout.json.payment.amount_rial === autoMiniCheckout.json.payment.amount_toman * 10, 'مسیر خودکار Mini App فقط با سوییچ خودکار روشن و معادل ریالی فعال می‌شود');
const u1PointsBeforeAutoMini = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
const autoMiniPaid = await shetabPost({ amount: autoMiniOrder.pay_amount, recipeId: 'MINI-APP-BANK-001' });
const pointsAfterAutoMini = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
const duplicateAutoMiniPaid = await shetabPost({ amount: autoMiniOrder.pay_amount, recipeId: 'MINI-APP-BANK-001' });
assert(autoMiniPaid.status === 200 && (await kvJson('o:' + autoMiniOrder.id)).status === 'approved' && pointsAfterAutoMini === u1PointsBeforeAutoMini + 10 && duplicateAutoMiniPaid.status === 200 && (await kvJson('u:' + U1)).referral_points_balance === pointsAfterAutoMini, 'پرداخت موفقِ زیرمجموعه ۱۰ امتیاز می‌دهد و callback بانکی تکراری سرویس/امتیاز را دوباره نمی‌دهد');
const customer4AfterAuto = await miniApi('/api/miniapp/customer', user4Init);
const renewSub = customer4AfterAuto.json.subscriptions.find(s => s.panel_id === purchasable.panel_id && s.plan_id === purchasable.plan_id);
assert(renewSub && renewSub.sid, 'Mini App اشتراک ایجادشده را با شناسهٔ تمدید برمی‌گرداند');
const renewalMiniCheckout = await miniApi('/api/miniapp/checkout', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', plan_id: purchasable.plan_id, sub_sid: renewSub.sid, request_id: 'miniapp-renew-order-0001' })
});
const renewalMiniOrder = renewalMiniCheckout.json && renewalMiniCheckout.json.order;
assert(renewalMiniCheckout.status === 200 && renewalMiniOrder && renewalMiniOrder.type === 'renew' && (await kvJson('o:' + renewalMiniOrder.id)).sub_sid === renewSub.sid, 'تمدید اشتراک هم از مسیر checkout داخل Mini App ساخته می‌شود');
const deleteWhileRenewalPending = await miniApi('/api/miniapp/subscriptions/' + renewSub.sid, user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete' }) });
assert(deleteWhileRenewalPending.status === 409 && deleteWhileRenewalPending.json.error === 'subscription_has_pending_order' && hUsers.has((await kvJson('s:' + renewSub.sid)).uuid), 'حذف اشتراک تا تعیین تکلیف سفارش تمدیدِ در انتظار مسدود می‌شود و دسترسی باقی می‌ماند');
const competingUpgrade = await miniApi('/api/miniapp/checkout', user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'manual', plan_id: managedPlanId, sub_sid: renewSub.sid, request_id: 'miniapp-upgrade-blocked-001' }) });
assert(competingUpgrade.status === 409 && competingUpgrade.json.error === 'subscription_has_pending_order' && competingUpgrade.json.order_id === renewalMiniOrder.id, 'تا تعیین تکلیف سفارش باز، سفارش تمدید/ارتقای متفاوت برای همان اشتراک ساخته نمی‌شود');
const renewalReceipt = new FormData(); renewalReceipt.append('reference', 'MINI-RENEW-456');
const renewalReceiptResp = await miniApi('/api/miniapp/orders/' + renewalMiniOrder.id + '/receipt', user4Init, { method: 'POST', body: renewalReceipt });
assert(renewalReceiptResp.status === 200 && (await kvJson('o:' + renewalMiniOrder.id)).receipt_submitted_at, 'ارسال کد پیگیری متنی برای رسید بدون عکس پشتیبانی می‌شود');
const u1PointsBeforeRenew = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
await press(ADMIN, 'a_ok:' + renewalMiniOrder.id);
assert((await miniApi('/api/miniapp/orders/' + renewalMiniOrder.id, user4Init)).json.order.status === 'approved' && Number((await kvJson('u:' + U1)).referral_points_balance) === u1PointsBeforeRenew + 10, 'تمدید موفق زیرمجموعه پس از تأیید مدیر تکمیل می‌شود و ۱۰ امتیاز می‌دهد');
const upgradedCheckout = await miniApi('/api/miniapp/checkout', user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'manual', plan_id: managedPlanId, sub_sid: renewSub.sid, request_id: 'miniapp-upgrade-order-0001' }) });
const upgradeOrder = upgradedCheckout.json && upgradedCheckout.json.order;
assert(upgradedCheckout.status === 200 && upgradeOrder && upgradeOrder.type === 'renew' && upgradeOrder.type_label === 'ارتقای پلن' && upgradeOrder.amount === Number(managedPlanCreate.json.plan.price) && (await kvJson('o:' + upgradeOrder.id)).upgrade_from_plan_id === purchasable.plan_id, 'ارتقا مبلغ کامل پلن جدید را می‌گیرد و در سفارش از تمدید عادی متمایز ثبت می‌شود');
const upgradeReceipt = new FormData(); upgradeReceipt.append('reference', 'MINI-UPGRADE-789');
const upgradeReceiptResp = await miniApi('/api/miniapp/orders/' + upgradeOrder.id + '/receipt', user4Init, { method: 'POST', body: upgradeReceipt });
const u1PointsBeforeUpgrade = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
await press(ADMIN, 'a_ok:' + upgradeOrder.id);
const u1PointsAfterUpgrade = Number((await kvJson('u:' + U1)).referral_points_balance || 0);
const upgradeOrderStatus = await miniApi('/api/miniapp/orders/' + upgradeOrder.id, user4Init);
const upgradedSubRecord = await kvJson('s:' + renewSub.sid);
const upgradedHiddifyUser = hUsers.get(upgradedSubRecord && upgradedSubRecord.uuid);
const upgradedCustomerHistory = await miniApi('/api/miniapp/customer', user4Init);
const upgradedLedger = await kvJson('ledger:sale:' + upgradeOrder.id);
assert(upgradeReceiptResp.status === 200 && upgradeOrderStatus.status === 200 && upgradeOrderStatus.json.order.status === 'approved' && u1PointsAfterUpgrade === u1PointsBeforeUpgrade + 10 && upgradedSubRecord.plan_id === managedPlanId && upgradedHiddifyUser.usage_limit_GB === 15 && upgradedHiddifyUser.package_days === 20 && upgradedHiddifyUser.current_usage_GB === 0 && upgradedCustomerHistory.json.orders.some(x => x.id === upgradeOrder.id && x.type_label === 'ارتقای پلن') && upgradedLedger.upgrade_from_plan_id === purchasable.plan_id, 'تأیید ارتقا سقف حجم/مدت را از امروز در Hiddify اعمال می‌کند و تاریخچه/دفترکل آن را ثبت می‌کند');
const customerSubDelete = await miniApi('/api/miniapp/subscriptions/' + renewSub.sid, user4Init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete' }) });
const u4AfterDelete = await miniApi('/api/miniapp/customer', user4Init);
assert(customerSubDelete.status === 200 && !(await kvJson('s:' + renewSub.sid)) && !(await kvJson('u:' + U4)).subs.includes(renewSub.sid) && !hUsers.has(upgradedSubRecord.uuid) && !u4AfterDelete.json.subscriptions.some(x => x.sid === renewSub.sid), 'حذف اشتراک از Mini App هم سرویس Hiddify را حذف می‌کند و هم فهرست مشترک ربات/مینی‌اپ را به‌روز می‌کند');

const walletBeforeMiniApp = await kvJson('u:' + U1);
const walletMiniCheckout = await miniApi('/api/miniapp/checkout', userInit, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'wallet', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-wallet-order-0001' })
});
const walletMiniOrder = walletMiniCheckout.json && walletMiniCheckout.json.order;
assert(walletMiniCheckout.status === 200 && walletMiniOrder && walletMiniOrder.status === 'approved' && (await kvJson('u:' + U1)).balance === walletBeforeMiniApp.balance - purchasable.price, 'پرداخت مستقیم با کیف پول داخل Mini App موجودی را یک‌بار کم و سفارش را تحویل می‌دهد');
const staleInit = await signedInitData(U1, {}, 90000);
const staleApi = await miniApi('/api/miniapp/bootstrap', staleInit);
assert(staleApi.status === 401, 'initData قدیمی/منقضی‌شده رد می‌شود');

await sendText(U3, '/start');
const photoApprovalId = 'photo-approve-001';
await kv.put('o:' + photoApprovalId, JSON.stringify({ id: photoApprovalId, tg_id: String(U3), first_name: 'PhotoCustomer', type: 'buy', status: 'pending', payment_method: 'manual', payment_status: 'review', receipt_submitted_at: Date.now(), receipt_file_id: 'TEST-RECEIPT-FILE', amount: Number(plans[plid].price), pay_amount: Number(plans[plid].price) + 10, plan_id: plid, panel_id: pid, created_at: Date.now() }));
const captionEditStart = TG.length;
await upd({ callback_query: { id: 'q' + (qSeq++), from: { id: ADMIN, first_name: 'Admin' }, message: { message_id: 987, chat: { id: ADMIN, type: 'private' }, photo: [{ file_id: 'TEST-RECEIPT-FILE' }], caption: 'رسید' }, data: 'a_ok:' + photoApprovalId } });
const captionEdits = TG.slice(captionEditStart).filter(x => x.method === 'editMessageCaption');
assert((await kvJson('o:' + photoApprovalId)).status === 'approved' && captionEdits.some(x => String(x.params.caption || '').includes('در حال تأیید') && String(x.params.caption || '').includes('\n🧾 شماره:')) && captionEdits.some(x => String(x.params.caption || '').includes('تأیید و پردازش شد') && x.params.reply_markup?.inline_keyboard?.length === 0), 'رسید تصویری هم در همان پیام کپشن را به وضعیت شروع و نتیجهٔ تأیید به‌روز می‌کند');

// ---------- نمایندگی Mini App ----------
const agentUiSource = fs.readFileSync(path.join(here, '..', 'public', 'miniapp.html'), 'utf8');
assert(agentUiSource.includes('id="agentsPage"') && agentUiSource.includes('id="agentPage"') && agentUiSource.includes('id="agentPricingForm"') && agentUiSource.includes('id="agentCreateForm"') && agentUiSource.includes('data-page="agents"') && agentUiSource.includes('data-page="agent"'), 'Mini App پنل مدیریت نماینده، قیمت پلن و پورتال مستقل نماینده را دارد');
assert(agentUiSource.includes('مشتری نیازی به حساب تلگرام ندارد') && agentUiSource.includes('agent/subscriptions') && agentUiSource.includes('agent/overview') && agentUiSource.includes('کپی لینک اشتراک'), 'رابط نماینده ساخت و تحویل دستی لینک اشتراک به مشتری بدون تلگرام را توضیح می‌دهد');
const promoterInit = await signedInitData(U12, { first_name: 'PromotedAgent', username: 'promoted_agent' });
const inviteeInit = await signedInitData(U13, { first_name: 'InvitedAgent', username: 'invited_agent' });
const regularCustomerWalletBeforeAgent = Number((await kvJson('u:' + U12)).balance || 0);
const promotedAgentResponse = await miniApi('/api/miniapp/admin/agents', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tg_id: String(U12) }) });
const promotedAgentBoot = await miniApi('/api/miniapp/bootstrap', promoterInit);
const promotedAgentDetailDefault = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit);
const regularAgentOverviewDenied = await miniApi('/api/miniapp/agent/overview', user4Init);
const regularAgentAdminDenied = await miniApi('/api/miniapp/admin/agents', user4Init);
assert(promotedAgentResponse.status === 200 && promotedAgentBoot.status === 200 && promotedAgentBoot.json.role === 'agent' && promotedAgentDetailDefault.status === 200 && promotedAgentDetailDefault.json.agent.balance === 0 && promotedAgentDetailDefault.json.agent.quota_remaining === 0 && promotedAgentDetailDefault.json.plans.some(p => p.id === purchasable.plan_id && p.agent_price === purchasable.price) && regularAgentOverviewDenied.status === 403 && regularAgentAdminDenied.status === 403, 'ادمین مشتری ثبت‌شده را نماینده می‌کند؛ نقش، قیمت پیش‌فرض و کنترل دسترسی API درست است');
const promotedAgentSearch = await miniApi('/api/miniapp/admin/agents?q=' + U12, adminInit);
assert(promotedAgentSearch.status === 200 && promotedAgentSearch.json.items.some(a => a.tg_id === String(U12)), 'فهرست نماینده‌ها با شناسهٔ تلگرام جست‌وجو می‌شود');
const agentPlanPrice = 123456;
const invalidAgentPrice = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan_prices: { [purchasable.plan_id]: 0 } }) });
const saveAgentPrice = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan_prices: { [purchasable.plan_id]: agentPlanPrice } }) });
const agentWalletCredit = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 50000 }) });
const agentQuotaSet = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: 1 }) });
const agentOverviewInitial = await miniApi('/api/miniapp/agent/overview', promoterInit);
const agentQuotaFail = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Quota Test', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-quota-test-0001' }) });
assert(invalidAgentPrice.status === 400 && saveAgentPrice.status === 200 && agentWalletCredit.status === 200 && agentQuotaSet.status === 200 && agentOverviewInitial.status === 200 && agentOverviewInitial.json.agent.balance === 50000 && agentOverviewInitial.json.agent.quota_remaining === 1 && agentOverviewInitial.json.products.some(p => p.plan_id === purchasable.plan_id && p.agent_price === agentPlanPrice) && agentQuotaFail.status === 409 && agentQuotaFail.json.error === 'agent_balance_insufficient', 'مدیر قیمت خرید ثابت، کیف پول و سهمیهٔ مستقل را تعیین می‌کند و نماینده فقط پلن قیمت‌گذاری‌شده را می‌بیند');
const agentWalletTopup = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 250000 }) });
const hUsersBeforeAgentCreate = hUsers.size;
const agentCreateBody = { customer_name: 'مشتری بدون تلگرام', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-create-test-0001' };
const agentCreateSuccess = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agentCreateBody) });
const agentSub = agentCreateSuccess.json && agentCreateSuccess.json.subscription;
const agentSubRecord = agentSub ? await kvJson('s:' + agentSub.sid) : null;
const agentHiddifyUser = agentSubRecord ? hUsers.get(agentSubRecord.uuid) : null;
const agentAfterCreate = await kvJson('agent:' + U12);
const agentUserRecordAfterCreate = await kvJson('u:' + U12);
const agentCreateDuplicate = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(agentCreateBody) });
const agentCreateOverQuota = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, agentCreateBody, { request_id: 'agent-create-overquota-01' })) });
assert(agentWalletTopup.status === 200 && agentWalletTopup.json.agent.balance === 300000 && agentCreateSuccess.status === 200 && agentSubRecord && agentSubRecord.agent_id === String(U12) && agentSubRecord.tg_id === '' && agentSubRecord.customer_name === 'مشتری بدون تلگرام' && agentHiddifyUser && agentHiddifyUser.telegram_id === undefined && agentSub.link.startsWith('https://') && hUsers.size === hUsersBeforeAgentCreate + 1 && agentAfterCreate.balance === 300000 - agentPlanPrice && agentAfterCreate.quota_remaining === 0 && agentAfterCreate.total_created === 1 && !((agentUserRecordAfterCreate.subs || []).includes(agentSub.sid)) && Number(agentUserRecordAfterCreate.balance || 0) === regularCustomerWalletBeforeAgent && agentCreateDuplicate.status === 200 && agentCreateDuplicate.json.duplicate && agentCreateDuplicate.json.subscription.sid === agentSub.sid && hUsers.size === hUsersBeforeAgentCreate + 1 && agentCreateOverQuota.status === 409 && agentCreateOverQuota.json.error === 'agent_quota_exhausted', 'ساخت موفق برای مشتری بدون تلگرام فقط یک یوزر Hiddify می‌سازد، کیف پول/سهمیه را یک‌بار کسر و درخواست تکراری را idempotent می‌کند');
const agentHistoryAfterCreate = await miniApi('/api/miniapp/agent/overview', promoterInit);
const agentLedgerPurchase = agentSub ? await kvJson('agent_ledger:' + U12 + ':purchase-' + agentSub.sid) : null;
assert(agentHistoryAfterCreate.status === 200 && agentHistoryAfterCreate.json.subscriptions.some(s => s.sid === agentSub.sid && s.customer_name === 'مشتری بدون تلگرام' && s.link === agentSub.link) && agentHistoryAfterCreate.json.transactions.some(t => t.subscription_sid === agentSub.sid && t.amount === agentPlanPrice) && agentLedgerPurchase && agentLedgerPurchase.balance_after === 300000 - agentPlanPrice, 'نماینده لینک و سابقهٔ اشتراک را می‌بیند و کسر مبلغ در دفتر مستقل کیف پول ثبت می‌شود');
const agentDebit = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'debit', amount: 10000 }) });
const agentCreditSmall = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 5000 }) });
const agentQuotaIncrease = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: 7 }) });
const agentQuotaDecrease = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: 2 }) });
const agentDisabled = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle' }) });
const disabledAgentBoot = await miniApi('/api/miniapp/bootstrap', promoterInit);
const disabledAgentApi = await miniApi('/api/miniapp/agent/overview', promoterInit);
const disabledAgentCreate = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'disabled test', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-disabled-create-01' }) });
const agentReenabled = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle' }) });
assert(agentDebit.status === 200 && agentDebit.json.agent.balance === 300000 - agentPlanPrice - 10000 && agentCreditSmall.status === 200 && agentCreditSmall.json.agent.balance === 300000 - agentPlanPrice - 5000 && agentQuotaIncrease.status === 200 && agentQuotaIncrease.json.agent.quota_remaining === 7 && agentQuotaDecrease.status === 200 && agentQuotaDecrease.json.agent.quota_remaining === 2 && agentDisabled.status === 200 && !agentDisabled.json.agent.enabled && disabledAgentBoot.json.role === 'agent' && disabledAgentApi.status === 200 && disabledAgentApi.json.disabled === true && disabledAgentApi.json.products.length === 0 && disabledAgentCreate.status === 403 && disabledAgentCreate.json.error === 'agent_inactive' && agentReenabled.status === 200 && agentReenabled.json.agent.enabled && Number((await kvJson('u:' + U12)).balance || 0) === regularCustomerWalletBeforeAgent, 'مدیر می‌تواند کیف پول نماینده را شارژ/کسر، سهمیه را زیاد/کم و نمایندگی را غیرفعال/فعال کند؛ کیف پول مشتری جدا می‌ماند');
const inviteCreate = await miniApi('/api/miniapp/admin/agents/invites', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' }) });
const inviteStartPayload = inviteCreate.json && inviteCreate.json.url ? new URL(inviteCreate.json.url).searchParams.get('start') : '';
await sendText(U13, '/start ' + inviteStartPayload);
const invitedAgentRecord = await kvJson('agent:' + U13);
const invitedAgentBoot = await miniApi('/api/miniapp/bootstrap', inviteeInit);
const inviteListAfterUse = await miniApi('/api/miniapp/admin/agents/invites', adminInit);
const reusedInviteStart = await sendText(U9, '/start ' + inviteStartPayload);
const reusedInviteAgent = await kvJson('agent:' + U9);
const inviteCreateToRevoke = await miniApi('/api/miniapp/admin/agents/invites', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create' }) });
const revokedAgentInvite = await miniApi('/api/miniapp/admin/agents/invites', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', code: inviteCreateToRevoke.json.code }) });
const revokedPayload = inviteCreateToRevoke.json && inviteCreateToRevoke.json.url ? new URL(inviteCreateToRevoke.json.url).searchParams.get('start') : '';
await sendText(U10, '/start ' + revokedPayload);
assert(inviteCreate.status === 200 && /^https:\/\/t\.me\/TestShopBot\?start=agent_[A-Z2-9]{10,32}$/.test(inviteCreate.json.url) && invitedAgentRecord && invitedAgentBoot.status === 200 && invitedAgentBoot.json.role === 'agent' && inviteListAfterUse.json.items.some(i => i.code === inviteCreate.json.code && i.used_by === String(U13) && !i.active) && !reusedInviteAgent && inviteCreateToRevoke.status === 200 && revokedAgentInvite.status === 200 && !(await kvJson('agent:' + U10)), 'لینک دعوت یک‌بارمصرف ثبت‌نام مشتری موجود را به نماینده تبدیل و پس از استفاده/لغو از استفادهٔ دوباره جلوگیری می‌کند');
const quotaBeforeConcurrentAgentCreation = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: 1 }) });
const agentBeforeConcurrentCreate = await kvJson('agent:' + U12);
const hUsersBeforeConcurrentAgentCreate = hUsers.size;
const concurrentAgentRequests = await Promise.all([
  miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Concurrent customer A', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-concurrent-create-a1' }) }),
  miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Concurrent customer B', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-concurrent-create-b1' }) })
]);
const concurrentSuccesses = concurrentAgentRequests.filter(r => r.status === 200);
const concurrentDenied = concurrentAgentRequests.filter(r => r.status === 409);
const agentAfterConcurrentCreate = await kvJson('agent:' + U12);
assert(quotaBeforeConcurrentAgentCreation.status === 200 && concurrentSuccesses.length === 1 && concurrentDenied.length === 1 && ['agent_creation_processing','agent_quota_exhausted'].includes(concurrentDenied[0].json.error) && hUsers.size === hUsersBeforeConcurrentAgentCreate + 1 && agentAfterConcurrentCreate.total_created === agentBeforeConcurrentCreate.total_created + 1 && agentAfterConcurrentCreate.quota_remaining === 0 && agentAfterConcurrentCreate.balance === agentBeforeConcurrentCreate.balance - agentPlanPrice, 'قفل ساخت هم‌زمان مانع مصرف دوبارهٔ کیف پول/سهمیه و ایجاد اشتراک تکراری می‌شود');
const agentNoName = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-no-name-test-01' }) });
const badAgentQuota = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: -1 }) });
assert(agentNoName.status === 400 && agentNoName.json.error === 'agent_customer_name_required' && badAgentQuota.status === 400 && badAgentQuota.json.error === 'invalid_agent_quota', 'نام مشتری و سهمیهٔ عددی نامعتبر پیش از هر تغییر مالی/ساخت رد می‌شوند');

console.log('— تمام —');
if (process.exitCode) console.error('❌ بعضی تست‌ها شکست خوردند');
else console.log('🎉 همه تست‌ها پاس شدند');
