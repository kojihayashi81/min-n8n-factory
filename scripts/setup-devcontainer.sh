#!/bin/bash
set -e

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO is not set."
  echo "Set it in .env: GITHUB_REPO=owner/repo-name"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq"
  exit 1
fi

REPO="$GITHUB_REPO"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../templates/devcontainer"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Cloning $REPO..."
gh repo clone "$REPO" "$WORK_DIR" -- --depth=1 2>&1 | grep -v "warning: You appear to have cloned an empty repository" || true

DEVCONTAINER_JSON="$WORK_DIR/.devcontainer/devcontainer.json"

if [ -f "$DEVCONTAINER_JSON" ]; then
  echo "Found existing devcontainer.json — merging Claude Code settings..."

  # features に gh CLI と Claude Code を追加（既存の features は保持）
  FEATURES_PATCH='{
    "ghcr.io/devcontainers/features/github-cli:1": {},
    "ghcr.io/devcontainers/features/node:1": {"version": "22"}
  }'

  TMP_JSON="$WORK_DIR/.devcontainer/devcontainer.json.tmp"
  jq --argjson patch "$FEATURES_PATCH" '
    .features = ((.features // {}) + $patch)
  ' "$DEVCONTAINER_JSON" > "$TMP_JSON" && mv "$TMP_JSON" "$DEVCONTAINER_JSON"

  # postCreateCommand が未設定の場合のみ Claude Code インストールを追加
  HAS_POST=$(jq 'has("postCreateCommand")' "$DEVCONTAINER_JSON")
  if [ "$HAS_POST" = "false" ]; then
    jq '.postCreateCommand = "npm install -g @anthropic-ai/claude-code"' \
      "$DEVCONTAINER_JSON" > "$TMP_JSON" && mv "$TMP_JSON" "$DEVCONTAINER_JSON"
    echo "  added: postCreateCommand (npm install -g @anthropic-ai/claude-code)"
  else
    echo "  skip: postCreateCommand already exists — add 'npm install -g @anthropic-ai/claude-code' manually if needed"
  fi

  echo "  updated: .devcontainer/devcontainer.json"
else
  echo "No devcontainer.json found — creating from Microsoft base image template..."
  mkdir -p "$WORK_DIR/.devcontainer"
  cp "$TEMPLATE_DIR/Dockerfile" "$WORK_DIR/.devcontainer/Dockerfile"
  cp "$TEMPLATE_DIR/devcontainer.json" "$WORK_DIR/.devcontainer/devcontainer.json"
  echo "  created: .devcontainer/Dockerfile"
  echo "  created: .devcontainer/devcontainer.json"
fi

cd "$WORK_DIR"
git add .devcontainer/
if git diff --cached --quiet; then
  echo "skip: no changes to commit"
else
  git commit -m "chore: add Claude Code to devcontainer"
  git push
  echo "done: devcontainer pushed to $REPO"
fi

