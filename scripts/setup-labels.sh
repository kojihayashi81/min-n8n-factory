#!/bin/bash
set -e

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO is not set."
  echo "Set it in .env: GITHUB_REPO=owner/repo-name"
  exit 1
fi

REPO="$GITHUB_REPO"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LABELS_JSON="${SCRIPT_DIR}/../labels.json"

if [ ! -f "$LABELS_JSON" ]; then
  echo "Error: labels.json not found at ${LABELS_JSON}"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required. Install with: brew install jq"
  exit 1
fi

count=$(jq length "$LABELS_JSON")
for i in $(seq 0 $((count - 1))); do
  name=$(jq -r ".[$i].name" "$LABELS_JSON")
  color=$(jq -r ".[$i].color" "$LABELS_JSON")
  description=$(jq -r ".[$i].description" "$LABELS_JSON")

  color="${color#\#}"

  if gh label list --repo "$REPO" --limit 100 --json name -q '.[].name' | grep -qx "${name}"; then
    echo "skip: ${name} already exists"
  else
    gh label create "$name" --color "$color" --description "$description" --repo "$REPO"
    echo "created: ${name}"
  fi
done
