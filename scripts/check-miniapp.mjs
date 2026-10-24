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

const legacy = /\.(customer-quick|customer-hero|customer-kpi|store-plan|plan-card|plan-spec|plan-buy|plan-summary|plan-billing-chip|customer-sub-card|customer-transaction)\b/.test(html);
if (legacy) {
  console.error('❌ قانون CSS قدیمیِ نمای مشتری در miniapp.html باقی مانده است.');
  process.exit(1);
}

console.log('✅ miniapp.html: اسکریپت درون‌خطی سالم است و لایهٔ قدیمی نمای مشتری باقی نمانده.');
