# تیزنت VPN — فروشگاه و ربات تلگرام (Self-hosted)

ربات فروش اشتراک VPN با Mini App تلگرام، سازگار با **Hiddify Manager v14 (API v2)**.
اجرا روی سرور مستقل: **Node.js 24 + SQLite** (بدون هیچ وابستگی npm)، پشت **Nginx + Let's Encrypt**.

- خرید، تمدید و ارتقای اشتراک
- کیف پول، کارت‌به‌کارت با رسید، و اتصال اختیاری به Shetab Verification
- پنل نمایندگی (قیمت خرید اختصاصی، کیف پول و سهمیهٔ مستقل)
- گزارش‌های مدیریتی، بکاپ KV و snapshot روزانهٔ SQLite
- احراز هویت server-side با امضای `initData` تلگرام

## نصب

```bash
# از مخزن عمومی
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh)" -- --repo OWNER/REPO --domain bot.example.com
```

یا از بستهٔ ZIP استخراج‌شده:

```bash
sudo bash /tmp/tiznetvpn/install.sh --source-dir /tmp/tiznetvpn --domain bot.example.com
```

برای مخزن **خصوصی** از `--token-file` استفاده کنید (توکن فقط در فایل root خوانده می‌شود، در دستور و هیستوری نوشته نمی‌شود):

```bash
printf 'GITHUB_TOKEN=%s\n' 'ghp_xxx' | sudo tee /root/.github-read >/dev/null && sudo chmod 600 /root/.github-read
sudo bash install.sh --repo OWNER/REPO --token-file /root/.github-read --domain bot.example.com
```

راهنمای کامل قدم‌به‌قدم: **[INSTALL_FA.md](INSTALL_FA.md)**

## به‌روزرسانی با یک خط

```bash
sudo bash /opt/tiznetvpn/update.sh
```

این یک دستور: نسخهٔ جدید را از GitHub می‌گیرد، تست‌ها را **قبل از** تغییر سرور اجرا می‌کند، از دیتابیس و کد فعلی بکاپ می‌گیرد، فایل‌ها را در همان `/opt/tiznetvpn` جایگزین می‌کند، سرویس را ری‌استارت و سلامت را بررسی می‌کند، و در صورت هر خطایی **خودکار به نسخهٔ قبلی برمی‌گردد**.

| کار | دستور |
|---|---|
| به‌روزرسانی به آخرین `main` | `sudo bash /opt/tiznetvpn/update.sh` |
| شاخه/تگ مشخص | `sudo bash /opt/tiznetvpn/update.sh --ref v1.8.1` |
| فقط بررسی و تست، بدون تغییر | `sudo bash /opt/tiznetvpn/update.sh --dry-run` |
| بازگشت به آخرین بکاپ کد | `sudo bash /opt/tiznetvpn/update.sh --rollback` |

اگر مخزن خصوصی است، بار اول توکن را مخفی می‌پرسد و در `/etc/tiznetvpn/update.env` (مجوز `0600`) ذخیره می‌کند؛ از آن به بعد همان یک خط کافی است.

## بازیابی وقتی ربات یا Mini App از کار افتاده

```bash
sudo bash recover.sh --diagnose      # فقط گزارش وضعیت (بی‌خطر، هیچ تغییری نمی‌دهد)
sudo bash recover.sh                 # بازیابی/نصب تمیز با حفظ env و دیتابیس
```

`recover.sh` کد را از نو نصب می‌کند اما `/etc/tiznetvpn/tiznetvpn.env` (توکن ربات) و `/var/lib/tiznetvpn` (مشتری، سفارش، کیف پول) را دست نمی‌زند؛ قبل از هر تغییری بکاپ کامل در `/var/backups/tiznetvpn` می‌سازد، تست‌ها را روی بستهٔ جدید اجرا می‌کند، Nginx را با دامنهٔ درست بازمی‌سازد و در پایان سلامت سایت و وبهوک را گزارش می‌دهد.

| گزینه | کار |
|---|---|
| `--diagnose` | فقط تشخیص (safe) |
| `--dry-run` | دانلود و تست بسته، بدون تغییر |
| `--restore-db` | اگر دیتابیس اصلی نیست، آخرین snapshot را بازگردان |
| `--set-webhook` | وبهوک تلگرام را روی همین دامنه تنظیم کن |
| `--domain x.com` | اگر دامنه خودکار تشخیص داده نشد |
| `--skip-cert` | گواهی TLS را دست نزن |

## مستندات

| فایل | موضوع |
|---|---|
| [INSTALL_FA.md](INSTALL_FA.md) | نصب گام‌به‌گام، Nginx، HTTPS، systemd، به‌روزرسانی |
| [MIGRATION_FA.md](MIGRATION_FA.md) | مهاجرت از Cloudflare Workers/KV |
| [GITHUB_FA.md](GITHUB_FA.md) | انتشار در GitHub و نصب از مخزن خصوصی |
| [CHANGELOG_FA.md](CHANGELOG_FA.md) | تغییرات نسخه‌ها |
| [docs/APP_INTEGRATION_FA.md](docs/APP_INTEGRATION_FA.md) | قرارداد اتصال اپ اندروید «تیزنت — حساب‌دار من» و کارهای باقی‌مانده |
| [README_FA.md](README_FA.md) | توضیح کامل معماری و قابلیت‌ها |

## توسعه و تست

```bash
cp .env.example .env      # مقادیر را پر کنید
npm run check             # بررسی سینتکس
npm test                  # تست یکپارچه + تست SQLite
npm start                 # اجرای دستی روی 127.0.0.1:3000
npm run preview           # پیش‌نمایش استاتیک Mini App
```

نیازمندی: **Node.js 24.15+** (ماژول داخلی `node:sqlite`).

## امنیت

- `.env` و توکن/secret هرگز در مخزن نیستند؛ `.gitignore` مسیرهای حساس را می‌پوشاند.
- Node فقط روی `127.0.0.1` گوش می‌دهد؛ تنها ورودی اینترنت Nginx/HTTPS است.
- مسیرهای قدیمی `/setup` و `/diag` (که secret را در query می‌گرفتند) از برنامه حذف شده‌اند؛ تغییر وبهوک فقط با `scripts/setup-webhook.mjs --confirm-switch` انجام می‌شود.
- بکاپ‌ها رمزگذاری نمی‌شوند؛ نسخهٔ خارج از سرور را با رمزگذاری نگه دارید.

## مجوز

این پروژه نرم‌افزار اختصاصی است؛ شرایط در [LICENSE](LICENSE) آمده است. اجزای شخص ثالث (فونت‌ها و تولیدکنندهٔ QR) مجوز خودشان را در `public/assets/*-OFL.txt` و `src/vendor/QRCODE-MIT.txt` دارند.
