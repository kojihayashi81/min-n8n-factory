#!/bin/bash
set -e

WORKTREE_PATH="${1:?Usage: start-devcontainer.sh <worktree-path>}"

if [ ! -d "$WORKTREE_PATH/.devcontainer" ]; then
  echo "Error: $WORKTREE_PATH/.devcontainer not found" >&2
  exit 1
fi

# devcontainer up の返り値から containerId を取り出すヘルパー。
# stdout には最終行の JSON があり、そこから containerId を抽出する。
# `--mount-git-worktree-common-dir` は worktree の parent .git を
# 追加マウントし、devcontainer 内からの git 操作を通すために必須
# (worktree は --relative-paths で作成されている前提)。
get_container_id() {
  local up_args=("$@")
  devcontainer up --workspace-folder "$WORKTREE_PATH" \
    --mount-git-worktree-common-dir \
    "${up_args[@]}" 2>&1 \
    | tail -1 \
    | jq -r '.containerId'
}

# Verify the devcontainer's workspace mount is actually usable.
# Docker Desktop on macOS occasionally leaves a previously-created
# devcontainer with a stale bind-mount view: the workspace path
# exists inside the container but docker exec can't set it as cwd
# ("unable to start container process: current working directory is
# outside of container mount namespace root"). Reusing such a
# container makes every subsequent `devcontainer exec` fail until the
# container is recreated. Detect this by running a trivial ls inside
# the workspace and recreating if it fails.
#
# We only pay the recreation cost (image rebuild + postCreateCommand
# reinstall) when the mount is actually broken, so the common reuse
# path stays fast.
ensure_usable_container() {
  local container_id="$1"
  if [ -z "$container_id" ] || [ "$container_id" = "null" ]; then
    return 1
  fi
  # Use `devcontainer exec` itself as the probe. With
  # --mount-git-worktree-common-dir the in-container workspace path is
  # computed from the git worktree common dir layout (e.g.
  # /workspaces/.worktrees/issue-1, not /workspaces/issue-1), which
  # makes manual path reconstruction brittle. Delegate workspace
  # resolution to the CLI and just confirm that it can open a file
  # handle in the workspace (`ls .` would fail with the same "current
  # working directory is outside of container mount namespace root"
  # error as a broken bind mount).
  devcontainer exec --workspace-folder "$WORKTREE_PATH" \
    --mount-git-worktree-common-dir \
    -- sh -c 'ls . > /dev/null' > /dev/null 2>&1 || return 1
}

CONTAINER_ID="$(get_container_id)"

if ! ensure_usable_container "$CONTAINER_ID"; then
  echo "start-devcontainer: existing devcontainer mount is unusable, recreating" >&2
  CONTAINER_ID="$(get_container_id --remove-existing-container)"
  if ! ensure_usable_container "$CONTAINER_ID"; then
    echo "Error: devcontainer workspace still unusable after recreation (container_id=$CONTAINER_ID)" >&2
    exit 1
  fi
fi

echo "$CONTAINER_ID"
