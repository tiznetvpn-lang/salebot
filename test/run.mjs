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
src = src.replace('export default APP;', 'globalThis.APP = APP; globalThis.__subscriptionQrPng = subscriptionQrPng; globalThis.__createKvBackupFile = createKvBackupFile; globalThis.__adminNotifyOrder = adminNotifyOrder; globalThis.__applyCommission = applyCommission; globalThis.__hCreateUser = hCreateUser; globalThis.__normalizePhone = normalizePhone; globalThis.__isJoinGateMarkup = isJoinGateMarkup; globalThis.__isPhoneRequestMarkup = isPhoneRequestMarkup; globalThis.__accessGate = accessGate; globalThis.__DEFAULT_SETTINGS = DEFAULT_SETTINGS; globalThis.__btnSlotFor = btnSlotFor; globalThis.__decorateMarkup = decorateMarkup; globalThis.__btnStyleFor = btnStyleFor; globalThis.__resetBtnUI = () => { BTN_UI_CACHE = { at: 0, colors: true, icons: {} }; }; globalThis.__btnUI = btnUI; globalThis.__resetChatButtons = () => { resetChatButtonCache(); }; globalThis.__chatButtons = chatButtons; globalThis.__retentionSweep = retentionSweep; globalThis.__shetabMakeTestOrder = shetabMakeTestOrder; globalThis.__shetabDropTestOrder = shetabDropTestOrder; globalThis.__retentionConfig = retentionConfig; globalThis.__saveSub = saveSub; globalThis.__saveCfg = saveCfg; globalThis.__getCfg = getCfg; globalThis.__getAgent = getAgent;');
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
let tgMemberStatus = 'member';   // وضعیت عضویت کاربر تستی در کانال
let tgBotStatus = 'administrator'; // وضعیت خود ربات در کانال
let tgChatError = '';
let tgMemberError = '';
let tgRejectDecorated = 0; // اگر > 0 باشد، اولین پیام با دکمهٔ استایل‌دار رد می‌شود
let midSeq = 100;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  // آزمون دامنه از سمت سرور: خود Worker آدرس عمومی را صدا می‌زند.
  if (u === 'https://bot.tiznet.site/healthz') return Response.json({ ok: true, version: pkgVersion }, { status: 200 });
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
    if (tgRejectDecorated > 0 && (method === 'sendMessage' || method === 'editMessageText')) {
      const kb = params.reply_markup && (params.reply_markup.inline_keyboard || params.reply_markup.keyboard);
      const hasDecor = Array.isArray(kb) && kb.flat().some((b) => b && (b.style || b.icon_custom_emoji_id));
      if (hasDecor) {
        tgRejectDecorated--;
        return Response.json({ ok: false, description: 'Bad Request: BUTTON_STYLE_INVALID' }, { status: 400 });
      }
    }
    if (method === 'getMe') return Response.json({ ok: true, result: { id: 4242, username: 'TestShopBot' } });
    if (method === 'getChat') {
      if (tgChatError) return Response.json({ ok: false, description: tgChatError }, { status: 400 });
      const reqId = String(params.chat_id);
      return Response.json({ ok: true, result: { id: -1001234567890, title: 'کانال تست', type: 'channel', username: reqId.replace(/^@/, '') } });
    }
    if (method === 'getChatMember') {
      if (tgMemberError) return Response.json({ ok: false, description: tgMemberError }, { status: 400 });
      const who = Number(params.user_id);
      if (who === 4242) return Response.json({ ok: true, result: { status: tgBotStatus } });
      return Response.json({ ok: true, result: { status: tgMemberStatus, is_member: tgMemberStatus === 'member' } });
    }
    if (method === 'getFile') return Response.json({ ok: true, result: { file_path: 'photos/receipt.png' } });
    if (method === 'setWebhook') return Response.json({ ok: true, result: true });
    if (method === 'getWebhookInfo') return Response.json({ ok: true, result: { url: 'https://bot.tiznet.site/webhook', pending_update_count: 0 } });
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
// امضای پکیجی که تلگرام بعد از requestContact به مینی‌اپ می‌دهد (همان قالب initData).
async function signedContactRaw(phone, user_id, ageSeconds = 0) {
  const params = new URLSearchParams();
  params.set('auth_date', String(Math.floor(Date.now() / 1000) - ageSeconds));
  params.set('contact', JSON.stringify({ phone_number: phone, first_name: 'Owner', user_id: user_id == null ? undefined : Number(user_id) }));
  const check = [...params.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([k, v]) => k + '=' + v).join('\n');
  const enc = new TextEncoder();
  const hmac = async (key, data) => {
    const raw = key instanceof Uint8Array ? key : enc.encode(String(key));
    const ck = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', ck, enc.encode(String(data))));
  };
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
function lookupButtons(msg) {
  const rows = msg && msg.params && msg.params.reply_markup && msg.params.reply_markup.inline_keyboard;
  return Array.isArray(rows) ? rows.flat() : [];
}
function fmtTomanForTest(n) { return Number(n || 0).toLocaleString('en-US') + ' تومان'; }
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
assert(miniAppSource.includes('--bg: #4a0911') && miniAppSource.includes('--brand-blue:#a60b18') && miniAppSource.includes("font-family:'Yekan',Vazirmatn") && miniAppSource.includes('/assets/Yekan.woff2') && fs.statSync(path.join(here, '..', 'public', 'assets', 'Yekan.woff2')).size > 10000 && yekanLicense.includes('SIL Open Font License, Version 1.1') && miniAppSource.includes('/assets/Vazirmatn-Arabic.woff2') && miniAppSource.includes('/assets/Vazirmatn-Latin.woff2'), 'فونت جایگزین Yekan با فایل و مجوز OFL 1.1 محلی جاسازی شده و Vazirmatn fallback آن است');
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
const shetabHealth = await get('/wp-json/webdide-cv/v1/health');
const powerPsShetabHealth = await get('/api/shetab-verify/');
// لایهٔ سازگاری وردپرس: اپ شتاب برای «تست اتصال» ساختار REST وردپرس را می‌سنجد.
const wpIndexResp = await get('/wp-json/');
const wpIndexJson = JSON.parse(wpIndexResp.text);
const wpIndexNoSlash = await get('/wp-json');
const wpNamespaceResp = await get('/wp-json/webdide-cv/v1');
const wpV2Types = await get('/wp-json/wp/v2/types');
const wpNamespaceJson = JSON.parse(wpNamespaceResp.text);
const wpIndexViaRestRoute = await get('/?rest_route=/');
const wpConfirmGet = await get('/wp-json/webdide-cv/v1/confirm');
const wpConfirmGetJson = JSON.parse(wpConfirmGet.text);
const wpStatusNoId = await get('/wp-json/webdide-cv/v1/status');
const wpStatusUnknown = await get('/wp-json/webdide-cv/v1/status?order_id=424242');
const wpStatusUnknownJson = JSON.parse(wpStatusUnknown.text);
const wpUnknownRoute = await get('/wp-json/webdide-cv/v1/does-not-exist');
const wpOptions = await APP.fetch(new Request('https://t.test/wp-json/webdide-cv/v1/confirm', { method: 'OPTIONS' }), env, {});
const shetabHealthWrongKey = await APP.fetch(new Request('https://t.test/api/shetab-verify', { headers: { Authorization: 'Bearer wrong-key' } }), env, {});
const shetabHealthBlankKey = await APP.fetch(new Request('https://t.test/api/shetab-verify', { headers: { Authorization: 'Bearer' } }), env, {});
const shetabUnconfiguredEnv = Object.assign({}, env, { SHETAB_API_SECRET: '' });
const shetabHealthUnconfigured = await APP.fetch(new Request('https://t.test/api/shetab-verify'), shetabUnconfiguredEnv, {});
const shetabHealthJson = JSON.parse(shetabHealth.text);
const shetabWrongJson = await shetabHealthWrongKey.json();
const shetabMissingJson = await shetabHealthUnconfigured.json();
assert(shetabHealth.status === 200 && shetabHealthJson.success === true && shetabHealthJson.secret_set === true
  && String(shetabHealthJson.endpoint).endsWith('/wp-json/webdide-cv/v1/confirm') && shetabHealthJson.version
  && powerPsShetabHealth.status === 200 && JSON.parse(powerPsShetabHealth.text).success === true
  && shetabHealthWrongKey.status === 401 && shetabWrongJson.reason === 'secret_mismatch' && !!shetabWrongJson.hint
  && shetabHealthBlankKey.status === 401
  && shetabHealthUnconfigured.status === 503 && shetabMissingJson.reason === 'secret_missing' && !!shetabMissingJson.hint,
  'تست اتصال GET روی هر دو مسیر Shetab پاسخ درست می‌دهد و reason/hint دقیق برای کلید اشتباه و Secret خالی برمی‌گرداند');

assert(wpIndexResp.status === 200 && Array.isArray(wpIndexJson.namespaces) && wpIndexJson.namespaces.includes('webdide-cv/v1')
  && wpIndexJson.routes && wpIndexJson.routes['/wp-json/webdide-cv/v1/confirm']
  && wpIndexJson.routes['/wp-json/webdide-cv/v1/confirm'].methods.join(',') === 'POST'
  && String(wpIndexJson.url).startsWith('https://') && wpIndexJson.timezone_string === 'Asia/Tehran'
  && wpIndexNoSlash.status === 200
  && wpIndexViaRestRoute.status === 200 && JSON.parse(wpIndexViaRestRoute.text).namespaces.includes('webdide-cv/v1')
  && wpIndexJson.namespaces.includes('wp/v2') && wpV2Types.status === 200
  && wpNamespaceResp.status === 200 && wpNamespaceJson.namespace === 'webdide-cv/v1'
  && !!wpNamespaceJson.routes['/webdide-cv/v1/confirm']
  && shetabWrongJson.code === 'secret_mismatch' && shetabWrongJson.data.status === 401,
  'ایندکس REST وردپرس با namespaces و routeهای افزونه سرو می‌شود (هم /wp-json/ هم ?rest_route=/ و بدنهٔ خطا شامل code و data.status است)');

assert(wpConfirmGet.status === 404 && wpConfirmGetJson.code === 'rest_no_route' && wpConfirmGetJson.data.status === 404
  && wpUnknownRoute.status === 404
  && wpStatusNoId.status === 400 && JSON.parse(wpStatusNoId.text).code === 'missing_order_id'
  && wpStatusUnknown.status === 200 && wpStatusUnknownJson.status === 'not_found' && Number(wpStatusUnknownJson.order_id) === 424242
  && wpOptions.status === 204 && String(wpOptions.headers.get('access-control-allow-origin')) === '*'
  && String(wpOptions.headers.get('allow')).includes('POST'),
  'مسیرهای وردپرس مثل rest_route واقعی رفتار می‌کنند: GET روی confirm → rest_no_route، status → not_found، OPTIONS → ۲۰۴ با CORS');
const miniAsset = await get('/miniapp');
assert(miniAsset.status === 200 && miniAsset.text.includes('TiznetVPN Mini App'), 'GET /miniapp فایل Mini App را از binding دارایی Worker می‌خواند');
const noInitData = await miniApi('/api/miniapp/bootstrap');
assert(noInitData.status === 401, 'API مینی‌اپ بدون initData تلگرام را رد می‌کند');
const badInitData = await signedInitData(U1);
const badApi = await miniApi('/api/miniapp/bootstrap', badInitData + '&tampered=1');
assert(badApi.status === 401, 'API مینی‌اپ دست‌کاری initData را رد می‌کند');

await sendText(U1, '/start');
assert((lastMsgTo(U1) || {}).params && lastMsgTo(U1).params.text.includes('تیزنت VPN | TiznetVPN'), '/start صفحهٔ اصلی برند تیزنت را نشان می‌دهد');
const homeMarkup = lastMsgTo(U1).params.reply_markup;
assert(homeMarkup && Array.isArray(homeMarkup.keyboard) && homeMarkup.keyboard.flat().length === 6 && !homeMarkup.inline_keyboard, 'منوی اصلی فقط با کیبورد پایین چت می‌آید و هیچ دکمهٔ شیشه‌ای داخل پیام ندارد');
const privateMenuButton = TG.find(x => x.method === 'setChatMenuButton' && String(x.params.chat_id) === String(U1));
assert(privateMenuButton && privateMenuButton.params.menu_button.type === 'web_app' && privateMenuButton.params.menu_button.text === 'tiznet' && privateMenuButton.params.menu_button.web_app.url === 'https://t.test/miniapp' && (await kvJson('u:' + U1)).miniapp_menu_set_version === 'tiznetvpn-menu-button-ubuntu-v1', 'MenuButtonWebApp عنوان دقیق tiznet با حروف کوچک دارد و نسخهٔ برچسب به‌روزرسانی می‌شود');
assert(String(lastMsgTo(U1).params.text || '').includes('از کیبورد پایین چت استفاده کنید'), 'پیام خانه کاربر را به کیبورد پایین چت راهنمایی می‌کند');
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
const miniOnlyKeyboardMessage = miniOnlyStartMessages[0];
const miniOnlyCommands = TG.filter(x => x.method === 'setMyCommands').at(-1);
const miniOnlyMenu = TG.find(x => x.method === 'setChatMenuButton' && String(x.params.chat_id) === String(U5));
await sendText(U5, '🛍 خرید اشتراک');
const emojiButtonEntry = lastMsgTo(U5);
await sendText(U5, 'خرید اشتراک');
const plainButtonEntry = lastMsgTo(U5);
assert(emojiButtonEntry && emojiButtonEntry.params.text.includes('برای خرید اشتراک وارد اپ فروش تیزنت شوید') && plainButtonEntry && plainButtonEntry.params.text.includes('برای خرید اشتراک وارد اپ فروش تیزنت شوید'), 'دکمه‌های ایموجی‌دار ربات کار می‌کنند و متن بدون ایموجی هم پشتیبانی می‌شود');
const exactRobotButtons = ['🛍 خرید اشتراک','🎧 پشتیبانی','🎁 اشتراک رایگان','📘 راهنما','🪪 اطلاعات حساب','🤝 دریافت نمایندگی'];
const replyTexts = miniOnlyKeyboardMessage?.params.reply_markup?.keyboard?.flat().map(x => x.text) || [];
assert(miniOnlyEntry && miniOnlyEntry.params.text.includes('دکمهٔ منوی تلگرام') && !miniOnlyEntry.params.reply_markup?.inline_keyboard && miniOnlyKeyboardMessage?.params.reply_markup?.keyboard && JSON.stringify(replyTexts) === JSON.stringify(exactRobotButtons), '/start در Mini App-only فقط کیبورد پایین چت با همان شش دکمه را می‌فرستد و دکمهٔ شیشه‌ای داخل پیام ندارد');
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
assert(!JSON.stringify(lastMsgTo(U1, 'editMessageText').params.reply_markup || {}).includes('payc:'), 'روش دستی خاموش از صفحه پرداخت مخفی شد');
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
assert(!manualPayMsg.params.reply_markup?.inline_keyboard && manualPayMsg.params.text.includes('1,200,000 ریال'), 'پرداخت دستی معادل ریالی را در متن نشان می‌دهد و دکمهٔ شیشه‌ای ندارد');
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
const detailMsg = lastMsgTo(U3, 'editMessageText');
assert(!detailMsg.params.reply_markup?.inline_keyboard, 'صفحهٔ جزئیات پلن برای مشتری بدون دکمهٔ شیشه‌ای است');
await press(U3, `payx:${pid}:${plid}`);
const pendAuto = await kvJson('pend');
const autoId = pendAuto.find((id) => { const x = kv.m.get('o:' + id); return x && JSON.parse(x).tg_id === U3; });
const autoOrder = await kvJson('o:' + autoId);
assert(autoOrder && autoOrder.payment_method === 'shetab' && autoOrder.pay_amount >= autoOrder.amount + 10 && autoOrder.pay_amount <= autoOrder.amount + 999, 'مبلغ یکتای خرید ۱۰ تا ۹۹۹ تومان بیشتر از مبلغ پایه است');
const autoPayMsg = lastMsgTo(U3);
assert(!autoPayMsg.params.reply_markup?.inline_keyboard && autoPayMsg.params.text.includes((autoOrder.pay_amount * 10).toLocaleString('en-US') + ' ریال'), 'پرداخت خودکار معادل ریالی را در متن نشان می‌دهد و دکمهٔ شیشه‌ای ندارد');
const hBeforeAuto = hUsers.size;
let badKeyResp = await shetabPostAt('/api/shetab-verify', { amount: autoOrder.pay_amount, recipeId: 'BADKEY' }, 'wrong-key');
assert(badKeyResp.status === 401 && hUsers.size === hBeforeAuto, 'secret اشتباه درخواست پرداخت را رد کرد');
let noMatchResp = await shetabPost({ amount: autoOrder.pay_amount + 12345, recipeId: 'NOMATCH' });
assert(noMatchResp.status === 404 && hUsers.size === hBeforeAuto, 'مبلغ نامنطبق سفارشی را تأیید نکرد');
const wpStatusPending = await get('/wp-json/webdide-cv/v1/status?order_id=' + autoId);
const wpStatusPendingJson = JSON.parse(wpStatusPending.text);
assert(wpStatusPending.status === 200 && wpStatusPendingJson.status === 'pending' && Number(wpStatusPendingJson.amount) === Number(autoOrder.pay_amount) && String(wpStatusPendingJson.order_id) === String(autoId), 'مسیر status افزونه، سفارش در انتظار را با همان مبلغ pending برمی‌گرداند');
let paidResp = await shetabPost({ amount: String(autoOrder.pay_amount), recipeId: 'BANK-REF-001' });
const paidJson = await paidResp.json();
const paidOrder = await kvJson('o:' + autoId);
assert(paidResp.status === 200 && paidJson.payment_confirmed && paidJson.message === 'Payment confirmed successfully.' && paidOrder.status === 'approved' && paidOrder.payment_status === 'paid', 'مسیر confirm پلاگین با پاسخ مورد انتظار، پرداخت تطبیق‌یافته را تأیید می‌کند');
const wpStatusPaid = await get('/wp-json/webdide-cv/v1/status?order_id=' + autoId);
assert(JSON.parse(wpStatusPaid.text).status === 'confirmed', 'بعد از تأیید پرداخت، مسیر status وضعیت confirmed می‌دهد');
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
// — دفتر رویداد، واریز بی‌صاحب و وصل‌کردن دستی (فاز ۱ تا ۳)
await press(U3, 'buy');
await press(U3, 'bp:' + pid);
await press(U3, `bl:${pid}:${plid}`);
await press(U3, `payx:${pid}:${plid}`);
const pendForAttach = await kvJson('pend');
const attachId = pendForAttach.slice().reverse().find((id) => {
  const raw = kv.m.get('o:' + id); if (!raw) return false;
  const o = JSON.parse(raw); return o.tg_id === U3 && o.status === 'pending' && o.payment_method === 'shetab';
});
const attachOrderBefore = await kvJson('o:' + attachId);
const evtIndexBefore = (await kvJson('shetab_evt_index')) || [];
const orphanAmount = Number(attachOrderBefore.pay_amount) + 5000;
const orphanResp = await shetabPost({ amount: orphanAmount, recipeId: 'ORPHAN-001' });
const orphanJson = await orphanResp.json();
const evtIndexAfter = (await kvJson('shetab_evt_index')) || [];
const orphanEvtId = evtIndexAfter[0];
const orphanEvt = await kvJson('shetab_evt:' + orphanEvtId);
const orphanAlert = lastMsgTo(ADMIN);
assert(orphanResp.status === 404 && orphanJson.success === false && evtIndexAfter.length === evtIndexBefore.length + 1
  && orphanEvt && orphanEvt.kind === 'orphan' && Number(orphanEvt.amount) === orphanAmount
  && String(orphanAlert.params.text).includes('واریز بدون سفارش منطبق')
  && JSON.stringify(orphanAlert.params.reply_markup).includes('a_shev:' + orphanEvtId),
  'واریز بدون سفارش منطبق در دفتر رویداد ثبت و همراه مبلغ و دکمهٔ وصل‌کردن به ادمین هشدار داده شد');

await press(ADMIN, 'a_shev:' + orphanEvtId);
const attachPick = lastMsgTo(ADMIN, 'editMessageText');
await press(ADMIN, `a_shl:${orphanEvtId}:${attachId}`);
const attachConfirm = lastMsgTo(ADMIN, 'editMessageText');
const hBeforeAttach = hUsers.size;
await press(ADMIN, `a_shly:${orphanEvtId}:${attachId}`);
const attachDone = lastMsgTo(ADMIN, 'editMessageText');
const attachedOrder = await kvJson('o:' + attachId);
const attachedEvt = await kvJson('shetab_evt:' + orphanEvtId);
assert(String(attachPick.params.text).includes('وصل‌کردن واریز به سفارش') && String(attachPick.params.text).includes('انتخاب کنید')
  && lookupButtons(attachPick).some((b) => b.callback_data === `a_shl:${orphanEvtId}:${attachId}`),
  'فهرست سفارش‌های باز برای وصل‌کردن واریز بی‌صاحب با اختلاف مبلغ نمایش داده شد');
assert(String(attachConfirm.params.text).includes('تأیید نهایی وصل‌کردن واریز') && String(attachConfirm.params.text).includes('اختلاف'),
  'پیش از تأیید نهایی، مبلغ واریز و اختلاف با سفارش دوباره نمایش داده می‌شود');
assert(attachedOrder.status === 'approved' && attachedOrder.payment_status === 'paid' && attachedOrder.manual_approval === true
  && attachedEvt.kind === 'attached' && attachedEvt.resolved_order_id === attachId && hUsers.size === hBeforeAttach + 1
  && String(attachDone.params.text).includes('وصل شد و سرویس تحویل داده شد')
  && lastMsgTo(U3).params.text.includes('واریز شما به سفارش'),
  'ادمین واریز بی‌صاحب را به سفارش وصل کرد، سرویس ساخته شد و مشتری و ادمین هر دو خبر گرفتند');

await press(ADMIN, 'a_shlog');
const eventLogMsg = lastMsgTo(ADMIN, 'editMessageText');
assert(String(eventLogMsg.params.text).includes('رویدادهای اخیر بانکی')
  && String(eventLogMsg.params.text).includes(fmtTomanForTest(orphanAmount))
  && String(eventLogMsg.params.text).includes('واریز بی‌صاحب')
  && lookupButtons(eventLogMsg).some((b) => b.callback_data === 'a_shtest'),
  'گزارش رویدادهای بانکی مبلغ/نوع آخرین رخدادها را با دسترسی به آزمون پرداخت نشان می‌دهد');

await press(ADMIN, 'a_shapp');
const appGuide = lastMsgTo(ADMIN, 'editMessageText');
const appGuideButtons = lookupButtons(appGuide);
const secretCopy = appGuideButtons.find((b) => b.copy_text);
assert(String(appGuide.params.text).includes('اتصال اپ Shetab Verification')
  && String(appGuide.params.text).includes('/wp-json/webdide-cv/v1/confirm')
  && String(appGuide.params.text).includes('سازگاری REST وردپرس')
  && !!secretCopy && secretCopy.copy_text.text === 'shetab-test-secret'
  && appGuideButtons.some((b) => b.copy_text && b.copy_text.text === 'https://t.test/wp-json/webdide-cv/v1/confirm')
  && appGuideButtons.some((b) => b.callback_data === 'a_shtest'),
  'صفحهٔ اتصال اپ آدرس دقیق سرور و دکمهٔ کپی Secret را بدون نمایش خودِ Secret نشان می‌دهد');
const appQrButton = appGuideButtons.find((b) => b.callback_data === 'a_shqr');
assert(appQrButton && String(appGuide.params.text).includes('ذخیره تنظیمات'),
  'صفحهٔ اتصال اپ دکمهٔ «QR آدرس» و یادآوری ترتیب «ذخیره تنظیمات → تست اتصال» را دارد');
await press(ADMIN, 'a_shqr');
const qrShot = TG.filter((x) => x.method === 'sendPhoto' && String(x.params.chat_id) === String(ADMIN) && x.params.photo_name === 'tiznetvpn-shetab-endpoint-qr.png').at(-1);
assert(qrShot && qrShot.params.photo_type === 'image/png' && qrShot.params.photo !== '[file:0]'
  && String(qrShot.params.caption).includes('https://t.test/wp-json/webdide-cv/v1/confirm'),
  'دکمهٔ «QR آدرس» تصویر PNG همان آدرس confirm را برای اسکن در اپ می‌فرستد');

// Secret ممکن است با فاصله/کوتیشن در env ذخیره شده باشد؛ نباید احراز هویت را بشکند.
const quotedSecret = '"  shetab-test-secret  "';
env.SHETAB_API_SECRET = quotedSecret;
const quotedAuth = await shetabPost({ amount: 987654, recipeId: 'QUOTED-SECRET' }, 'shetab-test-secret');
assert(quotedAuth.status === 404 && !String(await quotedAuth.text()).includes('Unauthorized'),
  'Secret دارای فاصله یا کوتیشن در env هنگام تطبیق نادیده گرفته می‌شود');
env.SHETAB_API_SECRET = 'shetab-test-secret';

// اگر Secret هیچ‌جا نباشد، ادمین با یک دکمه در خود ربات می‌سازد و اپ با همان کار می‌کند.
const savedEnvSecret = env.SHETAB_API_SECRET;
const cfgBeforeGen = await kvJson('cfg') || {};
await kv.put('cfg', Object.assign({}, cfgBeforeGen, { shetab_secret: '', shetab_secret_created_at: 0 }));
delete env.SHETAB_API_SECRET;
await press(ADMIN, 'a_shapp');
const appGuideNoSecret = lastMsgTo(ADMIN, 'editMessageText');
const cfgAfterGen = await kvJson('cfg');
const generatedSecret = String(cfgAfterGen.shetab_secret || '');
const generatedCopy = lookupButtons(appGuideNoSecret).find((b) => b.copy_text);
assert(String(appGuideNoSecret.params.text).includes('Secret همین حالا ساخته شد')
  && /^[0-9a-f]{64}$/.test(generatedSecret) && cfgAfterGen.shetab_secret_created_at > 0
  && !!generatedCopy && generatedCopy.copy_text.text === generatedSecret
  && String(appGuideNoSecret.params.text).includes('کاراکتر'),
  'باز کردن صفحهٔ اتصال اپ، Secret ۶۴ کاراکتری را خودکار می‌سازد و دکمهٔ کپی همان مقدار را نشان می‌دهد');
const generatedAuthProbe = await shetabPost({ amount: 123457, recipeId: 'BOT-MADE-SECRET' }, generatedSecret);
assert(generatedAuthProbe.status === 404 && !String(await generatedAuthProbe.text()).includes('Unauthorized'),
  'Secret ساخته‌شده در ربات همان چیزی است که اپ برای احراز هویت استفاده می‌کند');
const wrongAfterGenerated = await shetabPost({ amount: 123457, recipeId: 'BOT-MADE-SECRET' }, 'shetab-test-secret');
assert(wrongAfterGenerated.status === 401, 'Secret قدیمی env وقتی مقدار معتبری در ربات ثبت شده دیگر پذیرفته نمی‌شود');
await press(ADMIN, 'a_shgen');
const regenConfirm = lastMsgTo(ADMIN, 'editMessageText');
const secretBeforeRegen = (await kvJson('cfg')).shetab_secret;
assert(String(regenConfirm.params.text).includes('کلید قبلی باطل می‌شود')
  && (await kvJson('cfg')).shetab_secret === secretBeforeRegen
  && lookupButtons(regenConfirm).some((b) => b.callback_data === 'a_shgen_y'),
  'ساخت Secret تازه فقط با تأیید صریح انجام می‌شود');
await press(ADMIN, 'a_shgen_y');
const afterRegen = (await kvJson('cfg')).shetab_secret;
assert(/^[0-9a-f]{64}$/.test(afterRegen) && afterRegen !== secretBeforeRegen,
  'تأیید ساخت کلید تازه، Secret را واقعاً عوض می‌کند');
const quotedToken = await shetabPost({ amount: 123458, recipeId: 'QUOTED-TOKEN' }, '  "' + afterRegen + '"  ');
assert(quotedToken.status === 404, 'توکنی که با فاصله/کوتیشن کپی شده باشد هم پذیرفته می‌شود');
await press(ADMIN, 'a_shcheck');
const checkReport = lastMsgTo(ADMIN, 'editMessageText');
assert(String(checkReport.params.text).includes('بررسی اتصال پرداخت خودکار')
  && String(checkReport.params.text).includes('آخرین خبر از اپ')
  && String(checkReport.params.text).includes('آماده است')
  && String(checkReport.params.text).includes('نسخهٔ سرور') && String(checkReport.params.text).includes(pkgVersion),
  'گزارش بررسی اتصال، نسخهٔ نصب‌شده و وضعیت آدرس/Secret/کارت/سوییچ و آخرین تماس اپ را نشان می‌دهد');

// 🛰 صندوق درخواست‌های ورودی: ابزار قطعی برای پیام «آدرس API اشتباه است» در اپ
const reqLog = await kvJson('shetab_reqlog');
assert(Array.isArray(reqLog) && reqLog.length > 0
  && reqLog.some((e) => String(e.p).startsWith('/wp-json/webdide-cv/v1/confirm') && Number(e.s) > 0)
  && reqLog.every((e) => typeof e.m === 'string' && e.m.length > 0 && Number(e.at) > 0),
  'هر درخواست مسیر اپ (موفق یا ناموفق) با روش، مسیر و کد پاسخ در صندوق «درخواست‌های اخیر» ثبت می‌شود');
await press(ADMIN, 'a_shreq');
const reqLogView = lastMsgTo(ADMIN, 'editMessageText');
assert(String(reqLogView.params.text).includes('آخرین درخواست‌های رسیده از سمت گوشی')
  && String(reqLogView.params.text).includes('/wp-json/webdide-cv/v1/confirm'),
  'دکمهٔ «درخواست‌های اخیر» مسیر و کد پاسخ تماس‌های اپ را برای ادمین نشان می‌دهد');
await kv.delete('shetab_reqlog');
await press(ADMIN, 'a_shreq');
const reqLogEmpty = lastMsgTo(ADMIN, 'editMessageText');
assert(String(reqLogEmpty.params.text).includes('هیچ درخواستی از سمت اپ به سرور نرسیده')
  && String(reqLogEmpty.params.text).includes('/wp-json/'),
  'در نبود درخواست، گزارش صریح می‌گوید مشکل پیش از سرور است و آدرس تست مرورگر را می‌دهد');
env.SHETAB_API_SECRET = savedEnvSecret;

// آزمون پرداخت: در تست آدرس عمومی وجود ندارد، پس مسیر داخلی باید سالم باشد
const hBeforeSelfTest = hUsers.size;
const evtIndexBeforeTest = ((await kvJson('shetab_evt_index')) || []).length;
await press(ADMIN, 'a_shtest');
const selfTestMsg = lastMsgTo(ADMIN, 'editMessageText');
const evtIndexAfterTest = ((await kvJson('shetab_evt_index')) || []).length;
assert(String(selfTestMsg.params.text).includes('منطق پرداخت سالم است') && !String(selfTestMsg.params.text).includes('ناموفق بود')
  && hUsers.size === hBeforeSelfTest && evtIndexAfterTest === evtIndexBeforeTest + 1,
  'آزمون پرداخت خودکار مسیر داخلی را می‌آزماید، سفارش آزمایشی را پاک می‌کند و سرویس واقعی نمی‌سازد');

// قرارداد آزمون پرداخت برای اپ گوشی: پاسخ سفارش آزمایشی هم باید payment_confirmed داشته باشد
const appTestOrder = await globalThis.__shetabMakeTestOrder(env);
const appTestResp = await shetabPost({ amount: appTestOrder.payAmount, recipeId: 'SELFTEST-APP' });
const appTestJson = await appTestResp.json();
await globalThis.__shetabDropTestOrder(env, appTestOrder);
assert(appTestResp.status === 200 && appTestJson.success === true && appTestJson.test === true
  && appTestJson.payment_confirmed === true && appTestJson.fulfilled === true && String(appTestJson.order_id) === String(appTestOrder.orderId),
  'پاسخ سفارش آزمایشی همان شکل واریز واقعی را دارد تا اپ گوشی آن را تأییدشده ببیند');

// محدودیت نرخ: Secret اشتباه، هشدار امنیتی و سپس ۴۲۹
await kv.delete('shetab_rl:unknown');
const rlStatuses = [];
for (let i = 0; i < 30; i++) {
  const r = await shetabPost({ amount: 1000 + i, recipeId: 'RL-' + i }, 'wrong-secret-' + i);
  rlStatuses.push(r.status);
  if (r.status === 429) break;
}
const rlAlert = TG.slice().reverse().find((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN) && String(x.params.text).includes('هشدار امنیتی پرداخت خودکار'));
assert(rlStatuses.filter((x) => x === 401).length === 25 && rlStatuses[rlStatuses.length - 1] === 429 && !!rlAlert,
  'پس از ۲۵ درخواست ناموفق، هشدار امنیتی ارسال و درخواست‌های بعدی با ۴۲۹ مسدود می‌شوند');

// انقضای سفارش خودکار: ۴۵ دقیقه بدون تأیید بانک، سفارش بسته و مبلغ یکتا آزاد می‌شود
await press(U3, 'buy');
await press(U3, 'bp:' + pid);
await press(U3, `bl:${pid}:${plid}`);
await press(U3, `payx:${pid}:${plid}`);
const pendForExpiry = await kvJson('pend');
const expiryId = pendForExpiry.slice().reverse().find((id) => {
  const raw = kv.m.get('o:' + id); if (!raw) return false;
  const o = JSON.parse(raw); return o.tg_id === U3 && o.status === 'pending' && o.payment_method === 'shetab';
});
const expiryOrder = await kvJson('o:' + expiryId);
expiryOrder.created_at = Date.now() - 46 * 60 * 1000;
await kv.put('o:' + expiryId, expiryOrder);
await APP.scheduled({ cron: '*/10 * * * *', scheduledTime: Date.now() }, env, {});
const expiredOrder = await kvJson('o:' + expiryId);
const expiryReservation = await kvJson('shetab_amt:' + expiryOrder.pay_amount);
assert(expiredOrder.status === 'cancelled' && expiredOrder.closed_reason === 'auto_expired' && expiredOrder.payment_status === 'waiting'
  && expiryReservation === null && String(lastMsgTo(U3).params.text).includes('سفارش پرداخت‌نشده بسته شد')
  && !(await kvJson('pend')).includes(expiryId),
  'سفارش خودکار بدون تأیید بانک پس از ۴۵ دقیقه بسته، از فهرست بازها حذف و مبلغ یکتا آزاد می‌شود');
const lateAfterExpiry = await shetabPost({ amount: expiryOrder.pay_amount, recipeId: 'LATE-AFTER-EXPIRY' });
assert(lateAfterExpiry.status === 404, 'پرداخت دیرهنگام برای سفارش منقضی، خودکار تأیید نمی‌شود و به ادمین هشدار می‌رسد');

// — Mini App: شمارش معکوس انتظار بانک و تبدیل همان سفارش به رسید دستی
await press(U3, 'buy');
await press(U3, 'bp:' + pid);
await press(U3, `bl:${pid}:${plid}`);
await press(U3, `payx:${pid}:${plid}`);
const pendForConvert = await kvJson('pend');
const convertId = pendForConvert.slice().reverse().find((id) => {
  const raw = kv.m.get('o:' + id); if (!raw) return false;
  const o = JSON.parse(raw); return o.tg_id === U3 && o.status === 'pending' && o.payment_method === 'shetab';
});
const u3InitData = await signedInitData(U3);
const trackShemab = await miniApi('/api/miniapp/orders/' + convertId, u3InitData);
assert(trackShemab.status === 200 && trackShemab.json.payment && Number(trackShemab.json.payment.expires_at) > Number(trackShemab.json.order.created_at)
  && trackShemab.json.payment.can_switch_to_receipt === true && trackShemab.json.payment.method === 'shetab',
  'Mini App برای سفارش خودکار مهلت شمارش معکوس و گزینهٔ ارسال رسید را برمی‌گرداند');
const convertForm = new FormData();
convertForm.append('reference', 'CONVERT-REF-1');
const convertResp = await miniApi('/api/miniapp/orders/' + convertId + '/receipt', u3InitData, { method: 'POST', body: convertForm });
const convertedOrder = await kvJson('o:' + convertId);
const convertNotice = TG.slice().reverse().find((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN) && String(x.params.text).includes('رسید دستی برای سفارش خودکار'));
assert(convertResp.status === 200 && convertedOrder.status === 'pending' && convertedOrder.payment_method === 'manual'
  && convertedOrder.payment_status === 'review' && convertedOrder.converted_from_shetab_at > 0
  && Number(convertedOrder.shetab_amount_reserved) === Number(convertedOrder.pay_amount) && !!convertNotice,
  'دکمهٔ «رسید می‌فرستم» همان سفارش خودکار را (بدون ساخت سفارش تکراری) به رسید دستی تبدیل و به ادمین اطلاع می‌دهد');
const hBeforeLateConverted = hUsers.size;
const lateConverted = await shetabPost({ amount: convertedOrder.pay_amount, recipeId: 'LATE-CONVERTED' });
assert(lateConverted.status === 404 && hUsers.size === hBeforeLateConverted && (await kvJson('o:' + convertId)).status === 'pending',
  'پس از تبدیل به رسید دستی، واریز دیرهنگام بانکی سرویس دوم نمی‌سازد و برای بررسی به ادمین می‌رسد');

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
const botFreeStartKb = botFreeStartMessages[0]?.params.reply_markup?.keyboard?.flat().map(x => x.text) || [];
const botFreeDeliveryStart = TG.length;
await sendText(U7, 'اشتراک رایگان');
const botFreeDelivery = TG.slice(botFreeDeliveryStart).filter(x => x.method === 'sendPhoto' && String(x.params.chat_id) === String(U7)).at(-1);
const botFreeMarkup = botFreeDelivery ? JSON.parse(botFreeDelivery.params.reply_markup || '{}') : {};
const botFreeReplyTexts = botFreeMarkup.keyboard?.flat().map(x => x.text) || [];
assert(!botFreeStartMessages[0]?.params.reply_markup?.inline_keyboard && botFreeStartKb.join('|') === exactRobotButtons.join('|') && botFreeDelivery?.params.caption.includes('اشتراک رایگان شما فعال شد') && botFreeReplyTexts.join('|') === exactRobotButtons.join('|') && hUsers.size === hUsersBeforeBotFree + 1, 'ربات از شش‌گزینه‌ای Mini App-only اشتراک رایگان را صادر می‌کند و reply keyboard را حفظ می‌کند');
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
assert(miniAppSource.includes('body.customer-mode {') && miniAppSource.includes('#270609') && miniAppSource.includes('background-attachment:fixed') && miniAppSource.includes('backdrop-filter:blur(18px)') && miniAppSource.includes('.customer-mode .customer-tabs [role="tab"][aria-selected="true"]::after'), 'طرح نمای مشتری از پس‌زمینهٔ قرمز عمیق، کارت‌های شیشه‌ای و نشانگر تب فعال استفاده می‌کند');
assert((miniAppSource.match(/class="cv-stat"/g)||[]).length === 4 && miniAppSource.includes("`<div class=\"cv-stat\"><small>") && miniAppSource.includes('.cv-stats { display:grid; grid-template-columns:repeat(3,minmax(0,1fr))') && !miniAppSource.includes('kpiIcons'), 'نوار آمار مشتری سه شاخص فشرده را در یک ردیف نشان می‌دهد (بدون تکرار موجودی کیف پول)');
assert(!miniAppSource.includes('.customer-mode .main { max-width:600px') && !miniAppSource.includes('.customer-mode .plans-grid { grid-template-columns:minmax(0,1fr) !important') && !miniAppSource.includes('.customer-mode .store-plan { min-height:0; padding:16px') && !miniAppSource.includes('padding-bottom:calc(122px + var(--safe-bottom)) !important'), 'نمای مشتری چیدمان ریسپانسیو پایه (عرض، گرید پلن‌ها، کارت‌ها و حاشیهٔ پایین) را بازنویسی نمی‌کند');
// ---------- تحویل اشتراک: QR و لینک ریسپانسیو، بدون اسکرول افقی (۱.۸.۳۳) ----------
assert(miniAppSource.includes('.subscription-delivery-card {\n      display: grid !important;\n      grid-template-columns: minmax(0, 1fr) !important;') && miniAppSource.includes('.subscription-delivery-card > * { min-width: 0 !important; max-width: 100% !important; }'),
  'کارت تحویل اشتراک یک ستونِ قابل‌شکست است و هیچ فرزندی با لینک بلند آن را پهن‌تر از مودال نمی‌کند');
assert(miniAppSource.includes('max-width: min(100%, 208px) !important;') && miniAppSource.includes('max-height: min(44vh, 208px) !important;') && miniAppSource.includes('aspect-ratio: 1 / 1;') && miniAppSource.includes('padding: clamp(8px, 2.8vw, 14px) !important;'),
  'تصویر QR همیشه مربع است، با عرض/ارتفاع min() به صفحه مقیاس می‌گیرد و قابش padding سیال دارد');
assert(miniAppSource.includes('.copy-line.subscription-copy code {') && miniAppSource.includes('white-space: pre-wrap !important;') && miniAppSource.includes('overflow-wrap: anywhere !important;') && miniAppSource.includes('overflow: visible !important; text-overflow: clip !important;'),
  'لینک اشتراک به‌جای «…» و اسکرول افقی، در چند خط کامل نمایش داده می‌شود');
assert(miniAppSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr)) !important;\n      gap: clamp(6px, 2vw, 9px) !important; width: 100% !important; min-width: 0 !important;') && miniAppSource.includes('@media (max-width: 360px) {\n      .subscription-actions, .hiddify-downloads { grid-template-columns: minmax(0, 1fr) !important; }'),
  'دکمه‌های کپی/بازکردن لینک و کارت‌های دانلود در گوشی‌های باریک تک‌ستونه و در بقیه دو‌ستونه می‌نشینند');
assert(miniAppSource.includes('.modal { overflow-x: hidden !important; }') && miniAppSource.includes('#modalBody, .modal-body, .modal-intro, .modal-head { min-width: 0 !important; max-width: 100% !important; }'),
  'قاب مودال هیچ اسکرول افقی ندارد و بدنهٔ آن عرض خود را به محتوا تحمیل می‌کند');

assert(miniAppSource.includes('function subscriptionQrMarkup') && miniAppSource.includes('function loadSubscriptionQrInto') && miniAppSource.includes('subscriptionQrSlot') && miniAppSource.includes('function showFreeSubscriptionDelivery') && miniAppSource.includes('data-subscription-qr="${esc(s.sid)}"') && miniAppSource.includes('qr_data_url:sub.qr_data_url'), 'صفحهٔ اطلاعات اشتراک و تحویل اشتراک رایگان/هدیه، QR و لینک قابل کپی را نشان می‌دهند');
assert(miniAppSource.includes('HIDDIFY_DOWNLOADS') && miniAppSource.includes('function hiddifyDownloadsMarkup') && ['android','ios','windows','github'].every(k => miniAppSource.includes('HIDDIFY_DOWNLOADS.'+k)) && miniAppSource.includes('play.google.com/store/apps/details?id=app.hiddify.com') && miniAppSource.includes('apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532') && miniAppSource.includes('apps.microsoft.com/detail/9pdfnl3qv2s5') && miniAppSource.includes('github.com/hiddify/hiddify-app/releases') && miniAppSource.includes('همهٔ سیستم‌عامل‌ها') && miniAppSource.includes('data-open-url'), 'دکمه‌های دانلود هیدیفای برای اندروید، آیفون، ویندوز و صفحهٔ گیت‌هاب در کارت اشتراک وجود دارد');
assert(src.includes('function qrZlibStored') && src.includes('function qrDeflate') && src.includes("qrcode(0, 'L')") && src.includes('function safeQrDataUrl') && src.includes("qr_data_url: await safeQrDataUrl(link)"), 'تولید QR در Worker بدون وابستگی به CompressionStream هم کار می‌کند و برای لینک‌های بلند تلاش دوباره دارد');
assert(miniAppSource.includes('function legacyCopy') && miniAppSource.includes('execCommand') && miniAppSource.includes('height:auto; margin:0 auto; object-fit:contain'), 'کپی لینک در وب‌ویو تلگرام جایگزین دارد و تصویر QR بدون وابستگی به aspect-ratio اندازه می‌گیرد');
assert(miniAppSource.includes('--bg: #4a0911') && miniAppSource.includes('--brand-blue:#a60b18') && miniAppSource.includes('.cv-wallet') && !miniAppSource.includes('#6d4aff') && !miniAppSource.includes('#1b1626'), 'پالت قرمز پررنگ براق در نمای مشتری اعمال شده و رنگ بنفش مرجع کپی نشده است');
assert(workerSource.includes("const VERSION = '1.8.40-ubuntu26.42';"), 'شمارهٔ نسخهٔ سرور 1.8.40-ubuntu26.42 است و در «بررسی اتصال» همین دیده می‌شود');
assert(miniAppSource.includes('تم زندهٔ قرمز') && miniAppSource.includes('.cv-wallet {\n      position: relative; overflow: hidden; padding: 16px 16px 14px;') && miniAppSource.includes('--accent-grad: linear-gradient(115deg, #f05663, #ec2132 52%, #8e0914)'), 'تم زندهٔ قرمز براق روی کارت‌ها و کیف پول اعمال شده است (شیشه، گرادیان عمیق، درخشش لبه)');
assert(miniAppSource.includes('body::before {') && miniAppSource.includes('.shell { position: relative; z-index: 1; }') && miniAppSource.includes('@keyframes auroraDrift'), 'پس‌زمینهٔ شفقِ رنگی زیر محتوای اپ قرار می‌گیرد و روی کلیک‌ها اثر ندارد');
assert(miniAppSource.includes('--purple: #d6112a;') && !miniAppSource.includes('#a8b5ff') && !miniAppSource.includes('#6d4aff'), 'هیچ رنگ بنفشی در پالت نمانده است؛ همهٔ تأکیدها قرمز پررنگ‌اند');
assert(miniAppSource.includes('id="settingsEditorPanel"') && miniAppSource.includes('data-stab="look"') && miniAppSource.includes('function showSettingsGroup') && !miniAppSource.includes('settingCommission') && !miniAppSource.includes('settingMinWithdraw'), 'تنظیمات مینی‌اپ در پنج سربرگ (فروشگاه، پرداخت، اشتراک رایگان، دکمه‌ها، پشتیبان) گروه‌بندی شده و کارت‌های «درصد کمیسیون» و «حداقل برداشت» حذف شده‌اند');
// ---------- قرمز پررنگ براق در کل سامانه (۱.۸.۳۲) ----------
const hueOfRgb2 = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
const offRed = [];
for (const hex of (miniAppSource.match(/#[0-9a-fA-F]{6}\b/g) || [])) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  if (Math.max(r, g, b) - Math.min(r, g, b) < 14) continue;
  const h = hueOfRgb2(r, g, b);
  if (!(h >= 330 || h <= 15)) offRed.push(hex);
}
assert(offRed.length === 0, 'همهٔ رنگ‌های رنگی مینی‌اپ در خانوادهٔ قرمزند و هیچ آبی/سبز/زرد/بنفشی نمانده است' + (offRed.length ? ' — خارج: ' + [...new Set(offRed)].slice(0, 6).join(', ') : ''));
assert(miniAppSource.includes('--bg: #4a0911') && miniAppSource.includes('--bg-deep: #34060c') && miniAppSource.includes('<meta name="theme-color" content="#4a0911">') && miniAppSource.includes("tg.setHeaderColor('#4a0911')") && miniAppSource.includes("tg.setBackgroundColor('#4a0911')"),
  'پس‌زمینه هم قرمز است: بدنه، رنگ نوار تلگرام، سربرگ تلگرام و پس‌زمینهٔ وب‌ویو همه #4a0911 شده‌اند و مشکی جایی نمانده است');
assert(!/--bg:\s*#0[0-9a-f]{5}/.test(miniAppSource) && miniAppSource.includes('.panel, .stat-card, .table-wrap, .hero, .managed-item, .domain-row,'),
  'هیچ توکن پس‌زمینهٔ مشکی نمانده و همهٔ سطوح اصلی (پنل، کارت، جدول، هیرو، ردیف مدیریتی) در لایهٔ قرمز براق بازرنگ شده‌اند');
assert(!miniAppSource.includes('data-plan-archive') && !miniAppSource.includes('planArchive') && miniAppSource.includes('data-plan-edit="' + '${esc(p.id)}' + '"'),
  'دکمهٔ «آرشیو» از ردیف پلن‌ها در پنل مدیر حذف شده است و فقط «ویرایش» و «فعال/غیرفعال» می‌مانند');

assert(miniAppSource.includes('تم «قرمز پررنگ براق»') && !miniAppSource.includes('#3497ff') && !miniAppSource.includes('#6ee0ff') && !miniAppSource.includes('#04152e') && miniAppSource.includes('linear-gradient(180deg, #ff5d67 0%, #f81f35 26%, #cf0f24 62%, #8f0616 100%)') && miniAppSource.includes('.status.paid, .status.good, .order-state.good {'), 'کل مینی‌اپ قرمز پررنگ براق است (بدنه هم قرمز، نه مشکی)، دکمهٔ اصلی براق چهارلایه است و وضعیت «پرداخت‌شده» در همان خانواده با روشنایی جدا می‌شود');
assert(src.includes('play.google.com/store/apps/details?id=app.hiddify.com') && src.includes('apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532') && src.includes('apps.microsoft.com/detail/9pdfnl3qv2s5') && src.includes('github.com/hiddify/hiddify-app/releases'), 'فهرست دانلود اپ‌ها در چت و مینی‌اپ به‌صورت یکسان به پلی‌استور، اپ‌استور، مایکروسافت‌استور و گیت‌هاب اشاره می‌کند');
assert(miniAppSource.includes('@media (prefers-reduced-motion: reduce)') && miniAppSource.includes('@keyframes riseIn') && miniAppSource.includes('.stat-card:hover, .stat-card:focus-visible {'), 'حرکت‌ها افزوده شده‌اند و با تنظیم «کاهش حرکت» سیستم خاموش می‌شوند');
assert(miniAppSource.includes('@media (max-width: 900px) and (min-width: 421px) {\n      .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }'), 'کارت‌های KPI در تبلت و گوشی دو‌به‌دو می‌نشینند تا شلوغ نشوند');
assert(miniAppSource.includes('#overviewPage, #overviewPage *, #storePage, #storePage * { white-space: nowrap; }') && miniAppSource.includes('clamp(16px, 1.05vw + 12.65px, 24px)') && miniAppSource.includes('repeat(auto-fit, minmax(min(100%, 170px), 1fr))') && miniAppSource.includes('.table-wrap { overscroll-behavior-x: contain;'), 'نمای کلی مدیر و مشتری یک لایهٔ تک‌خطی سیال دارد: nowrap سراسری، مقیاس clamp و گرید auto-fit');
assert(miniAppSource.includes('.table-wrap tbody td { display:flex; align-items:center; justify-content:space-between; gap:7px; min-width:0; padding:2px 0; border:0; white-space:nowrap;') && miniAppSource.includes('.table-wrap .cell { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }') && miniAppSource.includes('cell-main') && miniAppSource.includes('cell-sub'), 'کارت‌های جدول در موبایل هر ردیف را «برچسب … مقدار» در یک خط نگه می‌دارند و مقدار بلند با «…» کوتاه می‌شود');
assert(!miniAppSource.includes('.stat-value { overflow-wrap:anywhere') && !miniAppSource.includes('white-space:normal; overflow-wrap:anywhere') && !miniAppSource.includes("white-space:normal; }\n      .admin-actions"), 'هیچ قاعده‌ای دیگر مقدار KPI/دکمه‌ها/وضعیت را به شکستن خط وادار نمی‌کند');
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
assert(miniOnlyAdminAlert && !!miniOnlyAdminAlert.params.reply_markup?.inline_keyboard?.length, 'در حالت Mini App-only اعلان سفارش با دکمه‌های ادمین به مدیر می‌رسد تا پنل تلگرام کار کند');
// در حالت Mini App-only مشتری به اپ هدایت می‌شود، اما ادمین باید کل پنل تلگرام را داشته باشد.
const cfgBeforeMiniOnlyToggle = (await kvJson('cfg')).card_auto_enabled === true;
const miniOnlyAnswerStart = TG.length;
await press(ADMIN, 'a_set');
const miniOnlySettings = lastMsgTo(ADMIN, 'editMessageText');
await press(ADMIN, 's_pay_auto');
const miniOnlyAnswers = TG.slice(miniOnlyAnswerStart).filter(x => x.method === 'answerCallbackQuery').map(x => x.params.text || '').join(' | ');
const cfgAfterMiniOnlyToggle = (await kvJson('cfg')).card_auto_enabled === true;
assert(!!miniOnlySettings && miniOnlySettings.params.reply_markup.inline_keyboard.flat().some(b => b.callback_data === 'a_shapp')
  && cfgAfterMiniOnlyToggle === !cfgBeforeMiniOnlyToggle
  && miniOnlyAnswers.includes('کارت‌به‌کارت خودکار'),
  'در حالت Mini App-only ادمین تنظیمات را باز و سوییچ کارت‌به‌کارت خودکار را عوض می‌کند');
await press(ADMIN, 's_pay_auto');
assert((await kvJson('cfg')).card_auto_enabled === cfgBeforeMiniOnlyToggle, 'حالت قبلی سوییچ کارت‌به‌کارت خودکار پس از آزمون برگشت داده شد');
env.MINIAPP_ONLY_MODE = 'false';
assert(manualMiniCheckout.json.payment && manualMiniCheckout.json.payment.card_number === '6037991122334455' && manualMiniCheckout.json.payment.amount_toman >= manualMiniOrder.amount + 10 && manualMiniCheckout.json.payment.amount_toman <= manualMiniOrder.amount + 999 && manualMiniCheckout.json.payment.amount_rial === manualMiniCheckout.json.payment.amount_toman * 10, 'پرداخت Mini App شماره کارت و مبلغ یکتا با معادل ریالی را روشن برمی‌گرداند');
const duplicateMiniCheckout = await miniApi('/api/miniapp/checkout', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'miniapp-manual-order-0001' })
});
assert(duplicateMiniCheckout.status === 200 && duplicateMiniCheckout.json.order.id === manualMiniOrder.id, 'شناسهٔ idempotency همان سفارش را برمی‌گرداند و سفارش تکراری نمی‌سازد');

// — شارژ کیف پول از داخل Mini App (قبلاً دکمه کاربر را از اپ بیرون می‌فرستاد)
assert(miniAppSource.includes('/api/miniapp/wallet/topup') && miniAppSource.includes('function openWalletTopup')
  && miniAppSource.includes('function submitWalletTopup') && miniAppSource.includes('data-topup-method')
  && !miniAppSource.includes("openCustomerBot('miniapp_wallet')") && !miniAppSource.includes('function openCustomerBot'),
  'دکمهٔ «شارژ کیف پول» در Mini App پنل داخلی باز می‌کند و دیگر کاربر را به لینک t.me ربات نمی‌فرستد');
const topupAutoDisabled = await miniApi('/api/miniapp/wallet/topup', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'shetab', amount: 100000, request_id: 'miniapp-topup-auto-off-0001' })
});
assert(topupAutoDisabled.status === 403 && topupAutoDisabled.json.error === 'automatic_payment_disabled', 'شارژ خودکار وقتی سوییچ خودکار خاموش است رد می‌شود');
const topupTooSmall = await miniApi('/api/miniapp/wallet/topup', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', amount: 5000, request_id: 'miniapp-topup-small-0001' })
});
assert(topupTooSmall.status === 400 && topupTooSmall.json.error === 'invalid_topup_amount' && topupTooSmall.json.min === 10000, 'مبلغ شارژ کمتر از حداقل رد می‌شود و کف مجاز در پاسخ می‌آید');
const topupManual = await miniApi('/api/miniapp/wallet/topup', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', amount: 120000, request_id: 'miniapp-topup-manual-0001' })
});
const topupManualOrder = topupManual.json && topupManual.json.order;
assert(topupManual.status === 200 && topupManualOrder && topupManualOrder.type === 'charge' && topupManualOrder.status === 'pending'
  && topupManual.json.payment && topupManual.json.payment.card_number === '6037991122334455'
  && topupManual.json.payment.amount_toman >= 120010 && topupManual.json.payment.amount_toman <= 120999
  && topupManual.json.payment.amount_rial === topupManual.json.payment.amount_toman * 10,
  'سفارش شارژ دستی از Mini App با کارت و مبلغ یکتا و معادل ریالی ساخته می‌شود');
const topupManualRepeat = await miniApi('/api/miniapp/wallet/topup', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', amount: 120000, request_id: 'miniapp-topup-manual-0001' })
});
const topupManualSecond = await miniApi('/api/miniapp/wallet/topup', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'manual', amount: 120000, request_id: 'miniapp-topup-manual-0002' })
});
assert(topupManualRepeat.status === 200 && topupManualRepeat.json.order.id === topupManualOrder.id
  && topupManualSecond.status === 200 && topupManualSecond.json.order.id === topupManualOrder.id && topupManualSecond.json.reused === true,
  'شارژ تکراری (حتی با request_id تازه) سفارش دوم نمی‌سازد و همان سفارش باز را برمی‌گرداند');
// سفارشِ در انتظار نباید هم از ایندکس سفارش‌ها و هم از فهرست pend در «آخرین سفارش‌ها» تکرار شود.
const summaryWithPending = await miniApi('/api/miniapp/admin/summary?days=30', adminInit);
const summaryRecentIds = (summaryWithPending.json.recent_orders || []).map((o) => String(o.id));
assert(summaryWithPending.status === 200
  && summaryRecentIds.filter((id) => id === String(topupManualOrder.id)).length === 1
  && new Set(summaryRecentIds).size === summaryRecentIds.length,
  'سفارش در انتظار در بخش «آخرین سفارش‌ها»ی نمای مدیر فقط یک بار نمایش داده می‌شود');
const topupAutoEnabledCfg = Object.assign({}, await kvJson('cfg'), { card_auto_enabled: true, card_manual_enabled: true });
await kv.put('cfg', topupAutoEnabledCfg);
const balanceBeforeTopup = Number((await kvJson('u:' + U4)).balance || 0);
const topupAuto = await miniApi('/api/miniapp/wallet/topup', user4Init, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'shetab', amount: 150000, request_id: 'miniapp-topup-auto-0001' })
});
const topupAutoOrder = topupAuto.json && topupAuto.json.order;
assert(topupAuto.status === 200 && topupAutoOrder && topupAutoOrder.type === 'charge' && topupAuto.json.payment.method === 'shetab'
  && topupAuto.json.payment.expires_at > Date.now(), 'سفارش شارژ خودکار با مهلت انتظار پیامک بانک ساخته می‌شود');
const topupPaid = await shetabPost({ amount: topupAuto.json.payment.amount_toman, recipeId: 'TOPUP-REF-1' });
const topupAfterPay = await kvJson('u:' + U4);
assert(topupPaid.status === 200 && (await kvJson('o:' + topupAutoOrder.id)).status === 'approved'
  && Number(topupAfterPay.balance || 0) === balanceBeforeTopup + 150000,
  'تأیید خودکار واریز، سفارش شارژ را می‌بندد و موجودی کیف پول را دقیقاً به اندازهٔ مبلغ اضافه می‌کند');
// موجودی آزمون شارژ به حالت اول برمی‌گردد تا تست‌های بعدی که مبلغ دقیق کیف پول را می‌سنجند دست‌نخورده بمانند.
await kv.put('u:' + U4, Object.assign({}, topupAfterPay, { balance: balanceBeforeTopup }));
const topupCustomerPayload = await miniApi('/api/miniapp/customer', user4Init);
assert(topupCustomerPayload.json.wallet_topup && topupCustomerPayload.json.wallet_topup.min === 10000
  && topupCustomerPayload.json.wallet_topup.max === 50000000 && Array.isArray(topupCustomerPayload.json.wallet_topup.presets),
  'اطلاعات شارژ (کف، سقف و مبلغ‌های پیشنهادی) به Mini App داده می‌شود');
env.MINIAPP_ONLY_MODE = 'true';
const walletStartMark = TG.length;
await sendText(U4, '/start miniapp_wallet');
const walletStartMsgs = TG.slice(walletStartMark).filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(U4));
assert(walletStartMsgs.some((m) => String(m.params.text || '').includes('شارژ کیف پول از داخل خودِ اپ'))
  && !walletStartMsgs.some((m) => ((m.params.reply_markup && m.params.reply_markup.inline_keyboard) || []).flat().some((b) => b.web_app)),
  'در حالت Mini App-only پیوند قدیمی «شارژ کیف پول» به صفحهٔ استارت نمی‌افتد، مسیر درست را نشان می‌دهد و دکمهٔ شیشه‌ای نمی‌سازد');
env.MINIAPP_ONLY_MODE = 'false';
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
assert(agentUiSource.includes('function openAgentRenewSelector') && agentUiSource.includes('data-agent-renew-plan="') && agentUiSource.includes('data-agent-renew-confirm="') && agentUiSource.includes("agentAvailableProducts.filter(p=>String(p.panel_id)===String(sub.panel_id)") && agentUiSource.includes('plan_id:String(plan.plan_id)') && agentUiSource.includes('همهٔ پلن‌های فعال سرور'), 'تمدید در پنل نماینده همهٔ پلن‌های همان سرور را نشان می‌دهد و پلن انتخابی برای تمدید فرستاده می‌شود');
assert(agentUiSource.includes('id="agentDeliveryPage"') && agentUiSource.includes('function showAgentDelivery') && agentUiSource.includes('agent/subscriptions/\'+encodeURIComponent(sid)+\'/delivery') && agentUiSource.includes('data-agent-renew=') && agentUiSource.includes('function renewAgentSubscription') && !agentUiSource.includes('agentQuotaValue') && !agentUiSource.includes('data-agent-quota'), 'سهمیه از رابط نماینده حذف شده، صفحهٔ جدا برای QR/لینک و دکمهٔ تمدید با کسر کیف پول وجود دارد');
const promoterInit = await signedInitData(U12, { first_name: 'PromotedAgent', username: 'promoted_agent' });
const inviteeInit = await signedInitData(U13, { first_name: 'InvitedAgent', username: 'invited_agent' });
const regularCustomerWalletBeforeAgent = Number((await kvJson('u:' + U12)).balance || 0);
const promotedAgentResponse = await miniApi('/api/miniapp/admin/agents', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tg_id: String(U12) }) });
const promotedAgentBoot = await miniApi('/api/miniapp/bootstrap', promoterInit);
const promotedAgentDetailDefault = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit);
const regularAgentOverviewDenied = await miniApi('/api/miniapp/agent/overview', user4Init);
const regularAgentAdminDenied = await miniApi('/api/miniapp/admin/agents', user4Init);
assert(promotedAgentResponse.status === 200 && promotedAgentBoot.status === 200 && promotedAgentBoot.json.role === 'agent' && promotedAgentDetailDefault.status === 200 && promotedAgentDetailDefault.json.agent.balance === 0 && promotedAgentDetailDefault.json.agent.total_renewed === 0 && promotedAgentDetailDefault.json.agent.quota_remaining === undefined && promotedAgentDetailDefault.json.plans.some(p => p.id === purchasable.plan_id && p.agent_price === purchasable.price) && regularAgentOverviewDenied.status === 403 && regularAgentAdminDenied.status === 403, 'ادمین مشتری ثبت‌شده را نماینده می‌کند؛ نقش، قیمت پیش‌فرض و کنترل دسترسی API درست است');
const promotedAgentSearch = await miniApi('/api/miniapp/admin/agents?q=' + U12, adminInit);
assert(promotedAgentSearch.status === 200 && promotedAgentSearch.json.items.some(a => a.tg_id === String(U12)), 'فهرست نماینده‌ها با شناسهٔ تلگرام جست‌وجو می‌شود');
const agentPlanPrice = 123456;
const invalidAgentPrice = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan_prices: { [purchasable.plan_id]: 0 } }) });
const saveAgentPrice = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan_prices: { [purchasable.plan_id]: agentPlanPrice } }) });
const agentWalletCredit = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 50000 }) });
const agentQuotaRejected = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: 1 }) });
const agentOverviewInitial = await miniApi('/api/miniapp/agent/overview', promoterInit);
const agentBalanceFail = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'No Funds Test', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-nofunds-test-0001' }) });
assert(invalidAgentPrice.status === 400 && saveAgentPrice.status === 200 && agentWalletCredit.status === 200 && agentQuotaRejected.status === 400 && agentQuotaRejected.json.error === 'invalid_agent_action' && agentOverviewInitial.status === 200 && agentOverviewInitial.json.agent.balance === 50000 && agentOverviewInitial.json.agent.quota_remaining === undefined && agentOverviewInitial.json.products.some(p => p.plan_id === purchasable.plan_id && p.agent_price === agentPlanPrice) && agentBalanceFail.status === 409 && agentBalanceFail.json.error === 'agent_balance_insufficient' && agentBalanceFail.json.price === agentPlanPrice, 'مدیر قیمت خرید و کیف پول را تعیین می‌کند؛ سهمیه حذف شده و ساخت فقط بر اساس موجودی کیف پول است');
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
assert(agentWalletTopup.status === 200 && agentWalletTopup.json.agent.balance === 300000 && agentCreateSuccess.status === 200 && agentSubRecord && agentSubRecord.agent_id === String(U12) && agentSubRecord.tg_id === '' && agentSubRecord.customer_name === 'مشتری بدون تلگرام' && agentHiddifyUser && agentHiddifyUser.telegram_id === undefined && agentSub.link.startsWith('https://') && hUsers.size === hUsersBeforeAgentCreate + 1 && agentAfterCreate.balance === 300000 - agentPlanPrice && agentAfterCreate.total_created === 1 && agentAfterCreate.total_renewed === 0 && !((agentUserRecordAfterCreate.subs || []).includes(agentSub.sid)) && Number(agentUserRecordAfterCreate.balance || 0) === regularCustomerWalletBeforeAgent && agentCreateDuplicate.status === 200 && agentCreateDuplicate.json.duplicate && agentCreateDuplicate.json.subscription.sid === agentSub.sid && hUsers.size === hUsersBeforeAgentCreate + 1 && agentSub.qr_data_url.startsWith('data:image/png;base64,'), 'ساخت موفق برای مشتری بدون تلگرام فقط یک یوزر Hiddify می‌سازد، کیف پول را یک‌بار کسر و درخواست تکراری را idempotent می‌کند');
const agentSubComment = agentHiddifyUser ? String(agentHiddifyUser.comment || '') : '';
assert(agentSubComment.includes(String(agentAfterCreate.first_name || '')) && agentSubComment.includes('مشتری بدون تلگرام') && !agentSubComment.includes(String(plans[purchasable.plan_id].title)), 'توضیحات کاربر در پنل به‌جای نام پلن، نام نماینده و نام مشتری را نشان می‌دهد');
const agentHistoryAfterCreate = await miniApi('/api/miniapp/agent/overview', promoterInit);
const agentLedgerPurchase = agentSub ? await kvJson('agent_ledger:' + U12 + ':purchase-' + agentSub.sid) : null;
assert(agentHistoryAfterCreate.status === 200 && agentHistoryAfterCreate.json.subscriptions.some(s => s.sid === agentSub.sid && s.customer_name === 'مشتری بدون تلگرام' && s.link === agentSub.link) && agentHistoryAfterCreate.json.transactions.some(t => t.subscription_sid === agentSub.sid && t.amount === agentPlanPrice) && agentLedgerPurchase && agentLedgerPurchase.balance_after === 300000 - agentPlanPrice, 'نماینده لینک و سابقهٔ اشتراک را می‌بیند و کسر مبلغ در دفتر مستقل کیف پول ثبت می‌شود');
const agentDebit = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'debit', amount: 10000 }) });
const agentCreditSmall = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 5000 }) });
const agentDisabled = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle' }) });
const disabledAgentBoot = await miniApi('/api/miniapp/bootstrap', promoterInit);
const disabledAgentApi = await miniApi('/api/miniapp/agent/overview', promoterInit);
const disabledAgentCreate = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'disabled test', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-disabled-create-01' }) });
const agentReenabled = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle' }) });
assert(agentDebit.status === 200 && agentDebit.json.agent.balance === 300000 - agentPlanPrice - 10000 && agentCreditSmall.status === 200 && agentCreditSmall.json.agent.balance === 300000 - agentPlanPrice - 5000 && agentDisabled.status === 200 && !agentDisabled.json.agent.enabled && disabledAgentBoot.json.role === 'agent' && disabledAgentApi.status === 200 && disabledAgentApi.json.disabled === true && disabledAgentApi.json.products.length === 0 && disabledAgentCreate.status === 403 && disabledAgentCreate.json.error === 'agent_inactive' && agentReenabled.status === 200 && agentReenabled.json.agent.enabled && Number((await kvJson('u:' + U12)).balance || 0) === regularCustomerWalletBeforeAgent, 'مدیر می‌تواند کیف پول نماینده را شارژ/کسر و نمایندگی را غیرفعال/فعال کند؛ کیف پول مشتری جدا می‌ماند');
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
const agentBeforeConcurrentCreate = await kvJson('agent:' + U12);
const hUsersBeforeConcurrentAgentCreate = hUsers.size;
const concurrentAgentRequests = await Promise.all([
  miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Concurrent customer A', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-concurrent-create-a1' }) }),
  miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: 'Concurrent customer B', panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-concurrent-create-b1' }) })
]);
const concurrentSuccesses = concurrentAgentRequests.filter(r => r.status === 200);
const concurrentDenied = concurrentAgentRequests.filter(r => r.status === 409);
const agentAfterConcurrentCreate = await kvJson('agent:' + U12);
assert(concurrentSuccesses.length === 1 && concurrentDenied.length === 1 && concurrentDenied[0].json.error === 'agent_creation_processing' && hUsers.size === hUsersBeforeConcurrentAgentCreate + 1 && agentAfterConcurrentCreate.total_created === agentBeforeConcurrentCreate.total_created + 1 && agentAfterConcurrentCreate.balance === agentBeforeConcurrentCreate.balance - agentPlanPrice, 'قفل ساخت هم‌زمان مانع مصرف دوبارهٔ کیف پول و ایجاد اشتراک تکراری می‌شود');
const agentNoName = await miniApi('/api/miniapp/agent/subscriptions', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panel_id: purchasable.panel_id, plan_id: purchasable.plan_id, request_id: 'agent-no-name-test-01' }) });
const agentQuotaActionGone = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quota_set', amount: -1 }) });
assert(agentNoName.status === 400 && agentNoName.json.error === 'agent_customer_name_required' && agentQuotaActionGone.status === 400 && agentQuotaActionGone.json.error === 'invalid_agent_action', 'نام مشتری خالی رد می‌شود و اقدام سهمیه کاملاً حذف شده است');

// ---------- تمدید اشتراک توسط نماینده؛ کسر هزینه از کیف پول ----------
const agentBeforeRenewTests = await kvJson('agent:' + U12);
const agentRenewFunding = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 400000 }) });
const agentAfterFunding = Number(agentBeforeRenewTests.balance || 0) + 400000;
const agentDeliveryOwn = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid, promoterInit);
const agentDeliveryNonAgent = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid, user4Init);
const agentForeignDelivery = await miniApi('/api/miniapp/agent/subscriptions/' + manualMiniStatus.json.order.sub_sid, promoterInit);
const agentForeignRenew = await miniApi('/api/miniapp/agent/subscriptions/' + manualMiniStatus.json.order.sub_sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-foreign-01' }) });
const agentRenewFirst = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-test-0001' }) });
const agentRenewDuplicate = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-test-0001' }) });
const agentAfterRenew = await kvJson('agent:' + U12);
const agentAfterDuplicateRenew = agentAfterRenew;
const agentRenewLedger = await kvJson('agent_ledger:' + U12 + ':renew-' + agentSub.sid + '-' + agentAfterRenew.last_renewed_at);
const renewedPanelUser = hUsers.get(agentSubRecord.uuid);
const agentRenewSecond = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-test-0002' }) });
const agentRenewThird = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-test-0003' }) });
const agentAfterThirdRenew = await kvJson('agent:' + U12);
const agentRenewNoFunds = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-test-0004' }) });
assert(agentRenewFunding.status === 200 && agentRenewFunding.json.agent.balance === agentAfterFunding, 'مدیر برای آزمون تمدید کیف پول نماینده را شارژ می‌کند');
assert(agentDeliveryOwn.status === 200 && agentDeliveryOwn.json.delivery.link === agentSub.link && agentDeliveryOwn.json.delivery.qr_data_url.startsWith('data:image/png;base64,') && agentDeliveryNonAgent.status === 403 && agentForeignDelivery.status === 404 && agentForeignRenew.status === 404 && agentForeignRenew.json.error === 'agent_subscription_not_found', 'صفحهٔ جدا فقط لینک و QR اشتراک خود نماینده را می‌دهد و مالکیت اشتراک کنترل می‌شود');
assert(agentRenewFirst.status === 200 && agentRenewFirst.json.agent.balance === agentAfterFunding - agentPlanPrice && agentRenewFirst.json.subscription.last_renewed_at > 0 && agentAfterRenew.total_renewed === 1 && agentRenewLedger && agentRenewLedger.amount === agentPlanPrice && agentRenewLedger.balance_after === agentAfterFunding - agentPlanPrice && renewedPanelUser && renewedPanelUser.current_usage_GB === 0 && Number(renewedPanelUser.package_days) === Number(plans[purchasable.plan_id].days), 'تمدید نماینده مبلغ را از کیف پول کسر، حجم/روز پنل را بازنشانی و در دفتر مستقل ثبت می‌کند');
assert(agentRenewDuplicate.status === 200 && agentRenewDuplicate.json.duplicate && Number(agentAfterDuplicateRenew.balance || 0) === agentAfterFunding - agentPlanPrice && agentRenewSecond.status === 200 && agentRenewThird.status === 200 && agentAfterThirdRenew.total_renewed === 3 && agentAfterThirdRenew.balance === agentAfterFunding - agentPlanPrice * 3 && agentRenewNoFunds.status === 409 && agentRenewNoFunds.json.error === 'agent_balance_insufficient', 'تمدید تکراری دوباره کسر نمی‌شود و تمدید بدون موجودی کافی رد می‌شود');

// ---------- تمدید با هر پلن فعال همان سرور (نه فقط پلن فعلی) ----------
const agentPlanPrice2 = 222222;
const agentPlansPriced = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', plan_prices: { [purchasable.plan_id]: agentPlanPrice, [managedPlanId]: agentPlanPrice2 } }) });
const agentOverviewAllPlans = await miniApi('/api/miniapp/agent/overview', promoterInit);
const agentPanelPlans = (agentOverviewAllPlans.json.products || []).filter(p => String(p.panel_id) === String(purchasable.panel_id));
assert(agentPlansPriced.status === 200 && agentPanelPlans.length >= 2 && agentPanelPlans.some(p => p.plan_id === purchasable.plan_id && p.agent_price === agentPlanPrice) && agentPanelPlans.some(p => p.plan_id === managedPlanId && p.agent_price === agentPlanPrice2), 'لیست پلن‌های نماینده برای یک سرور همهٔ پلن‌های قیمت‌گذاری‌شده را دارد، نه فقط پلن فعلی');
const agentSwitchFunding = await miniApi('/api/miniapp/admin/agents/' + U12, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'credit', amount: 500000 }) });
const agentBalanceBeforeSwitch = Number(agentSwitchFunding.json.agent.balance || 0);
const agentPlanSwitchRenew = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-plan-switch-01', plan_id: managedPlanId }) });
const agentAfterSwitchRenew = await kvJson('agent:' + U12);
const switchedSubRecord = await kvJson('s:' + agentSub.sid);
const switchedPanelUser = hUsers.get(agentSubRecord.uuid);
assert(agentPlanSwitchRenew.status === 200 && agentPlanSwitchRenew.json.subscription.plan_id === managedPlanId && agentPlanSwitchRenew.json.subscription.plan_name === String((await kvJson('plans'))[managedPlanId].title) && switchedSubRecord.plan_id === managedPlanId && switchedSubRecord.agent_price === agentPlanPrice2 && agentAfterSwitchRenew.balance === agentBalanceBeforeSwitch - agentPlanPrice2 && agentAfterSwitchRenew.total_renewed === agentAfterThirdRenew.total_renewed + 1 && switchedPanelUser && Number(switchedPanelUser.usage_limit_GB) === Number((await kvJson('plans'))[managedPlanId].gb) && Number(switchedPanelUser.package_days) === Number((await kvJson('plans'))[managedPlanId].days), 'نماینده می‌تواند اشتراک را با پلن دیگری از همان سرور تمدید کند؛ پلن، قیمت و حجم/روز پنل به پلن انتخابی تغییر می‌کند');
const ghostPanelPlan = await miniApi('/api/miniapp/admin/plans', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', title: 'پلن سرور دیگر', gb: 5, days: 10, price: 100000, panel_ids: [purchasable.panel_id] }) });
const ghostPlanId = ghostPanelPlan.json && ghostPanelPlan.json.plan && ghostPanelPlan.json.plan.id;
// این پلن را به سرور دیگری منتقل می‌کنیم تا تمدید اشتراکِ سرور فعلی با آن باید رد شود.
const ghostPlansKv = await kvJson('plans');
if (ghostPlanId && ghostPlansKv[ghostPlanId]) { ghostPlansKv[ghostPlanId].panel_ids = ['ghost-panel-xyz']; ghostPlansKv[ghostPlanId].panels = []; await kv.put('plans', JSON.stringify(ghostPlansKv)); }
const agentRenewGhostPlan = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-ghost-plan-01', plan_id: ghostPlanId }) });
const agentRenewUnknownPlan = await miniApi('/api/miniapp/agent/subscriptions/' + agentSub.sid + '/renew', promoterInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'agent-renew-unknown-plan-01', plan_id: 'planNope123' }) });
const agentAfterRejectedRenews = await kvJson('agent:' + U12);
assert(agentRenewGhostPlan.status === 400 && agentRenewGhostPlan.json.error === 'agent_plan_panel_mismatch' && agentRenewUnknownPlan.status === 404 && agentRenewUnknownPlan.json.error === 'agent_product_unavailable' && agentAfterRejectedRenews.balance === agentAfterSwitchRenew.balance && agentAfterRejectedRenews.total_renewed === agentAfterSwitchRenew.total_renewed, 'پلن سرور دیگر یا پلن ناموجود برای تمدید رد می‌شود و هیچ مبلغی کسر نمی‌گردد');


// ================= قفل کانال و ثبت شماره =================
console.log('\n— قفل کانال و ثبت شماره —');
const GATE_USER = 771;
const GATE_USER2 = 772;
const gateInit = await signedInitData(GATE_USER);
const gateInit2 = await signedInitData(GATE_USER2);

assert(globalThis.__DEFAULT_SETTINGS.join_lock_enabled === false && globalThis.__DEFAULT_SETTINGS.phone_required === false && Array.isArray(globalThis.__DEFAULT_SETTINGS.join_channels) && globalThis.__DEFAULT_SETTINGS.join_channels.length === 0, 'قفل کانال و شماره پیش‌فرض خاموش‌اند و هیچ کانالی ثبت نشده است');
assert(globalThis.__normalizePhone('۰۹۱۲۱۲۳۴۵۶۷') === '09121234567' && globalThis.__normalizePhone('+989121234567') === '09121234567' && globalThis.__normalizePhone('00989121234567') === '09121234567' && globalThis.__normalizePhone('9121234567') === '09121234567' && globalThis.__normalizePhone('12345') === '' && globalThis.__normalizePhone('۰۹۱۲۱۲۳۴۵') === '', 'شمارهٔ موبایل فارسی/بین‌المللی به یک قالب یکسان تبدیل می‌شود و شمارهٔ ناقص رد می‌شود');
assert(globalThis.__isJoinGateMarkup({ inline_keyboard: [[{ text: 'کانال', url: 'https://t.me/x' }], [{ text: 'چک', callback_data: 'jc:check' }]] }) === true && globalThis.__isJoinGateMarkup({ inline_keyboard: [[{ text: 'چک', callback_data: 'jc:check' }], [{ text: 'x', callback_data: 'a_admin' }]] }) === false && globalThis.__isPhoneRequestMarkup({ keyboard: [[{ text: 'شماره', request_contact: true }]] }) === true && globalThis.__isPhoneRequestMarkup({ keyboard: [[{ text: 'شماره' }]] }) === false, 'در حالت فقط‌اپ، فقط مارک‌آپ قفل کانال و دکمهٔ درخواست شماره مجاز است و بقیه حذف می‌شوند');

// --- بدون قفل، رفتار قبلی ---
const normalBefore = TG.length;
await sendText(GATE_USER, '/start');
const normalStart = lastMsgTo(GATE_USER);
assert(normalStart && !String(normalStart.params.text || '').includes('عضویت در کانال'), 'تا وقتی قفل خاموش است، /start همان پاسخ همیشگی را می‌دهد');

// --- روشن‌کردن قفل کانال ---
await kvJson; // noop to keep lint calm
const gateCfg0 = await kv.get('cfg', { type: 'json' }) || {};
const gateCfg1 = Object.assign({}, gateCfg0, { join_lock_enabled: true, join_channels: [{ id: '-1001234567890', key: 'idm1001234567890', title: 'کانال تست', url: 'https://t.me/testchannel' }] });
await kv.put('cfg', JSON.stringify(gateCfg1));

tgMemberStatus = 'left';
await sendText(GATE_USER, '/start');
const gatePress = lastMsgTo(GATE_USER);
const gateButtons = lookupButtons(gatePress);
const gateKeyboard = (gatePress.params.reply_markup && gatePress.params.reply_markup.keyboard || []).flat().map((b) => String(b.text || ''));
assert(gatePress && String(gatePress.params.text || '').includes('عضویت در کانال') && String(gatePress.params.text || '').includes('https://t.me/testchannel') && gateKeyboard.includes('✅ عضو شدم، بررسی کن') && !gateButtons.length, 'با روشن‌بودن قفل، کاربر غیرعضو پیام «عضویت در کانال» با لینک کانال در متن و دکمهٔ بررسی روی کیبورد پایین می‌گیرد (بدون دکمهٔ شیشه‌ای)');
assert(TG.filter((x) => x.method === 'getChatMember' && Number(x.params.user_id) === GATE_USER).length >= 1, 'عضویت کاربر با getChatMember از تلگرام پرسیده می‌شود');

// --- عضویت بعدی: دکمهٔ بررسی باید قفل را باز کند ---
tgMemberStatus = 'member';
await press(GATE_USER, 'jc:check');
const joinedOk = TG.some((x) => x.method === 'editMessageText' && String(x.params.chat_id) === String(GATE_USER) && String(x.params.text || '').includes('عضویت تأیید شد'))
  || TG.some((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(GATE_USER) && String(x.params.text || '').includes('عضویت تأیید شد'));
assert(joinedOk, 'بعد از عضویت، دکمهٔ «عضو شدم، بررسی کن» دسترسی را باز می‌کند');

// --- کش: بررسی دوباره هم‌زمان با تلگرام تماس نمی‌گیرد ---
const memberCallsBefore = TG.filter((x) => x.method === 'getChatMember' && Number(x.params.user_id) === GATE_USER).length;
await sendText(GATE_USER, '/start');
const memberCallsAfter = TG.filter((x) => x.method === 'getChatMember' && Number(x.params.user_id) === GATE_USER).length;
assert(memberCallsAfter === memberCallsBefore, 'نتیجهٔ عضویت کش می‌شود تا هر پیام کاربر یک درخواست به تلگرام نفرستد');

// --- خطای پیکربندی: قفل نباید فروشگاه را ببندد ---
tgMemberError = 'Bad Request: chat not found';
await sendText(GATE_USER2, '/start');
const degradedMsg = lastMsgTo(GATE_USER2);
assert(degradedMsg && !String(degradedMsg.params.text || '').includes('عضویت در کانال'), 'اگر ربات نتواند عضویت را ببیند، کاربر مسدود نمی‌شود (fail-open)');
const degradedAlert = TG.filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === '999' && String(x.params.text || '').includes('قفل کانال')).length;
assert(degradedAlert >= 1, 'خطای پیکربندی قفل به ادمین گزارش می‌شود');
tgMemberError = '';

// --- ادمین همیشه مستثنا است ---
tgMemberStatus = 'left';
await sendText(ADMIN, '/start');
const adminStart = lastMsgTo(ADMIN);
assert(adminStart && !String(adminStart.params.text || '').includes('عضویت در کانال'), 'ادمین با قفل کانال از پنل خودش بیرون نمی‌ماند');
tgMemberStatus = 'member';

// --- قفل شماره ---
const gateCfg2 = Object.assign({}, gateCfg1, { join_lock_enabled: false, phone_required: true });
await kv.put('cfg', JSON.stringify(gateCfg2));
const PHONE_USER = 773;
await sendText(PHONE_USER, '/start');
const phonePrompt = lastMsgTo(PHONE_USER);
const phoneKb = phonePrompt && phonePrompt.params.reply_markup && phonePrompt.params.reply_markup.keyboard;
assert(phonePrompt && String(phonePrompt.params.text || '').includes('ثبت شمارهٔ موبایل') && Array.isArray(phoneKb) && phoneKb[0][0].request_contact === true, 'با روشن‌بودن قفل شماره، دکمهٔ بومی «ارسال شماره من» فرستاده می‌شود');

// شمارهٔ شخص دیگر
await upd({ message: { message_id: ++midSeq, chat: { id: PHONE_USER, type: 'private' }, from: { id: PHONE_USER, first_name: 'U' }, contact: { phone_number: '+989121110000', first_name: 'دیگری', user_id: 999 } } });
const foreignMsg = lastMsgTo(PHONE_USER);
assert(foreignMsg && String(foreignMsg.params.text || '').includes('متعلق به حساب شما نیست'), 'کنتاکت شخص دیگر پذیرفته نمی‌شود و کاربر راهنمایی می‌شود');

// کارت مخاطب بدون user_id (قابل جعل)
await upd({ message: { message_id: ++midSeq, chat: { id: PHONE_USER, type: 'private' }, from: { id: PHONE_USER, first_name: 'U' }, contact: { phone_number: '+989121110009', first_name: 'کارت' } } });
const cardMsg = lastMsgTo(PHONE_USER);
const noPhoneRec = await kvJson('u:' + PHONE_USER);
assert(cardMsg && String(cardMsg.params.text || '').includes('متعلق به حساب شما نیست') && !(noPhoneRec && noPhoneRec.phone), 'کارت مخاطب بدون شناسهٔ تلگرام پذیرفته نمی‌شود');

// شمارهٔ خودش
await upd({ message: { message_id: ++midSeq, chat: { id: PHONE_USER, type: 'private' }, from: { id: PHONE_USER, first_name: 'U' }, contact: { phone_number: '+989121110001', first_name: 'خودم', user_id: PHONE_USER } } });
const ownMsg = lastMsgTo(PHONE_USER);
const phoneRec = await kvJson('u:' + PHONE_USER);
assert(ownMsg && String(ownMsg.params.text || '').includes('ثبت شد') && phoneRec && phoneRec.phone === '09121110001' && phoneRec.phone_source === 'contact', 'شمارهٔ خودِ کاربر ذخیره می‌شود و پیام تأیید می‌گیرد');

await sendText(PHONE_USER, '/start');
const afterPhone = lastMsgTo(PHONE_USER);
assert(afterPhone && !String(afterPhone.params.text || '').includes('ثبت شمارهٔ موبایل'), 'بعد از ثبت شماره، دیگر پیام قفل شماره فرستاده نمی‌شود');

// تایپ دستی شماره
const TYPE_USER = 774;
await sendText(TYPE_USER, '۰۹۱۲۲۲۲۰۰۰۰');
const typedRec = await kvJson('u:' + TYPE_USER);
assert(typedRec && typedRec.phone === '09122220000' && typedRec.phone_source === 'text', 'کاربر می‌تواند شماره را دستی هم تایپ کند');

// --- Mini App: دسترسی ---
const gateInitLocked = await signedInitData(TYPE_USER + 10);
const bootOpen = await miniApi('/api/miniapp/bootstrap', gateInitLocked);
assert(bootOpen.status === 200 && bootOpen.json.access && bootOpen.json.access.phone_required === true && bootOpen.json.access.blocked === true && bootOpen.json.access.phone_verified === false, 'bootstrap وضعیت قفل را برای Mini App می‌فرستد');
const blockedCustomer = await miniApi('/api/miniapp/customer', gateInitLocked);
assert(blockedCustomer.status === 403 && blockedCustomer.json.error === 'phone_required', 'تا وقتی شماره ثبت نشده، دادهٔ مشتری به Mini App داده نمی‌شود');
const badPhone = await miniApi('/api/miniapp/phone', gateInitLocked, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '123' }) });
assert(badPhone.status === 400 && badPhone.json.error === 'invalid_phone', 'شمارهٔ نامعتبر از Mini App رد می‌شود');
const goodPhone = await miniApi('/api/miniapp/phone', gateInitLocked, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '۰۹۳۳۳۳۳۰۰۰۰' }) });
const unlockedBoot = await miniApi('/api/miniapp/bootstrap', gateInitLocked);
assert(goodPhone.status === 200 && goodPhone.json.ok === true && unlockedBoot.json.access.blocked === false && unlockedBoot.json.phone === '0933 333 0000', 'ثبت شماره از Mini App قفل را باز می‌کند و شماره در bootstrap برمی‌گردد');

// --- Mini App: تأیید فوری شمارهٔ requestContact با امضای خودِ تلگرام ---
const SIGN_USER = 776;
const signInit = await signedInitData(SIGN_USER);
const signBoot = await miniApi('/api/miniapp/bootstrap', signInit);
assert(signBoot.status === 200 && signBoot.json.access.blocked === true && signBoot.json.access.phone_required === true, 'کاربر تازه در مینی‌اپ هنوز شماره‌نشده است و قفل روی او باز است');
const signedContact = await signedContactRaw('+989355556666', SIGN_USER);
const signedOk = await miniApi('/api/miniapp/phone', signInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_raw: signedContact }) });
const signedRec = await kvJson('u:' + SIGN_USER);
const signedBoot = await miniApi('/api/miniapp/bootstrap', signInit);
assert(signedOk.status === 200 && signedOk.json.ok === true && signedRec && signedRec.phone === '09355556666'
  && signedRec.phone_source === 'contact_signed' && signedBoot.json.access.blocked === false && signedBoot.json.phone === '0935 555 6666',
  'شمارهٔ امضاشدهٔ requestContact بدون نیاز به پیام چت همان لحظه ثبت می‌شود و قفل را باز می‌کند');
const forgedContact = (await signedContactRaw('+989355556667', 777)).replace(/hash=[0-9a-f]{64}$/, 'hash=' + '0'.repeat(64));
const forgedRes = await miniApi('/api/miniapp/phone', signInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_raw: forgedContact }) });
assert(forgedRes.status === 400 && forgedRes.json.error === 'invalid_contact_signature', 'پکیج شمارهٔ دست‌کاری‌شده با امضای نامعتبر رد می‌شود');
const foreignSignInit = await signedInitData(778);
await miniApi('/api/miniapp/bootstrap', foreignSignInit);
const foreignContact = await signedContactRaw('+989355556668', 999);
const foreignRes = await miniApi('/api/miniapp/phone', foreignSignInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_raw: foreignContact }) });
const foreignRec = await kvJson('u:778');
assert(foreignRes.status === 403 && foreignRes.json.error === 'contact_user_mismatch' && !(foreignRec && foreignRec.phone), 'شمارهٔ امضاشدهٔ متعلق به حساب دیگر پذیرفته نمی‌شود');

// --- شمارهٔ بین‌المللی (مشتری خارج از ایران) ---
const INTL_USER = 779;
const intlInit = await signedInitData(INTL_USER);
await miniApi('/api/miniapp/bootstrap', intlInit);
const intlContact = await signedContactRaw('+49 151 1234 5678', INTL_USER);
const intlRes = await miniApi('/api/miniapp/phone', intlInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_raw: intlContact }) });
const intlRec = await kvJson('u:' + INTL_USER);
const intlBoot = await miniApi('/api/miniapp/bootstrap', intlInit);
assert(intlRes.status === 200 && intlRec && intlRec.phone === '+4915112345678' && intlBoot.json.access.blocked === false && intlBoot.json.phone === '+4915112345678',
  'شمارهٔ خارج از ایران (+۴۹…) هم ثبت می‌شود و قفل شماره را باز می‌کند');
const INTL_TYPED = 780;
await sendText(INTL_TYPED, '+49 160 9876543');
const intlTypedRec = await kvJson('u:' + INTL_TYPED);
assert(intlTypedRec && intlTypedRec.phone === '+491609876543' && intlTypedRec.phone_source === 'text', 'شمارهٔ بین‌المللی تایپ‌شده در چت هم پذیرفته می‌شود');

// --- Mini App: استفاده از پکیج امضاشده و انتظار فعال برای تأیید ---
assert(miniAppSource.includes('tg.requestContact(async(shared,info)')
  && miniAppSource.includes('async function saveSignedPhoneContact')
  && miniAppSource.includes('contact_raw')
  && miniAppSource.includes('pollPhoneConfirmation')
  && !miniAppSource.includes('tg.requestContact(()=>reveal(')
  && !miniAppSource.includes("tg.requestContact(()=>{status.textContent='شماره فرستاده شد"),
  'دکمهٔ ارسال شماره در مینی‌اپ پاسخ امضاشدهٔ تلگرام را مستقیم ثبت می‌کند و اگر پیام چت دیر برسد، خودکار تأیید را می‌پاید');
assert(miniAppSource.includes("inputmode=\"tel\"") && miniAppSource.includes('+۴۹'),
  'ورودی شماره در مینی‌اپ شمارهٔ بین‌المللی را هم می‌پذیرد');

// --- کانال در Mini App ---
const gateInitJoin = await signedInitData(TYPE_USER + 20);
const cfgJoin = Object.assign({}, gateCfg2, { phone_required: false, join_lock_enabled: true });
await kv.put('cfg', JSON.stringify(cfgJoin));
tgMemberStatus = 'left';
const joinBoot = await miniApi('/api/miniapp/bootstrap', gateInitJoin);
const joinBlocked = await miniApi('/api/miniapp/customer', gateInitJoin);
assert(joinBoot.json.access.join_required === true && joinBoot.json.access.channels.length === 1 && joinBoot.json.access.channels[0].url === 'https://t.me/testchannel' && joinBlocked.status === 403 && joinBlocked.json.error === 'join_required', 'قفل کانال در Mini App هم دیده می‌شود و داده‌ها تا عضویت بسته‌اند');
tgMemberStatus = 'member';

// --- پنل ادمین ---
await sendText(ADMIN, '/admin');
await press(ADMIN, 'a_set');
const settingsMsg = lastMsgTo(ADMIN, 'editMessageText') || lastMsgTo(ADMIN);
assert(lookupButtons(settingsMsg).some((b) => b.callback_data === 's_gate'), 'در «⚙️ تنظیمات» دکمهٔ «🔒 قفل کانال و شماره» وجود دارد');
await press(ADMIN, 's_gate');
const gatePanel = TG.filter((x) => (x.method === 'sendMessage' || x.method === 'editMessageText') && String(x.params.chat_id) === String(ADMIN) && String(x.params.text || '').includes('قفل کانال')).slice(-1)[0];
const gatePanelButtons = lookupButtons(gatePanel);
assert(gatePanel && String(gatePanel.params.text || '').includes('قفل کانال') && gatePanelButtons.some((b) => b.callback_data === 's_gate_toggle') && gatePanelButtons.some((b) => b.callback_data === 's_phone_toggle') && gatePanelButtons.some((b) => b.callback_data === 's_gate_add'), 'پنل قفل، کلید روشن/خاموش کانال و شماره و افزودن کانال را دارد');

// افزودن کانال از داخل تلگرام
await press(ADMIN, 's_gate_add');
await sendText(ADMIN, '@tiznetvpn_test');
const cfgAfterAdd = await kvJson('cfg');
assert(cfgAfterAdd.join_channels.some((c) => c.key === 'tiznetvpn_test' && c.url === 'https://t.me/tiznetvpn_test' && c.title === 'کانال تست'), 'ادمین می‌تواند کانال را با آیدی از داخل تلگرام اضافه کند');

// کانالی که ربات ادمینش نیست پذیرفته نمی‌شود
tgBotStatus = 'member';
await press(ADMIN, 's_gate_add');
await sendText(ADMIN, '@tiznetvpn_other');
const cfgNoAdmin = await kvJson('cfg');
const failMsg = TG.filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN) && String(x.params.text || '').includes('ادمین نیست')).length;
assert(!cfgNoAdmin.join_channels.some((c) => c.key === 'tiznetvpn_other') && failMsg >= 1, 'کانالی که ربات در آن ادمین نیست اضافه نمی‌شود و دلیلش گفته می‌شود');
tgBotStatus = 'administrator';
await sendText(ADMIN, '/cancel');

// پاک‌کردن قفل‌ها تا تست‌های بعدی تحت‌تأثیر نباشند
const cfgClean = Object.assign({}, (await kvJson('cfg')) || {}, { join_lock_enabled: false, phone_required: false });
await kv.put('cfg', JSON.stringify(cfgClean));


// ================= رنگ و آیکن دکمه‌های چت =================
console.log('\n— رنگ و آیکن دکمه‌های چت —');
assert(globalThis.__btnSlotFor('🛍 خرید اشتراک') === 'buy' && globalThis.__btnSlotFor('💰 کیف پول / شارژ') === 'wallet' && globalThis.__btnSlotFor('⚙️ تنظیمات') === 'settings' && globalThis.__btnSlotFor('سلام دوست من') === '', 'هر دکمه به جایگاه درست خودش وصل می‌شود');
assert(globalThis.__btnStyleFor('✅ تأیید', 'ok') === 'success' && globalThis.__btnStyleFor('❌ انصراف', 'menu') === 'danger' && globalThis.__btnStyleFor('🛍 خرید اشتراک', 'buy') === 'primary' && globalThis.__btnStyleFor('📊 آمار', 'stats') === '', 'رنگ دکمه از معنی آن می‌آید: سبز تأیید، قرمز انصراف، آبی خرید');

globalThis.__resetBtnUI();
const uiProbe = () => ({ inline_keyboard: [[{ text: '🛍 خرید اشتراک', callback_data: 'buy' }, { text: '📖 راهنما', callback_data: 'help' }]] });
const uiDecorate = async () => globalThis.__decorateMarkup(uiProbe(), await globalThis.__btnUI(env)).markup.inline_keyboard[0];
{
  const [buyBtn, helpBtn] = await uiDecorate();
  assert(buyBtn.style === 'primary' && buyBtn.text === '🛍 خرید اشتراک', 'دکمهٔ خرید در چت رنگ اصلی می‌گیرد و متنش دست‌نخورده می‌ماند');
  assert(helpBtn && helpBtn.text === '📖 راهنما' && !helpBtn.style, 'دکمه‌های خنثی رنگ نمی‌گیرند تا صفحه شلوغ نشود');
}

await press(ADMIN, 's_gate');
await press(ADMIN, 's_gate_add');
const cancelBtn = lookupButtons(lastMsgTo(ADMIN)).find((b) => b.text.includes('انصراف'));
assert(cancelBtn && cancelBtn.style === 'danger', 'دکمهٔ «❌ انصراف» قرمز می‌شود');
await sendText(ADMIN, '/cancel');

// کیبورد ثابت و تغییرناپذیری دکمه‌های اصلی
const fixedKb = globalThis.__decorateMarkup({ keyboard: [[{ text: '🛍 خرید اشتراک' }, { text: '📖 راهنما' }]], resize_keyboard: true }, { colors: true, icons: {} });
assert(fixedKb.changed && fixedKb.markup.keyboard[0][0].style === 'primary' && !fixedKb.markup.keyboard[0][1].style && fixedKb.markup.keyboard[0][0].text === '🛍 خرید اشتراک' && fixedKb.markup.resize_keyboard === true, 'کیبورد ثابت هم رنگ می‌گیرد ولی متن دکمه (که کاربر می‌فرستد) عوض نمی‌شود');
const srcKb = { inline_keyboard: [[{ text: '🛍 خرید اشتراک', callback_data: 'buy' }]] };
const decKb = globalThis.__decorateMarkup(srcKb, { colors: true, icons: { buy: '5368324170671202286' } });
assert(decKb.markup.inline_keyboard[0][0].icon_custom_emoji_id === '5368324170671202286' && decKb.markup.inline_keyboard[0][0].style === 'primary' && !srcKb.inline_keyboard[0][0].style && !srcKb.inline_keyboard[0][0].icon_custom_emoji_id, 'تزئین دکمه‌ها روی نسخهٔ کپی انجام می‌شود و مارک‌آپ اصلی دست‌نخورده می‌ماند');
assert(globalThis.__btnStyleFor('✅ بله، حذف کن', 'ok') === 'danger', 'تأییدِ کارِ خطرناک (حذف) هم قرمز می‌شود');

// آیکن متحرک از تنظیمات
await kv.put('ui:btn_icons', JSON.stringify({ buy: '5368324170671202286' }));
globalThis.__resetBtnUI();
const iconBtn = (await uiDecorate())[0];
assert(iconBtn && iconBtn.icon_custom_emoji_id === '5368324170671202286', 'آیکن متحرک ذخیره‌شده روی دکمهٔ خرید می‌نشیند');
assert(iconBtn && iconBtn.text === 'خرید اشتراک', 'وقتی آیکن متحرک ست شده، ایموجی ابتدای متن حذف می‌شود تا دو ایموجی پشت‌هم نیاید');
await kv.put('ui:btn_icons', JSON.stringify({ buy: 'not-a-number' }));
globalThis.__resetBtnUI();
const badIconBtn = (await uiDecorate())[0];
assert(badIconBtn && !badIconBtn.icon_custom_emoji_id, 'شناسهٔ نامعتبر آیکن نادیده گرفته می‌شود و پیام سالم می‌ماند');

// پاک‌کردن
await kv.put('ui:btn_icons', JSON.stringify({}));
globalThis.__resetBtnUI();

// پنل ادمین
await sendText(ADMIN, '/admin');
await press(ADMIN, 'a_set');
assert(lookupButtons(lastMsgTo(ADMIN, 'editMessageText') || lastMsgTo(ADMIN)).some((b) => b.callback_data === 's_ui'), 'در «⚙️ تنظیمات» دکمهٔ «🎨 دکمه‌ها و آیکن‌ها» وجود دارد');
await press(ADMIN, 's_ui');
const lookPanel = TG.filter((x) => (x.method === 'sendMessage' || x.method === 'editMessageText') && String(x.params.chat_id) === String(ADMIN) && String(x.params.text || '').includes('ظاهر دکمه‌های چت')).slice(-1)[0];
const lookButtons = lookupButtons(lookPanel);
assert(lookPanel && lookButtons.some((b) => b.callback_data === 's_ui_colors' && /شیشه‌ای|رنگی/.test(b.text)) && lookButtons.some((b) => b.callback_data === 's_ui_grab') && lookButtons.some((b) => String(b.callback_data).startsWith('s_ui_icon:buy')), 'پنل دکمه‌ها: کلید رنگ‌ها، گرفتن شناسه و انتخاب جایگاه هر دکمه');

// خاموش‌کردن رنگ‌ها
const colorCallsBefore = TG.filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN)).length;
await press(ADMIN, 's_ui_colors');
assert((await uiDecorate()).every((b) => !b.style), 'با خاموش‌کردن رنگ‌ها هیچ دکمه‌ای استایل نمی‌گیرد');
await press(ADMIN, 's_ui');
await press(ADMIN, 's_ui_colors');
assert((await uiDecorate()).some((b) => b.style === 'primary'), 'روشن‌کردن دوبارهٔ رنگ‌ها برمی‌گردد');

// ثبت دستی شناسه
await press(ADMIN, 's_ui');
await press(ADMIN, 's_ui_icon:buy');
await sendText(ADMIN, '12345678901234567');
const iconsAfterManual = await kvJson('ui:btn_icons');
assert(iconsAfterManual && iconsAfterManual.buy === '12345678901234567', 'ادمین می‌تواند شناسهٔ آیکن را دستی وارد کند');
globalThis.__resetBtnUI();
assert((await uiDecorate())[0].icon_custom_emoji_id === '12345678901234567', 'آیکن ثبت‌شدهٔ دستی روی دکمه ظاهر می‌شود');

// با آیکن ست‌شده، دکمه‌ها هنوز با متن بدون ایموجی کار می‌کنند
await kv.put('ui:btn_icons', JSON.stringify({ buy: '5368324170671202286' }));
globalThis.__resetBtnUI();
const iconOnly = (await uiDecorate())[0];
assert(iconOnly.text === 'خرید اشتراک' && iconOnly.icon_custom_emoji_id === '5368324170671202286' && iconOnly.style === 'primary', 'با آیکن ست‌شده، متن دکمه بدون ایموجی می‌ماند و آیکن خودش قبل از متن می‌آید');
const kbRouteMark = TG.length;
await sendText(ADMIN, 'خرید اشتراک');
const kbRouteTexts = TG.slice(kbRouteMark).filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN)).map((x) => String(x.params.text || ''));
assert(kbRouteTexts.some((t) => t.includes('اپ فروش') || t.includes('لوکیشن') || t.includes('سرور')), 'پیام متنی کاربر (بدون ایموجی) باز هم مسیر «خرید اشتراک» را از کیبورد پایین چت اجرا می‌کند');
await kv.put('ui:btn_icons', JSON.stringify({}));
globalThis.__resetBtnUI();

// گرفتن شناسه از ایموجی فوروارد‌شده
await press(ADMIN, 's_ui_grab');
const grabBefore = TG.length;
await upd({ message: { message_id: ++midSeq, chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN, first_name: 'A' }, text: '🎁', entities: [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5368324170671202286' }] } });
const grabMsg = TG.slice(grabBefore).filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN)).slice(-1)[0];
assert(grabMsg && String(grabMsg.params.text || '').includes('5368324170671202286') && lookupButtons(grabMsg).some((b) => String(b.callback_data).startsWith('s_ui_assign:5368324170671202286:')), 'ادمین با فوروارد ایموجی متحرک، شناسه‌اش را می‌گیرد و جایگاه را انتخاب می‌کند');
await press(ADMIN, 's_ui_grab');
await upd({ message: { message_id: ++midSeq, chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN, first_name: 'A' }, text: 'سلام' } });
const noEmojiMsg = TG.filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN) && String(x.params.text || '').includes('ایموجی متحرک پیدا نشد')).slice(-1)[0];
assert(noEmojiMsg, 'اگر پیام ایموجی متحرک نداشته باشد، راهنما داده می‌شود');

// فرمان /start در میانهٔ حالتِ گرفتن ایموجی هم کار می‌کند (قفل نمی‌شود)
await press(ADMIN, 's_ui_grab');
await sendText(ADMIN, '/start');
const escapedGrab = lastMsgTo(ADMIN);
assert(escapedGrab && String(escapedGrab.params.text || '').includes('خوش آمدید'), '/start در حالت گرفتن شناسهٔ ایموجی هم اجرا می‌شود و ادمین در حالت قفل نمی‌ماند');

// لغو حالت و پاک‌سازی
await sendText(ADMIN, '/cancel');
await kv.put('ui:btn_icons', JSON.stringify({}));
await kv.put('ui:btn_colors', JSON.stringify('1'));
globalThis.__resetBtnUI();

// پشتیبان: اگر تلگرام دکمهٔ استایل‌دار را رد کند
tgRejectDecorated = 1;
const fbBefore = TG.length;
await press(ADMIN, 's_kb');
const fbCalls = TG.slice(fbBefore).filter((x) => (x.method === 'sendMessage' || x.method === 'editMessageText') && String(x.params.chat_id) === String(ADMIN));
const firstDecorated = fbCalls[0] && Array.isArray(fbCalls[0].params.reply_markup?.inline_keyboard) && fbCalls[0].params.reply_markup.inline_keyboard.flat().some((b) => b && b.style);
const secondPlain = fbCalls[1] && Array.isArray(fbCalls[1].params.reply_markup?.inline_keyboard) && fbCalls[1].params.reply_markup.inline_keyboard.flat().every((b) => b && !b.style && !b.icon_custom_emoji_id);
assert(firstDecorated && secondPlain, 'اگر تلگرام استایل را رد کند، همان پیام بی‌درنگ بدون استایل دوباره فرستاده می‌شود');
tgRejectDecorated = 0;


// ================= ظاهر دکمه‌ها در تنظیمات مینی‌اپ =================
console.log('\n— ظاهر دکمه‌ها در تنظیمات مینی‌اپ —');
const lookAdmin = await signedInitData(ADMIN);
await kv.put('ui:btn_colors', JSON.stringify('1'));
await kv.put('ui:btn_icons', JSON.stringify({}));
globalThis.__resetBtnUI();
const settingsWithButtons = await miniApi('/api/miniapp/admin/settings', lookAdmin);
assert(settingsWithButtons.status === 200 && settingsWithButtons.json.buttons && settingsWithButtons.json.buttons.colors === true && Array.isArray(settingsWithButtons.json.buttons.slots) && settingsWithButtons.json.buttons.slots.length === 16, 'تنظیمات مینی‌اپ وضعیت ظاهر دکمه‌ها و ۱۶ جایگاه را برمی‌گرداند');

const savedLook = await miniApi('/api/miniapp/admin/buttons', lookAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colors: false, icons: { buy: '5368324170671202286' } }) });
assert(savedLook.status === 200 && savedLook.json.ok && savedLook.json.colors === false && savedLook.json.icons.buy === '5368324170671202286', 'مدیر می‌تواند از اپ حالت شیشه‌ای و آیکن یک دکمه را ذخیره کند');
const storedColors = await kvJson('ui:btn_colors');
assert(String(storedColors) === '0' || storedColors === 0, 'حالت شیشه‌ای در KV ذخیره می‌شود');
assert((await kvJson('ui:btn_icons')).buy === '5368324170671202286', 'شناسهٔ آیکن از اپ در KV ذخیره می‌شود');

const uiAfterApp = await globalThis.__btnUI(env);
const afterAppSave = globalThis.__decorateMarkup(uiProbe(), uiAfterApp).markup.inline_keyboard[0][0];
assert(afterAppSave && !afterAppSave.style && afterAppSave.icon_custom_emoji_id === '5368324170671202286', 'تغییری که از مینی‌اپ ذخیره شد، همان لحظه روی دکمه‌های چت اعمال می‌شود');

const badEmoji = await miniApi('/api/miniapp/admin/buttons', lookAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ icons: { buy: 'abc' } }) });
assert(badEmoji.status === 400 && badEmoji.json.error === 'invalid_emoji_id', 'شناسهٔ غیرعددی از اپ رد می‌شود');
const badSlot = await miniApi('/api/miniapp/admin/buttons', lookAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ icons: { unknown_slot: '123456789' } }) });
assert(badSlot.status === 400 && badSlot.json.error === 'invalid_slot', 'جایگاه ناشناخته از اپ رد می‌شود');
const badColors = await miniApi('/api/miniapp/admin/buttons', lookAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colors: 'yes' }) });
assert(badColors.status === 400 && badColors.json.error === 'invalid_colors', 'مقدار نامعتبر حالت رنگ رد می‌شود');
const cleared = await miniApi('/api/miniapp/admin/buttons', lookAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colors: true, icons: { buy: '' } }) });
assert(cleared.status === 200 && cleared.json.colors === true && !cleared.json.icons.buy, 'خالی‌کردن شناسه، آیکن را حذف می‌کند');

const normalUserLook = await miniApi('/api/miniapp/admin/buttons', await signedInitData(U8), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colors: false }) });
assert([401, 403].includes(normalUserLook.status), 'کاربر عادی به تنظیمات ظاهر دکمه‌ها دسترسی ندارد');
await kv.put('ui:btn_icons', JSON.stringify({}));
globalThis.__resetBtnUI();

// پنل واقعی در HTML تنظیمات مینی‌اپ وجود دارد (نه فقط API)
const miniHtmlLook = fs.readFileSync(path.join(here, '..', 'public', 'miniapp.html'), 'utf8');
assert(miniHtmlLook.includes('id="btnLookPanel"') && miniHtmlLook.includes('id="btnLookGrid"') && miniHtmlLook.includes('id="btnLookSave"') && miniHtmlLook.includes('id="btnLookColors"'),
  'پنل «ظاهر دکمه‌های چت» با کلید رنگ، فهرست جایگاه‌ها و دکمهٔ ذخیره در صفحهٔ تنظیمات مینی‌اپ هست');
assert(miniHtmlLook.includes("id=\"btnLookGrab\"") && miniHtmlLook.includes('?start=ui_grab'),
  'از داخل مینی‌اپ یک دکمه ادمین را برای گرفتن شناسهٔ ایموجی به چت ربات می‌برد');
const lookGet = await miniApi('/api/miniapp/admin/buttons', lookAdmin);
assert(lookGet.status === 200 && Array.isArray(lookGet.json.slots) && lookGet.json.slots.length === 16 && typeof lookGet.json.colors === 'boolean',
  'مسیر اختصاصی ظاهر دکمه‌ها هم وضعیت و ۱۶ جایگاه را برمی‌گرداند');

// پل مینی‌اپ → چت: /start ui_grab ادمین را در حالت گرفتن شناسه می‌گذارد
await sendText(ADMIN, '/start ui_grab');
const deepGrab = lastMsgTo(ADMIN);
assert(deepGrab && String(deepGrab.params.text || '').includes('شناسهٔ ایموجی متحرک'), 'لینک «گرفتن شناسه» از مینی‌اپ، چت را در حالت گرفتن شناسه می‌گذارد');
const deepBefore = TG.length;
await upd({ message: { message_id: ++midSeq, chat: { id: ADMIN, type: 'private' }, from: { id: ADMIN, first_name: 'A' }, text: '🎁', entities: [{ type: 'custom_emoji', offset: 0, length: 2, custom_emoji_id: '5368324170671202286' }] } });
const deepGrabMsg = TG.slice(deepBefore).filter((x) => x.method === 'sendMessage' && String(x.params.chat_id) === String(ADMIN)).slice(-1)[0];
assert(deepGrabMsg && String(deepGrabMsg.params.text || '').includes('5368324170671202286') && lookupButtons(deepGrabMsg).some((b) => String(b.callback_data).startsWith('s_ui_assign:5368324170671202286:')),
  'بعد از ورود از لینک مینی‌اپ، فوروارد ایموجی متحرک همان‌جا شناسه را می‌دهد');
await sendText(ADMIN, '/cancel');
await kv.put('ui:btn_icons', JSON.stringify({}));
await kv.put('ui:btn_colors', JSON.stringify('1'));
globalThis.__resetBtnUI();


// ================= مدیریت دکمه‌های کیبورد چت =================
console.log('\n— مدیریت دکمه‌های کیبورد چت —');
const prevMode = env.MINIAPP_ONLY_MODE;
env.MINIAPP_ONLY_MODE = 'true';
await kv.delete('ui:chat_buttons');
globalThis.__resetChatButtons();
function panelMsg(tgid) {
  const f = TG.filter(x => String(x.params.chat_id) === String(tgid) && (x.method === 'sendMessage' || x.method === 'editMessageText'));
  return f[f.length - 1];
}
function kbTexts(msg) {
  const kb = msg && msg.params && msg.params.reply_markup && msg.params.reply_markup.keyboard;
  return Array.isArray(kb) ? kb.flat().map(x => x.text) : [];
}
const DEFAULT_KB = ['🛍 خرید اشتراک', '🎧 پشتیبانی', '🎁 اشتراک رایگان', '📘 راهنما', '🪪 اطلاعات حساب', '🤝 دریافت نمایندگی'];

await press(ADMIN, 's_kb');
assert(panelMsg(ADMIN).params.text.includes('دکمه‌های چت') && lookupButtons(panelMsg(ADMIN)).filter(b => String(b.callback_data).startsWith('s_kb_it:')).length === 6, 'پنل «دکمه‌های چت» در تنظیمات ادمین باز می‌شود و شش دکمهٔ فعلی را نشان می‌دهد');
await press(ADMIN, 's_kb_it:buy');
assert(panelMsg(ADMIN).params.text.includes('خرید اشتراک') && lookupButtons(panelMsg(ADMIN)).some(b => b.callback_data === 's_kb_tog:buy') && lookupButtons(panelMsg(ADMIN)).some(b => b.callback_data === 's_kb_ren:buy'), 'هر دکمه صفحهٔ اختصاصی با روشن/خاموش و تغییر نام دارد');

await press(ADMIN, 's_kb_ren:buy');
await sendText(ADMIN, 'اشتراک بخرم');
const renamedCfg = await kvJson('ui:chat_buttons');
assert(renamedCfg && renamedCfg.labels && renamedCfg.labels.buy === 'اشتراک بخرم', 'تغییر نام دکمه در KV ذخیره می‌شود');
await sendText(U12, '/start');
assert(JSON.stringify(kbTexts(lastMsgTo(U12))) === JSON.stringify(['🛍 اشتراک بخرم', '🎧 پشتیبانی', '🎁 اشتراک رایگان', '📘 راهنما', '🪪 اطلاعات حساب', '🤝 دریافت نمایندگی']), 'نام تازه همان لحظه روی کیبورد مشتری می‌آید');
await sendText(U12, 'خرید اشتراک');
assert(String(lastMsgTo(U12).params.text || '').includes('برای خرید اشتراک وارد اپ فروش تیزنت شوید'), 'نام پیش‌فرض قبلی هم بعد از تغییر نام هنوز مسیر درست را اجرا می‌کند');
await sendText(U12, 'اشتراک بخرم');
assert(String(lastMsgTo(U12).params.text || '').includes('برای خرید اشتراک وارد اپ فروش تیزنت شوید'), 'نام سفارشی هم همان دکمه را اجرا می‌کند');

await press(ADMIN, 's_kb_tog:support');
await sendText(U12, '/start');
assert(kbTexts(lastMsgTo(U12)).length === 5 && !kbTexts(lastMsgTo(U12)).includes('🎧 پشتیبانی'), 'خاموش‌کردن دکمه آن را از کیبورد برمی‌دارد');
await sendText(U12, 'پشتیبانی');
assert(lastMsgTo(U12).params.text.includes('یکی از دکمه‌های پایین'), 'دکمهٔ خاموش دیگر مسیری را اجرا نمی‌کند');

await press(ADMIN, 's_kb_up:help');
await sendText(U12, '/start');
assert(JSON.stringify(kbTexts(lastMsgTo(U12))) === JSON.stringify(['🛍 اشتراک بخرم', '📘 راهنما', '🎁 اشتراک رایگان', '🪪 اطلاعات حساب', '🤝 دریافت نمایندگی']), 'جابه‌جایی دکمه ترتیب کیبورد را عوض می‌کند');

await press(ADMIN, 's_kb_del:apps');
await press(ADMIN, 's_kb_put:apps');
const afterAdd = await kvJson('ui:chat_buttons');
assert(afterAdd.order[afterAdd.order.length - 1] === 'apps', 'دکمهٔ حذف‌شده با «افزودن دکمه» به انتهای فهرست برمی‌گردد');

await press(ADMIN, 's_kb_reset');
const resetCfg = await kvJson('ui:chat_buttons');
await sendText(U12, '/start');
assert(JSON.stringify(kbTexts(lastMsgTo(U12))) === JSON.stringify(DEFAULT_KB) && resetCfg.order.length === 6 && !Object.keys(resetCfg.labels || {}).length, 'بازگردانی پیش‌فرض، نام و ترتیب و وضعیت شش دکمهٔ اصلی را برمی‌گرداند');

// همان تنظیمات از مینی‌اپ
const chatAdmin = await signedInitData(ADMIN);
const lookWithChat = await miniApi('/api/miniapp/admin/settings', chatAdmin);
assert(lookWithChat.json.buttons && lookWithChat.json.buttons.chat && lookWithChat.json.buttons.chat.items.length === 6 && lookWithChat.json.buttons.chat.catalog.length >= 6, 'تنظیمات مینی‌اپ فهرست دکمه‌های چت و کاتالوگ کامل را برمی‌گرداند');
const appChatSave = await miniApi('/api/miniapp/admin/buttons', chatAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: { order: ['buy', 'subs', 'wallet'], off: ['wallet'], labels: { subs: 'بسته‌های من' } } }) });
assert(appChatSave.status === 200 && appChatSave.json.chat.items.length === 3 && appChatSave.json.chat.items.find(i => i.id === 'subs').custom === 'بسته‌های من', 'مدیر از مینی‌اپ ترتیب، نام و خاموش‌بودن دکمه‌ها را ذخیره می‌کند');
await sendText(U12, '/start');
assert(JSON.stringify(kbTexts(lastMsgTo(U12))) === JSON.stringify(['🛍 خرید اشتراک', '📦 بسته‌های من']), 'تغییر مینی‌اپ همان لحظه روی کیبورد چت اعمال می‌شود');
const allOff = await miniApi('/api/miniapp/admin/buttons', chatAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: { order: ['buy'], off: ['buy'] } }) });
assert(allOff.status === 400 && allOff.json.error === 'all_buttons_off', 'خاموش‌کردن همهٔ دکمه‌ها از مینی‌اپ رد می‌شود');
const tooMany = await miniApi('/api/miniapp/admin/buttons', chatAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: { order: ['buy','support','free','help','account','agent','subs','wallet','orders','apps','ref'] } }) });
assert(tooMany.status === 400 && tooMany.json.error === 'too_many_buttons', 'بیش از سقف دکمه پذیرفته نمی‌شود');
const badBtn = await miniApi('/api/miniapp/admin/buttons', chatAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: { order: ['nope'] } }) });
assert(badBtn.status === 400 && badBtn.json.error === 'invalid_button', 'شناسهٔ ناشناختهٔ دکمه رد می‌شود');

// همگام‌سازی قابلیت‌ها: هر دکمهٔ مینی‌اپ در چت هم همان داده را می‌دهد
const fullOrder = ['subs', 'wallet', 'orders', 'apps', 'ref', 'account', 'buy', 'support', 'free', 'help'];
const fullSave = await miniApi('/api/miniapp/admin/buttons', chatAdmin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: { order: fullOrder, off: [], labels: {} } }) });
assert(fullSave.status === 200, 'ده دکمهٔ همگام‌شده در یک کیبورد جای می‌گیرند');
await sendText(U12, 'اشتراک‌های من');
assert(lastMsgTo(U12).params.text.includes('اشتراک‌های من'), 'دکمهٔ «اشتراک‌های من» در چت پاسخ می‌دهد');
await sendText(U12, 'کیف پول و شارژ');
const walletChat = lastMsgTo(U12).params.text;
const u12 = await kvJson('u:' + U12);
assert(walletChat.includes('کیف پول') && walletChat.includes(fmtTomanForTest(u12.balance || 0)), 'موجودی کیف پول در چت با همان عدد ذخیره‌شده یکی است');
await sendText(U12, 'سفارش‌های من');
assert(lastMsgTo(U12).params.text.includes('سفارش‌های من'), 'دکمهٔ «سفارش‌های من» در چت پاسخ می‌دهد');
await sendText(U12, 'دانلود اپ‌ها');
assert(lastMsgTo(U12).params.text.includes('hiddify'), 'دکمهٔ «دانلود اپ‌ها» همان فهرست اپ‌ها را می‌دهد');
await sendText(U12, 'دعوت دوستان');
assert(lastMsgTo(U12).params.text.includes('دعوت دوستان') && lastMsgTo(U12).params.text.includes('start=ref_'), 'دکمهٔ «دعوت دوستان» لینک اختصاصی را می‌دهد');
await sendText(U12, 'اطلاعات حساب');
assert(lastMsgTo(U12).params.text.includes('شناسهٔ تلگرام') && lastMsgTo(U12).params.text.includes(String(U12)), '«اطلاعات حساب» همان شناسهٔ کاربر را نشان می‌دهد');

// مشتری عادی به تنظیمات دکمه‌ها دسترسی ندارد
const plainChatSave = await miniApi('/api/miniapp/admin/buttons', await signedInitData(U12), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat: { order: ['buy'] } }) });
assert([401, 403].includes(plainChatSave.status), 'کاربر عادی نمی‌تواند دکمه‌های چت را تغییر دهد');

await kv.delete('ui:chat_buttons');
globalThis.__resetChatButtons();
env.MINIAPP_ONLY_MODE = prevMode;


// ================= همگام‌سازی چت و مینی‌اپ (ادمین) =================
console.log('\n— همگام‌سازی چت و مینی‌اپ —');
const syncAdminInit = await signedInitData(ADMIN);
const faDigits = (n) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const summarySync = await miniApi('/api/miniapp/admin/summary?days=30', syncAdminInit);
const panelsSync = await miniApi('/api/miniapp/admin/panels', syncAdminInit);
const plansSync = await miniApi('/api/miniapp/admin/plans', syncAdminInit);
await press(ADMIN, 'a_stats');
const statsText = String(panelMsg(ADMIN).params.text || '');
const revenueSync = summarySync.json && summarySync.json.totals ? Number(summarySync.json.totals.revenue || 0) : -1;
assert(summarySync.status === 200 && summarySync.json.ok && statsText.includes('کاربران') && revenueSync >= 0 && statsText.includes(fmtTomanForTest(revenueSync)), 'آمار چت و مینی‌اپ از یک منبع می‌خوانند و درآمد یکی است');
const plansCount = Array.isArray(plansSync.json && plansSync.json.items) ? plansSync.json.items.length : 0;
const panelsCount = Array.isArray(panelsSync.json && panelsSync.json.items) ? panelsSync.json.items.length : 0;
assert(statsText.includes(faDigits(plansCount)) && statsText.includes(faDigits(panelsCount)), 'تعداد پلن و سرور در گزارش چت با مینی‌اپ یکی است');

await kv.put('system:kv_backup_last_at', 0);
await press(ADMIN, 'a_kvb');
const backupMsg = String(panelMsg(ADMIN).params.text || '');
assert(backupMsg.includes('بکاپ KV') && (backupMsg.includes('ارسال شد') || backupMsg.includes('در حال') || backupMsg.includes('تازه') || backupMsg.includes('انجام نشد')), 'بکاپ KV از داخل چت اجرا می‌شود و نتیجه را می‌گوید');

const agentsApiSync = await miniApi('/api/miniapp/admin/agents', syncAdminInit);
await press(ADMIN, 'a_agents');
const agentsText = String(panelMsg(ADMIN).params.text || '');
const agentsFirst = agentsApiSync.json && agentsApiSync.json.items && agentsApiSync.json.items[0];
const agentsName = agentsFirst ? String(agentsFirst.first_name || agentsFirst.username || agentsFirst.tg_id) : '';
assert(agentsApiSync.status === 200 && agentsApiSync.json.ok && agentsText.includes('نماینده‌ها') && (agentsFirst ? agentsText.includes(agentsName) : agentsText.includes('هنوز نماینده‌ای ثبت نشده')), 'فهرست نماینده‌ها در چت از همان دادهٔ مینی‌اپ ساخته می‌شود');

await press(ADMIN, 'a_store');
const storeBtns = lookupButtons(panelMsg(ADMIN));
assert(storeBtns.some(b => b.web_app && String(b.web_app.url).includes('/miniapp')), 'پیش‌نمایش فروشگاه از چت، همان مینی‌اپ را باز می‌کند');

// ================= نسخهٔ وب: ورود با کد یک‌بارمصرف =================
console.log('\n— نسخهٔ وب —');
await sendText(U13, '/start');
await sendText(U13, '/login');
const loginMsg = lastMsgTo(U13);
const codeMatch = String(loginMsg && loginMsg.params && loginMsg.params.text || '').match(/<code>([A-Z2-9]{8})<\/code>/);
assert(!!codeMatch, 'دستور /login یک کد یک‌بارمصرف ۸ نویسه‌ای می‌فرستد');
const webCodeValue = codeMatch[1];
const appPage = await APP.fetch(new Request('https://t.test/app'), env, {});
assert(appPage.status === 200 && (await appPage.text()).includes('TiznetVPN Mini App'), 'مسیر /app همان صفحهٔ اپ را برای مرورگر سرو می‌کند');

const noCookie = await APP.fetch(new Request('https://t.test/api/web/session'), env, {});
assert(noCookie.status === 401, 'بدون نشست، /api/web/session اجازه نمی‌دهد');
const badLogin = await APP.fetch(new Request('https://t.test/api/web/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'ZZZZZZZZ' }) }), env, {});
assert(badLogin.status === 401, 'کد نامعتبر پذیرفته نمی‌شود');
const goodLogin = await APP.fetch(new Request('https://t.test/api/web/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: webCodeValue }) }), env, {});
const setCookie = goodLogin.headers.get('set-cookie') || '';
const sessionValue = (setCookie.match(/tzs=([^;]+)/) || [])[1] || '';
assert(goodLogin.status === 200 && sessionValue && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie), 'ورود موفق کوکی HttpOnly/SameSite می‌دهد');
const reuse = await APP.fetch(new Request('https://t.test/api/web/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: webCodeValue }) }), env, {});
assert(reuse.status === 401, 'همان کد بار دوم کار نمی‌کند (یک‌بارمصرف)');
const webBoot = await APP.fetch(new Request('https://t.test/api/miniapp/bootstrap', { headers: { Cookie: 'tzs=' + sessionValue } }), env, {});
const webBootJson = await webBoot.json();
assert(webBoot.status === 200 && webBootJson.ok && String(webBootJson.profile.id) === String(U13), 'API مینی‌اپ با کوکی وب همان کاربر را می‌شناسد');
const tampered = await APP.fetch(new Request('https://t.test/api/miniapp/bootstrap', { headers: { Cookie: 'tzs=' + sessionValue.slice(0, -2) + 'aa' } }), env, {});
assert(tampered.status === 401, 'کوکی دست‌کاری‌شده رد می‌شود');
const sess = await APP.fetch(new Request('https://t.test/api/web/session', { headers: { Cookie: 'tzs=' + sessionValue } }), env, {});
assert(sess.status === 200, '/api/web/session با کوکی معتبر پاسخ می‌دهد');
const logout = await APP.fetch(new Request('https://t.test/api/web/logout', { method: 'POST', headers: { Cookie: 'tzs=' + sessionValue } }), env, {});
assert(logout.status === 200 && /Max-Age=0/.test(logout.headers.get('set-cookie') || ''), 'خروج، کوکی نشست را پاک می‌کند');
let throttled = false;
for (let i = 0; i < 10; i++) {
  const r = await APP.fetch(new Request('https://t.test/api/web/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ code: 'AAAA' + i }) }), env, {});
  if (r.status === 429) { throttled = true; break; }
}
assert(throttled, 'تلاش‌های پیاپی ورود از یک IP محدود می‌شوند');

// ---------- دامنه و HTTPS ----------
console.log('\n— دامنه و HTTPS —');
const domainNoAdmin = await miniApi('/api/miniapp/admin/domain', userInit);
assert(domainNoAdmin.status === 403, 'گزارش دامنه فقط برای مدیر است');
env.PUBLIC_BASE_URL = 'https://bot.tiznet.site';
env.MINIAPP_URL = 'https://bot.tiznet.site/miniapp';
const domainReport = await miniApi('/api/miniapp/admin/domain', adminInit);
assert(domainReport.status === 200 && domainReport.json.ok && domainReport.json.public_base_url === 'https://bot.tiznet.site'
  && domainReport.json.web_url === 'https://bot.tiznet.site/app'
  && domainReport.json.miniapp_url === 'https://bot.tiznet.site/miniapp'
  && domainReport.json.shetab_endpoint === 'https://bot.tiznet.site/wp-json/webdide-cv/v1/confirm',
  'گزارش دامنه آدرس عمومی، نسخهٔ وب، مینی‌اپ و endpoint شتاب را یک‌جا برمی‌گرداند');
assert(domainReport.json.request_host === 't.test' && domainReport.json.host_match === false, 'گزارش دامنه اختلاف هاست درخواست با آدرس عمومی را تشخیص می‌دهد');
const domainMatched = await APP.fetch(new Request('https://bot.tiznet.site/api/miniapp/admin/domain', { headers: { 'X-Telegram-Init-Data': adminInit } }), env, {});
const domainMatchedJson = await domainMatched.json();
assert(domainMatched.status === 200 && domainMatchedJson.host_match === true && domainMatchedJson.https === true, 'وقتی درخواست روی خود دامنه می‌آید، هاست و HTTPS منطبق گزارش می‌شوند');
const domainProbed = await APP.fetch(new Request('https://bot.tiznet.site/api/miniapp/admin/domain?probe=1', { headers: { 'X-Telegram-Init-Data': adminInit } }), env, {});
const domainProbedJson = await domainProbed.json();
assert(domainProbedJson.probe && domainProbedJson.probe.ok === true && domainProbedJson.probe.status === 200 && domainProbedJson.probe.version === pkgVersion, 'آزمون HTTPS از سمت سرور پاسخ سالم و نسخهٔ فعال را می‌خواند');
assert(domainProbedJson.webhook && domainProbedJson.webhook.ok === true && domainProbedJson.webhook.match === true && domainProbedJson.webhook.url === 'https://bot.tiznet.site/webhook', 'وبهوک تلگرام با آدرس همین دامنه مقایسه می‌شود');
env.PUBLIC_BASE_URL = 'https://down.example';
const domainDown = await APP.fetch(new Request('https://down.example/api/miniapp/admin/domain?probe=1', { headers: { 'X-Telegram-Init-Data': adminInit } }), env, {});
const domainDownJson = await domainDown.json();
assert(domainDownJson.probe && domainDownJson.probe.ok === false && domainDownJson.probe.status === 0 && domainDownJson.probe.error, 'اگر دامنه پاسخ ندهد، خطا به‌صورت پیام قابل‌نمایش برمی‌گردد');
delete env.PUBLIC_BASE_URL;
delete env.MINIAPP_URL;

// ---------- اپ اندروید: همان قرارداد مینی‌اپ، بدون endpoint تازهٔ جدا ----------
const shetabAppDenied = await miniApi('/api/miniapp/admin/shetab-app', userInit);
assert(shetabAppDenied.status === 403, 'اطلاعات اتصال اپ فقط برای مدیر است');
const shetabAppView = await miniApi('/api/miniapp/admin/shetab-app', adminInit);
assert(shetabAppView.status === 200 && shetabAppView.json.ok === true
  && String(shetabAppView.json.endpoint || '').endsWith('/wp-json/webdide-cv/v1/confirm')
  && String(shetabAppView.json.secret || '').length >= 16
  && String(shetabAppView.json.status_url || '').endsWith('/wp-json/webdide-cv/v1/status')
  && typeof shetabAppView.json.auto_enabled === 'boolean'
  && typeof shetabAppView.json.card_number === 'string',
  'اپ اندروید آدرس confirm، آدرس status و Secret را از نشست مدیریتی می‌گیرد');
assert(miniAppSource.includes("api('/api/miniapp/admin/shetab-app'") === false, 'مینی‌اپ به این مسیر وابسته نیست و رفتارش تغییر نکرده');

// ---------- گزارش‌ها: ارسال فایل به چت به‌جای دانلود گم‌شونده ----------
const reportDenied = await miniApi('/api/miniapp/admin/report', userInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'tiznetvpn-x.csv', title: 't', csv: 'a,b\n1,2\n' }) });
assert(reportDenied.status === 403, 'ارسال گزارش به چت فقط برای مدیر است');
const reportBadName = await miniApi('/api/miniapp/admin/report', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: '../etc/passwd.csv', title: 't', csv: 'a\n1\n' }) });
assert(reportBadName.status === 400 && reportBadName.json.error === 'invalid_report_filename', 'نام فایل گزارش اعتبارسنجی می‌شود');
const reportEmpty = await miniApi('/api/miniapp/admin/report', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'tiznetvpn-empty.csv', title: 't', csv: '' }) });
assert(reportEmpty.status === 400 && reportEmpty.json.error === 'invalid_report_content', 'گزارش خالی ارسال نمی‌شود');
const reportStart = TG.length;
const reportOk = await miniApi('/api/miniapp/admin/report', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'tiznetvpn-orders.csv', title: 'گزارش سفارش‌ها', csv: '\ufeff"شناسه","مبلغ"\n"1","۱۰۰۰"\n"2","۲۰۰۰"\n' }) });
const reportDoc = TG.slice(reportStart).find((x) => x.method === 'sendDocument' && String(x.params.chat_id) === String(ADMIN));
assert(reportOk.status === 200 && reportOk.json.ok === true && reportOk.json.rows === 2 && reportDoc
  && String(reportDoc.params.document_name || '') === 'tiznetvpn-orders.csv'
  && String(reportDoc.params.document_type || '').includes('text/csv')
  && String(reportDoc.params.caption || '').includes('گزارش سفارش‌ها')
  && String(reportDoc.params.caption || '').includes('۲ ردیف'),
  'گزارش CSV به‌صورت فایل در چت خود مدیر ارسال می‌شود و در تاریخچه می‌ماند');

// ---------- بکاپ خودکار در چت ----------
const backupStatusDenied = await miniApi('/api/miniapp/admin/backup-status', userInit);
assert(backupStatusDenied.status === 403, 'وضعیت بکاپ خودکار فقط برای مدیر است');
await kv.delete('system:kv_backup_last_at');
const backupStatusBefore = await miniApi('/api/miniapp/admin/backup-status', adminInit);
assert(backupStatusBefore.status === 200 && backupStatusBefore.json.ok && backupStatusBefore.json.every_hours === 3
  && backupStatusBefore.json.cron === '0 */3 * * *' && backupStatusBefore.json.last_at === 0 && backupStatusBefore.json.admins >= 1,
  'وضعیت بکاپ بازهٔ ۳ ساعته، کرون و گیرندگان را برمی‌گرداند');
const manualSendStart = TG.length;
const backupSend = await miniApi('/api/miniapp/admin/backup-send', adminInit, { method: 'POST' });
const manualSendDoc = TG.slice(manualSendStart).find((x) => x.method === 'sendDocument' && String(x.params.chat_id) === String(ADMIN));
assert(backupSend.status === 200 && backupSend.json.ok && manualSendDoc
  && String(manualSendDoc.params.document_name || '').endsWith('.json.gz') && backupSend.json.last_at > 0,
  'دکمهٔ «بکاپ و ارسال فوری» فایل gzip را همین حالا به مدیر می‌فرستد');
const backupSendAgain = await miniApi('/api/miniapp/admin/backup-send', adminInit, { method: 'POST' });
assert(backupSendAgain.status === 409 && backupSendAgain.json.error === 'already_sent' && backupSendAgain.json.last_at > 0,
  'ارسال فوری پشت‌سرهم تا یک دقیقه مسدود می‌شود تا فایل تکراری نرود');
await sendText(ADMIN, '/backup');
const backupCmdMsg = lastMsgTo(ADMIN);
assert(String(backupCmdMsg.params.text || '').includes('یک دقیقه صبر کنید') && String(backupCmdMsg.params.text || '').includes('هر ۳ ساعت'),
  'دستور /backup در چت زمان آخرین بکاپ و بازهٔ خودکار را گزارش می‌دهد');
await sendText(U2, '/backup');
const backupCmdDenied = lastMsgTo(U2);
assert(String(backupCmdDenied.params.text || '').includes('فقط برای مدیران'), 'دستور /backup برای کاربر عادی اجرا نمی‌شود');
const updateSourceTimers = fs.readFileSync(path.join(here, '..', 'update.sh'), 'utf8');
assert(updateSourceTimers.includes('tiznetvpn-backup.timer') && updateSourceTimers.includes('TIMERS_ENABLED')
  && updateSourceTimers.includes('systemctl start tiznetvpn-backup.service'),
  'update.sh همهٔ تایمرها (از جمله بکاپ ۳ساعته) را فعال می‌کند و یک بکاپ فوری می‌فرستد');
assert(miniAppSource.includes('backup-status') && miniAppSource.includes('backup-send') && !miniAppSource.includes('kvBackupSend')
  && miniAppSource.includes("id=\"kvBackupDownload\" type=\"button\"")
  && miniAppSource.indexOf("api('/api/miniapp/admin/backup-send'") < miniAppSource.indexOf("api('/api/miniapp/admin/backup-link')"),
  'تب «پشتیبان» مینی‌اپ یک دکمه دارد که اول فایل را داخل چت تلگرام می‌فرستد و لینک موقت فقط پشتیبان است');
assert(miniAppSource.includes('async function exportReportToChat') && miniAppSource.includes("api('/api/miniapp/admin/report'")
  && miniAppSource.includes("exportReportToChat(recentOrders,'tiznetvpn-latest-orders.csv'")
  && miniAppSource.includes("exportReportToChat(currentOrders,'tiznetvpn-orders.csv'")
  && miniAppSource.includes("exportReportToChat(data,'tiznetvpn-customers.csv'")
  && miniAppSource.includes("exportReportToChat(data,'tiznetvpn-plans.csv'")
  && miniAppSource.includes('function downloadCSVFile')
  && !/downloadCSV\(recentOrders|downloadCSV\(currentOrders/.test(miniAppSource),
  'هر چهار خروجی CSV مینی‌اپ اول به‌صورت فایل در چت تلگرام ارسال می‌شوند و ذخیرهٔ محلی فقط پشتیبان است');

// ---------- نسخهٔ وب در مرورگر واقعی + ابزار دامنه ----------
const isTelegramBlock = miniAppSource.slice(miniAppSource.indexOf('const tgPlatform'), miniAppSource.indexOf('const isTelegram ='));
assert(miniAppSource.includes("const tgPlatform = String((tg && tg.platform) || 'unknown').toLowerCase();")
  && isTelegramBlock.length > 0
  && miniAppSource.includes("/tgWebApp/i.test(location.hash)")
  && !miniAppSource.includes('const isTelegram = !!tg;'),
  'نسخهٔ وب در مرورگر با وجود SDK تلگرام، به‌اشتباه «داخل تلگرام» تشخیص داده نمی‌شود');
assert(miniAppSource.includes('class="web-login-bot"') && miniAppSource.includes('?start=web_login') && miniAppSource.includes('bot_username'),
  'صفحهٔ ورود وب دکمهٔ «دریافت کد در تلگرام» را از نام ربات می‌سازد');
const webSessionUnauthorized = await APP.fetch(new Request('https://t.test/api/web/session'), env, {});
const webSessionUnauthorizedJson = await webSessionUnauthorized.json();
assert(webSessionUnauthorized.status === 401 && webSessionUnauthorizedJson.bot_username === 'TestShopBot',
  'پاسخ ۴۰۱ نشست وب نام ربات را برای دکمهٔ دریافت کد برمی‌گرداند');
assert(miniAppSource.includes('data-stab="domain"') && miniAppSource.includes('function loadDomainStatus')
  && miniAppSource.includes("api('/api/miniapp/admin/domain'+(probe?'?probe=1':''))"),
  'تب «دامنه» در تنظیمات مینی‌اپ، سلامت دامنه را با آزمون واقعی HTTPS نشان می‌دهد');
const fixDomainPath = path.join(here, '..', 'scripts', 'fix-domain.sh');
const fixDomainSource = fs.readFileSync(fixDomainPath, 'utf8');
assert(fs.statSync(fixDomainPath).mode & 0o100 && fixDomainSource.includes('nginx -t') && fixDomainSource.includes("s/__DOMAIN__/${DOMAIN}/g")
  && fixDomainSource.includes('certbot') && fixDomainSource.includes('env_set PUBLIC_BASE_URL') && fixDomainSource.includes('--check'),
  'اسکریپت fix-domain.sh جای‌نگهدار Nginx، گواهی، env و حالت بررسی را پوشش می‌دهد');
const updateSource = fs.readFileSync(path.join(here, '..', 'update.sh'), 'utf8');
assert(updateSource.includes("--domain)") && updateSource.includes('FIX_DOMAIN_SH') && updateSource.includes('FIX_ARGS+=(--check)')
  && updateSource.includes('scripts/fix-domain.sh'),
  'update.sh دامنه را با --domain می‌گیرد و در --dry-run فقط بررسی می‌کند');

// ---------- مدیران: فقط مدیر اصلی ----------
console.log('\n— مدیران —');
const managersDenied = await miniApi('/api/miniapp/admin/managers', userInit);
assert(managersDenied.status === 403, 'کاربر عادی به فهرست مدیران دسترسی ندارد');
const managersInitial = await miniApi('/api/miniapp/admin/managers', adminInit);
assert(managersInitial.status === 200 && managersInitial.json.ok && String(managersInitial.json.owner) === String(ADMIN)
  && managersInitial.json.env_admins.includes(String(ADMIN)) && Array.isArray(managersInitial.json.extra_admins),
  'مدیر اصلی فهرست مدیران دائمی و اضافه‌شده را می‌بیند');
const addAdminId = 777001;
const addAdminRes = await miniApi('/api/miniapp/admin/managers', adminInit, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', id: addAdminId })
});
assert(addAdminRes.status === 200 && addAdminRes.json.ok && addAdminRes.json.extra_admins.some((x) => x.id === String(addAdminId)),
  'مدیر اصلی می‌تواند مدیر جدید اضافه کند');
const secondAdminInit = await signedInitData(addAdminId, { first_name: 'Second', username: 'second_admin' });
const secondAdminSummary = await miniApi('/api/miniapp/admin/summary?days=30', secondAdminInit);
assert(secondAdminSummary.status === 200, 'مدیر تازه بلافاصله به پنل دسترسی کامل دارد');
const secondAdminManagers = await miniApi('/api/miniapp/admin/managers', secondAdminInit);
assert(secondAdminManagers.status === 403 && secondAdminManagers.json.error === 'owner_required', 'مدیر غیراصلی بخش «مدیران» را نمی‌بیند');
const removeAdminRes = await miniApi('/api/miniapp/admin/managers', adminInit, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: addAdminId })
});
assert(removeAdminRes.status === 200 && !removeAdminRes.json.extra_admins.some((x) => x.id === String(addAdminId)),
  'مدیر اصلی می‌تواند مدیر اضافه‌شده را حذف کند');
const secondAdminAfter = await miniApi('/api/miniapp/admin/summary?days=30', secondAdminInit);
assert(secondAdminAfter.status === 403, 'بعد از حذف، دسترسی مدیر قطع می‌شود');
const permanentRemove = await miniApi('/api/miniapp/admin/managers', adminInit, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', id: ADMIN })
});
assert(permanentRemove.status === 409 && permanentRemove.json.error === 'permanent_admin', 'مدیر دائمی (ADMIN_IDS) از پنل حذف نمی‌شود');

// همان کار از داخل چت
await press(ADMIN, 'a_admins');
const chatManagersMsg = lastMsgTo(ADMIN, 'editMessageText') || lastMsgTo(ADMIN);
assert(String(chatManagersMsg.params.text || '').includes('مدیران ربات') && String(chatManagersMsg.params.text || '').includes(String(ADMIN)),
  'پنل چت فهرست مدیران را نشان می‌دهد');
await press(ADMIN, 'a_addm');
await sendText(ADMIN, '777002');
const afterChatAdd = await miniApi('/api/miniapp/admin/managers', adminInit);
assert(afterChatAdd.json.extra_admins.some((x) => x.id === '777002'), 'افزودن مدیر از داخل چت کار می‌کند');
await press(ADMIN, 'a_delmgo:777002');
const afterChatRemove = await miniApi('/api/miniapp/admin/managers', adminInit);
assert(!afterChatRemove.json.extra_admins.some((x) => x.id === '777002'), 'حذف مدیر از داخل چت کار می‌کند');

// «انصراف» باید حالت انتظار شناسه را پاک کند تا پیام بعدی به‌اشتباه مدیر نسازد
await press(ADMIN, 'a_addm');
await press(ADMIN, 'a_admins');
await sendText(ADMIN, '777004');
const afterChatCancel = await miniApi('/api/miniapp/admin/managers', adminInit);
assert(!afterChatCancel.json.extra_admins.some((x) => x.id === '777004'), 'انصراف از افزودن مدیر، حالت انتظار شناسه را پاک می‌کند');

// مدیر غیراصلی دکمهٔ «مدیران» را در پنل نمی‌بیند
const savedAdminIds = env.ADMIN_IDS;
env.ADMIN_IDS = savedAdminIds + ',777003';
await sendText(777003, '/start');
await sendText(777003, '/admin');
const secondAdminButtons = lookupButtons(lastMsgTo(777003)).map((b) => b.callback_data);
await sendText(ADMIN, '/start');
await sendText(ADMIN, '/admin');
const ownerButtons = lookupButtons(lastMsgTo(ADMIN)).map((b) => b.callback_data);
assert(!secondAdminButtons.includes('a_admins') && ownerButtons.includes('a_admins'),
  'دکمهٔ «مدیران» فقط در پنل مدیر اصلی دیده می‌شود');
env.ADMIN_IDS = savedAdminIds;
assert(miniAppSource.includes('id="managersTab"') && miniAppSource.includes('data-manager-remove') && miniAppSource.includes("api('/api/miniapp/admin/managers'"),
  'تب «مدیران» در تنظیمات مینی‌اپ با افزودن و حذف فقط برای مدیر اصلی ساخته شده است');

// ---------- نگهداری اشتراک‌ها: حذف خودکار انقضاشده‌ها از پنل ----------
const retEnv = Object.assign({}, env, { DB: new MockKV() });
const retPanelId = 'rpanel';
await retEnv.DB.put('panels', JSON.stringify({ [retPanelId]: { id: retPanelId, name: 'سرور نگهداری', enabled: true, api_base: 'https://panel.test/RET', api_key: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', user_base: 'https://panel.test/sub' } }));
await retEnv.DB.put('cfg', JSON.stringify(Object.assign({}, globalThis.__DEFAULT_SETTINGS)));
const dayMs = 86400000;
function isoDay(offsetDays) { return new Date(Date.now() + offsetDays * dayMs).toISOString().slice(0, 10); }
let retSeq = 0;
async function seedRetSub(opts) {
  const sid = 'retsub' + String(++retSeq).padStart(3, '0');
  const uuid = 'dddddddd-0000-0000-0000-' + String(retSeq).padStart(12, '0');
  const sub = {
    sid: sid, uuid: uuid, tg_id: String(opts.tgid || ''), panel_id: retPanelId,
    plan_id: opts.plan_id || 'nope', created_at: Date.now() - 30 * dayMs,
    free_subscription: opts.free === true, kind: opts.free === true ? 'free_subscription' : 'paid'
  };
  if (opts.tgid) {
    const user = await kvJson('u:' + opts.tgid) || { tg_id: String(opts.tgid), first_name: 'R' + opts.tgid, balance: 0, subs: [] };
    user.subs = Array.from(new Set([].concat(user.subs || [], sid)));
    await retEnv.DB.put('u:' + opts.tgid, JSON.stringify(user));
  }
  await retEnv.DB.put('s:' + sid, JSON.stringify(sub));
  if (opts.live !== false) {
    hUsers.set(uuid, {
      uuid: uuid, name: 'ret-' + sid, usage_limit_GB: 10, package_days: opts.package_days,
      current_usage_GB: 1, start_date: opts.start_date || isoDay(-1), enable: true, is_active: true
    });
  }
  return { sid: sid, uuid: uuid };
}
const retFreePast = await seedRetSub({ tgid: 5501, free: true, package_days: 5, start_date: isoDay(-6) });    // دیروز منقضی
const retFreeToday = await seedRetSub({ tgid: 5502, free: true, package_days: 5, start_date: isoDay(-5) });   // امروز منقضی
const retPaidGrace = await seedRetSub({ tgid: 5503, free: false, package_days: 30, start_date: isoDay(-32) }); // ۲ روز گذشته
const retPaidLate = await seedRetSub({ tgid: 5504, free: false, package_days: 30, start_date: isoDay(-35) });  // ۵ روز گذشته
const retPaidLate2 = await seedRetSub({ tgid: '', free: false, package_days: 30, start_date: isoDay(-40) });   // بدون tg_id
const retActive = await seedRetSub({ tgid: 5505, free: false, package_days: 30, start_date: isoDay(-1) });
const retMissing = await seedRetSub({ tgid: 5506, free: false, package_days: 30, live: false });
const retUnknown = await seedRetSub({ tgid: 5507, free: true, package_days: 5, start_date: 'not-a-date' });
const retAgentSub = await seedRetSub({ tgid: '', free: false, package_days: 30, start_date: isoDay(-35) });
const retAgentRec = JSON.parse(await retEnv.DB.get('s:' + retAgentSub.sid, { type: 'text' }));
retAgentRec.kind = 'agent_subscription'; retAgentRec.agent_id = '6601';
await retEnv.DB.put('s:' + retAgentSub.sid, JSON.stringify(retAgentRec));

const retViewDenied = await miniApi('/api/miniapp/admin/retention', user4Init);
const retView = await miniApi('/api/miniapp/admin/retention', adminInit);
assert(retViewDenied.status === 403 && retView.status === 200 && retView.json.config.enabled === true && retView.json.config.free_delete === true && retView.json.config.paid_delete === true && retView.json.config.grace_days === 3 && retView.json.cron === '30 5 * * *', 'دیدگاه نگهداری فقط برای مدیر است و پیش‌فرض‌ها (حذف رایگان، حذف پولی پس از ۳ روز) را نشان می‌دهد');
const badGrace = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retention_paid_grace_days: 99 }) });
const goodGrace = await miniApi('/api/miniapp/admin/settings', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retention_paid_grace_days: 3, retention_enabled: true, retention_free_delete: true, retention_paid_delete: true }) });
assert(badGrace.status === 400 && badGrace.json.error === 'invalid_retention_grace_days' && goodGrace.status === 200 && goodGrace.json.settings.retention_paid_grace_days === 3 && goodGrace.json.settings.retention_enabled === true, 'تنظیمات نگهداری اعتبارسنجی می‌شود و در پاسخ ذخیره برمی‌گردد');

const retDry = await globalThis.__retentionSweep(retEnv, { dry_run: true });
assert(retDry.dry_run === true && retDry.eligible === 3 && retDry.deleted === 0 && retDry.in_grace === 2 && retDry.active === 1 && retDry.unknown === 1 && retDry.missing === 1 && retDry.agent_subs === 1, 'پیش‌نمایش پاک‌سازی هیچ چیزی را حذف نمی‌کند و شمارش‌ها دقیق است', JSON.stringify(retDry));
assert(hUsers.has(retFreePast.uuid) && hUsers.has(retPaidLate.uuid), 'در حالت پیش‌نمایش، اشتراک‌های واجد شرایط هنوز در پنل باقی می‌مانند');
const tgBeforeRetention = TG.length;
const retRun = await globalThis.__retentionSweep(retEnv, {});
assert(retRun.deleted === 3 && retRun.deleted_free === 1 && retRun.deleted_paid === 2 && retRun.failed === 0, 'اجرای واقعی رایگان منقضی و پولی‌های خارج از مهلت را از پنل حذف می‌کند', JSON.stringify(retRun));
assert(!hUsers.has(retFreePast.uuid) && !hUsers.has(retPaidLate.uuid) && !hUsers.has(retPaidLate2.uuid), 'کاربران واجد شرایط واقعاً از پنل حذف شدند');
assert(hUsers.has(retFreeToday.uuid) && hUsers.has(retPaidGrace.uuid) && hUsers.has(retActive.uuid) && hUsers.has(retUnknown.uuid) && hUsers.has(retAgentSub.uuid), 'رایگانِ پایان‌امروز، پولیِ در مهلت، فعال، تاریخ نامعتبر و اشتراک نماینده دست‌نخورده می‌مانند');
const retFreeRec = await retEnv.DB.get('s:' + retFreePast.sid, { type: 'json' });
const retPaidRec = await retEnv.DB.get('s:' + retPaidLate.sid, { type: 'json' });
const retGraceRec = await retEnv.DB.get('s:' + retPaidGrace.sid, { type: 'json' });
const retMissingRec = await retEnv.DB.get('s:' + retMissing.sid, { type: 'json' });
assert(retFreeRec.purged_at > 0 && retFreeRec.purge_reason === 'free_expired' && retFreeRec.purged_by === 'system' && retPaidRec.purged_at > 0 && retPaidRec.purge_reason === 'unrenewed_after_grace' && retPaidRec.purge_grace_days === 3, 'رکورد اشتراک برای سابقه می‌ماند و با نشانهٔ پاک‌شده و علت مشخص می‌شود');
assert(!retGraceRec.purged_at && retMissingRec.purged_at > 0 && retMissingRec.purge_reason === 'missing_in_panel', 'اشتراک حذف‌شده از قبل در پنل (۴۰۴) علامت‌گذاری می‌شود ولی اشتراک در مهلت پاک نمی‌شود');
const retLog = JSON.parse(await retEnv.DB.get('system:retention_log', { type: 'text' }) || '[]');
assert(Array.isArray(retLog) && retLog.length === 3 && retLog[0].sid && retLog.some((row) => row.free === true && row.reason === 'free_expired') && retLog.some((row) => row.free === false && row.grace_days === 3), 'گزارش آخرین حذف‌ها با شناسه و علت ذخیره می‌شود');
const retMsgs = TG.slice(tgBeforeRetention).filter((x) => x.method === 'sendMessage');
const retNotifiedPaid = retMsgs.some((x) => String(x.params.chat_id) === '5504' && String(x.params.text).includes('حذف شد'));
const retNotifiedFree = retMsgs.some((x) => String(x.params.chat_id) === '5501');
const retNotifiedAdmin = retMsgs.some((x) => String(x.params.chat_id) === String(ADMIN) && String(x.params.text).includes('پاک‌سازی خودکار پنل'));
assert(retNotifiedPaid && !retNotifiedFree && retNotifiedAdmin, 'فقط مشتری پولیِ حذف‌شده و مدیر پیام می‌گیرند؛ اشتراک رایگان پیام اضافه نمی‌فرستد');
const retRerun = await globalThis.__retentionSweep(retEnv, {});
assert(retRerun.deleted === 0, 'اجرای دوباره چیزی را دوباره حذف نمی‌کند (idempotent)');
await retEnv.DB.put('cfg', JSON.stringify(Object.assign({}, globalThis.__DEFAULT_SETTINGS, { retention_paid_delete: false })));
const retPaidKeep = await globalThis.__retentionSweep(retEnv, {});
assert(retPaidKeep.deleted === 0 && hUsers.has(retPaidGrace.uuid), 'خاموش‌کردن حذف پولی‌ها مانع پاک‌سازی آن‌ها می‌شود');
await retEnv.DB.put('cfg', JSON.stringify(Object.assign({}, globalThis.__DEFAULT_SETTINGS, { retention_enabled: false })));
const retDisabled = await globalThis.__retentionSweep(retEnv, {});
assert(retDisabled.disabled === true && retDisabled.deleted === 0, 'کلید اصلی نگهداری می‌تواند کل فرایند را متوقف کند');

// داشبورد پیشرفته: کارت نگهداری و خلاصهٔ نمایندگان در پاسخ summary
const summaryAdvanced = await miniApi('/api/miniapp/admin/summary?days=30', adminInit);
assert(summaryAdvanced.status === 200 && summaryAdvanced.json.retention && summaryAdvanced.json.retention.config.grace_days === 3 && summaryAdvanced.json.agents_summary && typeof summaryAdvanced.json.agents_summary.count === 'number' && typeof summaryAdvanced.json.agents_summary.revenue === 'number', 'داشبورد مدیر کارت نگهداری و خلاصهٔ نمایندگان را برمی‌گرداند');

// مدیریت کاربران: فیلترها، صفحه‌بندی و آمار
const customerListAll = await miniApi('/api/miniapp/admin/customers?limit=60', adminInit);
const customerListAgents = await miniApi('/api/miniapp/admin/customers?status=agent&limit=60', adminInit);
const customerListBySpend = await miniApi('/api/miniapp/admin/customers?sort=spend&limit=5', adminInit);
const customerListNumeric = await miniApi('/api/miniapp/admin/customers?q=' + U4, adminInit);
assert(customerListAll.status === 200 && customerListAll.json.stats && typeof customerListAll.json.registered_users === 'number' && Array.isArray(customerListAll.json.items) && 'active_subscriptions' in (customerListAll.json.items[0] || {}) && 'next_expiry' in (customerListAll.json.items[0] || {}), 'فهرست کاربران آمار، وضعیت اشتراک فعال و تاریخ انقضای بعدی را می‌دهد');
assert(customerListAgents.json.items.every((u) => u.is_agent === true) && customerListBySpend.json.items.length <= 5 && customerListBySpend.json.items.every((u, i, arr) => i === 0 || arr[i - 1].total_spent >= u.total_spent), 'فیلتر «نماینده» و مرتب‌سازی بر اساس خرید کار می‌کند');
assert(customerListNumeric.json.items.length === 1 && customerListNumeric.json.items[0].tg_id === String(U4) && customerListNumeric.json.has_more === false, 'جست‌وجوی آیدی عددی دقیقاً همان کاربر را برمی‌گرداند');
const deniedCustomerList = await miniApi('/api/miniapp/admin/customers?limit=10', user4Init);
assert(deniedCustomerList.status === 403, 'فهرست کاربران فقط برای مدیر است');

// مدیریت کامل کاربران از داشبورد: ارتقا/برکناری نماینده و پیام مستقیم
await sendText(778811, '/start');
const promoteFromCustomers = await miniApi('/api/miniapp/admin/customers/778811', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'promote_agent' }) });
const repeatPromote = await miniApi('/api/miniapp/admin/customers/778811', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'promote_agent' }) });
const promotedAgent = await globalThis.__getAgent(env, 778811);
await kv.put('agent:778811', JSON.stringify(Object.assign({}, promotedAgent, { balance: 5000 })));
const demoteWithBalance = await miniApi('/api/miniapp/admin/customers/778811', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'demote_agent' }) });
assert(promoteFromCustomers.status === 200 && promoteFromCustomers.json.agent && promoteFromCustomers.json.agent.tg_id === '778811' && repeatPromote.status === 409 && repeatPromote.json.error === 'agent_already_exists' && promotedAgent && demoteWithBalance.status === 409 && demoteWithBalance.json.error === 'agent_has_balance', 'مدیر می‌تواند کاربر را از داشبورد نماینده کند؛ ارتقای تکراری و برکناری تا وقتی موجودی کیف پول دارد رد می‌شود');
await kv.put('agent:778811', JSON.stringify(Object.assign({}, promotedAgent, { balance: 0 })));
const demoteClean = await miniApi('/api/miniapp/admin/customers/778811', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'demote_agent' }) });
assert(demoteClean.status === 200 && demoteClean.json.demoted === true && !(await globalThis.__getAgent(env, 778811)), 'نمایندهٔ بدون موجودی از داشبورد برکنار می‌شود');
await miniApi('/api/miniapp/admin/customers/778811', adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'promote_agent' }) });
const notifyUser = await miniApi('/api/miniapp/admin/customers/' + U2, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notify', text: 'سلام، تمدید کنید' }) });
const notifyEmpty = await miniApi('/api/miniapp/admin/customers/' + U2, adminInit, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'notify', text: ' ' }) });
assert(notifyUser.status === 200 && notifyUser.json.notified === true && lastMsgTo(U2) && String(lastMsgTo(U2).params.text).includes('تمدید کنید') && notifyEmpty.status === 400, 'مدیر می‌تواند از داشبورد به کاربر پیام مستقیم بفرستد و پیام خالی رد می‌شود');

// نمایندگان پیشرفته: آمار فروش، فیلتر و تحلیل ۳۰ روزه
const agentsAdvanced = await miniApi('/api/miniapp/admin/agents?sort=sales', adminInit);
assert(agentsAdvanced.status === 200 && agentsAdvanced.json.totals && typeof agentsAdvanced.json.totals.sales === 'number' && typeof agentsAdvanced.json.totals.revenue === 'number' && agentsAdvanced.json.items.every((a, i, arr) => i === 0 || arr[i - 1].sales_total >= a.sales_total), 'فهرست نمایندگان جمع کل فروش/درآمد و مرتب‌سازی فروش را دارد');
const agentsLowBalance = await miniApi('/api/miniapp/admin/agents?status=low_balance', adminInit);
const agentsLowQuotaGone = await miniApi('/api/miniapp/admin/agents?status=low_quota', adminInit);
assert(agentsLowBalance.status === 200 && agentsLowBalance.json.items.every((a) => a.balance <= 0) && agentsLowBalance.json.totals.low_balance === agentsLowBalance.json.items.length && agentsLowQuotaGone.status === 200 && agentsLowQuotaGone.json.items.length === agentsLowQuotaGone.json.totals.agents && agentsLowQuotaGone.json.items.every((a) => a.quota_remaining === undefined), 'فیلتر «موجودی خالی» دقیق است و فیلتر سهمیه با داده‌های سهمیه حذف شده‌اند');
const agentDetailAdvanced = await miniApi('/api/miniapp/admin/agents/778811', adminInit);
assert(agentDetailAdvanced.status === 200 && agentDetailAdvanced.json.analytics && Array.isArray(agentDetailAdvanced.json.analytics.chart) && agentDetailAdvanced.json.analytics.chart.length === 30 && Array.isArray(agentDetailAdvanced.json.analytics.top_plans) && typeof agentDetailAdvanced.json.analytics.revenue === 'number' && typeof agentDetailAdvanced.json.analytics.sales_total === 'number' && String(agentDetailAdvanced.json.agent.tg_id) === '778811', 'پروندهٔ نماینده نمودار ۳۰ روزه، پرفروش‌ترین پلن‌ها و آمار مالی دارد');

// ---------- پنل چت: نگهداری پنل ----------
await sendText(ADMIN, '/admin');
await press(ADMIN, 'a_set');
const settingsKb = lookupButtons(lastMsgTo(ADMIN, 'editMessageText')).map((b) => b.callback_data);
await press(ADMIN, 's_retn');
const retentionChat = lastMsgTo(ADMIN, 'editMessageText');
const retentionChatButtons = lookupButtons(retentionChat).map((b) => b.callback_data);
assert(settingsKb.includes('s_retn') && String(retentionChat.params.text).includes('نگهداری و پاک‌سازی پنل') && retentionChatButtons.includes('s_retn_preview') && retentionChatButtons.includes('s_retn_run') && retentionChatButtons.includes('s_retn_g:3'), 'تنظیمات چت مسیر «نگهداری پنل» با پیش‌نمایش، اجرا و انتخاب مهلت دارد');
await press(ADMIN, 's_retn_g:5');
const cfgAfterGrace = await kvJson('cfg');
await press(ADMIN, 's_retn_paid');
const cfgAfterPaidOff = await kvJson('cfg');
await press(ADMIN, 's_retn_paid');
const cfgAfterPaidOn = await kvJson('cfg');
await press(ADMIN, 's_retn_g:3');
const cfgFinalGrace = await kvJson('cfg');
assert(cfgAfterGrace.retention_paid_grace_days === 5 && cfgAfterPaidOff.retention_paid_delete === false && cfgAfterPaidOn.retention_paid_delete === true && cfgFinalGrace.retention_paid_grace_days === 3, 'تغییر مهلت و روشن/خاموش‌کردن حذف پولی از داخل چت ذخیره می‌شود');

// ---------- رابط مینی‌اپ: داشبورد، مدیرت کاربران و نمایندگان ----------
assert(miniAppSource.includes('id="retentionFacts"') && miniAppSource.includes('id="retentionPreviewBtn"') && miniAppSource.includes('id="retentionRunBtn"') && miniAppSource.includes('id="agentsSummaryGrid"') && miniAppSource.includes('function renderRetentionPanel') && miniAppSource.includes('function renderAgentsSummary'), 'داشبورد مینی‌اپ کارت نگهداری با پیش‌نمایش/اجرا و خلاصهٔ نمایندگان دارد');
assert(miniAppSource.includes('id="customerStatusChips"') && ['all','active','expiring','expired','banned','agent'].every(x => miniAppSource.includes('data-customer-status="' + x + '"')) && miniAppSource.includes('id="customerSort"') && miniAppSource.includes('id="customerPrevBtn"') && miniAppSource.includes('id="customerNextBtn"') && miniAppSource.includes('id="customerPageInfo"'), 'فهرست کاربران مینی‌اپ فیلتر وضعیت، مرتب‌سازی و صفحه‌بندی دارد');
assert(miniAppSource.includes('id="agentStatusFilter"') && miniAppSource.includes('id="agentSortFilter"') && miniAppSource.includes('id="agentAdminStats"') && miniAppSource.includes('class="analytics-chart"') && miniAppSource.includes('top_plans'), 'بخش نمایندگان مینی‌اپ آمار، فیلتر، مرتب‌سازی و تحلیل ۳۰ روزه دارد');
assert(miniAppSource.includes('data-stab="retention"') && miniAppSource.includes('data-sgroup="retention"') && miniAppSource.includes('id="settingRetentionEnabled"') && miniAppSource.includes('id="settingRetentionGrace"') && miniAppSource.includes('retention_paid_grace_days') && miniAppSource.includes("const formGroups=['shop','pay','free','retention']"), 'تنظیمات مینی‌اپ گروه «نگهداری» را با کلیدها و مهلت ذخیره می‌کند');
assert(miniAppSource.includes('data-customer-action="notify"') && miniAppSource.includes('promote_agent') && miniAppSource.includes('demote_agent') && miniAppSource.includes("toastMap[ctx.action]"), 'مدیر از پروندهٔ کاربر می‌تواند پیام بفرستد و نقش نمایندگی را تغییر دهد');

// ---------- هیچ دکمهٔ شیشه‌ای در چت مشتری ----------
const adminChatIds = new Set(['999', '777003']); // 777003 فقط در تست «مدیران» موقتاً ادمین می‌شود
const customerInline = TG.filter((x) => ['sendMessage', 'editMessageText', 'editMessageCaption', 'sendPhoto'].includes(x.method)
  && !adminChatIds.has(String(x.params.chat_id))
  && x.params.reply_markup && Array.isArray(x.params.reply_markup.inline_keyboard) && x.params.reply_markup.inline_keyboard.length);
assert(customerInline.length === 0, 'هیچ پیامی به مشتری دکمهٔ شیشه‌ای (inline) ندارد؛ ناوبری فقط با کیبورد پایین چت و مینی‌اپ است');

console.log('— تمام —');
if (process.exitCode) console.error('❌ بعضی تست‌ها شکست خوردند');
else console.log('🎉 همه تست‌ها پاس شدند');
