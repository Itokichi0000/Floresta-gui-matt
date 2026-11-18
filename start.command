#!/usr/bin/env bash
# Start floresta-ui and open it in your browser.
# macOS: double-click this file in Finder. Linux / macOS terminal: ./start.command
# Extra flags are passed to server/serve.py (see: python3 server/serve.py --help).
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found."
  echo "  macOS: run  xcode-select --install  (or install Python from python.org)"
  echo "  Linux: install the python3 package"
  read -r -p "Press Enter to close. " _
  exit 1
fi

echo "Starting floresta-ui. Keep this window open; close it (or press Ctrl+C) to stop."
python3 server/serve.py --open "$@"
status=$?
if [ "$status" -ne 0 ]; then
  read -r -p "floresta-ui stopped with an error (exit $status). Press Enter to close. " _
fi
exit "$status"
