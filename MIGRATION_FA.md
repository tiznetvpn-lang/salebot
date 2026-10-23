# مهاجرت از Cloudflare Workers/KV به Ubuntu/SQLite

این بسته هیچ درخواست یا تغییری به Cloudflare نمی‌فرستد. مقصد تازه از SQLite خالی شروع می‌کند، مگر آنکه دادهٔ KV را از بکاپ خودتان ریستور کنید.

## پیش از مهاجرت

1. از پنل Cloudflare حذف/ویرایش نکنید و Worker یا namespace قدیمی را نگه دارید.
2. با ربات فعلی، Mini App مدیر را باز کنید و از **تنظیمات → بکاپ دستی KV** یک فایل `tiznetvpn-kv-backup-....json.gz` بگیرید.
3. این فایل رمزگذاری نشده است و شامل رکوردهای KV می‌تواند شامل credentialهای API پنل باشد. آن را فقط در محل امن ذخیره و در انتقال به VPS از SCP/SSH استفاده کنید.
4. در بکاپ KV، secretهای محیط Cloudflare (مانند `BOT_TOKEN`، `WEBHOOK_SECRET` و `SHETAB_API_SECRET`) نیستند. آن‌ها را در فایل env جدید روی سرور تنظیم کنید؛ هیچ secret را در این راهنما یا چت ننویسید.
5. توکن BotFather را نگه دارید؛ برای همان توکن در آنِ واحد فقط یک webhook مقصد فعال است.

## ترتیب کم‌ریسک Cutover

### ۱. سرویس Ubuntu را بدون دست‌کاری Cloudflare آماده کنید

راهنمای `INSTALL_FA.md` را تا پایان گرفتن HTTPS و دریافت `200` از این دو درخواست اجرا کنید:

```bash
curl -fsS https://bot.tiznet.site/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://bot.tiznet.site/miniapp
```

در این مرحله هنوز اسکریپت انتقال webhook را اجرا نکنید. سرور جدید می‌تواند از اینترنت سرویس بگیرد، اما Telegram همچنان به webhook قبلی می‌فرستد.

### ۲. انتقال webhook به Ubuntu

وقتی سرویس، Nginx و HTTPS آماده‌اند، دستور زیر را اجرا کنید:

```bash
sudo -u tiznetvpn env ENV_FILE=/etc/tiznetvpn/tiznetvpn.env \
  /usr/bin/node /opt/tiznetvpn/scripts/setup-webhook.mjs --confirm-switch
```

این کار ربات را به `https://bot.tiznet.site/webhook` متصل می‌کند. اسکریپت قبل از تغییر `getMe` می‌زند و `drop_pending_updates=false` می‌فرستد؛ صف آپدیت‌های معلق تلگرام پاک نمی‌شود. پس از آن Cloudflare Worker دیگر آپدیت‌های webhook همین توکن را دریافت نمی‌کند.

### ۳. واردکردن دادهٔ KV

1. در Telegram به همان ربات پیام `/start` بدهید و Mini App مدیر را باز کنید.
2. اگر Menu Button هنوز لینک قبلی را نشان می‌دهد، از دکمهٔ «ورود به اپ» در پیام جدید `/start` استفاده کنید. نسخهٔ self-hosted هنگام `/start` Menu Button را با URL جدید تنظیم می‌کند.
3. در Mini App مدیر، **تنظیمات → ریستور کامل** را باز کنید.
4. فایل gzip بکاپ Cloudflare را انتخاب کنید، عبارت `RESTORE` را وارد و تأیید نهایی را انجام دهید.
5. پیش از جایگزینی، برنامه یک snapshot وضعیت فعلی SQLite را برای مدیران می‌فرستد. این هم بدون رمزگذاری است؛ آن را ایمن نگه دارید.
6. پس از ریستور، Mini App را دوباره باز/تازه کنید و مشتری، پلن، سفارش، تنظیمات، پنل و کیف پول را بررسی کنید.

ریستور کامل است: تمام محتویات KV جدید با داده‌های snapshot جایگزین می‌شود. کلیدهای lock موقت حذف/مستثنی می‌شوند و کلیدهای منقضی بازگردانده نمی‌شوند. روی یک دیتابیس مقصدی که بعد از cutover دادهٔ واقعی جدید گرفته است، بدون backup وضعیت فعلی ریستور نکنید.

## تفاوت‌هایی که باید بعد از مهاجرت کنترل کنید

- آدرس Mini App باید دامنهٔ HTTPS سرور جدید باشد. `MINIAPP_URL` و `PUBLIC_BASE_URL` را در `/etc/tiznetvpn/tiznetvpn.env` کنترل کنید.
- توکن BotFather باید همان توکن مورد نظر باشد؛ `WEBHOOK_SECRET` جدید هم از env Ubuntu خوانده می‌شود.
- مقادیر Hiddify/پلن‌ها/تنظیمات ذخیره‌شده در KV با snapshot منتقل می‌شوند. خود پنل Hiddify و دیتابیس آن روی سرور جداگانه تغییر نمی‌کند.
- secretهای محیطی Cloudflare منتقل نمی‌شوند. در صورت استفاده از پرداخت خودکار، `SHETAB_API_SECRET` را جداگانه روی Ubuntu قرار دهید و با اپ پرداختی که callback را به دامنهٔ جدید می‌فرستد، تطبیق دهید.
- فایل‌های رسانه‌ای Telegram در بکاپ نیستند؛ معمولاً IDهای رسید در KV باقی می‌مانند، اما Telegram همچنان مالک فایل است.
- backup فقط namespace/داده‌ای است که از binding قدیمی برنامه گرفته شده؛ ID namespace Cloudflare یا فایل‌های Cloudflare در پروژهٔ Ubuntu استفاده نمی‌شوند.

## بررسی و دورهٔ اطمینان

- چند روز سرور قبلی و backup اصلی را پاک نکنید.
- یک خرید/تمدید کم‌ریسک و یک تراکنش دستی را با مدیر بررسی کنید. از callback پرداخت زنده به‌عنوان تست استفاده نکنید.
- `sudo systemctl status tiznetvpn.service`، `sudo journalctl -u tiznetvpn.service` و timerها را کنترل کنید.
- قبل از تغییر بعدی، یک بکاپ Telegram و `sudo systemctl start tiznetvpn-dbbackup.service` اجرا کنید.

## بازگشت

اگر لازم شد برگردید، webhook را به URL قبلی برگردانید و قبل از آن مطمئن شوید Cloudflare Worker و KV قبلی هنوز سالم و در دسترس‌اند. بازگرداندن webhook، داده‌های SQLite که پس از cutover ساخته شده‌اند را به Cloudflare منتقل نمی‌کند؛ برای همگام‌سازی معکوس، بکاپ KV تازه بگیرید و آن را فقط پس از ارزیابی ریسک ریستور کنید. اجرای `/setup` نسخهٔ قدیمی ممکن است `drop_pending_updates` داشته باشد؛ صف Telegram را بدون بررسی پاک نکنید.
