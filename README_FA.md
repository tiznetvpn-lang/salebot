# تیزنت VPN | فروشگاه و ربات تلگرام — نسخهٔ self-hosted برای Ubuntu 26

این بسته نسخهٔ 1.8.0 پروژهٔ TiznetVPN را از محیط **Cloudflare Workers/KV** به یک سرور مستقل منتقل می‌کند. منطق ربات، APIها و Mini App حفظ شده‌اند؛ میزبان اجرا، ذخیره‌سازی، فایل‌های استاتیک و زمان‌بندی روی Ubuntu بازسازی شده‌اند. نسخهٔ بستهٔ حاضر: `1.8.0-ubuntu26.2`.

> **مهم:** این پروژه خودِ Hiddify Manager را نصب نمی‌کند. برای ساخت/تمدید سرویس، یک پنل Hiddify Manager v14 با API v2 و دسترسی شبکه از این سرور لازم است. راه‌اندازی این بسته هیچ تغییری در Cloudflare ایجاد نمی‌کند؛ فقط وقتی وبهوک را جابه‌جا کنید، ربات از میزبان قبلی به سرور Ubuntu منتقل می‌شود.

## معماری جدید

| جزء | اجرا در نسخهٔ Ubuntu |
|---|---|
| برنامهٔ ربات و API | Node.js 24 LTS، از طریق HTTP داخلی روی `127.0.0.1:3000` |
| ذخیره‌سازی سازگار با KV | SQLite در `/var/lib/tiznetvpn/tiznetvpn.sqlite3`، با WAL و ماندگاری پس از reboot |
| Mini App و دارایی‌ها | پوشهٔ محلی `public/` |
| HTTPS و Reverse Proxy | Nginx + گواهی Certbot/Let's Encrypt |
| یادآوری انقضا | systemd timer هر روز ساعت 05:30 UTC |
| بکاپ KV به تلگرام | systemd timer هر ۱۲ ساعت، در 00:00 و 12:00 UTC |
| بکاپ محلی دیتابیس | SQLite snapshot روزانه با نگهداری پیش‌فرض ۱۴ روز |

آداپتور SQLite همان متدهای مورد نیاز کد Worker (`get`، `put`، `delete` و `list`) را فراهم می‌کند؛ بنابراین کد منطق فروش مجبور به بازنویسی یا استفاده از Cloudflare نیست. هیچ وابستگی npm زمان اجرا نصب نمی‌شود؛ SQLite از `node:sqlite` خود Node.js استفاده می‌کند.

## امکانات برنامه

- خرید اشتراک با انتخاب پلن و سرور Hiddify؛ تمدید و ارتقا از Mini App.
- پرداخت کیف پول، کارت‌به‌کارت دستی با رسید و تأیید ادمین، و اتصال اختیاری به Shetab Verification.
- مدیریت مشتری، سفارش، پلن، پنل، کیف پول، کمیسیون، اشتراک رایگان و سوابق مالی.
- نمایندگی Mini App: ارتقای مشتری یا دعوت با لینک یک‌بارمصرف؛ قیمت خرید داخلی اختصاصی هر پلن، کیف پول مستقل و سهمیهٔ کل ساخت.
- ساخت اشتراک توسط نماینده برای مشتری بدون حساب تلگرام؛ نام/برچسب مشتری وارد می‌شود و لینک اشتراک برای تحویل دستی به نماینده نمایش داده می‌شود. قیمت فروش مجدد در این نسخه تعیین یا محاسبه نمی‌شود.
- Mini App مدیر و مشتری با اعتبارسنجی server-side امضای `initData` تلگرام.
- QR و لینک اشتراک، تاریخچه، گزارش‌های مدیریتی، بکاپ و ریستور KV.
- پنل چندسرورهٔ Hiddify Manager v14 (API v2).

## راه‌اندازی نمایندگی در Mini App

1. مدیر ربات را از داخل Telegram باز کند و در Mini App به بخش **نماینده‌ها** برود.
2. مشتریِ موجود را با Telegram ID ارتقا دهد، یا لینک دعوت یک‌بارمصرف را برای نمایندهٔ جدید بسازد.
3. پروندهٔ نماینده را باز کند؛ برای هر پلن قیمت خرید داخلی را به تومان وارد کند، کیف پول مستقل را شارژ کند و سهمیهٔ باقی‌ماندهٔ ساخت را تنظیم کند. نمایندهٔ تازه با کیف پول و سهمیهٔ صفر شروع می‌کند.
4. نماینده از حساب Telegram خود Mini App را باز می‌کند، نام/برچسب مشتری و پلن را انتخاب و اشتراک می‌سازد.
5. پس از ساخت موفق، Worker هزینه را از کیف پول و یک واحد را از سهمیه کم می‌کند؛ لینک اشتراک در پنل نماینده برای تحویل دستی نمایش داده می‌شود. مشتری نهایی نیازی به Telegram ندارد.

قیمت تعریف‌شده، بهای خرید داخلی نماینده است. قیمت فروش مجدد یا سود نماینده در این نسخه وارد یا محاسبه نمی‌شود.

## پیش‌نیازها

- سرور Ubuntu 26.x، معماری 64 بیتی؛ دسترسی root یا sudo.
- دامنه و رکورد DNS که به سرور اشاره کند؛ برای Mini App و Webhook، HTTPS الزامی است.
- Node.js نسخهٔ **24.15 یا بالاتر** (توصیه: جدیدترین نسخهٔ وصله‌شدهٔ شاخهٔ 24 LTS).
- ربات تلگرام و توکن BotFather؛ شناسهٔ عددی یک یا چند ادمین.
- پنل Hiddify Manager v14 با API v2، آدرس API و کلید Agent/Admin.

## نصب کامل

مراحل شماره‌دار، فرمان‌های Ubuntu، Nginx/HTTPS و systemd در **[INSTALL_FA.md](INSTALL_FA.md)** است. راهنمای بارگذاری در GitHub در **[GITHUB_FA.md](GITHUB_FA.md)**، مهاجرت از Cloudflare در **[MIGRATION_FA.md](MIGRATION_FA.md)** و فهرست تغییرات در **[CHANGELOG_FA.md](CHANGELOG_FA.md)** آمده‌اند. خلاصهٔ کار:

1. DNS و فایروال را آماده کنید.
2. Node.js 24 LTS، Nginx، Certbot و UFW نصب کنید.
3. محتویات بسته را در `/opt/tiznetvpn` قرار دهید و فایل `/etc/tiznetvpn/tiznetvpn.env` را بسازید.
4. سرویس systemd را اجرا کنید؛ Nginx را به `127.0.0.1:3000` وصل و گواهی HTTPS بگیرید.
5. پس از تأیید سلامت HTTPS، وبهوک را با اسکریپت محافظت‌شده تنظیم کنید.
6. در Telegram با `/start` وارد Mini App شوید و پنل Hiddify، پلن‌ها و تنظیمات فروش را تکمیل کنید.

## راه‌اندازی توسعه‌ای / اجرای دستی

پس از نصب Node.js 24.15+، در ریشهٔ پروژه:

```bash
cp .env.example .env
# .env را با مقادیر خودتان ویرایش کنید.
npm run check
npm test
npm start
```

برای اجرای دستی، `DATA_DIR` را روی مسیری بنویسید که کاربر فعلی اجازهٔ نوشتن دارد. در تولید، اجرای مستقیم توصیه نمی‌شود؛ از unitهای systemd و دیتادایرکتوری `/var/lib/tiznetvpn` استفاده کنید.

پیش‌نمایش استاتیک (بدون تلگرام، API یا دیتابیس واقعی):

```bash
npm run preview
```

## به‌روزرسانی

```bash
sudo bash /opt/tiznetvpn/update.sh
```

گزینه‌ها: `--dry-run`، `--ref <branch|tag>`، `--yes`، `--rollback`. جزئیات در [INSTALL_FA.md](INSTALL_FA.md#بهروزرسانی-نسخهٔ-برنامه-یک-خط).

## فایل‌های مهم

- `src/worker.js` — منطق اصلی ربات، Telegram Webhook، API Mini App و زمان‌بندی.
- `server/server.mjs` — آداپتور HTTP برای Node.js و اتصال درخواست به برنامه.
- `server/sqlite-kv.mjs` — پیاده‌سازی KV روی SQLite با TTL، metadata و pagination.
- `server/assets.mjs` — ارائهٔ امن فایل‌های پوشهٔ `public/`.
- `server/runtime.mjs` — خواندن پیکربندی و ساخت محیط اجرا.
- `public/miniapp.html` و `public/assets/` — Mini App، لوگو و فونت‌ها.
- `install.sh` — نصب تعاملی یک‌دستوره از مخزن عمومی/خصوصی یا پوشهٔ محلی؛ دامنهٔ پیش‌فرض `bot.tiznet.site` است.
- `update.sh` — به‌روزرسانی یک‌خطی روی سرور با تست پیش از اعمال، بکاپ و بازگشت خودکار.
- `GITHUB_FA.md` — بارگذاری بسته در GitHub Desktop و نصب از مخزن خصوصی بدون قراردادن token در دستور.
- `scripts/setup-webhook.mjs` — انتقال وبهوک Telegram؛ اجرای آن نیازمند گزینهٔ تأیید صریح است.
- `scripts/run-cron.mjs` — اجرای یادآوری و بکاپ KV از systemd timer.
- `scripts/backup-sqlite.mjs` — ساخت snapshot محلی SQLite و پاک‌سازی فایل‌های قدیمی.
- `systemd/` و `nginx/` — فایل‌های نمونهٔ سرویس/تایمر و Reverse Proxy.
- `test/` — تست یکپارچهٔ خرید و تست SQLite.

## امنیت و نگهداری

- توکن ربات، `WEBHOOK_SECRET` و `SHETAB_API_SECRET` را فقط در فایل env روی سرور نگه دارید؛ داخل چت یا مخزن کد نفرستید.
- مسیر Node فقط روی `127.0.0.1` گوش می‌دهد. اتصال مستقیم اینترنت به پورت 3000 را باز نکنید؛ اینترنت فقط باید از Nginx/HTTPS وارد شود.
- مسیرهای قدیمی `/setup` و `/diag` (که secret را در query می‌گرفتند) از برنامه حذف شده‌اند و نمونهٔ Nginx هم آن‌ها را مسدود می‌کند. وبهوک فقط با `scripts/setup-webhook.mjs --confirm-switch` تنظیم می‌شود.
- بکاپ Telegram و snapshotهای SQLite **رمزگذاری‌شده نیستند** و ممکن است کلید API پنل یا دادهٔ کاربران را داشته باشند. دسترسی/نگهداری آن‌ها را محدود کنید و یک نسخهٔ خارج از سرور با رمزگذاری بسازید.
- دایرکتوری دیتابیس `/var/lib/tiznetvpn` و بکاپ `/var/backups/tiznetvpn` باید فقط در اختیار کاربر سرویس/ادمین باشد.
- این بسته namespace قدیمی Cloudflare را استفاده، ایجاد یا تغییر نمی‌دهد. دیتابیس SQLite تازه خالی است مگر آنکه بکاپ KV را از Mini App مدیر ریستور کنید. برای مهاجرت، **[MIGRATION_FA.md](MIGRATION_FA.md)** را بخوانید.

## آزمون و عیب‌یابی سریع

```bash
npm test
sudo systemctl status tiznetvpn
sudo journalctl -u tiznetvpn -n 100 --no-pager
sudo systemctl list-timers --all | grep tiznetvpn
curl -fsS https://bot.tiznet.site/healthz
```

- `502 Bad Gateway`: وضعیت `tiznetvpn.service` و پورت `127.0.0.1:3000` را بررسی کنید.
- `Mini App` بدون API: آن را از داخل تلگرام باز کنید؛ مرورگر عادی `initData` معتبر ندارد.
- Webhook ناموفق: DNS، HTTPS، `BOT_TOKEN`، `WEBHOOK_SECRET` و `PUBLIC_BASE_URL` را بررسی کنید؛ سپس فقط پس از اطمینان از مقصد، اسکریپت را با `--confirm-switch` اجرا کنید.
- خرید ساخته می‌شود ولی سرویس صادر نمی‌شود: آدرس API و UUID مدیر Hiddify را در تنظیمات Mini App بررسی کنید و دسترسی شبکهٔ سرور Ubuntu به Hiddify را تست کنید.

## مستندات مرجع

- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)
- [Node.js 24 LTS release](https://nodejs.org/en/blog/release/v24.22.1)
- [Telegram Bot API: setWebhook](https://core.telegram.org/bots/api#setwebhook)
- [Telegram Mini Apps](https://core.telegram.org/bots/webapps)
