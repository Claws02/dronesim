#!/bin/bash
# Quality check for the drone setup guide (macOS: double-click; first time: right-click > Open).
# To check one 3D model: drag the .glb onto Terminal after typing ./qa.command and a space.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo; echo "  Node.js is not installed. Install the LTS version from nodejs.org (or ask IT), then run qa.command again."; echo
  read -n 1 -s -r -p "Press any key to close"; exit 2
fi
node tools/qa.mjs "$@"
[ -f QA_REPORT.md ] && open -e QA_REPORT.md 2>/dev/null
echo; read -n 1 -s -r -p "Press any key to close"
