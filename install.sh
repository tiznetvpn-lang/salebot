#!/usr/bin/env bash
# Interactive one-command installer for TiznetVPN on Ubuntu 26.
# This script asks for explicit confirmation before changing Telegram's webhook.
set -Eeuo pipefail
umask 077

DOMAIN='bot.tiznet.site'
REPO=''
SOURCE_DIR=''
TOKEN_FILE=''
BRANCH='main'
INSTALL_DIR='/opt/tiznetvpn'
ENV_FILE='/etc/tiznetvpn/tiznetvpn.env'

fail() { printf '\n[ERROR] %s\n' "$*" >&2; exit 1; }
info() { printf '\n[INSTALL] %s\n' "$*"; }

usage() {
  cat <<'USAGE'
Usage:
  sudo bash install.sh --repo OWNER/REPO [--branch main] [--domain bot.tiznet.site]
  sudo bash install.sh --source-dir /path/to/project [--domain bot.tiznet.site]

Public GitHub example:
  sudo bash install.sh --repo myaccount/tiznetvpn --domain bot.tiznet.site
Private GitHub example (read-only token in a root-only file):
  printf 'GITHUB_TOKEN=%s\n' 'ghp_xxx' | sudo tee /root/.github-read >/dev/null && sudo chmod 600 /root/.github-read
  sudo bash install.sh --repo myaccount/tiznetvpn --token-file /root/.github-read --domain bot.tiznet.site
Local ZIP/private-repository example:
  sudo bash install.sh --source-dir /tmp/tiznetvpn --domain bot.tiznet.site

This installer is interactive. Enter the Telegram bot token only at the hidden SSH prompt.
USAGE
}

while (($#)); do
  case "$1" in
    --repo) [[ $# -ge 2 ]] || fail 'Missing OWNER/REPO after --repo.'; REPO=$2; shift 2 ;;
    --source-dir) [[ $# -ge 2 ]] || fail 'Missing project path after --source-dir.'; SOURCE_DIR=$2; shift 2 ;;
    --token-file) [[ $# -ge 2 ]] || fail 'Missing path after --token-file.'; TOKEN_FILE=$2; shift 2 ;;
    --branch) [[ $# -ge 2 ]] || fail 'Missing branch name after --branch.'; BRANCH=$2; shift 2 ;;
    --domain) [[ $# -ge 2 ]] || fail 'Missing domain name after --domain.'; DOMAIN=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "Unknown option: $1" ;;
  esac
done

[[ "$EUID" -eq 0 ]] || fail 'Run this installer with sudo; see INSTALL_FA.md for the exact command.'
if [[ -n "$SOURCE_DIR" ]]; then
  [[ -d "$SOURCE_DIR" ]] || fail 'The --source-dir directory does not exist.'
  [[ -f "$SOURCE_DIR/src/worker.js" && -f "$SOURCE_DIR/server/server.mjs" && -f "$SOURCE_DIR/package.json" ]] \
    || fail 'The --source-dir directory must contain the project files at its root.'
  [[ -z "$REPO" ]] || fail 'Use either --repo or --source-dir, not both.'
else
  [[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'For GitHub install, set a public repository as OWNER/REPO.'
  [[ "$BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ && "$BRANCH" != *'..'* ]] || fail 'Invalid branch name.'
fi
[[ "$DOMAIN" =~ ^([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$ ]] || fail 'Invalid domain name.'
DOMAIN=${DOMAIN,,}

[[ -r /dev/tty ]] || fail 'Run this installer interactively in an SSH terminal (a TTY is required).'

GITHUB_TOKEN_VALUE=''
if [[ -n "$TOKEN_FILE" ]]; then
  [[ -r "$TOKEN_FILE" ]] || fail "Token file is not readable: $TOKEN_FILE"
  GITHUB_TOKEN_VALUE=$(grep -E '^GITHUB_TOKEN=' "$TOKEN_FILE" 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  [[ -n "$GITHUB_TOKEN_VALUE" ]] || GITHUB_TOKEN_VALUE=$(head -n1 "$TOKEN_FILE" | tr -d '\r\n')
  GITHUB_TOKEN_VALUE=${GITHUB_TOKEN_VALUE#\"}; GITHUB_TOKEN_VALUE=${GITHUB_TOKEN_VALUE%\"}
  GITHUB_TOKEN_VALUE=${GITHUB_TOKEN_VALUE#\'}; GITHUB_TOKEN_VALUE=${GITHUB_TOKEN_VALUE%\'}
  [[ -n "$GITHUB_TOKEN_VALUE" ]] || fail "No token found in $TOKEN_FILE"
fi

if [[ -e "$INSTALL_DIR" && -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  fail "$INSTALL_DIR already exists and is not empty. Installation stopped to protect existing files."
fi
[[ ! -e "$ENV_FILE" ]] || fail "$ENV_FILE already exists. The installer will not overwrite existing secrets."
[[ ! -e /etc/nginx/sites-available/tiznetvpn ]] || fail 'An Nginx site named tiznetvpn already exists; inspect the previous installation first.'

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == 'ubuntu' ]] || fail 'This installer is intended for Ubuntu.'
  if [[ "${VERSION_ID:-}" != 26* ]]; then
    printf '[WARNING] Detected Ubuntu %s; this package is prepared for Ubuntu 26.\n' "${VERSION_ID:-unknown}"
  fi
fi

command -v getent >/dev/null 2>&1 || fail 'The getent command is missing.'
getent ahostsv4 "$DOMAIN" >/dev/null 2>&1 || fail "DNS for $DOMAIN has no IPv4 answer yet. Configure its A record first."

read_line() {
  local prompt_text=$1 variable_name=$2
  IFS= read -r -p "$prompt_text" "$variable_name" </dev/tty || fail 'Could not read input from the terminal.'
}
read_secret() {
  local prompt_text=$1 variable_name=$2
  IFS= read -r -s -p "$prompt_text" "$variable_name" </dev/tty || fail 'Could not read input from the terminal.'
  printf '\n' >/dev/tty
}

printf '\nThis installer will set up https://%s\n' "$DOMAIN"
if [[ -n "$SOURCE_DIR" ]]; then
  printf 'Project source: local directory %s\n' "$SOURCE_DIR"
else
  if [[ -n "$GITHUB_TOKEN_VALUE" ]]; then
    printf 'Project source: private GitHub repository %s (branch %s, token from %s)\n' "$REPO" "$BRANCH" "$TOKEN_FILE"
  else
    printf 'Project source: public GitHub repository https://github.com/%s (branch %s)\n' "$REPO" "$BRANCH"
  fi
fi
printf 'Never put a password, token, or secret in a command, GitHub URL, or chat.\n'

STORE_MODE='empty'
read_line 'Use a fresh empty store database, or import previous KV data? [empty/migrate, default empty]: ' STORE_MODE
STORE_MODE=${STORE_MODE:-empty}
case "${STORE_MODE,,}" in
  empty|new)
    STORE_MODE='empty'
    printf '\nWARNING: An empty database will not import customers, orders, wallet balances, sales history, store settings, or saved Hiddify panel credentials. Existing Hiddify subscriptions are not deleted, but will not appear in this new Mini App until configured again.\n'
    EMPTY_ACK=''
    read_line 'Type YES to continue with an empty database (or press Ctrl+C to cancel): ' EMPTY_ACK
    [[ "${EMPTY_ACK^^}" == 'YES' ]] || fail 'Empty-database confirmation was not accepted. Installation cancelled.'
    ;;
  migrate)
    BACKUP_ACK=''
    read_line 'If you have not downloaded a KV backup from the old admin Mini App, press Ctrl+C. Type YES only if you have the backup: ' BACKUP_ACK
    [[ "${BACKUP_ACK^^}" == 'YES' ]] || fail 'A KV backup is required before migration. Installation cancelled.'
    ;;
  *) fail 'Choose either empty or migrate.' ;;
esac

EMAIL=''
read_line 'Email address for the HTTPS certificate: ' EMAIL
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail 'Invalid email address.'

BOT_TOKEN=''
read_secret 'Telegram BotFather token (hidden input): ' BOT_TOKEN
[[ "$BOT_TOKEN" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{20,}$ ]] || fail 'The BotFather token format looks invalid; check it with @BotFather.'

ADMIN_IDS=''
read_line 'Numeric Telegram admin ID(s), separated by commas: ' ADMIN_IDS
[[ "$ADMIN_IDS" =~ ^[0-9]{1,20}(,[0-9]{1,20})*$ ]] || fail 'ADMIN_IDS must contain numeric IDs separated by commas, with no spaces.'

info 'Installing system packages, Node.js 24 LTS, Nginx, Certbot, and Git'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git nginx certbot python3-certbot-nginx ufw openssl unzip

node_ok=0
if command -v node >/dev/null 2>&1; then
  current_node=$(node -p 'process.versions.node' 2>/dev/null || true)
  if [[ -n "$current_node" ]] && [[ "$(printf '%s\n' '24.15.0' "$current_node" | sort -V | head -n1)" == '24.15.0' ]]; then
    if node -e "const s=require('node:sqlite'); process.exit(s.DatabaseSync||s.Database ? 0 : 1)" >/dev/null 2>&1; then node_ok=1; fi
  fi
fi

if [[ "$node_ok" -ne 1 ]]; then
  info 'Installing Node.js 24.x from NodeSource'
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod a+r /etc/apt/keyrings/nodesource.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main\n' "$(dpkg --print-architecture)" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi
node -e "const s=require('node:sqlite'); if(!(s.DatabaseSync||s.Database)) process.exit(1); console.log('Node.js '+process.versions.node+' / SQLite OK')"

if ! id -u tiznetvpn >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$INSTALL_DIR" --no-create-home --shell /usr/sbin/nologin tiznetvpn
fi
install -d -o root -g tiznetvpn -m 0750 "$INSTALL_DIR"
install -d -o root -g tiznetvpn -m 0750 /etc/tiznetvpn
install -d -o tiznetvpn -g tiznetvpn -m 0750 /var/lib/tiznetvpn /var/backups/tiznetvpn

if [[ -n "$SOURCE_DIR" ]]; then
  info "Copying project files from $SOURCE_DIR"
  cp -a "$SOURCE_DIR"/. "$INSTALL_DIR"/
elif [[ -n "$GITHUB_TOKEN_VALUE" ]]; then
  info "Downloading GitHub repository $REPO (private, branch $BRANCH)"
  TMP_RELEASE=$(mktemp -d /tmp/tiznetvpn-release.XXXXXX)
  curl -fsSL --retry 2 --connect-timeout 15 --max-time 300 \
    -H "Authorization: Bearer ${GITHUB_TOKEN_VALUE}" -H 'Accept: application/vnd.github+json' \
    -o "$TMP_RELEASE/release.tar.gz" \
    "https://api.github.com/repos/${REPO}/tarball/${BRANCH}" \
    || fail 'Downloading the private repository failed; check the token and repo name.'
  tar -xzf "$TMP_RELEASE/release.tar.gz" -C "$INSTALL_DIR" --strip-components=1 \
    || fail 'Extracting the downloaded repository failed.'
  rm -rf "$TMP_RELEASE"
  unset GITHUB_TOKEN_VALUE
else
  info "Cloning GitHub repository $REPO"
  git clone --depth 1 --branch "$BRANCH" "https://github.com/${REPO}.git" "$INSTALL_DIR"
fi
[[ -f "$INSTALL_DIR/src/worker.js" && -f "$INSTALL_DIR/server/server.mjs" && -f "$INSTALL_DIR/package.json" ]] \
  || fail 'Unexpected project layout; the project files must be in the repository root.'

chown -R root:tiznetvpn "$INSTALL_DIR"
find "$INSTALL_DIR" -type d -exec chmod 0750 {} \;
find "$INSTALL_DIR" -type f -exec chmod 0640 {} \;

WEBHOOK_SECRET=$(openssl rand -hex 32)
# Secret اتصال اپ Shetab Verification؛ اپ همین مقدار را در فیلد API Secret می‌گذارد.
SHETAB_API_SECRET=$(openssl rand -hex 32)
{
  printf 'BOT_TOKEN=%s\n' "$BOT_TOKEN"
  printf 'WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET"
  printf 'ADMIN_IDS=%s\n' "$ADMIN_IDS"
  printf 'PUBLIC_BASE_URL=https://%s\n' "$DOMAIN"
  printf 'MINIAPP_URL=https://%s/miniapp\n' "$DOMAIN"
  printf 'HOST=127.0.0.1\nPORT=3000\nDATA_DIR=/var/lib/tiznetvpn\nMAX_REQUEST_BYTES=57671680\n'
  printf 'MINIAPP_ONLY_MODE=true\nSHETAB_API_SECRET=%s\n' "$SHETAB_API_SECRET"
  printf 'DB_BACKUP_DIR=/var/backups/tiznetvpn\nDB_BACKUP_RETENTION_DAYS=14\n'
} > "$ENV_FILE"
chown root:tiznetvpn "$ENV_FILE"
chmod 0640 "$ENV_FILE"
unset BOT_TOKEN WEBHOOK_SECRET ADMIN_IDS SHETAB_API_SECRET

info 'Running project tests'
runuser -u tiznetvpn -- env HOME=/tmp npm --prefix "$INSTALL_DIR" test

info 'Installing systemd services and Nginx configuration'
cp "$INSTALL_DIR"/systemd/*.service /etc/systemd/system/
cp "$INSTALL_DIR"/systemd/*.timer /etc/systemd/system/
sed "s/__DOMAIN__/${DOMAIN}/g" "$INSTALL_DIR/nginx/tiznetvpn.conf" > /etc/nginx/sites-available/tiznetvpn
grep -q "server_name ${DOMAIN};" /etc/nginx/sites-available/tiznetvpn \
  || fail "Domain substitution failed: ${DOMAIN} is not the Nginx server_name."
ln -sfn /etc/nginx/sites-available/tiznetvpn /etc/nginx/sites-enabled/tiznetvpn

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q 'Status: active'; then
  ufw allow 'Nginx Full'
else
  printf '[NOTE] UFW is not active. Allow ports 80 and 443 in your VPS provider firewall.\n'
fi

systemctl daemon-reload
nginx -t
systemctl enable --now nginx.service
systemctl enable --now tiznetvpn.service
curl -fsS --max-time 15 http://127.0.0.1:3000/healthz >/dev/null

info 'Requesting HTTPS certificate; DNS and public port 80 must reach this server'
certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" -d "$DOMAIN"
curl -fsS --max-time 20 "https://${DOMAIN}/healthz"
printf '\n'
curl -fsS --max-time 20 -o /dev/null "https://${DOMAIN}/miniapp"

systemctl enable --now tiznetvpn-dbbackup.timer

printf '\nThe web service is installed. Telegram webhook setup is the final step.\n'
printf 'If this bot is already active on Cloudflare or another host, switching its webhook stops updates from reaching the old host.\n'
SWITCH_ACK=''
read_line "Type SWITCH to move the webhook to ${DOMAIN} now, or press Enter to leave it unchanged: " SWITCH_ACK
if [[ "${SWITCH_ACK^^}" == 'SWITCH' ]]; then
  runuser -u tiznetvpn -- env ENV_FILE="$ENV_FILE" /usr/bin/node "$INSTALL_DIR/scripts/setup-webhook.mjs" --confirm-switch
  systemctl enable --now tiznetvpn-reminders.timer tiznetvpn-backup.timer tiznetvpn-shetab.timer
  printf '\nWebhook set. Send /start to the bot in Telegram and open its Mini App.\n'
else
  printf '\nWebhook was not changed. When ready, run:\n'
  printf 'sudo -u tiznetvpn env ENV_FILE=%s /usr/bin/node %s/scripts/setup-webhook.mjs --confirm-switch\n' "$ENV_FILE" "$INSTALL_DIR"
  printf 'Then enable Telegram timers:\n'
  printf 'sudo systemctl enable --now tiznetvpn-reminders.timer tiznetvpn-backup.timer tiznetvpn-shetab.timer\n'
fi

printf '\n--- Automatic card-to-card payments (Shetab Verification app) ---\n'
printf 'In the app set:\n'
printf '  Server URL : https://%s/wp-json/webdide-cv/v1/confirm\n' "$DOMAIN"
printf '  API Secret : the SHETAB_API_SECRET value in %s\n' "$ENV_FILE"
printf '               read it with: sudo grep SHETAB_API_SECRET %s\n' "$ENV_FILE"
printf 'Then enable "automatic card-to-card" in the bot admin settings.\n'
printf 'Health check: curl -s -H "Authorization: <secret>" https://%s/api/shetab-verify\n' "$DOMAIN"

printf '\nMini App: https://%s/miniapp\n' "$DOMAIN"
printf 'Service status: sudo systemctl status tiznetvpn.service --no-pager\n'
printf 'Service log: sudo journalctl -u tiznetvpn.service -n 100 --no-pager\n'
printf 'SQLite database: /var/lib/tiznetvpn/tiznetvpn.sqlite3\n'
printf 'After opening the admin Mini App, enter your Hiddify Manager v14 details and configure plans.\n'
