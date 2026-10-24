#!/usr/bin/env bash
# =============================================================================
# TiznetVPN — بالا آوردن دامنه: DNS، Nginx، HTTPS، env و آزمون واقعی
#
#   sudo bash /opt/tiznetvpn/scripts/fix-domain.sh                      # تشخیص خودکار
#   sudo bash /opt/tiznetvpn/scripts/fix-domain.sh bot.tiznet.site      # دامنهٔ صریح
#   sudo bash /opt/tiznetvpn/scripts/fix-domain.sh --check              # فقط گزارش
#   sudo bash /opt/tiznetvpn/scripts/fix-domain.sh --email me@mail.com  # برای گرفتن گواهی
#
# چه چیزی را درست می‌کند (همهٔ مراحل تکرارشدنی و ایمن‌اند):
#   • جای‌نگهدار __DOMAIN__ در /etc/nginx/sites-available/tiznetvpn
#   • server_name، لینک sites-enabled و پورت proxy_pass (هم‌راستا با PORT در env)
#   • گواهی Let's Encrypt و ریدایرکت HTTPS
#   • PUBLIC_BASE_URL و MINIAPP_URL در /etc/tiznetvpn/tiznetvpn.env
#   • فایروال UFW برای ۸۰/۴۴۳ و ری‌استارت سرویس در صورت نیاز
#   • رکورد A کلادفلر — فقط با --set-dns و توکن API
#   • وبهوک تلگرام — فقط با --set-webhook
#
# گزینه‌ها:
#   --domain NAME    دامنه (پیش‌فرض: از Nginx یا env تشخیص داده می‌شود)
#   --email ADDR     ایمیل Certbot (اگر حساب Let's Encrypt وجود داشته باشد لازم نیست)
#   --set-dns        رکورد A کلادفلر را روی IP همین سرور تنظیم کن
#   --set-webhook    وبهوک تلگرام را به این دامنه منتقل کن (تأیید صریح)
#   --check          فقط گزارش بده؛ هیچ تغییری نده
# =============================================================================
set -Eeuo pipefail

SITE_FILE="${TIZNET_NGINX_SITE:-/etc/nginx/sites-available/tiznetvpn}"
ENV_FILE="${TIZNET_ENV_FILE:-/etc/tiznetvpn/tiznetvpn.env}"
SERVICE="${TIZNET_SERVICE:-tiznetvpn.service}"
INSTALL_DIR="${TIZNET_INSTALL_DIR:-/opt/tiznetvpn}"
NGINX_TEMPLATE="${TIZNET_NGINX_TEMPLATE:-${INSTALL_DIR}/nginx/tiznetvpn.conf}"
NGINX_ENABLED_DIR="${TIZNET_NGINX_ENABLED_DIR:-/etc/nginx/sites-enabled}"
LE_LIVE_DIR="${TIZNET_LE_LIVE:-/etc/letsencrypt/live}"
LE_ACCOUNTS_DIR="${TIZNET_LE_ACCOUNTS:-/etc/letsencrypt/accounts}"

DOMAIN=""
EMAIL=""
CHECK_ONLY=0
SET_DNS=0
SET_WEBHOOK=0
FIXED=0
CHANGED_ENV=0
DNS_OK=0
TLS_OK=0
SERVER_IP=''

ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }
note() { printf '  \033[1;33m•\033[0m %s\n' "$*"; }
done_(){ printf '  \033[1;32m➜\033[0m %s\n' "$*"; FIXED=1; }
say()  { printf '\n\033[1;36m[domain]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[domain] خطا:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  awk 'NR==1 { next }
       /^#/  { sub(/^# ?/, ""); if ($0 !~ /^=+$/) print; next }
       /^$/  { next }
             { exit }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)      [[ $# -ge 2 ]] || fail 'بعد از --domain نام دامنه لازم است.'; DOMAIN="$2"; shift 2 ;;
    --email)       [[ $# -ge 2 ]] || fail 'بعد از --email آدرس ایمیل لازم است.'; EMAIL="$2"; shift 2 ;;
    --set-dns)     SET_DNS=1; shift ;;
    --set-webhook) SET_WEBHOOK=1; shift ;;
    --check)       CHECK_ONLY=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    -*)            fail "گزینهٔ ناشناخته: $1" ;;
    *)             DOMAIN="$1"; shift ;;
  esac
done

env_get() { # env_get KEY
  [[ -f "$ENV_FILE" ]] || return 1
  local line
  line=$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)
  [[ -n "$line" ]] || return 1
  local value=${line#*=}
  value=${value%\"}; value=${value#\"}
  printf '%s' "$value"
}

env_set() { # env_set KEY VALUE
  [[ -f "$ENV_FILE" ]] || return 1
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  KEY="$key" VALUE="$value" awk '
    BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    $0 ~ "^" k "=" { if (!done) { print k "=" v; done = 1 } next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

[[ ${EUID:-$(id -u)} -eq 0 ]] || fail 'این اسکریپت را با sudo اجرا کنید.'

# ---------------------------------------------------------------------------
# ۰) دامنه و پورت
# ---------------------------------------------------------------------------
if [[ -z "$DOMAIN" && -f "$SITE_FILE" ]]; then
  DOMAIN=$(awk '/^[[:space:]]*server_name/ { gsub(/;/,"",$2); print $2; exit }' "$SITE_FILE" 2>/dev/null || true)
  [[ "$DOMAIN" == '__DOMAIN__' ]] && DOMAIN=''
fi
if [[ -z "$DOMAIN" ]]; then
  DOMAIN=$(env_get PUBLIC_BASE_URL | sed -E 's#^[a-zA-Z]+://##; s#[:/].*$##' || true)
fi
if [[ -z "$DOMAIN" ]]; then
  DOMAIN=$(env_get MINIAPP_URL | sed -E 's#^[a-zA-Z]+://##; s#[:/].*$##' || true)
fi
[[ -n "$DOMAIN" ]] || fail 'دامنه را مشخص کنید: sudo bash scripts/fix-domain.sh bot.example.com'
DOMAIN=${DOMAIN,,}
DOMAIN=${DOMAIN#www.}
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]] || fail "نام دامنه معتبر نیست: $DOMAIN"

PORT=$(env_get PORT || true)
PORT=${PORT:-3000}
[[ "$PORT" =~ ^[0-9]+$ ]] || PORT=3000

say "دامنه: ${DOMAIN} • پورت سرویس: ${PORT} • فایل Nginx: ${SITE_FILE}"
(( CHECK_ONLY )) && note 'حالت بررسی: هیچ تغییری اعمال نمی‌شود.'
(( SET_DNS )) && note 'اجازهٔ اصلاح رکورد A کلادفلر داده شده است.'

# ---------------------------------------------------------------------------
# ۱) DNS
# ---------------------------------------------------------------------------
say '۱) DNS'
A_IP=''
if getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
  A_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1 { print $1 }')
  ok "دامنه resolve می‌شود → ${A_IP}"
  DNS_OK=1
else
  bad "دامنه به هیچ IPv4ای resolve نمی‌شود (رکورد A وجود ندارد یا DNS هنوز منتشر نشده)"
fi
AAAA_IP=$(getent ahostsv6 "$DOMAIN" 2>/dev/null | awk '{ print $1 }' | grep -v '^::ffff:' | head -n1 || true)
if [[ -n "$AAAA_IP" ]]; then
  note "رکورد AAAA هم دارد (${AAAA_IP})؛ اگر سرور IPv6 سالم ندارد، آن را حذف کنید تا مرورگر معطل نماند."
fi

for probe in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
  SERVER_IP=$(curl -fsS --max-time 6 "$probe" 2>/dev/null | tr -d '[:space:]' || true)
  [[ "$SERVER_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
  SERVER_IP=''
done
[[ -z "$SERVER_IP" ]] && SERVER_IP=$(getent ahostsv4 "$(hostname -f 2>/dev/null || hostname)" 2>/dev/null | awk 'NR==1 { print $1 }' || true)

CF_RANGE=0
if [[ "$A_IP" =~ ^(103\.21\.244|104\.(1[6-9]|2[0-9]|3[01])\.|108\.162\.|131\.0\.72|141\.101\.|162\.15[89]\.|172\.6[4-9]\.|173\.245\.|188\.114\.|190\.93\.|197\.234\.|198\.41\.) ]]; then
  CF_RANGE=1
fi

if [[ -n "$SERVER_IP" && -n "$A_IP" ]]; then
  if [[ "$SERVER_IP" == "$A_IP" ]]; then
    ok "IP عمومی این سرور همان مقصد DNS است (${SERVER_IP})"
  elif (( CF_RANGE )); then
    ok "دامنه از کلادفلر (${A_IP}) سرو می‌شود؛ IP واقعی سرور ${SERVER_IP} است."
    note 'در کلادفلر حالت SSL را روی Full (strict) بگذارید تا حلقهٔ ریدایرکت پیش نیاید.'
  else
    bad "IP عمومی سرور ${SERVER_IP} است ولی DNS به ${A_IP} می‌رود → ترافیک به این سرور نمی‌رسد"
    if (( SET_DNS )); then
      CF_TOKEN=$(env_get CF_API_TOKEN || true)
      CF_ZONE=$(env_get CF_ZONE_ID || true)
      if [[ -z "$CF_TOKEN" || -z "$CF_ZONE" ]]; then
        bad 'برای اصلاح خودکار DNS، CF_API_TOKEN و CF_ZONE_ID را در env بگذارید (مجوز Zone.DNS Edit).'
      elif (( CHECK_ONLY )); then
        note "با --set-dns رکورد A روی ${SERVER_IP} تنظیم می‌شود."
      else
        REC_NAME="$DOMAIN"
        REC_ID=$(curl -fsS --max-time 15 -H "Authorization: Bearer ${CF_TOKEN}" \
          "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/dns_records?type=A&name=${REC_NAME}" \
          | sed -n 's/.*"id":"\([a-f0-9]\{32\}\)".*/\1/p' | head -n1 || true)
        if [[ -n "$REC_ID" ]]; then
          RESP=$(curl -fsS --max-time 15 -X PUT -H "Authorization: Bearer ${CF_TOKEN}" -H 'Content-Type: application/json' \
            "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/dns_records/${REC_ID}" \
            --data "{\"type\":\"A\",\"name\":\"${REC_NAME}\",\"content\":\"${SERVER_IP}\",\"ttl\":1,\"proxied\":false}" || true)
        else
          RESP=$(curl -fsS --max-time 15 -X POST -H "Authorization: Bearer ${CF_TOKEN}" -H 'Content-Type: application/json' \
            "https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/dns_records" \
            --data "{\"type\":\"A\",\"name\":\"${REC_NAME}\",\"content\":\"${SERVER_IP}\",\"ttl\":1,\"proxied\":false}" || true)
        fi
        if grep -q '"success":true' <<<"$RESP"; then
          done_ "رکورد A روی ${SERVER_IP} تنظیم شد (انتشار تا چند دقیقه)"
        else
          bad 'اصلاح DNS ناموفق بود؛ پاسخ کلادفلر را بررسی کنید (توکن/Zone ID/مجوز).'
        fi
      fi
    else
      note "برای اصلاح خودکار: sudo bash scripts/fix-domain.sh ${DOMAIN} --set-dns  (نیازمند CF_API_TOKEN و CF_ZONE_ID)"
    fi
  fi
fi
if [[ "$DNS_OK" -eq 1 ]]; then
  if [[ -z "$SERVER_IP" ]]; then
    note 'IP عمومی این سرور مشخص نشد؛ فرض می‌کنیم DNS درست است.'
  elif [[ "$A_IP" != "$SERVER_IP" && $CF_RANGE -eq 0 ]]; then
    DNS_OK=0
  fi
fi

# ---------------------------------------------------------------------------
# ۲) پورت‌ها و فایروال
# ---------------------------------------------------------------------------
say '۲) پورت‌ها و فایروال'
for p in 80 443; do
  if ss -ltn 2>/dev/null | awk '{ print $4 }' | grep -qE "[:.]${p}$"; then
    ok "پورت ${p} گوش‌دهنده است"
  else
    bad "پورت ${p} گوش نمی‌دهد (Nginx بالا نیست یا پورت اشغال/بسته است)"
  fi
done
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  for p in 80 443; do
    if ufw status 2>/dev/null | grep -qE "^${p}(/tcp)?[[:space:]]+ALLOW"; then
      ok "UFW پورت ${p} را باز گذاشته است"
    elif (( CHECK_ONLY )); then
      bad "UFW پورت ${p} را باز نکرده است"
    else
      ufw allow "${p}/tcp" >/dev/null 2>&1 && done_ "UFW برای پورت ${p} باز شد" || bad "باز کردن پورت ${p} در UFW ناموفق بود"
    fi
  done
else
  note 'UFW فعال نیست؛ اگر فایروال ارائه‌دهنده یا فایروال دیگری دارید، ۸۰ و ۴۴۳ را باز کنید.'
fi
if command -v iptables >/dev/null 2>&1 && iptables -S 2>/dev/null | grep -qE '^\-A INPUT .*DROP|^\-P INPUT DROP'; then
  note 'قواعد iptables سخت‌گیرانه‌ای دیدم؛ مطمئن شوید ۸۰ و ۴۴۳ در INPUT باز هستند.'
fi

# ---------------------------------------------------------------------------
# ۳) Nginx
# ---------------------------------------------------------------------------
say '۳) Nginx'
command -v nginx >/dev/null 2>&1 || fail 'Nginx نصب نیست. این اسکریپت عمداً install.sh را اجرا نمی‌کند؛ ابتدا Nginx را نصب کنید: apt-get install -y nginx'
if systemctl is-active --quiet nginx 2>/dev/null; then
  ok 'سرویس nginx فعال است'
elif (( CHECK_ONLY )); then
  bad 'سرویس nginx فعال نیست'
else
  systemctl enable --now nginx >/dev/null 2>&1 && done_ 'سرویس nginx فعال شد' || bad 'فعال‌سازی nginx ناموفق بود'
fi

if [[ ! -f "$SITE_FILE" ]]; then
  if [[ -f "$NGINX_TEMPLATE" && $CHECK_ONLY -eq 0 ]]; then
    sed "s/__DOMAIN__/${DOMAIN}/g" "$NGINX_TEMPLATE" > "$SITE_FILE"
    done_ "فایل سایت از قالب پروژه ساخته شد: ${SITE_FILE}"
  else
    bad "فایل ${SITE_FILE} وجود ندارد و قالبی برای ساختنش پیدا نشد (${NGINX_TEMPLATE})"
  fi
fi

if [[ -f "$SITE_FILE" ]]; then
  if grep -q '__DOMAIN__' "$SITE_FILE"; then
    if (( CHECK_ONLY )); then
      bad 'فایل Nginx هنوز __DOMAIN__ دارد → هیچ درخواستی به این دامنه جواب نمی‌گیرد'
    else
      cp -a "$SITE_FILE" "${SITE_FILE}.bak.$(date +%Y%m%d%H%M%S)"
      sed -i "s/__DOMAIN__/${DOMAIN}/g" "$SITE_FILE"
      done_ "جای‌نگهدار __DOMAIN__ با ${DOMAIN} جایگزین شد"
    fi
  fi

  SRV_NAMES=$(awk '/^[[:space:]]*server_name/ { gsub(/;/,""); for (i=2;i<=NF;i++) print $i }' "$SITE_FILE" 2>/dev/null || true)
  if grep -qxF "$DOMAIN" <<<"$SRV_NAMES"; then
    ok "server_name شامل ${DOMAIN} است"
  elif (( CHECK_ONLY )); then
    bad "server_name روی ${DOMAIN} نیست (مقدار فعلی: ${SRV_NAMES//$'\n'/ })"
  else
    cp -a "$SITE_FILE" "${SITE_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    if [[ -n "$SRV_NAMES" ]]; then
      sed -i -E "0,/^[[:space:]]*server_name[^;]*;/s//    server_name ${DOMAIN};/" "$SITE_FILE"
    else
      sed -i -E "0,/listen[[:space:]]+80[^;]*;/s//&\n    server_name ${DOMAIN};/" "$SITE_FILE"
    fi
    done_ "server_name روی ${DOMAIN} تنظیم شد"
  fi

  # همهٔ locationها (شامل /healthz که مسیر پس از پورت دارد) باید به پورت سرویس بروند.
  if ! grep -qE 'proxy_pass http://127\.0\.0\.1:[0-9]+' "$SITE_FILE"; then
    bad 'در فایل Nginx هیچ proxy_pass محلی پیدا نشد'
  elif ! grep -qE "proxy_pass http://127\.0\.0\.1:${PORT}([^0-9]|$)" "$SITE_FILE"; then
    if (( CHECK_ONLY )); then
      bad "proxy_pass به پورت ${PORT} نیست ولی سرویس روی ${PORT} است"
    else
      cp -a "$SITE_FILE" "${SITE_FILE}.bak.$(date +%Y%m%d%H%M%S)"
      sed -i -E "s#proxy_pass http://127\.0\.0\.1:[0-9]+([^;]*);#proxy_pass http://127.0.0.1:${PORT}\1;#g" "$SITE_FILE"
      done_ "proxy_pass روی پورت ${PORT} تنظیم شد (همهٔ locationها)"
    fi
  else
    ok "proxy_pass به پورت ${PORT} اشاره می‌کند"
  fi

  grep -q 'X-Forwarded-Proto' "$SITE_FILE" || note 'هدر X-Forwarded-Proto در Nginx نیست (برای تشخیص https در اپ لازم است).'
  grep -qE 'client_max_body_size[[:space:]]+[0-9]+[mM]' "$SITE_FILE" || note 'client_max_body_size تنظیم نشده؛ آپلود رسید بزرگ ممکن است ۴۱۳ بگیرد.'
  grep -qE 'location[[:space:]]+/?setup|location[[:space:]]+/?diag' "$SITE_FILE" && note 'مسیرهای /setup و /diag در Nginx بسته شده‌اند (طبق طراحی).'

  if [[ -e ${NGINX_ENABLED_DIR}/tiznetvpn ]]; then
    TARGET=$(readlink -f ${NGINX_ENABLED_DIR}/tiznetvpn)
    if [[ "$TARGET" == "$(readlink -f "$SITE_FILE")" ]]; then
      ok 'لینک sites-enabled درست است'
    elif (( CHECK_ONLY )); then
      bad "sites-enabled به ${TARGET} اشاره می‌کند، نه ${SITE_FILE}"
    else
      ln -sfn "$SITE_FILE" ${NGINX_ENABLED_DIR}/tiznetvpn
      done_ 'لینک sites-enabled اصلاح شد'
    fi
  elif (( CHECK_ONLY )); then
    bad 'سایت در sites-enabled فعال نشده است'
  else
    ln -sfn "$SITE_FILE" ${NGINX_ENABLED_DIR}/tiznetvpn
    done_ 'سایت در sites-enabled فعال شد'
  fi
fi

if (( CHECK_ONLY )); then
  nginx -t >/dev/null 2>&1 && ok 'پیکربندی Nginx از نظر syntax سالم است' || bad 'پیکربندی Nginx خطای syntax دارد (nginx -t)'
else
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 && ok 'Nginx reload شد' || bad 'reload Nginx ناموفق بود'
  else
    nginx -t || true
    fail 'پیکربندی Nginx خطا دارد؛ آخرین فایل .bak را برگردانید و دوباره اجرا کنید.'
  fi
fi

# ---------------------------------------------------------------------------
# ۴) گواهی HTTPS
# ---------------------------------------------------------------------------
say '۴) گواهی HTTPS'
LIVE_DIR="${LE_LIVE_DIR}/${DOMAIN}"
if [[ -f "${LIVE_DIR}/fullchain.pem" ]]; then
  if openssl x509 -checkhost "$DOMAIN" -noout -in "${LIVE_DIR}/fullchain.pem" >/dev/null 2>&1; then
    TLS_OK=1
    EXP_RAW=$(openssl x509 -enddate -noout -in "${LIVE_DIR}/fullchain.pem" 2>/dev/null | cut -d= -f2 || true)
    EXP_TS=$(date -d "$EXP_RAW" +%s 2>/dev/null || echo 0)
    DAYS=$(( (EXP_TS - $(date +%s)) / 86400 ))
    if (( DAYS < 0 )); then
      bad "گواهی منقضی شده است (${EXP_RAW})"
      TLS_OK=0
    elif (( DAYS < 14 )); then
      note "گواهی تا ${DAYS} روز دیگر منقضی می‌شود (${EXP_RAW})"
    else
      ok "گواهی معتبر برای ${DOMAIN} (${DAYS} روز باقی‌مانده)"
    fi
  else
    bad "گواهی موجود برای ${DOMAIN} صادر نشده است"
  fi
else
  bad "گواهی Let's Encrypt برای ${DOMAIN} وجود ندارد → https بالا نمی‌آید"
fi

HAS_443=0
if command -v nginx >/dev/null 2>&1 && nginx -T 2>/dev/null | grep -qE 'listen[[:space:]]+(\[::\]:)?443'; then
  HAS_443=1
fi
if (( TLS_OK == 1 && HAS_443 == 0 )); then
  bad 'گواهی هست ولی Nginx هیچ بلوک ۴۴۳ ندارد → https پاسخ نمی‌دهد'
  if (( CHECK_ONLY == 0 )); then
    if command -v certbot >/dev/null 2>&1; then
      if certbot --nginx -d "$DOMAIN" --redirect --non-interactive --expand; then
        done_ 'بلوک ۴۴۳ ساخته و ریدایرکت فعال شد'
        systemctl reload nginx >/dev/null 2>&1 || true
        HAS_443=1
      else
        bad 'certbot نتوانست بلوک ۴۴۳ را نصب کند'
      fi
    else
      bad 'certbot نصب نیست؛ apt-get install -y certbot python3-certbot-nginx'
    fi
  fi
fi

if (( TLS_OK == 0 )); then
  if (( CHECK_ONLY )); then
    note 'بدون --check، درخواست گواهی به‌صورت خودکار انجام می‌شود.'
  elif [[ "$DNS_OK" -ne 1 ]]; then
    bad 'تا وقتی DNS به این سرور نرسد، Certbot نمی‌تواند گواهی بگیرد (چالش HTTP-01).'
  else
    if ! command -v certbot >/dev/null 2>&1; then
      note 'نصب certbot...'
      apt-get update -y >/dev/null 2>&1 || true
      apt-get install -y certbot python3-certbot-nginx || fail 'نصب certbot ناموفق بود'
    elif ! certbot plugins --non-interactive 2>/dev/null | grep -qi nginx; then
      note 'نصب افزونهٔ Nginx برای certbot...'
      apt-get install -y python3-certbot-nginx >/dev/null 2>&1 || true
    fi
    CB_ARGS=(--nginx -d "$DOMAIN" --agree-tos --redirect --non-interactive)
    if [[ -n "$EMAIL" ]]; then
      CB_ARGS+=(--email "$EMAIL")
    elif [[ -z "$(ls -A ${LE_ACCOUNTS_DIR} 2>/dev/null || true)" ]]; then
      EMAIL=$(env_get CERTBOT_EMAIL || true)
      [[ -n "$EMAIL" ]] && CB_ARGS+=(--email "$EMAIL")
    fi
    if [[ ! " ${CB_ARGS[*]} " =~ ' --email ' ]]; then
      CB_ARGS+=(--register-unsafely-without-email)
      note 'ایمیل ثبت نشد؛ گواهی بدون ایمیل هشدار گرفته می‌شود (برای اطلاع از انقضا، --email بدهید).'
    fi
    # سقف نرخ Let's Encrypt: تلاش ناموفق پشت‌سرهم، دامنه را یک ساعت قفل می‌کند.
    STAMP_DIR="${TIZNET_STATE_DIR:-/var/lib/tiznetvpn}"
    STAMP="${STAMP_DIR}/last-certbot-attempt"
    NOW=$(date +%s)
    LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
    [[ "$LAST" =~ ^[0-9]+$ ]] || LAST=0
    if (( NOW - LAST < 600 )); then
      note "آخرین تلاش Certbot $(( (NOW - LAST) / 60 )) دقیقه پیش بود؛ برای جلوگیری از محدودیت Let's Encrypt چند دقیقه صبر کنید."
    else
      mkdir -p "$STAMP_DIR" 2>/dev/null || true
      date +%s > "$STAMP" 2>/dev/null || true
      if certbot "${CB_ARGS[@]}"; then
        TLS_OK=1
        done_ 'گواهی نصب و ریدایرکت HTTPS فعال شد'
      else
        bad 'Certbot ناموفق بود — معمولاً یعنی DNS یا پورت ۸۰ هنوز به این سرور نمی‌رسد.'
        note "برای آزمون دستی: curl -v http://${DOMAIN}/.well-known/acme-challenge/test"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# ۵) env و سرویس
# ---------------------------------------------------------------------------
say '۵) تنظیمات و سرویس'
if [[ -f "$ENV_FILE" ]]; then
  WANT_BASE="https://${DOMAIN}"
  WANT_MINI="https://${DOMAIN}/miniapp"
  CUR_BASE=$(env_get PUBLIC_BASE_URL || true)
  CUR_MINI=$(env_get MINIAPP_URL || true)
  if [[ "$CUR_BASE" == "$WANT_BASE" && "$CUR_MINI" == "$WANT_MINI" ]]; then
    ok 'PUBLIC_BASE_URL و MINIAPP_URL درست‌اند'
  elif (( CHECK_ONLY )); then
    bad "env قدیمی است: PUBLIC_BASE_URL=${CUR_BASE:-—} • MINIAPP_URL=${CUR_MINI:-—}"
  else
    cp -a "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
    [[ "$CUR_BASE" == "$WANT_BASE" ]] || env_set PUBLIC_BASE_URL "$WANT_BASE"
    [[ "$CUR_MINI" == "$WANT_MINI" ]] || env_set MINIAPP_URL "$WANT_MINI"
    CHANGED_ENV=1
    done_ "PUBLIC_BASE_URL=${WANT_BASE} و MINIAPP_URL=${WANT_MINI} تنظیم شد"
  fi
  WEBHOOK_SECRET=$(env_get WEBHOOK_SECRET || true)
  [[ -n "$WEBHOOK_SECRET" ]] && ok 'WEBHOOK_SECRET موجود است' || bad 'WEBHOOK_SECRET در env نیست؛ وبهوک تلگرام ۴۰۳ می‌گیرد'
else
  bad "${ENV_FILE} پیدا نشد (نصب ناقص است)"
fi

if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  ok "سرویس ${SERVICE} فعال است"
else
  bad "سرویس ${SERVICE} فعال نیست"
  if (( CHECK_ONLY == 0 )); then
    systemctl restart "$SERVICE" >/dev/null 2>&1 && done_ 'سرویس ری‌استارت شد' || bad "ری‌استارت ${SERVICE} ناموفق بود (journalctl -u ${SERVICE} -n 50)"
  fi
fi
if (( CHECK_ONLY == 0 && CHANGED_ENV == 1 )); then
  systemctl try-restart "$SERVICE" >/dev/null 2>&1 || true
  ok 'سرویس برای خواندن env تازه ری‌استارت شد'
fi

# ---------------------------------------------------------------------------
# ۶) آزمون واقعی
# ---------------------------------------------------------------------------
say '۶) آزمون واقعی'
pass=0; total=0
check_url() { # check_url URL LABEL [ALLOW...]
  local url="$1" label="$2"; shift 2
  local allow=("$@") code
  [[ ${#allow[@]} -eq 0 ]] && allow=(200)
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" 2>/dev/null) || true
  [[ "$code" =~ ^[0-9]{3}$ ]] || code='000'
  total=$((total+1))
  if [[ " ${allow[*]} " == *" ${code} "* ]]; then
    pass=$((pass+1)); ok "${label}: ${url} → ${code}"
  else
    bad "${label}: ${url} → ${code}"
  fi
}
check_url "http://127.0.0.1:${PORT}/healthz" 'سلامت محلی'
check_url "https://${DOMAIN}/healthz" 'سلامت دامنه (https)'
check_url "https://${DOMAIN}/miniapp" 'مینی‌اپ'
check_url "https://${DOMAIN}/app" 'نسخهٔ وب'
check_url "http://${DOMAIN}/healthz" 'ریدایرکت HTTP → HTTPS' 301 302 308

LIVE_VERSION=$(curl -fsS --max-time 10 "http://127.0.0.1:${PORT}/healthz" 2>/dev/null \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
[[ -n "$LIVE_VERSION" ]] && ok "نسخهٔ فعال سرویس: ${LIVE_VERSION}"

# وبهوک تلگرام
if [[ -f "$ENV_FILE" ]]; then
  BOT_TOKEN=$(env_get BOT_TOKEN || true)
  if [[ -n "$BOT_TOKEN" ]]; then
    WH=$(curl -fsS --max-time 15 "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" 2>/dev/null || true)
    if [[ -n "$WH" ]]; then
      WH_URL=$(sed -n 's/.*"url":"\([^"]*\)".*/\1/p' <<<"$WH" | head -n1)
      if [[ -z "$WH_URL" ]]; then
        bad 'وبهوک تلگرام تنظیم نشده است'
        note "تنظیم: sudo -u tiznetvpn env ENV_FILE=${ENV_FILE} node ${INSTALL_DIR}/scripts/setup-webhook.mjs --confirm-switch"
      elif [[ "$WH_URL" == "https://${DOMAIN}/webhook" ]]; then
        ok "وبهوک تلگرام روی ${WH_URL} است"
      else
        bad "وبهوک تلگرام روی ${WH_URL} است، نه https://${DOMAIN}/webhook"
        if (( SET_WEBHOOK )); then
          if [[ $CHECK_ONLY -eq 0 ]]; then
            if ( cd "$INSTALL_DIR" && ENV_FILE="$ENV_FILE" node scripts/setup-webhook.mjs --confirm-switch ); then
              done_ 'وبهوک به این دامنه منتقل شد'
            else
              bad 'انتقال وبهوک ناموفق بود (log بالا را ببینید)'
            fi
          fi
        else
          note "برای انتقال: sudo bash scripts/fix-domain.sh ${DOMAIN} --set-webhook"
        fi
      fi
    else
      note 'getWebhookInfo پاسخ نداد (دسترسی سرور به api.telegram.org را بررسی کنید)'
    fi
  fi
fi

# ---------------------------------------------------------------------------
# خلاصه
# ---------------------------------------------------------------------------
say 'خلاصه'
printf '  آزمون‌های زنده: %s از %s موفق\n' "$pass" "$total"
if (( CHECK_ONLY )); then
  note "برای اصلاح: sudo bash ${INSTALL_DIR}/scripts/fix-domain.sh ${DOMAIN}"
elif (( pass == total )); then
  ok "https://${DOMAIN} بالا است."
else
  note 'موارد ✗ بالا را به ترتیب رفع کنید؛ بعد دوباره همین اسکریپت را اجرا کنید.'
fi
cat <<EOF

اگر با این حال از بیرون باز نشد:
  • DNS:      dig +short ${DOMAIN}     باید IP عمومی همین سرور باشد
  • از داخل:  curl -vk https://${DOMAIN}/healthz
  • کلادفلر:  حالت SSL را Full (strict) بگذارید و پراکسی را برای این رکورد فعال/غیرفعال امتحان کنید
  • لاگ‌ها:   journalctl -u ${SERVICE} -n 50 --no-pager
              tail -n 50 /var/log/nginx/error.log
EOF
