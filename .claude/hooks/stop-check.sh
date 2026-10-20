#!/usr/bin/env bash
# Stop: run `pnpm check` if code changed and return only the failures.
# exit 2 makes Claude continue and fix; stop_hook_active prevents an infinite loop.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
input=$(cat)
echo "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0
[ -f package.json ] && grep -q '"check"' package.json || exit 0
[ -n "$(git status --porcelain -- src test scripts drizzle package.json 2>/dev/null)" ] || exit 0
out=$(pnpm -s check 2>&1) && exit 0
echo "pnpm check failed:" >&2
echo "$out" | tail -n 40 >&2
exit 2
