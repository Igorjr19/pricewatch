#!/usr/bin/env bash
# PostToolUse (Edit|Write|MultiEdit): format the edited file with Biome.
# Silent and harmless if the project has no Biome installed yet.
set -u
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
f=$(python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
case "$f" in
  *.ts|*.tsx|*.js|*.mjs|*.json|*.jsonc) ;;
  *) exit 0 ;;
esac
[ -x node_modules/.bin/biome ] && [ -f "$f" ] || exit 0
node_modules/.bin/biome format --write "$f" >/dev/null 2>&1
exit 0
