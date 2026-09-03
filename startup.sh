#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_ROOT"

if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
mkdir -p "$APP_ROOT/.grok"
nohup npm run dev >>"$APP_ROOT/.grok/app-startup.log" 2>&1 &
