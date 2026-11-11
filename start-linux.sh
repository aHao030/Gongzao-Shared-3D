#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 24 or newer is required: https://nodejs.org/' 'Install it, then run this file again.'
  exit 1
fi
exec node tools/launch-local.mjs "$@"
