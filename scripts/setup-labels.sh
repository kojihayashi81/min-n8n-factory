#!/bin/bash
set -e

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO is not set."
  echo "Set it in .env: GITHUB_REPO=owner/repo-name"
  exit 1
fi

REPO="$GITHUB_REPO"

labels=(
  "ai-ready|#0075ca|Trigger: human assigns this to request AI processing"
  "ai-processing|#e4e669|AI is processing. Prevents duplicate runs"
  "ai-review|#5319e7|PR created by AI. Waiting for human review"
  "ai-done|#0e8a16|Merged and archived by AI"
  "ai-failed|#d93f0b|Error or timeout. Human intervention required"
)

for entry in "${labels[@]}"; do
  name="${entry%%|*}"
  rest="${entry#*|}"
  color="${rest%%|*}"
  description="${rest#*|}"

  color="${color#\#}"

  if gh label list --repo "$REPO" --limit 100 --json name -q '.[].name' | grep -qx "${name}"; then
    echo "skip: ${name} already exists"
  else
    gh label create "$name" --color "$color" --description "$description" --repo "$REPO"
    echo "created: ${name}"
  fi
done
