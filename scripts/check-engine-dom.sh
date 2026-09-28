#!/usr/bin/env bash
set -euo pipefail

# git grep: 0 = match, 1 = no match, 2 or higher = scan failure.
status=0
matches=$(git grep -n 'document\.\|window\.' -- src/engine/ 2>/dev/null) || status=$?
if (( status == 0 )); then
  printf '%s\n' "$matches"
  exit 1
fi
if (( status != 1 )); then
  printf 'check-engine-dom: scan failed\n' >&2
  exit 2
fi
printf 'check-engine-dom: OK\n'
