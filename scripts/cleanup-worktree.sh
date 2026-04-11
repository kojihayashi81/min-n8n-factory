#!/bin/bash
set -euo pipefail

ISSUE_NUMBER="${1:?Usage: cleanup-worktree.sh <issue-number>}"
PROJECT_PATH="${PROJECT_PATH:?Error: PROJECT_PATH is not set}"

WORKTREE_DIR="${PROJECT_PATH}/.worktrees/issue-${ISSUE_NUMBER}"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "worktree not found, skipping cleanup" >&2
  exit 0
fi

# Stop DevContainer if running
devcontainer down --workspace-folder "$WORKTREE_DIR" 2>/dev/null || true
echo "devcontainer stopped" >&2

# Remove worktree
cd "$PROJECT_PATH"
git worktree remove "$WORKTREE_DIR" --force 2>/dev/null || rm -rf "$WORKTREE_DIR"
git worktree prune 2>/dev/null || true
echo "worktree removed: $WORKTREE_DIR" >&2
