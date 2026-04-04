#!/bin/bash
set -e

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO is not set."
  echo "Set it in .env: GITHUB_REPO=owner/repo-name"
  exit 1
fi

REPO="$GITHUB_REPO"

echo "Note: make sure to run 'make setup-labels' first to create the 'ai-ready' label in $REPO"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../.github/ISSUE_TEMPLATE"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Note: "cloned an empty repository" warning is expected for new repositories
echo "Cloning $REPO..."
gh repo clone "$REPO" "$WORK_DIR" -- --depth=1 2>&1 | grep -v "warning: You appear to have cloned an empty repository" || true

echo "Copying Issue templates..."
mkdir -p "$WORK_DIR/.github/ISSUE_TEMPLATE"
cp "$TEMPLATE_DIR/ai-task.yml" "$WORK_DIR/.github/ISSUE_TEMPLATE/ai-task.yml"
cp "$TEMPLATE_DIR/config.yml" "$WORK_DIR/.github/ISSUE_TEMPLATE/config.yml"

cd "$WORK_DIR"
git add .github/ISSUE_TEMPLATE/
if git diff --cached --quiet; then
  echo "skip: no changes to commit"
else
  git commit -m "chore: add AI task Issue Form template"
  git push
  echo "done: Issue templates pushed to $REPO"
fi
