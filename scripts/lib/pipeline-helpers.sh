#!/bin/bash
# pipeline-helpers.sh — shared helper functions for n8n-run-claude-pipeline.sh
#
# Source this file after setting the following globals:
#   WORK_DIR              — temp directory for per-agent stdout/stderr capture
#   WORKTREE_PATH         — path to the git worktree being operated on
#   CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN — auth tokens
#   GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL,
#   GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL — git identity

# dc_exec: run a command inside the devcontainer with required env vars.
# Usage: dc_exec <cmd> [args...]
#
# `--mount-git-worktree-common-dir` is required so `git` commands run
# inside the container can resolve the worktree's gitdir reference.
# The worktree must have been created with `git worktree add --relative-paths`
# (see create-worktree.sh); otherwise this flag is a no-op and git
# operations will fail with "fatal: not a git repository".
dc_exec() {
  devcontainer exec --workspace-folder "$WORKTREE_PATH" \
    --mount-git-worktree-common-dir \
    --remote-env "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN" \
    --remote-env "GH_TOKEN=$GH_TOKEN" \
    --remote-env "GIT_AUTHOR_NAME=$GIT_AUTHOR_NAME" \
    --remote-env "GIT_AUTHOR_EMAIL=$GIT_AUTHOR_EMAIL" \
    --remote-env "GIT_COMMITTER_NAME=$GIT_COMMITTER_NAME" \
    --remote-env "GIT_COMMITTER_EMAIL=$GIT_COMMITTER_EMAIL" \
    -- "$@"
}

# run_agent: invoke `claude --print` for a single pipeline agent.
#
# Args:
#   $1 = agent name (used for temp file naming and error output)
#   $2 = per-agent timeout in seconds
#   $3 = --allowedTools value (space-separated, empty string for none)
#   $4 = path to system prompt file (on host, read and embedded in flag)
#
# Stdin: the user prompt (piped into claude via devcontainer exec)
# Captures:
#   $WORK_DIR/<name>.stdout
#   $WORK_DIR/<name>.stderr
#   $WORK_DIR/<name>.exit
#
# Returns 0 on success, non-zero on agent failure or timeout.
run_agent() {
  local name=$1
  local timeout_sec=$2
  local allowed_tools=$3
  local system_prompt_file=$4

  local stdout_file="$WORK_DIR/${name}.stdout"
  local stderr_file="$WORK_DIR/${name}.stderr"
  local exit_file="$WORK_DIR/${name}.exit"

  if [ ! -f "$system_prompt_file" ]; then
    echo "=== agent=$name missing system prompt: $system_prompt_file ===" >&2
    return 1
  fi

  local system_prompt
  system_prompt=$(cat "$system_prompt_file")

  # Build the claude command. --output-format json wraps the response in a
  # structured envelope ({ "result": "...", ... }) so validate_json can
  # extract .result with jq — no fragile text-scraping needed.
  local -a claude_args=(
    claude
    --print
    --output-format json
    --dangerously-skip-permissions
    --append-system-prompt
    "$system_prompt"
  )
  if [ -n "$allowed_tools" ]; then
    claude_args+=(--allowedTools "$allowed_tools")
  fi

  # Busybox's `timeout` cannot invoke shell functions (it only execs
  # on-disk binaries), so we can't wrap `dc_exec "${claude_args[@]}"`
  # in it — doing so would return exit=127 "No such file or directory"
  # before claude even starts. Inline the devcontainer invocation
  # here so timeout is handed a real executable (devcontainer → node).
  #
  # Intentional: this function does NOT re-enable `set -e` before
  # returning. bash's errexit is process-wide, not function-local, so a
  # `set -e` here would leak back to the caller and make the non-zero
  # return below trip errexit before the caller can inspect the code.
  # The caller is required to wrap run_agent in its own `set +e; ...;
  # set -e` block and handle the failure path via emit_failure.
  timeout "$timeout_sec" devcontainer exec \
    --workspace-folder "$WORKTREE_PATH" \
    --mount-git-worktree-common-dir \
    --remote-env "CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN" \
    --remote-env "GH_TOKEN=$GH_TOKEN" \
    --remote-env "GIT_AUTHOR_NAME=$GIT_AUTHOR_NAME" \
    --remote-env "GIT_AUTHOR_EMAIL=$GIT_AUTHOR_EMAIL" \
    --remote-env "GIT_COMMITTER_NAME=$GIT_COMMITTER_NAME" \
    --remote-env "GIT_COMMITTER_EMAIL=$GIT_COMMITTER_EMAIL" \
    -- "${claude_args[@]}" \
    >"$stdout_file" 2>"$stderr_file"
  local exit_code=$?

  echo "$exit_code" >"$exit_file"
  return "$exit_code"
}

# validate_json: extract .result from the CLI JSON envelope and verify
# the required top-level keys.
#
# --output-format json wraps Claude's response in { "result": "...", ... }.
# We extract .result, parse it as JSON, and check the schema — no fragile
# balanced-brace scanning needed.  The original CLI envelope is preserved
# as <name>.stdout.raw for diagnostics.
#
# Args:
#   $1 = agent name (must match run_agent call)
#   $2 = jq filter expression that must evaluate truthy (e.g. '.foo and .bar')
#
# Returns 0 on success, non-zero on schema violation.
validate_json() {
  local name=$1
  local required=$2
  local file="$WORK_DIR/${name}.stdout"

  # Keep the original CLI envelope on disk for diagnostics.
  if [ ! -f "$file.raw" ]; then
    cp "$file" "$file.raw" 2>/dev/null || true
  fi

  # Extract .result from the CLI envelope and parse it as JSON.
  # -e makes jq exit non-zero when .result is null/false/missing, and
  # // empty suppresses output entirely in those cases, so we fail fast
  # at this stage instead of passing "null" to the next jq invocation.
  local result
  result=$(jq -e -r '.result // empty' "$file.raw" 2>/dev/null) || return 1

  # Validate that .result is itself valid JSON and write the cleaned output.
  if ! printf '%s' "$result" | jq -e '.' >"$file" 2>/dev/null; then
    return 1
  fi

  # Check required schema keys.
  if ! jq -e "$required" "$file" >/dev/null 2>&1; then
    return 1
  fi
}

# emit_failure: print a framed failure record to stderr and exit non-zero.
# The record is picked up by n8n's ExecuteCommand node as the `error` field
# and fed to resolveFailureError → scrubSecrets on the way to Slack/GitHub.
emit_failure() {
  local name=$1
  local exit_code=$2
  local reason=$3

  echo "=== pipeline failed at agent=$name (exit=$exit_code, reason=$reason) ===" >&2
  # -s: only print header when the file exists AND is non-empty, so
  # empty captures don't add noise to Slack / GitHub comments.
  # When validate_json has run, two files may exist:
  #   .stdout.raw — original CLI envelope (always useful for full context)
  #   .stdout     — extracted clean JSON (more readable for schema-key failures)
  # Show both when they differ; show whichever one exists otherwise.
  if [ -s "$WORK_DIR/${name}.stdout.raw" ]; then
    echo "--- ${name} stdout.raw (CLI envelope) ---" >&2
    cat "$WORK_DIR/${name}.stdout.raw" >&2
    # Also show .stdout if it exists, is non-empty, and differs from .raw
    # (i.e. validate_json extracted clean JSON before the schema check failed).
    if [ -s "$WORK_DIR/${name}.stdout" ] \
       && ! cmp -s "$WORK_DIR/${name}.stdout" "$WORK_DIR/${name}.stdout.raw"; then
      echo "--- ${name} stdout (extracted JSON) ---" >&2
      cat "$WORK_DIR/${name}.stdout" >&2
    fi
  elif [ -s "$WORK_DIR/${name}.stdout" ]; then
    echo "--- ${name} stdout ---" >&2
    cat "$WORK_DIR/${name}.stdout" >&2
  fi
  if [ -s "$WORK_DIR/${name}.stderr" ]; then
    echo "--- ${name} stderr ---" >&2
    cat "$WORK_DIR/${name}.stderr" >&2
  fi
  exit "$exit_code"
}

# pipe_prompt: helper for callers — write a multi-line string to a temp
# file and cat it into the next run_agent via stdin redirection.
# Usage:
#   pipe_prompt "name" "$prompt_text"
#   run_agent ... <"$WORK_DIR/name.prompt"
pipe_prompt() {
  local name=$1
  local content=$2
  printf '%s' "$content" >"$WORK_DIR/${name}.prompt"
}
