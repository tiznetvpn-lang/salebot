# بارگذاری پروژه در GitHub بدون خط فرمان

در این گفتگو اتصال GitHub برای ایجاد مخزن یا push فایل‌ها در دسترس نیست؛ پس من نمی‌توانم فایل‌ها را مستقیماً به حساب شما بفرستم. این بسته **بدون Secret واقعی** آماده است: `.env`، Bot Token، شناسهٔ قبلی مدیر و Cloudflare KV ID داخل آن نیستند.

## روش ساده با GitHub Desktop

1. فایل `tiznetvpn-ubuntu26.zip` را دانلود و روی رایانه Extract کنید.
2. در GitHub.com، با حساب خودتان یک مخزن تازه بسازید. اگر کد را خصوصی نگه‌می‌دارید، **Private** را انتخاب کنید. مخزن را خالی بسازید: README، `.gitignore` یا License خودکار اضافه نکنید.
3. برنامهٔ GitHub Desktop را از سایت رسمی GitHub نصب و وارد حساب شوید.
4. در GitHub Desktop از **File → Add Local Repository** پوشهٔ استخراج‌شده را انتخاب کنید. اگر پیام داد که پوشه هنوز repository نیست، گزینهٔ **Create a repository here** را انتخاب کنید؛ نام پروژه را `tiznetvpn-ubuntu26` بگذارید و `.gitignore`/License دیگری نسازید.
5. در پنجرهٔ Changes، فایل‌های پروژه را ببینید. بنویسید `Initial TiznetVPN import` و روی **Commit to main** بزنید.
6. روی **Publish repository** بزنید و وضعیت Private/Public را مطابق خواستهٔ خود نگه دارید.
7. فقط URL مخزن، مثل `https://github.com/USERNAME/tiznetvpn-ubuntu26`، را ارسال کنید؛ رمز GitHub یا token را نفرستید.

## نصب وقتی مخزن خصوصی است

نشانی `raw.githubusercontent.com` برای مخزن خصوصی بدون احراز هویت در دسترس نیست. برای حفظ خصوصی‌بودن و جلوگیری از قرار دادن token در فرمان:

1. بستهٔ `tiznetvpn-ubuntu26.zip` را از همین گفتگو دانلود کنید و با SCP یا WinSCP به سرور بفرستید؛ مسیر نمونه `/tmp/tiznetvpn-ubuntu26.zip` است. (برای نصب، لازم نیست سرور به مخزن خصوصی GitHub دسترسی بگیرد.)
2. روی سرور محتویات را استخراج کنید:

   ```bash
   sudo mkdir -p /tmp/tiznetvpn
   sudo unzip -oq /tmp/tiznetvpn-ubuntu26.zip -d /tmp/tiznetvpn
   ```

3. نصب‌کنندهٔ بسته را با همان یک فرمان اجرا کنید:

   ```bash
   sudo bash /tmp/tiznetvpn/install.sh --source-dir /tmp/tiznetvpn --domain bot.tiznet.site
   ```

این مسیر پس از انتقال ZIP، از GitHub token استفاده نمی‌کند. نصب‌کننده روی سرور Bot Token را به‌صورت ورودی مخفی می‌گیرد، `WEBHOOK_SECRET` تصادفی می‌سازد و قبل از جابه‌جایی webhook عبارت `SWITCH` را لازم دارد.

## اگر مخزن عمومی را انتخاب می‌کنید

به‌دلیل عمومی‌بودن کد، تنها در صورتی انتخاب کنید که با انتشار سورس موافق باشید. مخزن این بسته شامل Token یا Secret واقعی نیست. بعد از انتشار، دستور نصب مستقیم از GitHub در `INSTALL_FA.md` آمده است.
