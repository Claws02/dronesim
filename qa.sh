#!/bin/sh
# Quality check for the drone setup guide (Linux). Usage: ./qa.sh   or   ./qa.sh model.glb
cd "$(dirname "$0")" || exit 2
command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is not installed. Install the LTS version from nodejs.org."; exit 2; }
exec node tools/qa.mjs "$@"
