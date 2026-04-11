#!/bin/bash
set -euo pipefail

ISSUE_NUMBER="${1:?Usage: save-investigation.sh <issue-number>}"
OUTPUT_DIR="openspec/investigations"
OUTPUT_FILE="$OUTPUT_DIR/issue-$ISSUE_NUMBER-investigation.md"

mkdir -p "$OUTPUT_DIR"

CONTENT=$(cat)
if [ -z "$CONTENT" ]; then
  echo "Error: no content from stdin" >&2
  exit 1
fi

echo "$CONTENT" > "$OUTPUT_FILE"
echo "$OUTPUT_FILE"
