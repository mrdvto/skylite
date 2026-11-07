#!/usr/bin/env bash
# Give the Home HQ kiosk a Cloudflare Access service token, so the panel needs no email + PIN.
# Saves the URL and the token together, and the token only ever goes to that URL's origin.
#
# Usage: scripts/set-kiosk-access.sh            read the token from dashboard/.dev.vars.frame
#        scripts/set-kiosk-access.sh --clear    remove it from the frame
#
# dashboard/.dev.vars.frame is git-ignored and kept apart from .dev.vars, which goes to the Worker:
#   DASHBOARD_URL="https://your-dashboard.workers.dev/"
#   CF_ACCESS_CLIENT_ID="...access"
#   CF_ACCESS_CLIENT_SECRET="..."
#
# Over Wi-Fi instead of USB: ADB_SERIAL=<frame-ip>:5555 scripts/set-kiosk-access.sh

set -euo pipefail

ACTIVITY=com.wesbos.homehq/.MainActivity
adb_() { adb ${ADB_SERIAL:+-s "$ADB_SERIAL"} "$@"; }

if [ "${1:-}" = --clear ]; then
  adb_ shell am start -n "$ACTIVITY" --ez access_clear true >/dev/null
  echo "Token removed. The panel needs the Access sign-in again."
  exit 0
fi

vars="$(dirname "$0")/../dashboard/.dev.vars.frame"
[ -f "$vars" ] || { echo "No $vars, see the top of this script" >&2; exit 1; }
value() { sed -n "s/^$1=[\"']\{0,1\}\([^\"']*\)[\"']\{0,1\}\r\{0,1\}$/\1/p" "$vars" | head -n 1; }
url=$(value DASHBOARD_URL)
id=$(value CF_ACCESS_CLIENT_ID)
secret=$(value CF_ACCESS_CLIENT_SECRET)

# These go through adb's shell, so nothing but these characters gets near it.
for v in "$id" "$secret"; do
  [[ "$v" =~ ^[A-Za-z0-9._-]{8,200}$ ]] || { echo "Missing or odd value in $vars" >&2; exit 1; }
done

[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || { echo "DASHBOARD_URL in $vars must be https://host/" >&2; exit 1; }

adb_ shell am start -n "$ACTIVITY" --es url "$url" --es access_client_id "$id" --es access_client_secret "$secret" >/dev/null
echo "Token sent. Check the panel loads with no sign-in."
