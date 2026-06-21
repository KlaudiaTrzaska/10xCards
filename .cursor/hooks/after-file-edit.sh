#!/usr/bin/env bash

set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(echo "$INPUT" | jq -r '.file_path // empty')"
WORKSPACE_ROOT="$(echo "$INPUT" | jq -r '.workspace_roots[0] // "."')"

cd "$WORKSPACE_ROOT"

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    echo "Cursor hook: running ESLint for $FILE_PATH"
    npx eslint --fix "$FILE_PATH" --quiet
    ;;
  *)
    echo "Cursor hook: skipped non-JS/TS file: $FILE_PATH"
    ;;
esac
