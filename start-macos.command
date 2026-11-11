#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 24 or newer is required: https://nodejs.org/' 'Install it, then run this file again.'
  printf '%s' 'Press Enter to close.'
  read -r answer
  exit 1
fi
node tools/launch-local.mjs "$@"
result=$?
if [ "$result" -ne 0 ]; then
  printf '%s' 'Startup failed. Press Enter to close.'
  read -r answer
fi
exit "$result"
