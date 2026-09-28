#!/usr/bin/env bash
set -euo pipefail

patterns=(
	'gh[pousr]_[A-Za-z0-9]{20,}'
	'github_pat_[A-Za-z0-9_]{20,}'
	'AKIA[0-9A-Z]{16}'
	'ASIA[0-9A-Z]{16}'
	'xox[baprs]-[0-9A-Za-z-]{10,}'
	'AIza[0-9A-Za-z_-]{35}'
	'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
	'-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

matches=""
for pattern in "${patterns[@]}"; do
	result="$(git grep -n -E -e "$pattern" -- ':!scripts/check-secrets.sh' || true)"
	if [[ -n "$result" ]]; then
		matches+="$result\n"
	fi
done

if [[ -n "$matches" ]]; then
	echo "Potential credentials found in tracked files:" >&2
	printf '%b' "$matches" >&2
	exit 1
fi

echo "No common credential patterns found in tracked files."