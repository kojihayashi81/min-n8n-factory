#!/bin/bash
set -e

ISSUE_NUMBER="${1:?Usage: create-worktree.sh <issue-number>}"
PROJECT_PATH="${PROJECT_PATH:?Error: PROJECT_PATH is not set}"

BRANCH_NAME="issues/${ISSUE_NUMBER}"
WORKTREE_DIR="${PROJECT_PATH}/.worktrees/issue-${ISSUE_NUMBER}"

cd "$PROJECT_PATH"

# リモートの最新を取得（既存 worktree でも常に実行）
git fetch origin

# 既に worktree が存在する場合はパスだけ返す
if [ -d "$WORKTREE_DIR" ]; then
  echo "$WORKTREE_DIR"
  exit 0
fi

# ブランチが既にリモートにあればチェックアウト、なければ main から作成
if git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
  git worktree add "$WORKTREE_DIR" "$BRANCH_NAME"
else
  git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" origin/main
fi

echo "$WORKTREE_DIR"
