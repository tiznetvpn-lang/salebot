#!/usr/bin/env bash
# =============================================================================
# TiznetVPN — به‌روزرسانی یک‌خطی روی سرور
#
#   sudo bash /opt/tiznetvpn/update.sh
#
# این اسکریپت نسخهٔ جدید را از GitHub می‌گیرد، تست می‌کند، از دیتابیس و کد فعلی
# بکاپ می‌گیرد، فایل‌ها را در همان مسیر /opt/tiznetvpn جایگزین می‌کند (بدون
# جابه‌جایی دستی فایل)، سرویس را ری‌استارت می‌کند و در صورت خطا خودکار برمی‌گردد.
#
#   --ref main            شاخه/تگ/کامیت مبدأ (پیش‌فرض: main)
#   --repo OWNER/REPO     مخزن مبدأ
#   --domain NAME         دامنهٔ سایت؛ Nginx و گواهی HTTPS را برای همین دامنه اصلاح می‌کند
#   --email ADDR          ایمیل Certbot (اگر قبلاً حساب Let's Encrypt ساخته شده لازم نیست)
#   --dry-run             فقط دانلود و تست؛ چیزی روی سرور تغییر نمی‌کند
#   --yes                 بدون پرسش تأیید
#   --rollback            بازگشت به آخرین بکاپ کد در /var/backups/tiznetvpn
# =============================================================================
set -Eeuo pipefail

REPO="${TIZNET_REPO:-tiznetvpn-lang/salebot}"
INSTALL_DIR="${TIZNET_INSTALL_DIR:-/opt/tiznetvpn}"
ENV_FILE="${TIZNET_ENV_FILE:-/etc/tiznetvpn/tiznetvpn.env}"
UPDATE_ENV="${TIZNET_UPDATE_ENV:-/etc/tiznetvpn/update.env}"
BACKUP_DIR="${TIZNET_BACKUP_DIR:-/var/backups/tiznetvpn}"
SERVICE="${TIZNET_SERVICE:-tiznetvpn.service}"
REF="${TIZNET_REF:-main}"
SERVICE_USER="${TIZNET_SERVICE_USER:-tiznetvpn}"
SERVICE_GROUP="${TIZNET_SERVICE_GROUP:-}"
DRY_RUN=0
ASSUME_YES=0
DO_ROLLBACK=0
DOMAIN_ARG="${TIZNET_DOMAIN:-}"
CERTBOT_EMAIL="${TIZNET_CERTBOT_EMAIL:-}"

say()  { printf '\n\033[1;36m[update]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[update] هشدار:\033[0m %s\n' "$*" >&2; }
fail() { printf '\n\033[1;31m[update] خطا:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR==1 { next }
       /^#/  { sub(/^# ?/, ""); if ($0 !~ /^=+$/) print; next }
       /^$/  { next }
             { exit }' "${BASH_SOURCE[0]}"
}

# ---------------------------------------------------------------------------
# اجرای دوباره از یک کپی موقت (پیش از تجزیهٔ آرگومان‌ها تا گزینه‌ها حفظ شوند)؛
# چون محتویات INSTALL_DIR — از جمله همین فایل — جایگزین می‌شود.
# ---------------------------------------------------------------------------
SELF_COPY="${TIZNET_UPDATE_SELF:-}"
if [[ "${TIZNET_UPDATE_REEXEC:-0}" != '1' ]]; then
  SELF_COPY=$(mktemp /tmp/tiznetvpn-update.XXXXXX.sh)
  cat "${BASH_SOURCE[0]}" > "$SELF_COPY"
  TIZNET_UPDATE_REEXEC=1 TIZNET_UPDATE_SELF="$SELF_COPY" exec bash "$SELF_COPY" "$@"
fi

TMP_DIR=''
cleanup() {
  [[ -n "${TMP_DIR:-}" ]] && rm -rf "$TMP_DIR"
  [[ -n "${SELF_COPY:-}" ]] && rm -f "$SELF_COPY"
  return 0
}
trap cleanup EXIT

while (($#)); do
  case "$1" in
    --ref)      [[ $# -ge 2 ]] || fail 'مقدار --ref داده نشد.'; REF=$2; shift 2 ;;
    --repo)     [[ $# -ge 2 ]] || fail 'مقدار --repo داده نشد.'; REPO=$2; shift 2 ;;
    --dry-run)  DRY_RUN=1; shift ;;
    --domain)   [[ $# -ge 2 ]] || fail 'مقدار --domain داده نشد.'; DOMAIN_ARG=$2; shift 2 ;;
    --email)    [[ $# -ge 2 ]] || fail 'مقدار --email داده نشد.'; CERTBOT_EMAIL=$2; shift 2 ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    --rollback) DO_ROLLBACK=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *)          usage; fail "گزینهٔ ناشناخته: $1" ;;
  esac
done

[[ "$EUID" -eq 0 ]] || fail 'این اسکریپت باید با sudo اجرا شود:  sudo bash '"$INSTALL_DIR"'/update.sh'
[[ "$REF" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$REF" != *'..'* ]] || fail 'نام شاخه/تگ نامعتبر است.'
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'مقدار --repo باید به شکل OWNER/REPO باشد.'

command -v curl >/dev/null 2>&1 || fail 'curl نصب نیست: apt-get install -y curl'
command -v tar  >/dev/null 2>&1 || fail 'tar نصب نیست.'
command -v node >/dev/null 2>&1 || fail 'Node.js پیدا نشد؛ نصب اولیه را بررسی کنید.'

if [[ -z "$SERVICE_GROUP" ]]; then
  if id -g "$SERVICE_USER" >/dev/null 2>&1; then
    SERVICE_GROUP="$SERVICE_USER"
  else
    SERVICE_GROUP='root'
    warn "گروه سرویس «$SERVICE_USER» وجود ندارد؛ مالکیت فایل‌ها با root:root تنظیم می‌شود."
  fi
fi



# ---------------------------------------------------------------------------
# بازگشت به آخرین بکاپ کد
# ---------------------------------------------------------------------------
latest_code_backup() { ls -1t "$BACKUP_DIR"/code-*.tar.gz 2>/dev/null | head -n1; }

unit_available() {
  [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1 \
    && systemctl cat "$SERVICE" >/dev/null 2>&1
}

restart_service() {
  if unit_available; then
    systemctl restart "$SERVICE" || return 1
    return 0
  fi
  warn "unit «$SERVICE» در systemd ثبت نشده؛ ری‌استارت خودکار انجام نشد."
  return 0
}

wait_health() {
  local port="$1" i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

if (( DO_ROLLBACK )); then
  [[ -d "$INSTALL_DIR" ]] || fail "مسیر نصب پیدا نشد: $INSTALL_DIR"
  BACKUP=$(latest_code_backup) || true
  [[ -n "${BACKUP:-}" ]] || fail "هیچ بکاپ کدی در $BACKUP_DIR پیدا نشد."
  say "بازگشت به بکاپ: $BACKUP"
  find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  tar -xzf "$BACKUP" -C "$INSTALL_DIR"
  chown -R root:"$SERVICE_GROUP" "$INSTALL_DIR" 2>/dev/null || true
  find "$INSTALL_DIR" -type d -exec chmod 0750 {} \; 2>/dev/null || true
  find "$INSTALL_DIR" -type f -exec chmod 0640 {} \; 2>/dev/null || true
  restart_service || warn 'ری‌استارت سرویس ناموفق بود.'
  say 'بازگشت انجام شد.'
  exit 0
fi

[[ -f "$INSTALL_DIR/package.json" ]] \
  || fail "نصب TiznetVPN در $INSTALL_DIR پیدا نشد. ابتدا install.sh را اجرا کنید."
[[ -f "$ENV_FILE" ]] \
  || fail "فایل تنظیمات $ENV_FILE پیدا نشد؛ بدون آن به‌روزرسانی امن نیست."

# ---------------------------------------------------------------------------
# توکن GitHub (برای مخزن خصوصی) — یک‌بار ذخیره می‌شود، بعد از آن فقط یک خط لازم است
# ---------------------------------------------------------------------------
TOKEN="${GITHUB_TOKEN:-}"
if [[ -z "$TOKEN" && -r "$UPDATE_ENV" ]]; then
  TOKEN=$(grep -E '^GITHUB_TOKEN=' "$UPDATE_ENV" 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  TOKEN=${TOKEN%$'\r'}
  TOKEN=${TOKEN#\"}; TOKEN=${TOKEN%\"}
  TOKEN=${TOKEN#\'}; TOKEN=${TOKEN%\'}
fi

prompt_token() {
  [[ -t 0 ]] || fail "مخزن خصوصی است و توکن ذخیره نشده. یک‌بار این را اجرا کنید:
  sudo sh -c 'printf \"GITHUB_TOKEN=%s\\n\" \"YOUR_TOKEN\" > $UPDATE_ENV && chmod 600 $UPDATE_ENV'"
  printf 'توکن GitHub با دسترسی خواندن مخزن (ورودی مخفی): ' >/dev/tty
  IFS= read -r -s TOKEN </dev/tty || fail 'خواندن توکن ناموفق بود.'
  printf '\n' >/dev/tty
  [[ -n "$TOKEN" ]] || fail 'توکن خالی است.'
  install -d -m 0700 "$(dirname "$UPDATE_ENV")"
  ( umask 077; printf 'GITHUB_TOKEN=%s\n' "$TOKEN" > "$UPDATE_ENV" )
  chmod 0600 "$UPDATE_ENV"
  say "توکن برای به‌روزرسانی‌های بعدی در $UPDATE_ENV ذخیره شد."
}

TMP_DIR=$(mktemp -d /tmp/tiznetvpn-update.XXXXXX)
NEW_DIR="$TMP_DIR/new"
mkdir -p "$NEW_DIR"

download_release() {
  local dest="$TMP_DIR/release.tar.gz" url
  url="https://api.github.com/repos/${REPO}/tarball/${REF}"
  if [[ -n "$TOKEN" ]]; then
    curl -fsSL --retry 2 --retry-delay 2 --connect-timeout 15 --max-time 600 \
      -H "Authorization: Bearer ${TOKEN}" -H 'Accept: application/vnd.github+json' \
      -o "$dest" "$url"
  else
    curl -fsSL --retry 2 --retry-delay 2 --connect-timeout 15 --max-time 600 \
      -H 'Accept: application/vnd.github+json' -o "$dest" "$url"
  fi
}

say "دریافت نسخهٔ ${REF} از ${REPO}"
if ! download_release; then
  if [[ -z "$TOKEN" ]]; then
    prompt_token
    download_release || fail "دریافت نسخه از GitHub ناموفق بود (${REPO}@${REF})."
  else
    fail "دریافت نسخه از GitHub ناموفق بود (${REPO}@${REF}). توکن/دسترسی مخزن را بررسی کنید."
  fi
fi

[[ -s "$TMP_DIR/release.tar.gz" ]] || fail 'فایل دریافتی خالی است.'

say 'استخراج و بررسی ساختار بسته'
tar -xzf "$TMP_DIR/release.tar.gz" -C "$NEW_DIR" --strip-components=1 2>/dev/null \
  || fail 'استخراج بستهٔ دریافتی ناموفق بود.'
for required in package.json src/worker.js server/server.mjs update.sh install.sh; do
  [[ -f "$NEW_DIR/$required" ]] || fail "فایل ضروری در بستهٔ جدید نیست: $required"
done

OLD_VERSION=$(node -p "require('${INSTALL_DIR}/package.json').version" 2>/dev/null || echo 'unknown')
NEW_VERSION=$(node -p "require('${NEW_DIR}/package.json').version" 2>/dev/null || echo 'unknown')
say "نسخهٔ فعلی: ${OLD_VERSION}  →  نسخهٔ جدید: ${NEW_VERSION}"

say 'بررسی سینتکس فایل‌های اصلی'
node --check "$NEW_DIR/server/server.mjs"
node --check "$NEW_DIR/server/sqlite-kv.mjs"
node --check "$NEW_DIR/server/runtime.mjs"
node --check "$NEW_DIR/src/worker.js"

say 'اجرای تست‌ها روی بستهٔ جدید (قبل از هر تغییری روی سرور)'
( cd "$NEW_DIR" && node test/run.mjs >"$TMP_DIR/test.log" 2>&1 ) \
  || { tail -n 25 "$TMP_DIR/test.log" >&2; fail 'تست‌های بستهٔ جدید رد شدند؛ به‌روزرسانی انجام نشد.'; }
( cd "$NEW_DIR" && node test/sqlite-kv.test.mjs >>"$TMP_DIR/test.log" 2>&1 ) \
  || { tail -n 25 "$TMP_DIR/test.log" >&2; fail 'تست SQLite رد شد؛ به‌روزرسانی انجام نشد.'; }
say 'همهٔ تست‌ها روی بستهٔ جدید پاس شدند.'

if (( DRY_RUN )); then
  say "حالت --dry-run: بستهٔ ${NEW_VERSION} سالم است، اما هیچ تغییری روی سرور اعمال نشد."
  exit 0
fi

if [[ "$OLD_VERSION" == "$NEW_VERSION" ]]; then
  warn "نسخهٔ فعلی و جدید هر دو ${NEW_VERSION} هستند؛ احتمالاً همان شاخه دوباره دریافت شده است."
fi

if (( ! ASSUME_YES )); then
  [[ -t 0 ]] || fail 'برای اجرای بدون پرسش از --yes استفاده کنید.'
  printf 'اعمال نسخهٔ %s روی %s؟ [y/N]: ' "$NEW_VERSION" "$INSTALL_DIR" >/dev/tty
  IFS= read -r ANSWER </dev/tty || ANSWER=''
  [[ "${ANSWER,,}" == 'y' || "${ANSWER,,}" == 'yes' ]] || { say 'لغو شد.'; exit 0; }
fi

# ---------------------------------------------------------------------------
# Secret پرداخت خودکار شتاب
# ---------------------------------------------------------------------------
# مقدارهای خالی، کوتیشن‌دار یا دارای فاصله هم «خالی» حساب می‌شوند؛ چون در آن حالت
# احراز هویت اپ شکست می‌خورد و ادمین فکر می‌کند پرداخت خودکار خراب است.
current_secret=$(grep -E '^[[:space:]]*(export[[:space:]]+)?SHETAB_API_SECRET=' "$ENV_FILE" 2>/dev/null \
  | tail -n1 | cut -d= -f2- || true)
current_secret="${current_secret%$'\r'}"
current_secret="${current_secret#\"}"; current_secret="${current_secret%\"}"
current_secret="${current_secret#\'}"; current_secret="${current_secret%\'}"
current_secret="$(printf '%s' "$current_secret" | tr -d '[:space:]')"

if [[ ${#current_secret} -lt 32 ]]; then
  SHETAB_NEW_SECRET=''
  if command -v openssl >/dev/null 2>&1; then
    SHETAB_NEW_SECRET=$(openssl rand -hex 32 2>/dev/null || true)
  fi
  if [[ ${#SHETAB_NEW_SECRET} -lt 32 ]] && command -v node >/dev/null 2>&1; then
    SHETAB_NEW_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" 2>/dev/null || true)
  fi
  if [[ ${#SHETAB_NEW_SECRET} -ge 32 ]]; then
    # هر خط قبلی (خالی، کوتیشن‌دار یا تکراری) حذف و یک خط تمیز نوشته می‌شود.
    TMP_ENV=$(mktemp)
    grep -vE '^[[:space:]]*(export[[:space:]]+)?SHETAB_API_SECRET=' "$ENV_FILE" > "$TMP_ENV" 2>/dev/null || true
    printf 'SHETAB_API_SECRET=%s\n' "$SHETAB_NEW_SECRET" >> "$TMP_ENV"
    cat "$TMP_ENV" > "$ENV_FILE"
    rm -f "$TMP_ENV"
    chown root:"$SERVICE_GROUP" "$ENV_FILE" 2>/dev/null || true
    chmod 0640 "$ENV_FILE" 2>/dev/null || true
    say 'Secret پرداخت خودکار (SHETAB_API_SECRET) ساخته شد.'
    printf '         در ربات: تنظیمات → 📲 اتصال اپ شتاب → «📋 کپی Secret»\n'
    printf '         در ترمینال: sudo grep SHETAB_API_SECRET %s\n' "$ENV_FILE"
    unset SHETAB_NEW_SECRET
  else
    warn 'ساخت Secret پرداخت خودکار ناموفق بود (openssl و node در دسترس نبودند).'
    warn "دستی اضافه کنید: SHETAB_API_SECRET=<۶۴ کاراکتر تصادفی> در $ENV_FILE"
  fi
else
  say 'Secret پرداخت خودکار از قبل موجود است.'
fi

# ---------------------------------------------------------------------------
# بکاپ دیتابیس (قبل از هر تغییری)
# ---------------------------------------------------------------------------
say 'ساخت snapshot دیتابیس'
if [[ -f "$INSTALL_DIR/scripts/backup-sqlite.mjs" ]]; then
  if command -v runuser >/dev/null 2>&1 && id -u "$SERVICE_USER" >/dev/null 2>&1; then
    runuser -u "$SERVICE_USER" -- env ENV_FILE="$ENV_FILE" node \
      "$INSTALL_DIR/scripts/backup-sqlite.mjs" \
      || fail 'snapshot دیتابیس ناموفق بود؛ برای جلوگیری از ریسک، به‌روزرسانی متوقف شد.'
  else
    ENV_FILE="$ENV_FILE" node "$INSTALL_DIR/scripts/backup-sqlite.mjs" \
      || fail 'snapshot دیتابیس ناموفق بود؛ به‌روزرسانی متوقف شد.'
  fi
else
  warn 'اسکریپت بکاپ دیتابیس پیدا نشد؛ این مرحله رد شد.'
fi

say 'بکاپ کد فعلی'
mkdir -p "$BACKUP_DIR" 2>/dev/null || true
STAMP=$(date -u +%Y%m%d-%H%M%S)
CODE_BACKUP="$BACKUP_DIR/code-${STAMP}.tar.gz"
if ! tar -czf "$CODE_BACKUP" -C "$INSTALL_DIR" . 2>/dev/null; then
  CODE_BACKUP="/root/tiznetvpn-code-${STAMP}.tar.gz"
  warn "بکاپ در $BACKUP_DIR ساخته نشد؛ در $CODE_BACKUP (فقط root) ذخیره می‌شود."
  tar -czf "$CODE_BACKUP" -C "$INSTALL_DIR" . || fail 'ساخت بکاپ کد ناموفق بود.'
fi
chmod 0600 "$CODE_BACKUP" 2>/dev/null || true

ROLLED_BACK=0
rollback() {
  if (( ROLLED_BACK )); then return 0; fi
  ROLLED_BACK=1
  printf '\n\033[1;31m[update] شکست در میانهٔ کار؛ بازگردانی نسخهٔ قبلی…\033[0m\n' >&2
  set +e
  find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  tar -xzf "$CODE_BACKUP" -C "$INSTALL_DIR"
  chown -R root:"$SERVICE_GROUP" "$INSTALL_DIR" 2>/dev/null
  find "$INSTALL_DIR" -type d -exec chmod 0750 {} \; 2>/dev/null
  find "$INSTALL_DIR" -type f -exec chmod 0640 {} \; 2>/dev/null
  restart_service
  printf '[update] نسخهٔ قبلی بازگردانده شد. بکاپ: %s\n' "$CODE_BACKUP" >&2
}
trap rollback ERR

# ---------------------------------------------------------------------------
# جایگزینی کد در همان مسیر (بدون جابه‌جایی دستی)
# ---------------------------------------------------------------------------
say "جایگزینی فایل‌ها در $INSTALL_DIR"
PRESERVE="$TMP_DIR/preserve"
mkdir -p "$PRESERVE"
for keep in .env data node_modules; do
  [[ -e "$INSTALL_DIR/$keep" ]] && cp -a "$INSTALL_DIR/$keep" "$PRESERVE/" || true
done

find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$NEW_DIR/." "$INSTALL_DIR/"

for keep in .env data node_modules; do
  if [[ -e "$PRESERVE/$keep" && ! -e "$INSTALL_DIR/$keep" ]]; then
    cp -a "$PRESERVE/$keep" "$INSTALL_DIR/"
  fi
done

chown -R root:"$SERVICE_GROUP" "$INSTALL_DIR"
find "$INSTALL_DIR" -type d -exec chmod 0750 {} \;
find "$INSTALL_DIR" -type f -exec chmod 0640 {} \;
chmod 0750 "$INSTALL_DIR/update.sh" "$INSTALL_DIR/install.sh" "$INSTALL_DIR/scripts/check-shetab.sh" "$INSTALL_DIR/scripts/fix-domain.sh" 2>/dev/null || true

# ---------------------------------------------------------------------------
# systemd (فقط اگر واقعاً تغییر کرده باشد)
# ---------------------------------------------------------------------------
if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
  UNIT_CHANGED=0
  CHANGED_TIMERS=''
  while IFS= read -r unit; do
    target="/etc/systemd/system/$(basename "$unit")"
    if ! cmp -s "$unit" "$target"; then
      install -m 0644 "$unit" "$target"
      UNIT_CHANGED=1
      case "$unit" in
        *.timer) CHANGED_TIMERS="$CHANGED_TIMERS $(basename "$unit")" ;;
      esac
    fi
  done < <(find "$INSTALL_DIR/systemd" -maxdepth 1 -type f \( -name '*.service' -o -name '*.timer' \))
  (( UNIT_CHANGED )) && systemctl daemon-reload || true
  # تایمر تازهٔ نگه‌داری پرداخت خودکار: روی نصب‌های قبلی هم فعال شود.
  if [[ -f /etc/systemd/system/tiznetvpn-shetab.timer ]]; then
    if ! systemctl is-enabled tiznetvpn-shetab.timer >/dev/null 2>&1; then
      systemctl enable --now tiznetvpn-shetab.timer >/dev/null 2>&1 \
        && say 'تایمر نگه‌داری پرداخت خودکار فعال شد: tiznetvpn-shetab.timer' \
        || warn 'فعال‌سازی tiznetvpn-shetab.timer ناموفق بود؛ دستی اجرا کنید: sudo systemctl enable --now tiznetvpn-shetab.timer'
    fi
  fi
  # زمان‌بندی تایمر تغییر کرده؟ ری‌استارت تا برنامهٔ جدید فوراً اعمال شود.
  for timer in $CHANGED_TIMERS; do
    if systemctl is-enabled "$timer" >/dev/null 2>&1; then
      systemctl restart "$timer" && say "تایمر به‌روزرسانی شد: $timer" || warn "ری‌استارت $timer ناموفق بود."
    else
      warn "$timer به‌روزرسانی شد ولی غیرفعال است؛ برای فعال‌سازی: sudo systemctl enable --now $timer"
    fi
  done
  restart_service || { rollback; fail 'ری‌استارت سرویس ناموفق بود.'; }
else
  warn 'systemd فعال نیست؛ سرویس را دستی ری‌استارت کنید.'
fi

PORT=$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)
PORT=${PORT:-3000}
say "بررسی سلامت سرویس روی پورت ${PORT}"
if ! wait_health "$PORT"; then
  journalctl -u "$SERVICE" -n 40 --no-pager >&2 2>/dev/null || true
  rollback
  fail 'سرویس پس از به‌روزرسانی سالم نشد؛ نسخهٔ قبلی بازگردانده شد.'
fi

trap - ERR
LIVE_VERSION=$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
if [[ -n "$LIVE_VERSION" && "$LIVE_VERSION" != "$NEW_VERSION" ]]; then
  warn "نسخهٔ گزارش‌شده توسط سرویس (${LIVE_VERSION}) با بستهٔ ${NEW_VERSION} یکی نیست."
fi

# ---------------------------------------------------------------------------
# دامنه و HTTPS — اصلاح خودکار (جای‌نگهدار Nginx، گواهی، env)
# ---------------------------------------------------------------------------
DOMAIN_HINT="$DOMAIN_ARG"
if [[ -z "$DOMAIN_HINT" ]]; then
  DOMAIN_HINT=$(grep -E '^PUBLIC_BASE_URL=' "$ENV_FILE" 2>/dev/null | tail -n1 \
    | sed -E 's#^PUBLIC_BASE_URL=##; s#^"?https?://##; s#[:/].*$##; s#"$##' || true)
fi
if [[ -z "$DOMAIN_HINT" && -f /etc/nginx/sites-available/tiznetvpn ]]; then
  DOMAIN_HINT=$(awk '/^[[:space:]]*server_name/ { gsub(/;/,"",$2); print $2; exit }' /etc/nginx/sites-available/tiznetvpn 2>/dev/null || true)
  [[ "$DOMAIN_HINT" == '__DOMAIN__' ]] && DOMAIN_HINT=''
fi
FIX_DOMAIN_SH="$INSTALL_DIR/scripts/fix-domain.sh"
if [[ ! -f "$FIX_DOMAIN_SH" ]]; then
  warn 'اسکریپت اصلاح دامنه پیدا نشد؛ فقط وضعیت Nginx را گزارش می‌کنم.'
  grep -q '__DOMAIN__' /etc/nginx/sites-available/tiznetvpn 2>/dev/null \
    && warn 'فایل Nginx هنوز __DOMAIN__ دارد؛ دامنه روی این سرور پاسخ نمی‌دهد.'
elif [[ -z "$DOMAIN_HINT" ]]; then
  warn 'دامنه‌ای برای اصلاح پیدا نشد؛ اجرا کنید: sudo bash '"$FIX_DOMAIN_SH"' bot.example.com'
else
  say "اصلاح و بررسی دامنه: ${DOMAIN_HINT}"
  FIX_ARGS=("$DOMAIN_HINT")
  [[ -n "$CERTBOT_EMAIL" ]] && FIX_ARGS+=(--email "$CERTBOT_EMAIL")
  (( DRY_RUN )) && FIX_ARGS+=(--check)
  if bash "$FIX_DOMAIN_SH" "${FIX_ARGS[@]}"; then
    say 'دامنه بررسی شد.'
  else
    warn "اصلاح کامل نشد؛ جزئیات بالا را ببینید. اجرای دوباره: sudo bash ${FIX_DOMAIN_SH} ${DOMAIN_HINT}"
  fi
fi

say "به‌روزرسانی به ${NEW_VERSION} کامل شد."
printf '  نسخهٔ فعال: %s\n' "${LIVE_VERSION:-$NEW_VERSION}"
printf '  بکاپ کد:  %s\n' "$CODE_BACKUP"
printf '  بازگشت:   sudo bash %s/update.sh --rollback\n' "$INSTALL_DIR"
printf '  وضعیت:    sudo systemctl status %s --no-pager\n' "$SERVICE"
if [[ -d /run/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
  list_output=$(systemctl list-timers --all 2>/dev/null | grep -E 'tiznetvpn' || true)
  if [[ -n "$list_output" ]]; then
    printf '\n  تایمرها:\n%s\n' "$list_output"
  fi
fi
printf '\n'
