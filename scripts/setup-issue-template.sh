#!/bin/bash
set -e

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO is not set."
  echo "Set it in .env: GITHUB_REPO=owner/repo-name"
  exit 1
fi

REPO="$GITHUB_REPO"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../.github/ISSUE_TEMPLATE"
WORK_DIR="$(mktemp -d)"

echo "Cloning $REPO..."
gh repo clone "$REPO" "$WORK_DIR" -- --depth=1

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

rm -rf "$WORK_DIR"
