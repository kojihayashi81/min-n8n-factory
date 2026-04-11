#!/bin/bash
set -euo pipefail

ISSUE_NUMBER="${1:?Usage: n8n-run-claude.sh <issue-number>}"
PROJECT_PATH="${PROJECT_PATH:?Error: PROJECT_PATH is not set}"
GH_TOKEN="${GH_TOKEN:?Error: GH_TOKEN is not set}"
CLAUDE_TIMEOUT_SEC="${CLAUDE_TIMEOUT_SEC:-600}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Git HTTPS auth via env (does NOT persist to .git/config)
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="url.https://${GH_TOKEN}@github.com/.insteadOf"
export GIT_CONFIG_VALUE_0="git@github.com:"

# 1. Create worktree (idempotent: reuses existing worktree/branch)
WORKTREE_PATH=$("$SCRIPT_DIR/create-worktree.sh" "$ISSUE_NUMBER")
echo "worktree: $WORKTREE_PATH" >&2

# 2. Start DevContainer (idempotent: reuses running container)
"$SCRIPT_DIR/start-devcontainer.sh" "$WORKTREE_PATH" >&2

# 3. Run Claude in DevContainer with timeout
CLAUDE_OUTPUT=$(timeout "$CLAUDE_TIMEOUT_SEC" \
  devcontainer exec --workspace-folder "$WORKTREE_PATH" \
  -- claude --print --dangerously-skip-permissions "/investigate $ISSUE_NUMBER" < /dev/null)

# 4. Cleanup on success (on failure, keep worktree for investigation)
"$SCRIPT_DIR/cleanup-worktree.sh" "$ISSUE_NUMBER"

# Output result (stdout is captured by n8n)
echo "$CLAUDE_OUTPUT"
