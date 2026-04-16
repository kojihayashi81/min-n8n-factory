#!/bin/bash
# n8n-run-claude-pipeline.sh — 4 段エージェントパイプラインで Issue 調査を行う。
#
# 呼び出し側: n8n の `Run Claude Code` ノード（ExecuteCommand）
#   /opt/scripts/n8n-run-claude-pipeline.sh <issue-number>
#
# 成功時 stdout:
#   QUALITY_SCORE=<score>/<max>                  (Gatekeeper が走った場合)
#   QUALITY_SCORE_RERUN=<score>/<max>            (Synthesizer 再実行後のみ)
#   WEB_SKIP_REASON=<no_hints|web_failed>        (Web 調査がスキップされた場合のみ)
#   https://github.com/<owner>/<repo>/pull/<n>   (作成した Draft PR の URL)
#
# 失敗時: 非 0 終了 + stderr に失敗エージェント名 / stdout / stderr をデリミタ付きで出力
#
# 設計詳細: docs/workflows/ai-issue-processor/agent_pipeline.md を参照
set -euo pipefail

ISSUE_NUMBER="${1:?Usage: n8n-run-claude-pipeline.sh <issue-number>}"
if [[ ! "$ISSUE_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Error: issue number must be a positive integer (got: $ISSUE_NUMBER)" >&2
  exit 2
fi
PROJECT_PATH="${PROJECT_PATH:?Error: PROJECT_PATH is not set}"
GH_TOKEN="${GH_TOKEN:?Error: GH_TOKEN is not set}"
CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:?Error: CLAUDE_CODE_OAUTH_TOKEN is not set}"

# Individual agent timeouts (seconds). Sum must stay under CLAUDE_TIMEOUT_SEC.
# Defaults follow the "invariant: individual sum < pipeline total" rule documented
# in docs/workflows/ai-issue-processor/flow.md.
#
# Web Investigator is inherently variance-heavy (WebSearch 10-30s and
# WebFetch 5-60s per call, multiplied by the 2-3 turns the prompt expects),
# so the default budget is set well above the raw prompt estimate to avoid
# the "web_failed skip" path in normal operation while keeping a cap as a
# safety net against pathologically slow fetches.
CLAUDE_TIMEOUT_SEC="${CLAUDE_TIMEOUT_SEC:-1200}"
AGENT_TIMEOUT_COLLECTOR="${AGENT_TIMEOUT_COLLECTOR:-60}"
AGENT_TIMEOUT_CODE="${AGENT_TIMEOUT_CODE:-300}"
AGENT_TIMEOUT_WEB="${AGENT_TIMEOUT_WEB:-300}"
AGENT_TIMEOUT_SYNTHESIZER="${AGENT_TIMEOUT_SYNTHESIZER:-180}"
AGENT_TIMEOUT_GATEKEEPER="${AGENT_TIMEOUT_GATEKEEPER:-60}"
AGENT_TIMEOUT_SYNTHESIZER_RERUN="${AGENT_TIMEOUT_SYNTHESIZER_RERUN:-180}"

# Invariant (see docs/workflows/ai-issue-processor/flow.md):
#   sum of per-agent timeouts (including Synthesizer rerun + 2nd Gatekeeper)
#   must stay strictly below CLAUDE_TIMEOUT_SEC so the pipeline can surface
#   a per-agent timeout before n8n kills the whole ExecuteCommand.
AGENT_TIMEOUT_SUM=$((
  AGENT_TIMEOUT_COLLECTOR
  + AGENT_TIMEOUT_CODE
  + AGENT_TIMEOUT_WEB
  + AGENT_TIMEOUT_SYNTHESIZER
  + AGENT_TIMEOUT_GATEKEEPER
  + AGENT_TIMEOUT_SYNTHESIZER_RERUN
  + AGENT_TIMEOUT_GATEKEEPER
))
if [ "$AGENT_TIMEOUT_SUM" -ge "$CLAUDE_TIMEOUT_SEC" ]; then
  echo "Error: sum of per-agent timeouts ($AGENT_TIMEOUT_SUM s) must be < CLAUDE_TIMEOUT_SEC ($CLAUDE_TIMEOUT_SEC s)" >&2
  echo "  collector=$AGENT_TIMEOUT_COLLECTOR code=$AGENT_TIMEOUT_CODE web=$AGENT_TIMEOUT_WEB synthesizer=$AGENT_TIMEOUT_SYNTHESIZER gatekeeper=$AGENT_TIMEOUT_GATEKEEPER synthesizer_rerun=$AGENT_TIMEOUT_SYNTHESIZER_RERUN gatekeeper_rerun=$AGENT_TIMEOUT_GATEKEEPER" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPTS_DIR="${AGENT_PROMPTS_DIR:-$SCRIPT_DIR/../prompts/agents}"

# Work dir for per-agent stdout/stderr capture. Persisted to EXIT trap.
WORK_DIR=$(mktemp -d -t n8n-pipeline-XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

# Git HTTPS auth via env (does NOT persist to .git/config)
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="url.https://${GH_TOKEN}@github.com/.insteadOf"
export GIT_CONFIG_VALUE_0="git@github.com:"

# ─── Worktree + devcontainer setup ───────────────────────────────

WORKTREE_PATH=$("$SCRIPT_DIR/create-worktree.sh" "$ISSUE_NUMBER")
echo "worktree: $WORKTREE_PATH" >&2
"$SCRIPT_DIR/start-devcontainer.sh" "$WORKTREE_PATH" >&2

# ─── Helpers ─────────────────────────────────────────────────────

# Default git author for commits produced by the pipeline. The
# devcontainer has no pre-configured git user.name / user.email, so
# `git commit` would abort with "Author identity unknown". Surface a
# stable bot identity via GIT_AUTHOR_* / GIT_COMMITTER_* env vars
# (overridable from the host .env if the user wants a different name).
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-min-factory bot}"
GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-min-factory-bot@users.noreply.github.com}"
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$GIT_AUTHOR_NAME}"
GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$GIT_AUTHOR_EMAIL}"

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

# ─── Prepare branch ──────────────────────────────────────────────

BRANCH="issues/${ISSUE_NUMBER}"
NOTE_REL_PATH="openspec/investigations/issue-${ISSUE_NUMBER}-investigation.md"
NOTE_PATH_IN_CONTAINER="/workspaces/$(basename "$WORKTREE_PATH")/${NOTE_REL_PATH}"

dc_exec bash -c "git fetch origin && (git checkout '$BRANCH' 2>/dev/null || git checkout -b '$BRANCH' origin/main)" >&2

# ─── Agent 1: Collector ──────────────────────────────────────────

ISSUE_JSON=$(dc_exec gh issue view "$ISSUE_NUMBER" --json number,title,body,labels,comments)

pipe_prompt collector "Issue の JSON 入力を解析し、出力スキーマに沿った JSON のみを返してください。

入力:
$ISSUE_JSON"

set +e
run_agent collector "$AGENT_TIMEOUT_COLLECTOR" "" "$PROMPTS_DIR/collector.md" \
  <"$WORK_DIR/collector.prompt"
exit_code=$?
set -e
if [ "$exit_code" -ne 0 ]; then
  emit_failure collector "$exit_code" "claude exit=$exit_code (timeout or error)"
fi
if ! validate_json collector '.issue_summary and .investigation_focus and .initial_keywords and .linked_urls'; then
  emit_failure collector 10 "invalid JSON or missing required keys"
fi

COLLECTOR_OUT=$(cat "$WORK_DIR/collector.stdout")

# ─── Agent 2a: Code Investigator ─────────────────────────────────

pipe_prompt code-investigator "Collector の出力を踏まえて、コードベースを調査し、出力スキーマに沿った JSON のみを返してください。

Collector 出力:
$COLLECTOR_OUT"

set +e
run_agent code-investigator "$AGENT_TIMEOUT_CODE" \
  "Read Grep Glob Bash(git log:*) Bash(git blame:*)" \
  "$PROMPTS_DIR/code-investigator.md" \
  <"$WORK_DIR/code-investigator.prompt"
exit_code=$?
set -e
if [ "$exit_code" -ne 0 ]; then
  emit_failure code-investigator "$exit_code" "claude exit=$exit_code"
fi
if ! validate_json code-investigator '.related_files and .tech_stack and .current_behavior and .impact_scope and (.search_hints | type == "array")'; then
  emit_failure code-investigator 10 "invalid JSON, missing required keys, or search_hints is not an array"
fi

CODE_OUT=$(cat "$WORK_DIR/code-investigator.stdout")

# ─── Agent 2b: Web Investigator (maybe skipped) ──────────────────

# Skip Web investigation if Code Investigator produced no search hints —
# per agent_pipeline.md, this path scores on an 80-point scale since
# template-compliance item 5 would otherwise auto-dock the score.
SEARCH_HINTS_LEN=$(jq '.search_hints | length' "$WORK_DIR/code-investigator.stdout")
WEB_STATUS="ok"
# Reason for skipping Web Investigator. Empty when WEB_STATUS=ok.
# Values: "no_hints" (Code Investigator produced zero search_hints) or
#         "web_failed" (agent exit != 0 or invalid JSON).
# Emitted as a WEB_SKIP_REASON sentinel line alongside QUALITY_SCORE so
# Slack / PR reviewers can see which skip path produced the 80-pt scale.
WEB_SKIP_REASON=""

if [ "$SEARCH_HINTS_LEN" = "0" ]; then
  WEB_STATUS="skipped"
  WEB_SKIP_REASON="no_hints"
  echo "=== Web Investigator skipped: no search_hints ===" >&2
  printf '%s' '{"official_docs":[],"similar_issues":[],"constraints":"","migration_notes":"","skipped":"no search hints"}' \
    >"$WORK_DIR/web-investigator.stdout"
else
  pipe_prompt web-investigator "Code Investigator の結果を踏まえて外部情報を調査し、出力スキーマに沿った JSON のみを返してください。

Collector 出力:
$COLLECTOR_OUT

Code Investigator 出力:
$CODE_OUT"

  set +e
  run_agent web-investigator "$AGENT_TIMEOUT_WEB" "WebSearch WebFetch" \
    "$PROMPTS_DIR/web-investigator.md" \
    <"$WORK_DIR/web-investigator.prompt"
  web_exit=$?
  set -e
  # Separate the two skip reasons so diagnostic output tells us which
  # one to chase next (agent-side exit vs schema/parse failure). The
  # validate_json call only knows "did jq accept it", so we also dump
  # the first few lines of stdout/stderr when we skip — otherwise the
  # next time this fires in prod we have zero visibility into *why*.
  web_skip_cause=""
  if [ "$web_exit" -ne 0 ]; then
    web_skip_cause="agent exit=$web_exit"
  elif ! validate_json web-investigator '.official_docs and .similar_issues'; then
    web_skip_cause="schema validation failed (missing .official_docs / .similar_issues or invalid JSON)"
  fi
  if [ -n "$web_skip_cause" ]; then
    # Prefer the raw unmodified stdout for diagnostics so we can see any
    # natural-language preamble that defeated validate_json; fall back to
    # the (possibly rewritten) cleaned stdout if validate_json never ran.
    web_stdout_for_log="$WORK_DIR/web-investigator.stdout.raw"
    if [ ! -f "$web_stdout_for_log" ]; then
      web_stdout_for_log="$WORK_DIR/web-investigator.stdout"
    fi
    {
      echo "=== Web Investigator skip: $web_skip_cause ==="
      echo "--- web-investigator stdout (head 10, $web_stdout_for_log) ---"
      head -n 10 "$web_stdout_for_log" 2>/dev/null || echo "(empty)"
      echo "--- web-investigator.stderr (head 10) ---"
      head -n 10 "$WORK_DIR/web-investigator.stderr" 2>/dev/null || echo "(empty)"
      echo "=== (falling back to empty web result, score will scale to /80) ==="
    } >&2
    WEB_STATUS="skipped"
    WEB_SKIP_REASON="web_failed"
    printf '%s' '{"official_docs":[],"similar_issues":[],"constraints":"","migration_notes":"","skipped":"web investigator failed"}' \
      >"$WORK_DIR/web-investigator.stdout"
  fi
fi

WEB_OUT=$(cat "$WORK_DIR/web-investigator.stdout")

# ─── Agent 3: Synthesizer ────────────────────────────────────────

pipe_prompt synthesizer "3 つの調査結果を統合し、調査ノートを Markdown で生成してください。Write ツールで次のパスに保存してください: $NOTE_PATH_IN_CONTAINER

Collector 出力:
$COLLECTOR_OUT

Code Investigator 出力:
$CODE_OUT

Web Investigator 出力 (web_status=$WEB_STATUS, web_skip_reason=${WEB_SKIP_REASON:-none}):
$WEB_OUT"

set +e
run_agent synthesizer "$AGENT_TIMEOUT_SYNTHESIZER" "Write" \
  "$PROMPTS_DIR/synthesizer.md" \
  <"$WORK_DIR/synthesizer.prompt"
exit_code=$?
set -e
if [ "$exit_code" -ne 0 ]; then
  emit_failure synthesizer "$exit_code" "claude exit=$exit_code"
fi

if [ ! -f "${WORKTREE_PATH}/${NOTE_REL_PATH}" ]; then
  emit_failure synthesizer 11 "agent returned success but file missing: expected investigation note at $NOTE_REL_PATH"
fi

# ─── Agent 4: Gatekeeper (initial run) ───────────────────────────

MAX_SCORE=100
if [ "$WEB_STATUS" = "skipped" ]; then
  MAX_SCORE=80
fi
PASS_THRESHOLD=$(( MAX_SCORE * 70 / 100 ))

NOTE_CONTENT=$(cat "${WORKTREE_PATH}/${NOTE_REL_PATH}")

pipe_prompt gatekeeper "web_status=$WEB_STATUS / web_skip_reason=${WEB_SKIP_REASON:-none} / max_score=$MAX_SCORE / pass_threshold=$PASS_THRESHOLD

以下の調査ノートを採点基準に従って採点し、出力スキーマに沿った JSON のみを返してください。

調査ノート:
$NOTE_CONTENT"

GATEKEEPER_OK=false
SCORE=""
PASS=false
FEEDBACK=""

set +e
run_agent gatekeeper "$AGENT_TIMEOUT_GATEKEEPER" "" "$PROMPTS_DIR/gatekeeper.md" \
  <"$WORK_DIR/gatekeeper.prompt"
gate_exit=$?
set -e

# Pass判定は shell 側で決定論的に行う。Gatekeeper の `.pass` フィールドは
# プロンプトに threshold を渡している都合上 agent が自分で埋めるが、
# ハルシネーションで score < threshold なのに pass=true と返すケースを
# 防ぐため、ここでは SCORE と PASS_THRESHOLD の数値比較に寄せる。
if [ "$gate_exit" -eq 0 ] && validate_json gatekeeper '(.score | type == "number")'; then
  GATEKEEPER_OK=true
  SCORE=$(jq -r '.score' "$WORK_DIR/gatekeeper.stdout")
  FEEDBACK=$(jq -r '.feedback // ""' "$WORK_DIR/gatekeeper.stdout")
  if [ "$SCORE" -ge "$PASS_THRESHOLD" ]; then
    PASS=true
  else
    PASS=false
  fi
else
  echo "=== Gatekeeper failed or produced invalid JSON; continuing without score ===" >&2
fi

# ─── Synthesizer rerun + Gatekeeper 2nd run (if Gatekeeper failed threshold) ───

SCORE_RERUN=""
if [ "$GATEKEEPER_OK" = "true" ] && [ "$PASS" = "false" ]; then
  echo "=== Gatekeeper initial score=$SCORE < threshold=$PASS_THRESHOLD; running Synthesizer rerun with feedback ===" >&2

  pipe_prompt synthesizer-rerun "Gatekeeper のフィードバックを踏まえて、指摘箇所を改善した調査ノートを同じパスに上書き保存してください: $NOTE_PATH_IN_CONTAINER

Gatekeeper feedback:
$FEEDBACK

Collector 出力:
$COLLECTOR_OUT

Code Investigator 出力:
$CODE_OUT

Web Investigator 出力 (web_status=$WEB_STATUS, web_skip_reason=${WEB_SKIP_REASON:-none}):
$WEB_OUT

現在の調査ノート:
$NOTE_CONTENT"

  set +e
  run_agent synthesizer-rerun "$AGENT_TIMEOUT_SYNTHESIZER_RERUN" "Write" \
    "$PROMPTS_DIR/synthesizer.md" \
    <"$WORK_DIR/synthesizer-rerun.prompt"
  rerun_exit=$?
  set -e

  if [ "$rerun_exit" -eq 0 ]; then
    NOTE_CONTENT=$(cat "${WORKTREE_PATH}/${NOTE_REL_PATH}")

    pipe_prompt gatekeeper-rerun "web_status=$WEB_STATUS / web_skip_reason=${WEB_SKIP_REASON:-none} / max_score=$MAX_SCORE / pass_threshold=$PASS_THRESHOLD (通知用の 2 回目採点、閾値判定は使わない)

以下の調査ノートを採点し、出力スキーマに沿った JSON のみを返してください。

調査ノート:
$NOTE_CONTENT"

    set +e
    run_agent gatekeeper-rerun "$AGENT_TIMEOUT_GATEKEEPER" "" "$PROMPTS_DIR/gatekeeper.md" \
      <"$WORK_DIR/gatekeeper-rerun.prompt"
    gate2_exit=$?
    set -e

    if [ "$gate2_exit" -eq 0 ] && validate_json gatekeeper-rerun '.score'; then
      SCORE_RERUN=$(jq -r '.score' "$WORK_DIR/gatekeeper-rerun.stdout")
    else
      echo "=== Gatekeeper rerun failed; rerun score unavailable ===" >&2
    fi
  else
    echo "=== Synthesizer rerun failed (exit=$rerun_exit); continuing with initial note ===" >&2
  fi
fi

# ─── Commit + push + PR ──────────────────────────────────────────
#
# The whole tail of this pipeline must be idempotent because retries
# (ai-failed → ai-ready) re-run every agent. Each of the three steps
# below treats a "nothing to do" state as success so the retry path
# can pick up the existing Draft PR URL instead of failing:
#
#   git commit → exit 1 + "nothing to commit" → OK (note already staged upstream)
#   git push   → "Everything up-to-date" → native exit 0
#   gh pr create → already-exists error → look up the existing PR URL instead

set +e
dc_exec bash -c "git add '$NOTE_REL_PATH' && git commit -m 'investigate: add investigation note for issue #${ISSUE_NUMBER}'" \
  >"$WORK_DIR/git-commit.stdout" 2>"$WORK_DIR/git-commit.stderr"
commit_exit=$?
set -e
if [ "$commit_exit" -ne 0 ]; then
  if grep -qE "nothing to commit|no changes added to commit" \
    "$WORK_DIR/git-commit.stdout" "$WORK_DIR/git-commit.stderr" 2>/dev/null; then
    echo "=== git commit: no changes (note already on branch); continuing ===" >&2
  else
    emit_failure git-commit "$commit_exit" "git add/commit exit=$commit_exit (possibly no-op commit or staging failure)"
  fi
fi

set +e
dc_exec bash -c "git push -u origin '$BRANCH'" \
  >"$WORK_DIR/git-push.stdout" 2>"$WORK_DIR/git-push.stderr"
push_exit=$?
set -e
if [ "$push_exit" -ne 0 ]; then
  emit_failure git-push "$push_exit" "git push exit=$push_exit"
fi

# Reuse an existing open PR on the branch before attempting to create one.
# gh pr create fails hard with "a pull request for branch \"X\" already exists"
# when retried, which would bubble up as a pipeline failure even though the
# desired end state (a Draft PR exists for the issue) is already satisfied.
set +e
dc_exec gh pr list --head "$BRANCH" --state open --json url --jq '.[0].url // empty' \
  >"$WORK_DIR/pr-existing.stdout" 2>"$WORK_DIR/pr-existing.stderr"
list_exit=$?
set -e
EXISTING_PR_URL=""
if [ "$list_exit" -eq 0 ]; then
  EXISTING_PR_URL=$(tr -d '\r\n' <"$WORK_DIR/pr-existing.stdout")
fi

if [ -n "$EXISTING_PR_URL" ]; then
  echo "=== pr-create: reusing existing Draft PR $EXISTING_PR_URL ===" >&2
  PR_URL="$EXISTING_PR_URL"
else
  set +e
  dc_exec gh pr create \
    --draft \
    --base main \
    --title "investigate: Issue #${ISSUE_NUMBER} 調査ノート" \
    --body "Closes #${ISSUE_NUMBER}" \
    --head "$BRANCH" \
    >"$WORK_DIR/pr-create.stdout" 2>"$WORK_DIR/pr-create.stderr"
  pr_exit=$?
  set -e

  if [ "$pr_exit" -ne 0 ]; then
    emit_failure pr-create "$pr_exit" "gh pr create exit=$pr_exit"
  fi

  PR_URL=$(grep -Eo 'https://github\.com/[^[:space:]]+/pull/[0-9]+' "$WORK_DIR/pr-create.stdout" | tail -1)
  if [ -z "$PR_URL" ]; then
    emit_failure pr-create 12 "gh pr create succeeded but no PR URL found in stdout"
  fi
fi

# ─── Emit success output ─────────────────────────────────────────

if [ -n "$SCORE" ]; then
  echo "QUALITY_SCORE=${SCORE}/${MAX_SCORE}"
fi
if [ -n "$SCORE_RERUN" ]; then
  echo "QUALITY_SCORE_RERUN=${SCORE_RERUN}/${MAX_SCORE}"
fi
if [ -n "$WEB_SKIP_REASON" ]; then
  echo "WEB_SKIP_REASON=${WEB_SKIP_REASON}"
fi
echo "$PR_URL"

# Cleanup on success only — failure path leaves the worktree for inspection
"$SCRIPT_DIR/cleanup-worktree.sh" "$ISSUE_NUMBER" >&2 || true
