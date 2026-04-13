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

# ブランチ状態を判定して worktree を作成
# 1. ローカルブランチが既存 → そのままチェックアウト
# 2. リモートのみ存在 → リモートを追跡する新規ローカルブランチを作成
# 3. どちらにも無い → origin/main から新規作成
# git worktree add の stdout/stderr は全て stderr に流し、最後に path だけを stdout に出す
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git worktree add "$WORKTREE_DIR" "$BRANCH_NAME" >&2
elif git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
  git worktree add --track -b "$BRANCH_NAME" "$WORKTREE_DIR" "origin/$BRANCH_NAME" >&2
else
  git worktree add "$WORKTREE_DIR" -b "$BRANCH_NAME" origin/main >&2
fi

echo "$WORKTREE_DIR"
