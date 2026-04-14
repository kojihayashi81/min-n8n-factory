#!/bin/bash
set -e

ISSUE_NUMBER="${1:?Usage: create-worktree.sh <issue-number>}"
PROJECT_PATH="${PROJECT_PATH:?Error: PROJECT_PATH is not set}"

BRANCH_NAME="issues/${ISSUE_NUMBER}"
WORKTREE_DIR="${PROJECT_PATH}/.worktrees/issue-${ISSUE_NUMBER}"

cd "$PROJECT_PATH"

# リモートの最新を取得（既存 worktree でも常に実行）
git fetch origin

# Existing worktree handling.
#
# A worktree's .git file normally points at the parent repo's git dir
# using an absolute host path (`gitdir: /Users/.../gomoku/.git/worktrees/...`).
# That absolute path is not reachable inside the devcontainer (which
# only bind-mounts the worktree directory itself), and every subsequent
# git operation inside the container fails with
# "fatal: not a git repository: /Users/.../worktrees/..."
#
# git 2.48+ adds `git worktree add --relative-paths` to embed a
# relative pointer instead, and devcontainer CLI pairs it with
# `--mount-git-worktree-common-dir` to actually surface the parent git
# dir to the container. If we find a pre-existing worktree with an
# absolute gitdir, remove and recreate it so the fix takes effect;
# otherwise keep the fast-path reuse.
if [ -d "$WORKTREE_DIR" ]; then
  if [ -f "$WORKTREE_DIR/.git" ] && grep -q "^gitdir: /" "$WORKTREE_DIR/.git"; then
    echo "create-worktree: existing worktree uses absolute gitdir, recreating with --relative-paths" >&2
    git worktree remove --force "$WORKTREE_DIR" >&2 || rm -rf "$WORKTREE_DIR"
    git worktree prune >&2 || true
  else
    echo "$WORKTREE_DIR"
    exit 0
  fi
fi

# ブランチ状態を判定して worktree を作成
# 1. ローカルブランチが既存 → そのままチェックアウト
# 2. リモートのみ存在 → リモートを追跡する新規ローカルブランチを作成
# 3. どちらにも無い → origin/main から新規作成
# git worktree add の stdout/stderr は全て stderr に流し、最後に path だけを stdout に出す
# `--relative-paths` は devcontainer からの git 参照を通すために必須
# (devcontainer CLI の --mount-git-worktree-common-dir とセットで使う)
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  git worktree add --relative-paths "$WORKTREE_DIR" "$BRANCH_NAME" >&2
elif git ls-remote --heads origin "$BRANCH_NAME" | grep -q "$BRANCH_NAME"; then
  git worktree add --relative-paths --track -b "$BRANCH_NAME" "$WORKTREE_DIR" "origin/$BRANCH_NAME" >&2
else
  git worktree add --relative-paths "$WORKTREE_DIR" -b "$BRANCH_NAME" origin/main >&2
fi

echo "$WORKTREE_DIR"
