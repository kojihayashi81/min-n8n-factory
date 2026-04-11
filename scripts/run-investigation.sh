#!/bin/bash
set -e

ISSUE_NUMBER="${1:?Usage: run-investigation.sh <issue-number>}"
PROJECT_PATH="${PROJECT_PATH:?Error: PROJECT_PATH is not set}"
OP_VAULT_ID="${OP_VAULT_ID:?Error: OP_VAULT_ID is not set}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 0. 1Password から Claude OAuth トークンを取得
export CLAUDE_CODE_OAUTH_TOKEN=$(op read "op://$OP_VAULT_ID/Claude OAuth Token/token")
echo "auth: token loaded from 1Password" >&2

# 1. worktree 作成
WORKTREE_PATH=$("$SCRIPT_DIR/create-worktree.sh" "$ISSUE_NUMBER")
echo "worktree: $WORKTREE_PATH" >&2

# 2. DevContainer 起動
CONTAINER_ID=$("$SCRIPT_DIR/start-devcontainer.sh" "$WORKTREE_PATH")
echo "container: $CONTAINER_ID" >&2

# 3. DevContainer 内で claude 実行
devcontainer exec --workspace-folder "$WORKTREE_PATH" \
  -- claude --print --dangerously-skip-permissions "/investigate $ISSUE_NUMBER"
