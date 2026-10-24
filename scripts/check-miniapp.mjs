#!/usr/bin/env node
/**
 * بررسی سلامت مینی‌اپ: سینتکس جاوااسکریپت درون miniapp.html و
 * نبودِ قانون تکراری/قدیمی برای نمای مشتری.
 * بدون اجرای کد؛ فقط کامپایل می‌شود تا خطای سینتکس در CI گرفته شود.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'public', 'miniapp.html');
const html = fs.readFileSync(file, 'utf8');

const closeStyle = html.indexOf('</style>');
if (closeStyle < 0) throw new Error('miniapp.html: تگ </style> پیدا نشد');
const openScript = html.indexOf('<script>', closeStyle);
const closeScript = html.indexOf('</script>', openScript);
if (openScript < 0 || closeScript < 0) throw new Error('miniapp.html: بلوک اسکریپت درون‌خطی پیدا نشد');

const source = html.slice(openScript + '<script>'.length, closeScript);
try {
  new vm.Script(source, { filename: 'miniapp-inline.js' });
} catch (error) {
  console.error('❌ خطای سینتکس در اسکریپت درون‌خطی miniapp.html:');
  console.error(error.message);
  process.exit(1);
}

// ---------------------------------------------------------------- CSS lint
// نمای کلی مدیر و نمای مشتری باید «تک‌خطی» بمانند. jsdom در CI نصب نیست، پس
// این‌جا خودِ CSS را تجزیه می‌کنیم: هر قاعده‌ای که متنِ این دو نما را به شکستن
// خط وادار کند (white-space:normal، overflow-wrap:anywhere، word-break) رد می‌شود.
const openStyle = html.indexOf('<style>');
const css = html.slice(openStyle + '<style>'.length, closeStyle);

function cssRules(source) {
  const out = [];
  let i = 0;
  const readBlock = (start, context) => {
    let depth = 1, j = start;
    while (j < source.length && depth > 0) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}') depth--;
      j++;
    }
    const body = source.slice(start, j - 1);
    if (/^\s*@(media|supports|layer)/.test(context)) {
      const nested = [];
      let k = 0;
      while (k < body.length) {
        const brace = body.indexOf('{', k);
        if (brace < 0) break;
        const selector = body.slice(k, brace).trim();
        if (!selector) break;
        let d = 1, m = brace + 1;
        while (m < body.length && d > 0) {
          if (body[m] === '{') d++;
          else if (body[m] === '}') d--;
          m++;
        }
        nested.push({ selector, decls: body.slice(brace + 1, m - 1), media: context });
        k = m;
      }
      out.push(...nested);
    } else if (!/^\s*@/.test(context)) {
      out.push({ selector: context.trim(), decls: body, media: '' });
    }
    return j;
  };
  while (i < source.length) {
    const brace = source.indexOf('{', i);
    if (brace < 0) break;
    const selector = source.slice(i, brace).trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!selector) { i = brace + 1; continue; }
    i = readBlock(brace + 1, selector);
  }
  return out;
}

const parsed = cssRules(css);
const problems = [];
const SCOPE = /(#overviewPage|#storePage|\.cv-|\.stat-|\.table-wrap|\.panel-head|\.section-title|\.mini-note|\.type-pill|\.status\b|\.outline-btn|\.table-action|\.btn-primary|\.btn-secondary)/;
for (const rule of parsed) {
  if (!SCOPE.test(rule.selector)) continue;
  if (/white-space\s*:\s*normal/.test(rule.decls)) problems.push(`white-space:normal → ${rule.selector}`);
  if (/(overflow-wrap\s*:\s*(anywhere|break-word)|word-break\s*:\s*(break-all|break-word))/.test(rule.decls)) problems.push(`شکستن کلمه → ${rule.selector}`);
}
// جدول‌های موبایل هم باید سلول را یک‌خطی نگه دارند
const cellRule = parsed.find((r) => /\.table-wrap \.cell\b/.test(r.selector));
if (!cellRule || !/text-overflow\s*:\s*ellipsis/.test(cellRule.decls)) problems.push('قاعدهٔ .table-wrap .cell با ellipsis پیدا نشد');
if (!/#overviewPage,\s*#overviewPage \*,\s*#storePage,\s*#storePage \*\s*\{\s*white-space\s*:\s*nowrap/.test(css)) {
  problems.push('قاعدهٔ پایهٔ تک‌خطی (#overviewPage/#storePage) پیدا نشد');
}
if (problems.length) {
  console.error('❌ متنِ نمای کلی/مشتری یا جداول دوباره شکسته می‌شود:');
  for (const p of problems) console.error('   • ' + p);
  process.exit(1);
}

const legacy = /\.(customer-quick|customer-hero|customer-kpi|store-plan|plan-card|plan-spec|plan-buy|plan-summary|plan-billing-chip|customer-sub-card|customer-transaction)\b/.test(html);
if (legacy) {
  console.error('❌ قانون CSS قدیمیِ نمای مشتری در miniapp.html باقی مانده است.');
  process.exit(1);
}

console.log('✅ miniapp.html: اسکریپت سالم، بدون لایهٔ قدیمی مشتری و بدون شکستن خط در نمای کلی.');
