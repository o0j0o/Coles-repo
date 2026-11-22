#!/usr/bin/env bash
# Starts the fence estimator on this machine with Docker and publishes it on
# your Tailscale network over HTTPS. Safe to run again: it updates and restarts.
#
#   cd Coles-repo && ./install-lab.sh
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\n\033[33m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is missing. Install docker-compose-plugin."
command -v curl >/dev/null || fail "curl is not installed."

SUDO=""
[ "$(id -u)" -eq 0 ] || SUDO="sudo"

if [ -d .git ]; then
  say "Updating the code"
  git pull --ff-only || echo "Could not update (local changes?). Continuing with the current code."
fi

write_env() {
  {
    # Single quotes stop Docker Compose treating a $ in the password as a variable.
    echo "APP_PASSWORD='$1'"
    echo "SESSION_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "ANTHROPIC_API_KEY=$2"
    echo "TZ=America/Barbados"
    echo "FENCE_PORT=3001"
  } > .env
  chmod 600 .env
}

new_password=""
if [ ! -f .env ]; then
  if [ -t 0 ]; then
    say "First-time setup"
    while :; do
      read -rsp "Choose a password for the app: " pw; echo
      case "$pw" in *"'"*) echo "Please don't use a ' (single quote) in the password."; continue;; esac
      [ ${#pw} -ge 8 ] && break
      echo "Use at least 8 characters."
    done
    read -rp "Anthropic API key for Read a sketch (Enter to skip): " key
    write_env "$pw" "$key"
  else
    # No one at the keyboard (e.g. run by an assistant): make a strong password and show it once at the end.
    say "First-time setup (no terminal attached, so a password is generated)"
    new_password=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
    write_env "$new_password" "${ANTHROPIC_API_KEY:-}"
    echo "  App password: $new_password (saved in .env)"
  fi
fi

port=$(grep -E '^FENCE_PORT=' .env | tail -1 | cut -d= -f2 | tr -d "'\" ")
port=${port:-3001}

# Another fence estimator that was set up by hand keeps its own (old) code and data.
others=$(docker ps -a --format '{{.Names}}' | grep -i fence | grep -vx fence-estimator || true)
if [ -n "$others" ]; then
  warn "Found another fence app container on this machine:"
  echo "$others" | sed 's/^/  /'
  echo "  It keeps running its old code and its own data. To move your estimates across:"
  echo "  1. In the old app: Settings, Download backup."
  echo "  2. In the new app (address below): Settings, Restore, choose that file."
  echo "  3. Then stop the old one: docker stop <name> && docker update --restart=no <name>"
fi

# Check nothing else is using the port.
holder=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "[:.]${port}->" | awk '{print $1}' | grep -vx fence-estimator || true)
if [ -n "$holder" ]; then
  fail "Port $port is already used by the container '$holder'. Stop it, or pick another port by setting FENCE_PORT in .env, then run this again."
fi

say "Building and starting the app"
docker compose up -d --build

say "Waiting for the app to start"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${port}/api/auth" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ -n "$ok" ] || fail "The app did not start. Check: docker compose logs"

url=""
if command -v tailscale >/dev/null; then
  say "Publishing on Tailscale"
  # HTTPS on port 8443, so it doesn't clash with the recipe app on the default 443.
  if $SUDO tailscale serve --bg --https=8443 "$port" >/dev/null 2>&1; then
    url=$($SUDO tailscale serve status 2>/dev/null | grep -o 'https://[^ ]*:8443' | head -1 || true)
  fi
  if [ -z "$url" ]; then
    echo "Tailscale HTTPS isn't available (turn on MagicDNS and HTTPS certificates in the Tailscale admin console to get one)."
    name=$(tailscale status --self --peers=false 2>/dev/null | awk 'NR==1{print $2}')
    url="http://${name:-$(tailscale ip -4 | head -1)}:${port}"
  fi
else
  url="http://$(hostname -I 2>/dev/null | awk '{print $1}'):${port}"
fi

say "The fence estimator is running:"
echo "  $url"
if [ -n "$new_password" ]; then
  echo
  echo "  App password: $new_password"
  echo "  (saved in .env; change it there and run this script again)"
fi
echo
echo "To update later, run this script again. Your data is kept in the Docker volume fence-estimator_fence-data."
echo "On iPhone or iPad: open it in Safari, Share, Add to Home Screen."
