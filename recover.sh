#!/usr/bin/env bash
# =============================================================================
# TiznetVPN — بازیابی/نصب تمیز روی سرور، بدون از دست دادن داده و توکن
#
#   sudo bash recover.sh --diagnose      فقط وضعیت را گزارش می‌کند (هیچ تغییری نمی‌دهد)
#   sudo bash recover.sh                 بازیابی کامل با پرسش تأیید
#   sudo bash recover.sh --yes           بازیابی بدون پرسش
#   sudo bash recover.sh --dry-run       دانلود و تست بسته، بدون تغییر سرور
#
# این اسکریپت برای وقتی است که ربات/Mini App از کار افتاده یا مسیر نصب ناقص شده.
# فایل تنظیمات (/etc/tiznetvpn/tiznetvpn.env) و دیتابیس (/var/lib/tiznetvpn) حفظ
# می‌شوند، پس توکن ربات و مشتری/سفارش‌ها از دست نمی‌روند.
#
#   --repo OWNER/REPO      مخزن مبدأ (پیش‌فرض: tiznetvpn-lang/salebot)
#   --ref REF              شاخه/تگ/کامیت (پیش‌فرض: main)
#   --domain DOMAIN        دامنهٔ سایت؛ پیش‌فرض: از PUBLIC_BASE_URL فایل env
#   --restore-db           اگر دیتابیس اصلی نیست، آخرین snapshot را بازگردان
#   --set-webhook          وبهوک تلگرام را روی این دامنه تنظیم کن
#   --skip-cert            گواهی TLS را دست نزن (اگر سرویس‌های دیگر روی ۸۰/۴۴۳ هستند)
# =============================================================================
set -Eeuo pipefail

REPO="${TIZNET_REPO:-tiznetvpn-lang/salebot}"
REF="${TIZNET_REF:-main}"
INSTALL_DIR="${TIZNET_INSTALL_DIR:-/opt/tiznetvpn}"
ENV_DIR="${TIZNET_ENV_DIR:-/etc/tiznetvpn}"
ENV_FILE="${TIZNET_ENV_FILE:-$ENV_DIR/tiznetvpn.env}"
DATA_DIR="${TIZNET_DATA_DIR:-/var/lib/tiznetvpn}"
BACKUP_DIR="${TIZNET_BACKUP_DIR:-/var/backups/tiznetvpn}"
SERVICE="${TIZNET_SERVICE:-tiznetvpn.service}"
SERVICE_USER="${TIZNET_SERVICE_USER:-tiznetvpn}"
NGINX_SITE="${TIZNET_NGINX_SITE:-/etc/nginx/sites-available/tiznetvpn}"
NGINX_LINK="${TIZNET_NGINX_LINK:-/etc/nginx/sites-enabled/tiznetvpn}"
SKIP_SYSTEMD="${TIZNET_SKIP_SYSTEMD:-0}"
DOMAIN=''
DIAGNOSE_ONLY=0
DRY_RUN=0
ASSUME_YES=0
RESTORE_DB=0
SET_WEBHOOK=0
SKIP_CERT=0

say()  { printf '\n\033[1;36m[recover]\033[0m %s\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[recover] هشدار:\033[0m %s\n' "$*" >&2; }
fail() { printf '\n\033[1;31m[recover] خطا:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR==1 { next }
       /^#/  { sub(/^# ?/, ""); if ($0 !~ /^=+$/) print; next }
       /^$/  { next }
             { exit }' "${BASH_SOURCE[0]}"
}

# ---------------------------------------------------------------------------
# اجرای دوباره از کپی موقت (فایل داخل INSTALL_DIR جایگزین می‌شود)
# ---------------------------------------------------------------------------
SELF_COPY="${TIZNET_RECOVER_SELF:-}"
if [[ "${TIZNET_RECOVER_REEXEC:-0}" != '1' ]]; then
  SELF_COPY=$(mktemp /tmp/tiznetvpn-recover.XXXXXX.sh)
  cat "${BASH_SOURCE[0]}" > "$SELF_COPY"
  TIZNET_RECOVER_REEXEC=1 TIZNET_RECOVER_SELF="$SELF_COPY" exec bash "$SELF_COPY" "$@"
fi

while (($#)); do
  case "$1" in
    --diagnose)     DIAGNOSE_ONLY=1; shift ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --yes|-y)       ASSUME_YES=1; shift ;;
    --restore-db)   RESTORE_DB=1; shift ;;
    --set-webhook)  SET_WEBHOOK=1; shift ;;
    --skip-cert)    SKIP_CERT=1; shift ;;
    --repo)         [[ $# -ge 2 ]] || fail 'مقدار --repo داده نشد.'; REPO=$2; shift 2 ;;
    --ref)          [[ $# -ge 2 ]] || fail 'مقدار --ref داده نشد.'; REF=$2; shift 2 ;;
    --domain)       [[ $# -ge 2 ]] || fail 'مقدار --domain داده نشد.'; DOMAIN=${2,,}; shift 2 ;;
    -h|--help)      usage; exit 0 ;;
    *)              usage; fail "گزینهٔ ناشناخته: $1" ;;
  esac
done

[[ "$EUID" -eq 0 ]] || fail 'این اسکریپت باید با sudo اجرا شود.'
[[ "$REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$REF" != *'..'* ]] || fail 'نام شاخه/تگ نامعتبر است.'
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'مقدار --repo باید OWNER/REPO باشد.'
[[ -z "$DOMAIN" || "$DOMAIN" =~ ^([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$ ]] || fail 'دامنه نامعتبر است.'

TMP_DIR=''
cleanup() {
  [[ -n "${TMP_DIR:-}" ]] && rm -rf "$TMP_DIR"
  [[ -n "${SELF_COPY:-}" ]] && rm -f "$SELF_COPY"
  return 0
}
trap cleanup EXIT

have() { command -v "$1" >/dev/null 2>&1; }
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' || true; }
service_unit_exists() {
  [[ "$SKIP_SYSTEMD" == '1' ]] && return 1
  [[ -d /run/systemd/system ]] && have systemctl && systemctl cat "$SERVICE" >/dev/null 2>&1
}
db_path() { local d; d=$(env_get DATA_DIR); echo "${TIZNET_DB_PATH:-${d:-$DATA_DIR}/tiznetvpn.sqlite3}"; }
local_port() { local p; p=$(env_get PORT); echo "${p:-3000}"; }

nginx_domain() {
  [[ -f "$NGINX_SITE" ]] || return 0
  sed -n 's/^[[:space:]]*server_name[[:space:]]\+\([^;]*\);.*/\1/p' "$NGINX_SITE" | head -n1 | awk '{print $1}'
}

# ===========================================================================
# ۱) تشخیص وضعیت
# ===========================================================================
detect_domain() {
  [[ -n "$DOMAIN" ]] && return 0
  local from_env from_nginx
  from_env=$(env_get PUBLIC_BASE_URL | sed -E 's#^https?://##; s#/.*$##')
  from_nginx=$(nginx_domain)
  if [[ -n "$from_env" ]]; then DOMAIN="$from_env"
  elif [[ -n "$from_nginx" && "$from_nginx" != '__DOMAIN__' ]]; then DOMAIN="$from_nginx"
  fi
}

say 'تشخیص وضعیت فعلی سرور'
printf '  %-26s %s\n' 'مسیر نصب:' "$INSTALL_DIR"
if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/package.json" ]]; then
  ok "کد موجود · نسخه $(node -p "require('$INSTALL_DIR/package.json').version" 2>/dev/null || echo '?')"
elif [[ -d "$INSTALL_DIR" ]]; then
  bad 'پوشهٔ نصب هست ولی کد کامل نیست'
else
  bad 'پوشهٔ نصب وجود ندارد'
fi

if [[ -f "$ENV_FILE" ]]; then
  token=$(env_get BOT_TOKEN); admin=$(env_get ADMIN_IDS)
  ok "فایل تنظیمات هست · توکن ${#token} کاراکتر · ادمین ${admin:-خالی}"
else
  bad "فایل تنظیمات نیست: $ENV_FILE"
fi

DB=$(db_path)
if [[ -f "$DB" ]]; then
  rows=$(node -e "const {DatabaseSync}=require('node:sqlite');try{const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('select count(*) c from kv').get().c)}catch(e){console.log('?')}" "$DB" 2>/dev/null | tail -1)
  ok "دیتابیس هست · ${rows} رکورد ($DB)"
else
  bad "دیتابیس نیست: $DB"
fi

if service_unit_exists; then
  ok "unit هست · وضعیت: $(systemctl is-active "$SERVICE" 2>&1)/$(systemctl is-enabled "$SERVICE" 2>&1)"
else
  bad 'unit سرویس در systemd ثبت نشده'
fi

if [[ -f "$NGINX_SITE" ]]; then
  ok "کانفیگ Nginx هست · server_name: $(nginx_domain || echo '-')"
else
  bad 'کانفیگ Nginx برای این سایت نیست'
fi

detect_domain
if [[ -n "$DOMAIN" ]]; then
  ok "دامنه: $DOMAIN"
  if have curl; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "https://$DOMAIN/healthz" 2>/dev/null || true); code=${code:-000}
    [[ "$code" == '200' ]] && ok "https://$DOMAIN/healthz → 200" || bad "https://$DOMAIN/healthz → $code"
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "https://$DOMAIN/miniapp" 2>/dev/null || true); code=${code:-000}
    [[ "$code" == '200' ]] && ok "https://$DOMAIN/miniapp → 200" || bad "https://$DOMAIN/miniapp → $code"
  fi
else
  bad 'دامنه شناسایی نشد؛ با --domain بدهید'
fi

if have node; then ok "Node $(node -v)"; else bad 'Node.js نصب نیست'; fi

(( DIAGNOSE_ONLY )) && { say 'حالت --diagnose: هیچ تغییری اعمال نشد.'; exit 0; }

# ===========================================================================
# ۲) پیش‌نیازها
# ===========================================================================
have curl || fail 'curl نصب نیست: apt-get install -y curl'
have tar  || fail 'tar نصب نیست.'
have node || fail 'Node.js نصب نیست. اگر Ubuntu شما node 24 ندارد، ابتدا از INSTALL_FA.md بخش ۲ نصب کنید.'
[[ -f "$ENV_FILE" ]] || fail "فایل تنظیمات $ENV_FILE نیست. ابتدا نصب اولیه (install.sh) را انجام دهید؛ بدون آن توکن ربات بازسازی نمی‌شود."
[[ -n "$(env_get BOT_TOKEN)" ]] || fail 'BOT_TOKEN در فایل env خالی است.'
detect_domain
[[ -n "$DOMAIN" ]] || fail 'دامنه شناسایی نشد؛ با --domain دامنه را بدهید.'

# ===========================================================================
# ۳) بکاپ کامل قبل از هر تغییری
# ===========================================================================
say 'بکاپ وضعیت فعلی (کد، env، دیتابیس، nginx، units)'
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR" 2>/dev/null || true
STAMP=$(date -u +%Y%m%d-%H%M%S)
SAFE="$TMP_DIR/backup-src"
mkdir -p "$SAFE"
[[ -d "$INSTALL_DIR" ]] && cp -a "$INSTALL_DIR" "$SAFE/opt-tiznetvpn" 2>/dev/null || true
[[ -d "$ENV_DIR" ]] && cp -a "$ENV_DIR" "$SAFE/etc-tiznetvpn" 2>/dev/null || true
[[ -d "$DATA_DIR" ]] && mkdir -p "$SAFE/data" && cp -a "$DATA_DIR"/tiznetvpn.sqlite3* "$SAFE/data/" 2>/dev/null || true
[[ -f "$NGINX_SITE" ]] && cp -a "$NGINX_SITE" "$SAFE/nginx-site.conf" 2>/dev/null || true
for unit in /etc/systemd/system/tiznetvpn*.service /etc/systemd/system/tiznetvpn*.timer; do
  [[ -e "$unit" ]] && cp -a "$unit" "$SAFE/" 2>/dev/null || true
done
RECOVERY_BACKUP="$BACKUP_DIR/recover-$STAMP.tar.gz"
if ! tar -czf "$RECOVERY_BACKUP" -C "$SAFE" . 2>/dev/null; then
  RECOVERY_BACKUP="/root/tiznetvpn-recover-$STAMP.tar.gz"
  tar -czf "$RECOVERY_BACKUP" -C "$SAFE" . || fail 'ساخت بکاپ ناموفق بود؛ برای جلوگیری از ریسک متوقف شد.'
fi
chmod 0600 "$RECOVERY_BACKUP"
ok "بکاپ: $RECOVERY_BACKUP"

if (( ! ASSUME_YES )); then
  [[ -t 0 ]] || fail 'برای اجرای غیرتعاملی از --yes استفاده کنید.'
  printf '\nنصب/بازیابی روی %s با دامنهٔ %s انجام شود؟ [y/N]: ' "$INSTALL_DIR" "$DOMAIN" >/dev/tty
  IFS= read -r ANSWER </dev/tty || ANSWER=''
  [[ "${ANSWER,,}" == 'y' || "${ANSWER,,}" == 'yes' ]] || { say 'لغو شد.'; exit 0; }
fi

# ===========================================================================
# ۴) دریافت بستهٔ جدید
# ===========================================================================
say "دریافت بستهٔ ${REPO}@${REF}"
NEW_DIR="$TMP_DIR/new"
mkdir -p "$NEW_DIR"
RELEASE="$TMP_DIR/release.tar.gz"
curl -fsSL --retry 2 --retry-delay 2 --connect-timeout 15 --max-time 300 \
  -H 'Accept: application/vnd.github+json' -o "$RELEASE" \
  "https://api.github.com/repos/${REPO}/tarball/${REF}" \
  || fail "دریافت بسته ناموفق بود. اگر مخزن خصوصی است، از update.sh با توکن یا ZIP استفاده کنید."
tar -xzf "$RELEASE" -C "$NEW_DIR" --strip-components=1 2>/dev/null || fail 'استخراج بسته ناموفق بود.'
for required in package.json src/worker.js server/server.mjs nginx/tiznetvpn.conf systemd/tiznetvpn.service; do
  [[ -f "$NEW_DIR/$required" ]] || fail "فایل ضروری در بستهٔ جدید نیست: $required (شاخه/تگ را بررسی کنید)"
done
NEW_VERSION=$(node -p "require('$NEW_DIR/package.json').version" 2>/dev/null || echo unknown)
ok "بستهٔ $NEW_VERSION دریافت شد"

say 'بررسی سینتکس و اجرای تست‌ها روی بستهٔ جدید'
node --check "$NEW_DIR/server/server.mjs"
node --check "$NEW_DIR/server/sqlite-kv.mjs"
node --check "$NEW_DIR/server/runtime.mjs"
node --check "$NEW_DIR/src/worker.js"
( cd "$NEW_DIR" && node test/run.mjs >"$TMP_DIR/t.log" 2>&1 ) || { tail -n 25 "$TMP_DIR/t.log" >&2; fail 'تست‌های بستهٔ جدید رد شد.'; }
( cd "$NEW_DIR" && node test/sqlite-kv.test.mjs >>"$TMP_DIR/t.log" 2>&1 ) || { tail -n 25 "$TMP_DIR/t.log" >&2; fail 'تست SQLite رد شد.'; }
ok 'همهٔ تست‌ها پاس شدند'

if (( DRY_RUN )); then
  say "حالت --dry-run: بستهٔ $NEW_VERSION سالم است؛ هیچ تغییری اعمال نشد."
  exit 0
fi

# ===========================================================================
# ۵) جایگزینی کد (env و دیتابیس بیرون از این مسیر هستند)
# ===========================================================================
say 'نصب کد در مسیر نصب'
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$INSTALL_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER" \
    || warn "ساخت کاربر $SERVICE_USER ناموفق بود."
fi
if id -g "$SERVICE_USER" >/dev/null 2>&1; then SERVICE_GROUP="$SERVICE_USER"; else SERVICE_GROUP='root'; fi

PRESERVE="$TMP_DIR/preserve"
mkdir -p "$PRESERVE"
[[ -d "$INSTALL_DIR/data" ]] && cp -a "$INSTALL_DIR/data" "$PRESERVE/" || true

mkdir -p "$INSTALL_DIR"
find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$NEW_DIR/." "$INSTALL_DIR/"
[[ -d "$PRESERVE/data" && ! -e "$INSTALL_DIR/data" ]] && cp -a "$PRESERVE/data" "$INSTALL_DIR/"
chown -R root:"$SERVICE_GROUP" "$INSTALL_DIR"
find "$INSTALL_DIR" -type d -exec chmod 0750 {} \;
find "$INSTALL_DIR" -type f -exec chmod 0640 {} \;
chmod 0750 "$INSTALL_DIR"/install.sh "$INSTALL_DIR"/update.sh "$INSTALL_DIR"/recover.sh 2>/dev/null || true
ok "$NEW_VERSION نصب شد"

# ===========================================================================
# ۶) دیتابیس
# ===========================================================================
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown "$SERVICE_USER":"$SERVICE_GROUP" "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null || true
chmod 0750 "$DATA_DIR" 2>/dev/null || true

if [[ ! -f "$(db_path)" && "$RESTORE_DB" == '1' ]]; then
  SNAP=$(ls -1t "$BACKUP_DIR"/tiznetvpn-*.sqlite3 2>/dev/null | head -n1 || true)
  if [[ -n "$SNAP" ]]; then
    say "بازگردانی دیتابیس از snapshot: $SNAP"
    install -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0640 "$SNAP" "$(db_path)"
    ok 'دیتابیس بازگردانده شد'
  else
    warn "snapshot ای در $BACKUP_DIR پیدا نشد؛ دیتابیس خالی ساخته می‌شود."
  fi
elif [[ -f "$(db_path)" ]]; then
  ok "دیتابیس موجود حفظ شد: $(db_path)"
fi

# ===========================================================================
# ۷) systemd
# ===========================================================================
if [[ "$SKIP_SYSTEMD" != '1' && -d /run/systemd/system ]] && have systemctl; then
  say 'نصب و فعال‌سازی سرویس‌های systemd'
  install -m 0644 "$INSTALL_DIR"/systemd/*.service /etc/systemd/system/
  install -m 0644 "$INSTALL_DIR"/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now "$SERVICE"
  ok "سرویس $SERVICE فعال شد"
else
  warn 'systemd در دسترس نیست؛ سرویس را دستی اجرا کنید.'
fi

# ===========================================================================
# ۸) Nginx (با دامنهٔ درست)
# ===========================================================================
if have nginx && [[ -d /etc/nginx ]]; then
  say "پیکربندی Nginx برای $DOMAIN"
  mkdir -p "$(dirname "$NGINX_SITE")"
  sed "s/__DOMAIN__/${DOMAIN}/g" "$INSTALL_DIR/nginx/tiznetvpn.conf" > "$NGINX_SITE"
  if ! grep -q "server_name ${DOMAIN};" "$NGINX_SITE"; then
    warn 'جایگزینی دامنه در کانفیگ Nginx انجام نشد؛ فایل را دستی بررسی کنید.'
  fi
  ln -sfn "$NGINX_SITE" "$NGINX_LINK"
  if nginx -t >"$TMP_DIR/nginx.log" 2>&1; then
    systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true
    ok 'Nginx بارگذاری شد'
  else
    cat "$TMP_DIR/nginx.log" >&2
    warn 'nginx -t خطا داد؛ کانفیگ قبلی را از بکاپ برگردانید اگر سایت‌های دیگر آسیب دیدند.'
  fi
else
  warn 'Nginx نصب نیست؛ بعد از نصب، کانفیگ را از بکاپ بازگردانید.'
fi

# ===========================================================================
# ۹) گواهی TLS
# ===========================================================================
if [[ "$SKIP_CERT" != '1' ]] && have certbot; then
  if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    ok "گواهی TLS برای $DOMAIN موجود است"
  else
    say "دریافت گواهی TLS برای $DOMAIN"
    certbot --nginx --non-interactive --agree-tos --redirect \
      --register-unsafely-without-email -d "$DOMAIN" 2>&1 | tail -5 \
      || warn 'دریافت گواهی ناموفق بود؛ DNS/پورت‌های ۸۰ و ۴۴۳ را بررسی کنید.'
  fi
fi

# ===========================================================================
# ۱۰) بررسی نهایی
# ===========================================================================
say 'بررسی سلامت'
PORT=$(local_port)
HEALTH=''
for i in $(seq 1 30); do
  HEALTH=$(curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null || true)
  [[ -n "$HEALTH" ]] && break
  sleep 1
done
if [[ -n "$HEALTH" ]]; then ok "محلی: $HEALTH"; else
  bad "سرویس روی پورت $PORT پاسخ نداد"
  [[ "$SKIP_SYSTEMD" != '1' ]] && journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null || true
fi

for path in /healthz /miniapp; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAIN}${path}" 2>/dev/null || true); code=${code:-000}
  [[ "$code" == '200' ]] && ok "https://${DOMAIN}${path} → 200" || bad "https://${DOMAIN}${path} → $code"
done

TOKEN=$(env_get BOT_TOKEN)
if [[ -n "$TOKEN" ]]; then
  ME=$(curl -sS --max-time 10 "https://api.telegram.org/bot${TOKEN}/getMe" 2>/dev/null || true)
  BOTNAME=$(printf '%s' "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
  [[ -n "$BOTNAME" ]] && ok "ربات تلگرام: @$BOTNAME" || bad 'getMe ناموفق بود (توکن/شبکه)'
  HOOK=$(curl -sS --max-time 10 "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" 2>/dev/null || true)
  HOOKURL=$(printf '%s' "$HOOK" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
  if [[ "$HOOKURL" == "https://${DOMAIN}/webhook" ]]; then
    ok "وبهوک درست است: $HOOKURL"
  else
    bad "وبهوک: ${HOOKURL:-خالی} (باید https://${DOMAIN}/webhook باشد)"
    if [[ "$SET_WEBHOOK" == '1' ]]; then
      say 'تنظیم وبهوک روی دامنهٔ جدید'
      if runuser -u "$SERVICE_USER" -- env ENV_FILE="$ENV_FILE" node "$INSTALL_DIR/scripts/setup-webhook.mjs" --confirm-switch 2>&1 | tail -3; then
        ok 'وبهوک تنظیم شد'
      else
        warn 'تنظیم وبهوک ناموفق بود؛ دستی اجرا کنید: sudo -u '"$SERVICE_USER"' env ENV_FILE='"$ENV_FILE"' node '"$INSTALL_DIR"'/scripts/setup-webhook.mjs --confirm-switch'
      fi
    else
      printf '  برای تنظیم خودکار، همین دستور را با --set-webhook تکرار کنید.\n'
    fi
  fi
fi

say 'پایان'
printf '  بکاپ قبل از بازیابی: %s\n' "$RECOVERY_BACKUP"
printf '  اگر چیزی خراب شد، همین بکاپ را بازگردانید:\n'
printf '    sudo tar -xzf %s -C /tmp/rb && sudo cp -a /tmp/rb/opt-tiznetvpn/. %s/\n' "$RECOVERY_BACKUP" "$INSTALL_DIR"
printf '  لاگ سرویس: sudo journalctl -u %s -n 100 --no-pager\n\n' "$SERVICE"
