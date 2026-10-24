#!/usr/bin/env bash
# عیب‌یابی یک‌خطی پرداخت خودکار شتاب: چرا اپ وصل نمی‌شود؟
# اجرا: sudo bash /opt/tiznetvpn/scripts/check-shetab.sh
set -uo pipefail

ENV_FILE="${TIZNET_ENV_FILE:-/etc/tiznetvpn/tiznetvpn.env}"
INSTALL_DIR="${TIZNET_INSTALL_DIR:-/opt/tiznetvpn}"
SERVICE="${TIZNET_SERVICE:-tiznetvpn.service}"

ok()   { printf '  ✅ %s\n' "$*"; }
bad()  { printf '  ❌ %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }
head_() { printf '\n%s\n' "$*"; }

value_of() {
  # آخرین مقدار یک کلید در فایل env، بدون کوتیشن/فاصله/CR
  local key="$1" raw
  raw=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  raw="${raw%$'\r'}"
  raw="${raw#\"}"; raw="${raw%\"}"
  raw="${raw#\'}"; raw="${raw%\'}"
  printf '%s' "$raw" | tr -d '[:space:]'
}

PROBLEMS=0
printf '🔍 بررسی پرداخت خودکار شتاب\n'
printf '   فایل تنظیمات: %s\n' "$ENV_FILE"

head_ '۱) فایل تنظیمات'
if [[ ! -f "$ENV_FILE" ]]; then
  bad "فایل $ENV_FILE پیدا نشد."
  exit 1
fi
ok 'فایل تنظیمات موجود است.'

SECRET=$(value_of SHETAB_API_SECRET)
SECRET_SOURCE='env'
if [[ -z "$SECRET" ]]; then
  # ممکن است کلید در خود ربات (KV) ساخته شده باشد؛ GET بدون اعتبارنامه این را لو می‌دهد.
  PROBE_PORT=$(value_of PORT); PROBE_PORT=${PROBE_PORT:-3000}
  PROBE_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PROBE_PORT}/api/shetab-verify" 2>/dev/null || true)
  if [[ "$PROBE_CODE" == '200' ]]; then
    SECRET_SOURCE='bot'
    ok 'Secret در خود ربات ساخته شده است (در فایل env نیست؛ اشکالی ندارد).'
    warn 'مقدار آن را از ربات بردارید: تنظیمات → 📲 اتصال اپ شتاب → 📋 کپی Secret'
  elif [[ "$PROBE_CODE" == '503' ]]; then
    bad 'هیچ Secretی تنظیم نشده است (نه در env و نه در ربات).'
    warn 'در ربات: تنظیمات → 📲 اتصال اپ شتاب (خودش می‌سازد و دکمهٔ کپی می‌دهد).'
    warn 'یا دوباره اجرا کنید: sudo bash /opt/tiznetvpn/update.sh --yes'
    PROBLEMS=$((PROBLEMS + 1))
  else
    bad 'Secret در فایل env خالی است و وضعیت ربات هم خوانده نشد.'
    warn 'اگر سرویس بالاست، در ربات: تنظیمات → 📲 اتصال اپ شتاب'
    PROBLEMS=$((PROBLEMS + 1))
  fi
elif [[ ${#SECRET} -lt 32 ]]; then
  bad "SHETAB_API_SECRET فقط ${#SECRET} کاراکتر است (باید حداقل ۳۲ باشد)."
  PROBLEMS=$((PROBLEMS + 1))
else
  ok "SHETAB_API_SECRET موجود است (${#SECRET} کاراکتر، شروع: ${SECRET:0:6}…)."
  LOCAL_SECRET_PROBE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "Authorization: $SECRET" "http://127.0.0.1:$(value_of PORT || echo 3000)/api/shetab-verify" 2>/dev/null || true)
  if [[ "$LOCAL_SECRET_PROBE" == '401' ]]; then
    warn 'این مقدار را سرور قبول نمی‌کند؛ نسخهٔ بالاتر در ربات (KV) ممکن است جایگزین شده باشد.'
    SECRET_SOURCE='bot'
  fi
fi

BASE=$(value_of PUBLIC_BASE_URL)
[[ -n "$BASE" ]] && ok "آدرس عمومی: $BASE" || { bad 'PUBLIC_BASE_URL تنظیم نشده است.'; PROBLEMS=$((PROBLEMS + 1)); }
PORT=$(value_of PORT); PORT=${PORT:-3000}
HOST=$(value_of HOST)

head_ '۲) اجرای سرویس'
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  ok "$SERVICE در حال اجراست."
else
  bad "$SERVICE فعال نیست."
  warn "sudo systemctl status $SERVICE --no-pager"
  PROBLEMS=$((PROBLEMS + 1))
fi

LOCAL="http://127.0.0.1:${PORT}"
LOCAL_VERSION=$(curl -fsS --max-time 5 "$LOCAL/healthz" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
if [[ -n "$LOCAL_VERSION" ]]; then
  ok "نسخهٔ سرویس روی سرور: $LOCAL_VERSION"
  if [[ -f "$INSTALL_DIR/package.json" ]]; then
    PKG_VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$INSTALL_DIR/package.json" | head -n1)
    [[ -n "$PKG_VERSION" && "$PKG_VERSION" != "$LOCAL_VERSION" ]] && warn "نسخهٔ فایل‌ها ($PKG_VERSION) با سرویس در حال اجرا یکی نیست؛ سرویس را ری‌استارت کنید."
  fi
else
  bad "سرویس روی پورت ${PORT} پاسخ نداد."
  PROBLEMS=$((PROBLEMS + 1))
fi

head_ '۳) مسیر محلی (بدون اینترنت)'
if [[ -n "$SECRET" ]]; then
  LOCAL_BODY=$(curl -sS --max-time 5 -w '\n%{http_code}' -H "Authorization: $SECRET" "$LOCAL/api/shetab-verify" 2>/dev/null || true)
  LOCAL_CODE=$(printf '%s' "$LOCAL_BODY" | tail -n1)
  LOCAL_JSON=$(printf '%s' "$LOCAL_BODY" | sed '$d')
  case "$LOCAL_CODE" in
    200) ok 'مسیر محلی سالم است (۲۰۰).' ;;
    401) bad 'سرور این Secret را قبول نمی‌کند (۴۰۱).'
         warn 'Secret در env و مقدار داخل اپ یکی نیست؛ در ربات «📋 کپی Secret» را بزنید.' ;;
    503) bad 'سرور می‌گوید Secret تنظیم نشده (۵۰۳).'
         warn 'ربات را باز کنید: تنظیمات → 📲 اتصال اپ شتاب (Secret همان‌جا ساخته می‌شود).' ;;
    *)   bad "پاسخ غیرمنتظره از مسیر محلی: ${LOCAL_CODE:-بدون پاسخ}"
         warn "${LOCAL_JSON:-}" ;;
  esac
  [[ "$LOCAL_CODE" != '200' ]] && PROBLEMS=$((PROBLEMS + 1))
elif [[ "$SECRET_SOURCE" == 'bot' ]]; then
  warn 'کلید در ربات (KV) است و از ترمینال قابل خواندن نیست؛ با «📋 کپی Secret» تست کنید.'
else
  warn 'بدون Secret قابل تست نیست؛ اول Secret را بسازید.'
fi

head_ '۴) مسیر عمومی (همان چیزی که اپ صدا می‌زند)'
if [[ -n "$BASE" && -n "$SECRET" ]]; then
  PUBLIC_BODY=$(curl -sS --max-time 12 -w '\n%{http_code}' -H "Authorization: $SECRET" "$BASE/api/shetab-verify" 2>/dev/null || true)
  PUBLIC_CODE=$(printf '%s' "$PUBLIC_BODY" | tail -n1)
  PUBLIC_JSON=$(printf '%s' "$PUBLIC_BODY" | sed '$d')
  case "$PUBLIC_CODE" in
    200) ok "مسیر عمومی سالم است: ${BASE}/wp-json/webdide-cv/v1/confirm" ;;
    401) bad 'دامنه به سرور می‌رسد اما Secret را قبول نمی‌کند (۴۰۱).'
         warn 'Secret اپ/curl با سرور یکی نیست.' ;;
    503) bad 'دامنه به سرور می‌رسد اما Secret روی سرور تنظیم نشده (۵۰۳).' ;;
    000|'')
         if [[ "${LOCAL_CODE:-}" == '200' ]]; then
           warn 'سرور نمی‌تواند به دامنهٔ خودش وصل شود (NAT یا DNS داخلی).'
           warn 'مسیر محلی سالم است؛ همین آدرس را از گوشی تست کنید (🧪 آزمون پرداخت در ربات).'
         else
           bad 'اتصال به دامنه برقرار نشد (DNS/SSL/فایروال).'
           PROBLEMS=$((PROBLEMS + 1))
         fi ;;
    *)   bad "پاسخ غیرمنتظره: ${PUBLIC_CODE}"
         warn "${PUBLIC_JSON:-}"
         PROBLEMS=$((PROBLEMS + 1)) ;;
  esac
elif [[ "$SECRET_SOURCE" == 'bot' ]]; then
  warn 'کلید در ربات است؛ مسیر عمومی را با «🔍 بررسی اتصال» در ربات یا اپ گوشی تست کنید.'
else
  warn 'به‌دلیل نبود آدرس/Secret، مسیر عمومی تست نشد.'
fi

head_ '۵) سازگاری با اپ شتاب (ساختار REST وردپرس)'
# اپ نسخهٔ ۱.۷.۳ پیش از قبول آدرس، ایندکس REST وردپرس را می‌سنجد. نسخه‌های قبل از
# 1.8.12 این ایندکس را نداشتند و اپ می‌گفت «آدرس API اشتباه است».
if [[ -n "$BASE" ]]; then
  WP_INDEX_RAW=$(curl -sS --max-time 12 -w '\n%{http_code}' "$BASE/wp-json/" 2>/dev/null || true)
  WP_INDEX_CODE=$(printf '%s' "$WP_INDEX_RAW" | tail -n1)
  WP_INDEX_JSON=$(printf '%s' "$WP_INDEX_RAW" | sed '$d')
  if [[ "$WP_INDEX_CODE" == '200' && "$WP_INDEX_JSON" == *'webdide-cv/v1'* ]]; then
    ok 'ایندکس /wp-json/ با namespace افزونه برمی‌گردد؛ تست اتصال اپ باید پاس شود.'
  elif [[ "$WP_INDEX_CODE" == '000' || -z "$WP_INDEX_CODE" ]]; then
    warn 'از این سرور به دامنهٔ خودش دسترسی نبود (NAT/DNS داخلی)؛ از گوشی تست کنید.'
  elif [[ "$WP_INDEX_CODE" == '404' ]]; then
    bad '/wp-json/ هنوز ۴۰۴ است؛ اپ با پیام «آدرس API اشتباه است» رد می‌کند.'
    warn 'یعنی نسخهٔ نصب‌شده قدیمی است: sudo bash /opt/tiznetvpn/update.sh --yes'
    PROBLEMS=$((PROBLEMS + 1))
  else
    bad "پاسخ غیرمنتظره از /wp-json/: ${WP_INDEX_CODE}"
    PROBLEMS=$((PROBLEMS + 1))
  fi

  WP_CONFIRM_RAW=$(curl -sS --max-time 12 -w '\n%{http_code}' "$BASE/wp-json/webdide-cv/v1/confirm" 2>/dev/null || true)
  WP_CONFIRM_CODE=$(printf '%s' "$WP_CONFIRM_RAW" | tail -n1)
  WP_CONFIRM_BODY=$(printf '%s' "$WP_CONFIRM_RAW" | sed '$d')
  if [[ "$WP_CONFIRM_CODE" == '404' && "$WP_CONFIRM_BODY" == *'rest_no_route'* ]]; then
    ok 'مسیر confirm فقط POST می‌پذیرد و مثل وردپرس واقعی به GET با rest_no_route پاسخ می‌دهد.'
  elif [[ "$WP_CONFIRM_CODE" == '200' ]]; then
    warn 'مسیر confirm به GET هم ۲۰۰ می‌دهد (رفتار نسخهٔ قدیمی). برای سازگاری کامل: update.sh --yes'
  else
    warn "پاسخ GET روی confirm: ${WP_CONFIRM_CODE:-بدون پاسخ} — مورد انتظار ۴۰۴ با rest_no_route است."
  fi
else
  warn 'بدون PUBLIC_BASE_URL بررسی سازگاری ممکن نیست.'
fi

head_ '۶) اپ روی گوشی؛ این دو مقدار را وارد کنید'
printf '   Server URL : %s\n' "${BASE:-<PUBLIC_BASE_URL>}/wp-json/webdide-cv/v1/confirm"
printf '   تست سلامت : %s\n' "${BASE:-<PUBLIC_BASE_URL>}/wp-json/webdide-cv/v1/health"
if [[ -n "$SECRET" && "$SECRET_SOURCE" == 'env' ]]; then
  printf '   API Secret : %s\n' "$SECRET"
else
  printf '   API Secret : از ربات → تنظیمات → 📲 اتصال اپ شتاب → 📋 کپی Secret\n'
fi

head_ 'نتیجه'
if [[ $PROBLEMS -eq 0 ]]; then
  ok 'سمت سرور همه‌چیز درست است. اگر اپ هنوز خطا می‌دهد، Secret را دوباره از ربات کپی و در اپ جای‌گذاری کنید.'
  exit 0
fi
bad "${PROBLEMS} مورد بالا نیاز به رسیدگی دارد."
exit 1
