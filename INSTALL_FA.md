# راهنمای نصب قدم‌به‌قدم روی Ubuntu 26

این راهنما برای یک VPS تازهٔ Ubuntu 26.x است و از دامنهٔ درخواستی `bot.tiznet.site` استفاده می‌کند. پیش از نصب، رکورد DNS این دامنه باید به سرور شما اشاره کند. توکن ربات یا کلید پنل را در چت نفرستید.

## نصب خودکار با یک دستور (پس از انتشار مخزن عمومی GitHub)

وقتی پروژه در یک مخزن عمومی GitHub قرار گرفت، روی SSH سرور این یک خط را اجرا کنید؛ `OWNER/REPO` را با آدرس واقعی مخزن عوض کنید:

```bash
curl -fsSLo /tmp/tiznetvpn-install.sh https://raw.githubusercontent.com/OWNER/REPO/main/install.sh && sudo bash /tmp/tiznetvpn-install.sh --repo OWNER/REPO --domain bot.tiznet.site
```

نصب‌کننده Node.js، Nginx، Certbot، systemd، SQLite، TLS و تایمرهای بکاپ را تنظیم می‌کند؛ دامنه از قبل `bot.tiznet.site` است. در ترمینال فقط ایمیل، توکن BotFather (ورودی مخفی) و شناسهٔ عددی ادمین را می‌پرسد. اگر نصب برای رباتی است که قبلاً روی Cloudflare کار می‌کند، ابتدا بکاپ KV بگیرید؛ در پایان هم برای جابه‌جایی وبهوک باید عبارت دقیق `SWITCH` را تأیید کنید. تا آن زمان وبهوک قدیمی دست‌نخورده می‌ماند.

> مخزن باید عمومی باشد تا clone بدون رمز انجام شود. هیچ‌وقت GitHub password یا Personal Access Token را در دستور نصب یا چت قرار ندهید. قبل از اجرا، می‌توانید `install.sh` را از مخزن بازبینی کنید.
>
> اگر مخزن را **خصوصی** نگه می‌دارید، لینک `raw.githubusercontent.com` بدون احراز هویت کار نمی‌کند. ZIP را پس از ورود به GitHub دانلود و با SCP/WinSCP به سرور منتقل کنید؛ اگر آن را در `/tmp/tiznetvpn` استخراج کردید، نصب را با یک دستور اجرا کنید:
>
> ```bash
> sudo bash /tmp/tiznetvpn/install.sh --source-dir /tmp/tiznetvpn --domain bot.tiznet.site
> ```

## مرحلهٔ ۱ — آماده‌کردن سرور و DNS

1. رکورد `A` دامنه را به IPv4 سرور و در صورت استفاده، رکورد `AAAA` را به IPv6 درست سرور وصل کنید. اگر IPv6 ندارید، `AAAA` اشتباه را حذف کنید.
2. در فایروال ارائه‌دهنده، ورودی پورت‌های `22`، `80` و `443` را مجاز کنید. پورت برنامه (`3000`) نباید از اینترنت باز باشد.
3. با SSH وارد شوید. اگر پورت SSH شما غیر از 22 است، قبل از فعال‌کردن UFW آن پورت را هم مجاز کنید:

```bash
ssh ubuntu@SERVER_IP
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx ufw unzip openssl
```

UFW را طوری فعال کنید که SSH قطع نشود:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw status verbose
sudo ufw --force enable
sudo ufw status verbose
```

## مرحلهٔ ۲ — نصب Node.js 24 LTS و بررسی SQLite

نسخهٔ پروژه از ماژول داخلی `node:sqlite` استفاده می‌کند. Node.js باید حداقل 24.15 باشد. اگر مخزن Ubuntu شما همین نسخه یا جدیدتر دارد، می‌توانید از آن استفاده کنید؛ در غیر این صورت NodeSource شاخهٔ 24.x را اضافه کنید:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
sudo chmod a+r /etc/apt/keyrings/nodesource.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
  | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt update
sudo apt install -y nodejs
```

نسخه و ماژول SQLite را بررسی کنید؛ ادامه ندهید اگر نسخه کمتر از 24.15 است یا دستور دوم خطا می‌دهد:

```bash
node --version
npm --version
node -e "const s=require('node:sqlite'); if(!(s.DatabaseSync||s.Database)) process.exit(1); console.log('node:sqlite OK')"
```

## مرحلهٔ ۳ — انتقال بسته به سرور

فایل `tiznetvpn-ubuntu26.zip` را از رایانهٔ خود به سرور بفرستید. مثال:

```bash
# این دستور روی رایانهٔ خودتان اجرا می‌شود، نه در SSH:
scp tiznetvpn-ubuntu26.zip ubuntu@SERVER_IP:/tmp/
```

روی سرور، کاربر سرویس و مسیرها را بسازید و پروژه را استخراج کنید:

```bash
sudo useradd --system --home-dir /opt/tiznetvpn --no-create-home \
  --shell /usr/sbin/nologin tiznetvpn
sudo mkdir -p /opt/tiznetvpn /etc/tiznetvpn /var/lib/tiznetvpn /var/backups/tiznetvpn
sudo unzip -oq /tmp/tiznetvpn-ubuntu26.zip -d /opt/tiznetvpn/
```

بسته در مسیر `/opt/tiznetvpn` استخراج می‌شود. مجوزها را محدود کنید:

```bash
sudo chown -R root:tiznetvpn /opt/tiznetvpn
sudo find /opt/tiznetvpn -type d -exec chmod 0750 {} \;
sudo find /opt/tiznetvpn -type f -exec chmod 0640 {} \;
sudo chown tiznetvpn:tiznetvpn /var/lib/tiznetvpn /var/backups/tiznetvpn
sudo chmod 0750 /var/lib/tiznetvpn /var/backups/tiznetvpn
```

در صورت وجود کاربر `tiznetvpn` از نصب قبلی، دستور `useradd` را دوباره اجرا نکنید؛ از همان حساب استفاده کنید.

## مرحلهٔ ۴ — پیکربندی امن ربات

فایل نمونه را به خارج از پوشهٔ کد، در `/etc` کپی کنید:

```bash
sudo install -o root -g tiznetvpn -m 0640 \
  /opt/tiznetvpn/.env.example /etc/tiznetvpn/tiznetvpn.env
sudo nano /etc/tiznetvpn/tiznetvpn.env
```

این موارد را ویرایش کنید:

- `BOT_TOKEN`: توکن BotFather.
- `WEBHOOK_SECRET`: رشتهٔ تصادفی بلند؛ برای ساخت آن در SSH اجرا کنید و خروجی را به فایل env منتقل کنید:

  ```bash
  openssl rand -hex 32
  ```

- `ADMIN_IDS`: شناسهٔ عددی تلگرام ادمین، مثلاً `123456789`؛ چند شناسه را با کاما جدا کنید.
- `PUBLIC_BASE_URL`: فقط مبدأ HTTPS، مثل `https://bot.tiznet.site`؛ مسیر یا اسلش پایانی لازم نیست.
- `MINIAPP_URL`: معمولاً `https://bot.tiznet.site/miniapp`.
- `DATA_DIR=/var/lib/tiznetvpn` و `PORT=3000` را مطابق نمونه نگه دارید.
- `SHETAB_API_SECRET` را خالی بگذارید، مگر آنکه پرداخت خودکار را عمداً فعال می‌کنید.
- `MINIAPP_ONLY_MODE=true` را برای منوی Mini App نگه دارید، مگر آنکه آگاهانه مسیر کلاسیک ربات را هم می‌خواهید.

نمونهٔ خلاصه (از مقادیر نمونهٔ زیر در سرور واقعی استفاده نکنید):

```dotenv
BOT_TOKEN=توکن_واقعی_از_BotFather
WEBHOOK_SECRET=خروجی_واقعی_openssl_rand_hex_32
ADMIN_IDS=شناسه_واقعی_ادمین
PUBLIC_BASE_URL=https://bot.tiznet.site
MINIAPP_URL=https://bot.tiznet.site/miniapp
HOST=127.0.0.1
PORT=3000
DATA_DIR=/var/lib/tiznetvpn
MAX_REQUEST_BYTES=57671680
MINIAPP_ONLY_MODE=true
SHETAB_API_SECRET=
DB_BACKUP_DIR=/var/backups/tiznetvpn
DB_BACKUP_RETENTION_DAYS=14
```

فایل حاوی Secret را فقط root و گروه سرویس بخوانند:

```bash
sudo chown root:tiznetvpn /etc/tiznetvpn/tiznetvpn.env
sudo chmod 0640 /etc/tiznetvpn/tiznetvpn.env
```

> توکن، secret وبهوک و secret درگاه را در `package.json`، فایل‌های `src/` یا URLهای عمومی نگذارید. مسیرهای قدیمی `/setup` و `/diag` از خود برنامه حذف شده‌اند و تغییر وبهوک فقط با اسکریپت CLI انجام می‌شود.

## مرحلهٔ ۵ — اجرای تست‌ها و نصب سرویس systemd

از ریشهٔ پروژه تست‌ها را اجرا کنید:

```bash
cd /opt/tiznetvpn
sudo -u tiznetvpn node --check server/server.mjs
sudo -u tiznetvpn node --check server/sqlite-kv.mjs
sudo -u tiznetvpn node --check src/worker.js
sudo -u tiznetvpn npm test
```

خروجی پایانی تست Worker باید «همه تست‌ها پاس شدند» و تست SQLite باید `SQLite KV ... tests passed` باشد.

کپی unitها و اجرای برنامه:

```bash
sudo cp /opt/tiznetvpn/systemd/*.service /etc/systemd/system/
sudo cp /opt/tiznetvpn/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tiznetvpn.service
sudo systemctl status tiznetvpn.service --no-pager
```

سرویس فقط روی `127.0.0.1:3000` گوش می‌دهد. سلامت داخلی را بررسی کنید:

```bash
curl -fsS http://127.0.0.1:3000/healthz
```

پاسخ باید `"ok":true` داشته باشد. خطاها:

```bash
sudo journalctl -u tiznetvpn.service -n 100 --no-pager
```

## مرحلهٔ ۶ — اتصال Nginx به برنامه

فایل نمونه را نصب کنید و دامنه را عوض کنید:

```bash
sudo cp /opt/tiznetvpn/nginx/tiznetvpn.conf /etc/nginx/sites-available/tiznetvpn
sudo nano /etc/nginx/sites-available/tiznetvpn
# جای‌نگهدار __DOMAIN__ هنگام نصب با دامنهٔ شما جایگزین شده است؛ برای اطمینان: grep server_name /etc/nginx/sites-available/tiznetvpn
sudo ln -s /etc/nginx/sites-available/tiznetvpn /etc/nginx/sites-enabled/tiznetvpn
# فقط اگر این VPS سایت دیگری ندارد، تنظیم پیش‌فرض Nginx را غیرفعال کنید:
# sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

تا وقتی DNS کامل منتشر نشده، Certbot را اجرا نکنید. ابتدا دامنه را بررسی کنید:

```bash
getent ahosts bot.tiznet.site
curl -I http://bot.tiznet.site/healthz
```

## مرحلهٔ ۷ — فعال‌کردن HTTPS

گواهی Let's Encrypt را بگیرید؛ ایمیل را با ایمیل واقعی خودتان جایگزین کنید:

```bash
sudo certbot --nginx --redirect \
  --agree-tos -m admin@example.com \
  -d bot.tiznet.site
sudo certbot renew --dry-run
```

سلامت HTTPS و پاسخ Mini App را بررسی کنید:

```bash
curl -fsS https://bot.tiznet.site/healthz
curl -sS -o /dev/null -w '%{http_code}\n' https://bot.tiznet.site/miniapp
```

هر دو باید `200` بدهند. اگر Certbot خطای اتصال می‌دهد، DNS عمومی، فایروال ارائه‌دهنده و پورت‌های 80/443 را بررسی کنید.

## مرحلهٔ ۸ — ثبت Webhook تلگرام (فقط هنگام آماده‌بودن)

این مرحله webhook ربات را روی دامنهٔ جدید تنظیم می‌کند. اگر همین ربات قبلاً روی Cloudflare یا سرور دیگری فعال است، اجرای این دستور، مقصد دریافت آپدیت‌ها را به Ubuntu منتقل می‌کند؛ در هر لحظه یک webhook فعال برای هر توکن وجود دارد.

**پیش از اجرا:** مطمئن شوید سرویس، HTTPS، `/healthz` و Mini App سالم هستند و در صورت مهاجرت، بکاپ Cloudflare را گرفته‌اید. سپس:

```bash
sudo -u tiznetvpn env ENV_FILE=/etc/tiznetvpn/tiznetvpn.env \
  /usr/bin/node /opt/tiznetvpn/scripts/setup-webhook.mjs --confirm-switch
```

پارامتر `--confirm-switch` عمدی است تا webhook تصادفی جابه‌جا نشود. اسکریپت ابتدا ربات را با Telegram بررسی می‌کند، سپس `setWebhook` را اجرا می‌کند و آپدیت‌های معلق را پاک نمی‌کند.

در تلگرام به ربات پیام `/start` بدهید و دکمهٔ «ورود به اپ» یا Menu Button «tiznet» را باز کنید. Mini App برای احراز هویت باید از داخل Telegram باز شود؛ بازکردن URL در مرورگر عادی، `initData` معتبر ندارد.

> مسیرهای HTTP `/setup` و `/diag` در این نسخه از خود برنامه حذف شده‌اند (نمونهٔ Nginx هم آن‌ها را 404 می‌کند). تنظیم وبهوک فقط از اسکریپت CLI انجام می‌شود.

## مرحلهٔ ۹ — نصب و تنظیم پنل Hiddify

با اکانتی که در `ADMIN_IDS` ثبت شده:

1. در ربات `/start` بزنید و وارد Mini App شوید.
2. بخش **سرورها و پنل‌ها** را باز و یک پنل Hiddify اضافه کنید.
3. آدرس API نسخهٔ ۲ را وارد کنید: دامنهٔ پنل با `https://` و مسیر پروکسی لازم؛ `/admin` و UUID را به انتهای URL اضافه نکنید.
4. برای ربات در Hiddify یک Admin/Agent جدا بسازید و UUID همان اکانت را به‌عنوان API key وارد کنید. از حساب Super Admin روزمره استفاده نکنید.
5. تست اتصال را بزنید. اگر ناموفق بود، از خود سرور Ubuntu دسترسی HTTPS به دامنهٔ Hiddify را بررسی کنید و مسیر پروکسی، TLS و نقش API key را کنترل کنید.
6. پلن‌ها، قیمت‌ها، کارت بانکی، پشتیبانی و سیاست اشتراک رایگان را تنظیم کنید. سیاست پیش‌فرض اشتراک رایگان خالی/غیرفعال است تا مدیر آن را آگاهانه انتخاب کند.

## مرحلهٔ ۱۰ — فعال‌کردن timerها و بکاپ محلی

پس از تنظیم Bot Token و ادمین‌ها، timerها را فعال کنید (تایمر بکاپ فقط با تأیید `SWITCH` در نصب فعال می‌شود؛ اگر رد کردید، این دستور را بزنید):

```bash
sudo systemctl enable --now \
  tiznetvpn-reminders.timer \
  tiznetvpn-backup.timer \
  tiznetvpn-dbbackup.timer
sudo systemctl list-timers --all | grep tiznetvpn
```

- `tiznetvpn-reminders.timer`: روزانه 05:30 UTC.
- `tiznetvpn-backup.timer`: هر ۳ ساعت (00:00، 03:00، …، 21:00 UTC — یعنی ۰۳:۳۰، ۰۶:۳۰، … به‌وقت تهران) بکاپ فشردهٔ KV را به چت مدیران می‌فرستد.
- `tiznetvpn-dbbackup.timer`: روزانه 02:15 UTC یک snapshot SQLite در `/var/backups/tiznetvpn` می‌سازد و فایل‌های بیش از ۱۴ روز را حذف می‌کند.

برای اجرای دستی فقط بکاپ محلی:

```bash
sudo systemctl start tiznetvpn-dbbackup.service
sudo ls -lh /var/backups/tiznetvpn
```

برای مشاهدهٔ لاگ timerها:

```bash
sudo journalctl -u tiznetvpn-reminders.service -n 50 --no-pager
sudo journalctl -u tiznetvpn-backup.service -n 50 --no-pager
sudo journalctl -u tiznetvpn-dbbackup.service -n 50 --no-pager
```

بکاپ‌های KV تلگرام و snapshotهای SQLite رمزگذاری نشده‌اند و می‌توانند کلید API پنل را دربر داشته باشند. یک نسخهٔ رمزگذاری‌شدهٔ جداگانه و خارج از VPS نگه دارید.

## به‌روزرسانی نسخهٔ برنامه (یک خط)

از نسخهٔ 1.8.1، به‌روزرسانی فقط یک دستور است و هیچ فایلی را دستی جابه‌جا نمی‌کنید:

```bash
sudo bash /opt/tiznetvpn/update.sh
```

اسکریپت به ترتیب این کارها را انجام می‌دهد و در هر خطا **خودکار به نسخهٔ قبلی برمی‌گردد**:

1. دریافت نسخهٔ `main` (یا `--ref` دلخواه) از GitHub؛
2. `node --check` و اجرای کامل تست‌ها **روی بستهٔ جدید، قبل از هر تغییری روی سرور**؛
3. snapshot دیتابیس و بکاپ کد فعلی در `/var/backups/tiznetvpn`؛
4. جایگزینی فایل‌ها در همان `/opt/tiznetvpn` (بدون دست‌زدن به `/var/lib/tiznetvpn` و `/etc/tiznetvpn/tiznetvpn.env`) و اصلاح مجوزها؛
5. به‌روزرسانی unitهای systemd فقط اگر تغییر کرده باشند، ری‌استارت و بررسی `/healthz`.

| کار | دستور |
|---|---|
| فقط بررسی و تست، بدون تغییر | `sudo bash /opt/tiznetvpn/update.sh --dry-run` |
| شاخه یا تگ مشخص | `sudo bash /opt/tiznetvpn/update.sh --ref v1.8.1` |
| بدون پرسش تأیید (cron/اسکریپت) | `sudo bash /opt/tiznetvpn/update.sh --yes` |
| بازگشت به آخرین بکاپ کد | `sudo bash /opt/tiznetvpn/update.sh --rollback` |

> مخزن خصوصی: بار اول اسکریپت توکن را با ورودی مخفی می‌پرسد و در `/etc/tiznetvpn/update.env` با مجوز `0600` ذخیره می‌کند؛ از آن به بعد همان یک خط کافی است. برای اجرای غیرتعاملی، همان فایل را از قبل بسازید.

اگر ترجیح می‌دهید کاملاً دستی عمل کنید: `sudo systemctl stop tiznetvpn.service`، `sudo systemctl start tiznetvpn-dbbackup.service`، جایگزینی محتویات `/opt/tiznetvpn`، اصلاح مجوزها (`root:tiznetvpn`، پوشه `0750`، فایل `0640`) و سپس `sudo systemctl start tiznetvpn.service`.

## بازیابی سریع وقتی ربات یا Mini App از کار افتاده

اول وضعیت را ببینید (هیچ تغییری نمی‌دهد):

```bash
sudo bash /opt/tiznetvpn/recover.sh --diagnose
```

سپس بازیابی/نصب تمیز با حفظ توکن ربات و دیتابیس:

```bash
sudo bash /opt/tiznetvpn/recover.sh --yes
```

اگر `recover.sh` را ندارید:

```bash
sudo curl -fsSL -o /opt/tiznetvpn/recover.sh https://raw.githubusercontent.com/tiznetvpn-lang/salebot/main/recover.sh
sudo chmod 0755 /opt/tiznetvpn/recover.sh
```

چه می‌کند: بکاپ کامل از کد/env/دیتابیس/Nginx/units → دانلود بسته از GitHub → `node --check` و اجرای تست‌ها → جایگزینی کد (env و دیتابیس بیرون از مسیر نصب‌اند و حفظ می‌شوند) → نصب و فعال‌سازی units → بازسازی کانفیگ Nginx با دامنهٔ درست → بررسی سلامت محلی و HTTPS → گزارش وضعیت ربات و وبهوک. با `--set-webhook` وبهوک هم تنظیم می‌شود.

> اگر `/etc/tiznetvpn/tiznetvpn.env` هم پاک شده باشد، `recover.sh` متوقف می‌شود (چون بدون توکن، ربات بازسازی نمی‌شود). در آن حالت `install.sh` را اجرا کنید و توکن BotFather را دوباره وارد کنید؛ توکن قبلی با ساخت ربات جدید از کار نمی‌افتد.

## اگر سایت بالا نیامد

```bash
# برنامه و دیتابیس
sudo systemctl status tiznetvpn.service --no-pager
sudo journalctl -u tiznetvpn.service -n 150 --no-pager
curl -i http://127.0.0.1:3000/healthz

# Nginx و گواهی
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo journalctl -u nginx -n 80 --no-pager
sudo certbot certificates

# timerها
sudo systemctl list-timers --all | grep tiznetvpn
```

- `Missing required setting`: فایل `/etc/tiznetvpn/tiznetvpn.env`، نام متغیرها و مجوز `0640 root:tiznetvpn` را بررسی کنید.
- `WEBHOOK_SECRET` نامعتبر: یک خروجی `openssl rand -hex 32` کامل، بدون کوتیشن اضافی یا فاصلهٔ ابتدا/انتها قرار دهید.
- خطای `node:sqlite`: نسخهٔ Node باید حداقل 24.15 باشد و در systemd مسیر Node با `/usr/bin/node` تطبیق کند.
- `502`: سرویس Node متوقف است یا پورت Nginx با `PORT` در systemd یکی نیست.
- `401` در Mini App: اپ را داخل Telegram باز کنید و `BOT_TOKEN` همان توکنی باشد که Mini App با آن باز شده است.

## بازگشت از تغییر وبهوک

تا پایان مهاجرت سرور Cloudflare/قدیمی را حذف نکنید. برای بازگشت، وبهوک توکن را به URL قبلی برگردانید و مطمئن شوید `BOT_TOKEN` فقط برای یک مقصد فعال استفاده می‌شود. از اجرای `/setup` قدیمی بدون بررسی اثر `drop_pending_updates` خودداری کنید.
