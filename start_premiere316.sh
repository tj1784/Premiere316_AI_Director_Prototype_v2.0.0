#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install
fi

if [ ! -f client/dist/index.html ]; then
  echo "Building client..."
  npm run build
fi

export PORT="${PORT:-8789}"
export COMFY_URL="${COMFY_URL:-http://127.0.0.1:8190}"

echo
echo "Premiere316  http://127.0.0.1:${PORT}"
echo "ComfyUI      ${COMFY_URL}"
echo
exec node server/index.js
