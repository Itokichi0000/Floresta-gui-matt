#!/usr/bin/env bash
# Run floresta-ui in the background and start it automatically at login.
#
#   contrib/install-service.sh              install and start
#   contrib/install-service.sh --uninstall  stop and remove
#   contrib/install-service.sh --print      only print the service file
#
# macOS: a launchd agent (~/Library/LaunchAgents/sh.floresta.ui.plist).
# Linux: a systemd user service (~/.config/systemd/user/floresta-ui.service).
#
# Settings exported when you run this (FLORESTA_NETWORK, FLORESTA_DATADIR,
# FLORESTAD_URL, UI_BIND, UI_ALLOWED_HOSTS) are written into the service.
# FLORESTA_RPC_PASSWORD is never written to disk; use the cookie instead.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$(command -v python3 || true)"
LABEL="sh.floresta.ui"
ACTION="${1:-install}"

if [ -z "$PYTHON" ]; then
  echo "error: python3 not found" >&2
  exit 1
fi

VARS=(FLORESTA_NETWORK FLORESTA_DATADIR FLORESTAD_URL FLORESTA_RPC_USER FLORESTA_RPC_COOKIE_FILE UI_BIND UI_ALLOWED_HOSTS)

xml_escape() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

launchd_plist() {
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0"><dict>'
  echo "  <key>Label</key><string>$LABEL</string>"
  echo '  <key>ProgramArguments</key><array>'
  echo "    <string>$(printf %s "$PYTHON" | xml_escape)</string>"
  echo "    <string>$(printf %s "$ROOT/server/serve.py" | xml_escape)</string>"
  echo '    <string>--quiet</string>'
  echo '  </array>'
  echo '  <key>EnvironmentVariables</key><dict>'
  for v in "${VARS[@]}"; do
    if [ -n "${!v:-}" ]; then
      echo "    <key>$v</key><string>$(printf %s "${!v}" | xml_escape)</string>"
    fi
  done
  echo '  </dict>'
  echo '  <key>RunAtLoad</key><true/>'
  echo '  <key>KeepAlive</key><true/>'
  echo "  <key>StandardErrorPath</key><string>$(printf %s "$HOME/Library/Logs/floresta-ui.log" | xml_escape)</string>"
  echo '</dict></plist>'
}

systemd_unit() {
  echo '[Unit]'
  echo 'Description=floresta-ui (web UI for florestad)'
  echo 'After=network.target'
  echo
  echo '[Service]'
  for v in "${VARS[@]}"; do
    if [ -n "${!v:-}" ]; then
      echo "Environment=\"$v=${!v}\""
    fi
  done
  echo "ExecStart=\"$PYTHON\" \"$ROOT/server/serve.py\" --quiet"
  echo 'Restart=on-failure'
  echo 'RestartSec=5'
  echo
  echo '[Install]'
  echo 'WantedBy=default.target'
}

case "$(uname -s)" in
  Darwin)
    FILE="$HOME/Library/LaunchAgents/$LABEL.plist"
    case "$ACTION" in
      --print) launchd_plist ;;
      --uninstall)
        launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
        rm -f "$FILE"
        echo "Removed $FILE" ;;
      install)
        mkdir -p "$(dirname "$FILE")" "$HOME/Library/Logs"
        launchd_plist > "$FILE"
        launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
        launchctl bootstrap "gui/$(id -u)" "$FILE"
        echo "Installed $FILE"
        echo "floresta-ui now runs in the background: http://127.0.0.1:3000"
        echo "Log: ~/Library/Logs/floresta-ui.log" ;;
      *) echo "usage: $0 [--print|--uninstall]" >&2; exit 2 ;;
    esac ;;
  Linux)
    FILE="$HOME/.config/systemd/user/floresta-ui.service"
    case "$ACTION" in
      --print) systemd_unit ;;
      --uninstall)
        systemctl --user disable --now floresta-ui.service 2>/dev/null || true
        rm -f "$FILE"
        systemctl --user daemon-reload 2>/dev/null || true
        echo "Removed $FILE" ;;
      install)
        mkdir -p "$(dirname "$FILE")"
        systemd_unit > "$FILE"
        systemctl --user daemon-reload
        systemctl --user enable --now floresta-ui.service
        echo "Installed $FILE"
        echo "floresta-ui now runs in the background: http://127.0.0.1:3000"
        echo "Log: journalctl --user -u floresta-ui -f"
        echo "To keep it running when you are logged out: sudo loginctl enable-linger $USER" ;;
      *) echo "usage: $0 [--print|--uninstall]" >&2; exit 2 ;;
    esac ;;
  *)
    echo "Unsupported system: $(uname -s). Run python3 server/serve.py instead." >&2
    exit 1 ;;
esac
