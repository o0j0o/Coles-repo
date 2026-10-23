#!/usr/bin/env bash
# Starts the recipe app on this machine with Docker and publishes it on your
# Tailscale network over HTTPS. Safe to run again: it updates and restarts.
#
#   cd Coles-repo/recipe-costing && ./install-lab.sh
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is missing. Install docker-compose-plugin."
command -v tailscale >/dev/null || fail "Tailscale is not installed on this machine."

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

if [ -d ../.git ]; then
  say "Updating the code"
  git -C .. pull --ff-only || echo "Could not update (local changes?). Continuing with the current code."
fi

new_password=""
if [ ! -f .env ] && [ ! -t 0 ]; then
  # No one at the keyboard (e.g. run by an assistant): make a strong password and show it once at the end.
  say "First-time setup (no terminal attached, so a password is generated)"
  new_password=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
  {
    echo "APP_PASSWORD='$new_password'"
    echo "SESSION_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "TZ=America/Barbados"
    echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}"
  } > .env
  chmod 600 .env
fi

if [ ! -f .env ]; then
  say "First-time setup"
  while :; do
    read -rsp "Choose a password for the app: " pw; echo
    case "$pw" in *"'"*) echo "Please don't use a ' (single quote) in the password."; continue;; esac
    [ ${#pw} -ge 8 ] && break
    echo "Use at least 8 characters."
  done
  read -rp "Anthropic API key for photo import (Enter to skip): " key
  {
    # Single quotes stop Docker Compose treating a $ in the password as a variable.
    echo "APP_PASSWORD='$pw'"
    echo "SESSION_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "TZ=America/Barbados"
    echo "ANTHROPIC_API_KEY=$key"
  } > .env
  chmod 600 .env
fi

say "Building and starting the app"
docker compose up -d --build

say "Waiting for the app to start"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/api/auth >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "${ok:-}" = 1 ] || fail "The app did not start. Check: docker compose logs"

say "Publishing on Tailscale"
url=""
if $SUDO tailscale serve --bg 3000 >/dev/null 2>&1; then
  url=$($SUDO tailscale serve status 2>/dev/null | grep -o 'https://[^ ]*' | head -1 || true)
fi
if [ -z "$url" ]; then
  echo "Tailscale HTTPS isn't available (turn on MagicDNS and HTTPS certificates in the Tailscale admin console to get one)."
  name=$(tailscale status --self --peers=false 2>/dev/null | awk 'NR==1{print $2}')
  url="http://${name:-$(tailscale ip -4 | head -1)}:3000"
fi

say "The recipe app is running:"
echo "  $url"
if [ -n "$new_password" ]; then
  echo
  echo "  App password: $new_password"
  echo "  (saved in recipe-costing/.env; change it there and run this script again)"
fi
echo
echo "Open it on any device signed in to your Tailscale. On iPhone: Safari, Share, Add to Home Screen."
