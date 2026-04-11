#!/bin/bash
set -e

WORKTREE_PATH="${1:?Usage: start-devcontainer.sh <worktree-path>}"

if [ ! -d "$WORKTREE_PATH/.devcontainer" ]; then
  echo "Error: $WORKTREE_PATH/.devcontainer not found" >&2
  exit 1
fi

# DevContainer を起動（既に起動済みなら再利用される）
devcontainer up --workspace-folder "$WORKTREE_PATH" 2>&1 | tail -1 | jq -r '.containerId'
