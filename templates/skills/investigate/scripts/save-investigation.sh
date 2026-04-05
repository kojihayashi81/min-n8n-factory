#!/bin/bash
set -e

ISSUE_NUMBER="${1:?Usage: save-investigation.sh <issue-number>}"
OUTPUT_DIR="openspec/investigations"
OUTPUT_FILE="$OUTPUT_DIR/issue-$ISSUE_NUMBER-investigation.md"

mkdir -p "$OUTPUT_DIR"

cat > "$OUTPUT_FILE"

echo "$OUTPUT_FILE"
