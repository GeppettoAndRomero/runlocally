#!/usr/bin/env bash
set -euo pipefail

# Usage: check-leaks.sh [--cached]
#   --cached  scan the staged index (pre-commit); default scans tracked files in the working tree.
# Personal patterns never live in the repository: LEAK_PATTERNS (one ERE per line, e.g. an
# Actions secret) or the gitignored .leak-patterns.local. Pattern values are never printed.
# A scalar flag, not an array: bash 3.2 (macOS) treats an empty array as unbound under set -u.
cached=''
if [[ ${1:-} == --cached ]]; then
  cached=1
fi

exclude_paths=('--' '.' ':!scripts/check-leaks.sh' ':!.gitignore' ':!package-lock.json' ':!vendor/libarchive-lean/*.js' ':!vendor/libarchive-lean/*.mjs' ':!vendor/libarchive-lean/*.wasm')
general_exclude_paths=("${exclude_paths[@]}" ':!NOTICE.md' ':!vendor/libarchive-lean/licenses/**')
general_patterns=(
  -e '/Users/'
  -e '/home/[a-z]'
  -e '(^|[[:space:]"'"'"'/=])\.env(\.[a-z0-9]+)?($|[[:space:]"'"'"'/])'
  -e '[a-z0-9._%+-]+@gmail\.com'
  -e '\b[0-9a-f]{32}\b'
)

check_patterns() {
  # git grep exits 0 on a match, 1 on no match and >1 on error; anything but 1 must not pass.
  local matches status=0
  local paths=("${exclude_paths[@]}")
  if [[ ${1:-} == --general ]]; then
    shift
    paths=("${general_exclude_paths[@]}")
  fi
  matches=$(git grep ${cached:+--cached} -n -I -i -E "$@" "${paths[@]}" 2>/dev/null) || status=$?
  if (( status == 0 )); then
    printf '%s\n' "$matches"
    return 1
  fi
  if (( status != 1 )); then
    printf 'check-leaks: scan failed\n' >&2
    return 2
  fi
}

check_patterns --general "${general_patterns[@]}" || exit $?

personal_patterns=()
read_patterns() {
  local pattern
  while IFS= read -r pattern || [[ -n $pattern ]]; do
    [[ -n $pattern ]] && personal_patterns+=(-e "$pattern")
  done
}
if [[ -n ${LEAK_PATTERNS:-} ]]; then
  read_patterns <<< "$LEAK_PATTERNS"
elif [[ -f .leak-patterns.local ]]; then
  read_patterns < .leak-patterns.local
fi

if (( ${#personal_patterns[@]} == 0 )); then
  if [[ ${LEAK_PATTERNS_REQUIRED:-0} == 1 ]]; then
    printf 'check-leaks: 個人パターンが未設定\n' >&2
    exit 2
  fi
  printf 'check-leaks: 個人パターンが未設定（一般パターンのみ検査）\n' >&2
else
  check_patterns "${personal_patterns[@]}" || exit $?
fi

printf 'check-leaks: OK\n'
