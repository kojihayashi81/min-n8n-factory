#!/bin/bash
set -e

if [ -z "$GITHUB_REPO" ]; then
  echo "Error: GITHUB_REPO is not set."
  echo "Set it in .env: GITHUB_REPO=owner/repo-name"
  exit 1
fi

REPO="$GITHUB_REPO"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/../templates/skills"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Cloning $REPO..."
gh repo clone "$REPO" "$WORK_DIR" -- --depth=1 2>&1 | grep -v "warning: You appear to have cloned an empty repository" || true

echo "Copying Skill templates..."
mkdir -p "$WORK_DIR/.claude/commands"
cp "$SKILLS_DIR/"*.md "$WORK_DIR/.claude/commands/"

cd "$WORK_DIR"
git add .claude/commands/
if git diff --cached --quiet; then
  echo "skip: no changes to commit"
else
  git commit -m "chore: add AI workflow Skill templates"
  git push
  echo "done: Skills pushed to $REPO"
fi
