#!/usr/bin/env bash
# FootballCenter — serverga bir buyruq bilan o'rnatish (Ubuntu/Debian).
#
#   sudo bash setup.sh           # birinchi o'rnatish: savollar beradi, hammasini o'zi sozlaydi
#   sudo bash setup.sh update    # yangi versiyani GitHub'dan olib, qayta ishga tushirish
#   sudo bash setup.sh status    # holat va oxirgi loglar
#
# Savollarsiz ishlatish uchun qiymatlarni muhit o'zgaruvchisi sifatida bering:
#   BOT_TOKEN, OWNER_IDS, DOMAIN, FOOTBALL_API_KEY, ANTHROPIC_API_KEY, ADMIN_LOGIN
#   NO_HTTPS=1 — Caddy'siz (HTTPS'ni o'zingiz sozlaysiz)
set -euo pipefail

cd "$(dirname "$0")"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
die() { red "❌ $*"; exit 1; }

ask() {
  # ask "Savol" VAR_NAME [standart]
  local prompt="$1" var="$2" def="${3:-}" val=""
  if [ -n "${!var+x}" ]; then return; fi   # muhit o'zgaruvchisi berilgan (bo'sh bo'lsa ham)
  if [ -n "$def" ]; then prompt="$prompt [$def]"; fi
  { read -r -p "$prompt: " val < /dev/tty; } 2>/dev/null || true
  printf -v "$var" '%s' "${val:-$def}"
}

rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

compose_args() {
  if [ "${NO_HTTPS:-}" = "1" ] || grep -q '^NO_HTTPS=1' .env 2>/dev/null; then echo ""; else echo "--profile https"; fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    if ! docker info >/dev/null 2>&1; then
      systemctl enable --now docker >/dev/null 2>&1 || service docker start >/dev/null 2>&1 || true
      sleep 3
      docker info >/dev/null 2>&1 || die "Docker xizmati ishlamayapti: systemctl start docker"
    fi
    green "✅ Docker o'rnatilgan"
    return
  fi
  yellow "⏳ Docker o'rnatilmoqda (1–3 daqiqa)..."
  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker Compose o'rnatilmadi"
  green "✅ Docker o'rnatildi"
}

public_ip() {
  curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true
}

check_token() {
  [[ "$BOT_TOKEN" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]] || die "Token noto'g'ri ko'rinishda. BotFather bergan tokenni to'liq nusxalang."
  local me
  me=$(curl -sS --max-time 10 "https://api.telegram.org/bot${BOT_TOKEN}/getMe" 2>/dev/null || true)
  if [[ "$me" == *'"ok":true'* ]]; then
    BOT_USERNAME=$(sed -n 's/.*"username":"\([^"]*\)".*/\1/p' <<<"$me")
    green "✅ Token to'g'ri: @${BOT_USERNAME}"
  elif [[ "$me" == *'"ok":false'* ]]; then
    die "Telegram tokenni qabul qilmadi. BotFather'dan tokenni qayta nusxalang."
  else
    yellow "⚠️  Telegram'ga ulanib bo'lmadi — token keyinroq, bot ishga tushganda tekshiriladi."
  fi
}

check_domain() {
  local ip resolved
  ip=$(public_ip)
  resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
  if [ -z "$resolved" ]; then
    yellow "⚠️  $DOMAIN hali hech qaysi IP'ga yo'naltirilmagan."
    yellow "    DNS'da $DOMAIN → ${ip:-server IP} qilib qo'ying, bo'lmasa HTTPS sertifikati olinmaydi."
  elif [ -n "$ip" ] && [ "$resolved" != "$ip" ]; then
    yellow "⚠️  $DOMAIN → $resolved, lekin bu serverning IP'si $ip. DNS'ni tekshiring."
  else
    green "✅ $DOMAIN shu serverga yo'naltirilgan ($resolved)"
  fi
}

open_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
    green "✅ Firewall: 80 va 443 portlar ochildi"
  fi
}

write_env() {
  local admin_password postgres_password session_secret
  admin_password=$(rand 16)
  postgres_password=$(rand 32)
  session_secret=$(rand 48)
  umask 077
  cat > .env <<EOF
# setup.sh tomonidan $(date '+%Y-%m-%d %H:%M') da yaratilgan. Bu faylni hech kimga bermang.
BOT_TOKEN=${BOT_TOKEN}
OWNER_IDS=${OWNER_IDS}
WEBAPP_URL=https://${DOMAIN}
USE_WEBHOOK=false
DOMAIN=${DOMAIN}
POSTGRES_PASSWORD=${postgres_password}
ADMIN_LOGIN=${ADMIN_LOGIN}
ADMIN_PASSWORD=${admin_password}
SESSION_SECRET=${session_secret}
FOOTBALL_API_KEY=${FOOTBALL_API_KEY:-}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
APP_PORT=3000
NO_HTTPS=${NO_HTTPS:-0}
EOF
  ADMIN_PASSWORD_SHOWN="$admin_password"
  green "✅ .env yaratildi (parollar avtomatik)"
}

wait_healthy() {
  local url="http://127.0.0.1:3000/healthz" i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then green "✅ Ilova ishga tushdi"; return 0; fi
    sleep 3
  done
  red "❌ Ilova 3 daqiqada ishga tushmadi. Loglar:"
  docker compose logs --tail 40 app || true
  exit 1
}

cmd_install() {
  [ "$(id -u)" = "0" ] || die "Root sifatida ishga tushiring: sudo bash setup.sh"
  command -v openssl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq openssl; }
  install_docker

  if [ -f .env ]; then
    local keep
    ask "📄 .env allaqachon bor. Uni saqlab, faqat qayta ishga tushiraymi? (ha/yo'q)" keep "ha"
    if [[ "$keep" =~ ^[hH] ]]; then
      cmd_update_only
      return
    fi
  fi

  echo
  green "=== FootballCenter sozlamalari ==="
  echo "Har bir savolga javob yozib Enter bosing. Kvadrat qavsdagi qiymat — standart."
  echo
  ask "🤖 BotFather bergan bot tokeni" BOT_TOKEN
  check_token
  ask "🆔 Sizning Telegram ID raqamingiz (@userinfobot dan bilib olasiz)" OWNER_IDS
  [[ "$OWNER_IDS" =~ ^[0-9]+(,[0-9]+)*$ ]] || die "Telegram ID faqat raqamlardan iborat bo'ladi (bir nechta bo'lsa vergul bilan)."
  ask "🌐 Domen (masalan footballcenter.duckdns.org)" DOMAIN
  DOMAIN=$(sed -e 's#^https\?://##' -e 's#/.*$##' <<<"$DOMAIN")
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Domen noto'g'ri: $DOMAIN"
  check_domain
  ask "👤 Web admin paneli logini" ADMIN_LOGIN "admin"
  ask "⚽ football-data.org API kaliti (bo'lmasa Enter)" FOOTBALL_API_KEY ""
  ask "🧠 Anthropic (Claude) API kaliti (bo'lmasa Enter)" ANTHROPIC_API_KEY ""

  write_env
  open_firewall

  yellow "⏳ Ilova yig'ilmoqda va ishga tushirilmoqda (birinchi marta 2–5 daqiqa)..."
  # shellcheck disable=SC2046
  docker compose $(compose_args) up -d --build
  wait_healthy

  echo
  green "🎉 Tayyor!"
  echo
  echo "  🤖 Bot:            https://t.me/${BOT_USERNAME:-<bot>}  — /start yozing"
  echo "  📱 Web App:        https://${DOMAIN}/"
  echo "  🔒 Web admin:      https://${DOMAIN}/admin/"
  echo "     Login:          ${ADMIN_LOGIN}"
  echo "     Parol:          ${ADMIN_PASSWORD_SHOWN}"
  echo
  yellow "  Parolni saqlab qo'ying. Keyin ko'rish uchun: grep ADMIN_PASSWORD .env"
  yellow "  HTTPS sertifikati birinchi ochishda 1–2 daqiqa olinadi."
}

cmd_update_only() {
  # shellcheck disable=SC2046
  docker compose $(compose_args) up -d --build
  wait_healthy
}

cmd_update() {
  [ "$(id -u)" = "0" ] || die "Root sifatida ishga tushiring: sudo bash setup.sh update"
  [ -f .env ] || die ".env topilmadi. Avval: sudo bash setup.sh"
  if [ -d .git ]; then
    yellow "⏳ GitHub'dan yangi versiya olinmoqda..."
    git pull --ff-only
  fi
  cmd_update_only
  green "✅ Yangilandi"
}

cmd_status() {
  docker compose ps
  echo
  docker compose logs --tail 30 app
}

case "${1:-install}" in
  install) cmd_install ;;
  update) cmd_update ;;
  status) cmd_status ;;
  *) die "Noma'lum buyruq: $1 (install | update | status)" ;;
esac
