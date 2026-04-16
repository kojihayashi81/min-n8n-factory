#!/bin/bash
# Unit tests for validate_json and emit_failure in n8n-run-claude-pipeline.sh
#
# Usage:  bash scripts/n8n-run-claude-pipeline.test.sh
# Requires: jq, cmp
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE="$SCRIPT_DIR/n8n-run-claude-pipeline.sh"

# ─── Test harness ────────────────────────────────────────────────

PASS=0
FAIL=0

assert_eq() {
  local label=$1 expected=$2 actual=$3
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_content() {
  local label=$1 file=$2 expected=$3
  if [ ! -f "$file" ]; then
    echo "  FAIL: $label (file not found: $file)"
    FAIL=$((FAIL + 1))
    return
  fi
  local actual
  actual=$(cat "$file")
  assert_eq "$label" "$expected" "$actual"
}

# ─── Extract functions from pipeline script ──────────────────────
# awk extracts each function definition (from opening line to the
# closing } at column 1) so we can source them without running the
# rest of the pipeline.

FUNC_FILE=$(mktemp)
trap 'rm -rf "$FUNC_FILE" "$WORK_DIR"' EXIT

awk '/^validate_json\(\) \{$/,/^\}$/' "$PIPELINE"  >"$FUNC_FILE"
awk '/^emit_failure\(\) \{$/,/^\}$/'  "$PIPELINE" >>"$FUNC_FILE"

# shellcheck source=/dev/null
source "$FUNC_FILE"

# Fresh WORK_DIR for every test group.
reset_work_dir() {
  WORK_DIR=$(mktemp -d -t pipeline-test-XXXXXX)
}

# ═════════════════════════════════════════════════════════════════
# validate_json tests
# ═════════════════════════════════════════════════════════════════
echo "--- validate_json ---"

# --- happy path ---
echo "[valid envelope + required keys present]"
reset_work_dir
printf '%s' '{"result":"{\"foo\":1,\"bar\":2}","session_id":"s1"}' \
  >"$WORK_DIR/agent.stdout"

validate_json agent '.foo and .bar'
rc=$?
assert_eq "returns 0" "0" "$rc"
assert_file_content ".stdout is clean JSON" "$WORK_DIR/agent.stdout" '{
  "foo": 1,
  "bar": 2
}'
assert_eq ".stdout.raw preserved" "true" "$([ -f "$WORK_DIR/agent.stdout.raw" ] && echo true || echo false)"

# --- .result is null ---
echo "[.result is null]"
reset_work_dir
printf '%s' '{"result":null,"session_id":"s1"}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"

# --- .result key missing ---
echo "[.result key missing]"
reset_work_dir
printf '%s' '{"session_id":"s1"}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"

# --- .result is false ---
echo "[.result is false]"
reset_work_dir
printf '%s' '{"result":false}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"

# --- .result is not valid JSON ---
echo "[.result is invalid JSON string]"
reset_work_dir
printf '%s' '{"result":"this is not json"}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"

# --- .result is valid JSON but keys missing ---
echo "[.result valid JSON but required keys missing]"
reset_work_dir
printf '%s' '{"result":"{\"only_foo\":1}"}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo and .bar'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"
# .stdout should contain the extracted clean JSON (jq step 2 succeeded)
assert_file_content ".stdout has extracted JSON" "$WORK_DIR/agent.stdout" '{
  "only_foo": 1
}'

# --- .result is empty string ---
echo "[.result is empty string]"
reset_work_dir
printf '%s' '{"result":""}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"

# --- input is not JSON at all ---
echo "[stdout is not JSON]"
reset_work_dir
printf '%s' 'Error: something went wrong' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo'
rc=$?
set -e
assert_eq "returns non-zero" "1" "$rc"

# --- .result is an array ---
echo "[.result is an array]"
reset_work_dir
printf '%s' '{"result":"[1,2,3]"}' >"$WORK_DIR/agent.stdout"

set +e
validate_json agent '.foo and .bar'
rc=$?
set -e
assert_eq "returns non-zero (array has no object keys)" "1" "$rc"

# --- .stdout.raw already exists (idempotent cp) ---
echo "[.stdout.raw already exists — not overwritten]"
reset_work_dir
# .stdout has a different envelope than .stdout.raw; validate_json must
# read from the pre-existing .stdout.raw, not overwrite it with .stdout.
printf '%s' '{"result":"{\"foo\":1}","session_id":"from-stdout"}' >"$WORK_DIR/agent.stdout"
printf '%s' '{"result":"{\"foo\":1}","session_id":"original"}' >"$WORK_DIR/agent.stdout.raw"

validate_json agent '.foo'
rc=$?
assert_eq "returns 0" "0" "$rc"
assert_file_content ".stdout.raw not overwritten" "$WORK_DIR/agent.stdout.raw" \
  '{"result":"{\"foo\":1}","session_id":"original"}'

# ═════════════════════════════════════════════════════════════════
# emit_failure tests
# ═════════════════════════════════════════════════════════════════
echo ""
echo "--- emit_failure ---"

# Helper: run emit_failure in a subshell (it calls exit) and capture stderr.
run_emit_failure() {
  local name=$1 code=$2 reason=$3
  ( emit_failure "$name" "$code" "$reason" ) 2>&1 || true
}

# --- .stdout.raw + different .stdout → both shown ---
echo "[.stdout.raw and .stdout differ — both shown]"
reset_work_dir
printf '%s' '{"result":"{\"foo\":1}","session_id":"s1"}' >"$WORK_DIR/agent.stdout.raw"
printf '%s' '{"foo":1}' >"$WORK_DIR/agent.stdout"

stderr=$(run_emit_failure agent 10 "schema")
assert_eq "contains stdout.raw header" "true" \
  "$(echo "$stderr" | grep -qF -- 'stdout.raw (CLI envelope)' && echo true || echo false)"
assert_eq "contains stdout header" "true" \
  "$(echo "$stderr" | grep -qF -- 'stdout (extracted JSON)' && echo true || echo false)"

# --- .stdout.raw + same .stdout → only .stdout.raw ---
echo "[.stdout.raw and .stdout identical — only .stdout.raw shown]"
reset_work_dir
printf '%s' '{"result":"..."}' >"$WORK_DIR/agent.stdout.raw"
cp "$WORK_DIR/agent.stdout.raw" "$WORK_DIR/agent.stdout"

stderr=$(run_emit_failure agent 10 "schema")
assert_eq "contains stdout.raw header" "true" \
  "$(echo "$stderr" | grep -qF -- 'stdout.raw (CLI envelope)' && echo true || echo false)"
assert_eq "no extracted JSON header" "false" \
  "$(echo "$stderr" | grep -qF -- 'stdout (extracted JSON)' && echo true || echo false)"

# --- .stdout.raw + empty .stdout → only .stdout.raw ---
echo "[.stdout.raw exists but .stdout is empty — only .stdout.raw shown]"
reset_work_dir
printf '%s' '{"result":"..."}' >"$WORK_DIR/agent.stdout.raw"
: >"$WORK_DIR/agent.stdout"

stderr=$(run_emit_failure agent 10 "schema")
assert_eq "contains stdout.raw header" "true" \
  "$(echo "$stderr" | grep -qF -- 'stdout.raw (CLI envelope)' && echo true || echo false)"
assert_eq "no extracted JSON header" "false" \
  "$(echo "$stderr" | grep -qF -- 'stdout (extracted JSON)' && echo true || echo false)"

# --- no .stdout.raw, only .stdout → fallback to .stdout ---
echo "[no .stdout.raw — fallback to .stdout]"
reset_work_dir
printf '%s' '{"result":"..."}' >"$WORK_DIR/agent.stdout"

stderr=$(run_emit_failure agent 1 "crash")
assert_eq "no stdout.raw header" "false" \
  "$(echo "$stderr" | grep -qF -- 'stdout.raw' && echo true || echo false)"
assert_eq "contains stdout header" "true" \
  "$(echo "$stderr" | grep -qF -- '--- agent stdout ---' && echo true || echo false)"

# --- neither .stdout.raw nor .stdout → no stdout section ---
echo "[no stdout files — no stdout section]"
reset_work_dir

stderr=$(run_emit_failure agent 1 "crash")
assert_eq "no stdout section" "false" \
  "$(echo "$stderr" | grep -qF -- 'stdout' && echo true || echo false)"
assert_eq "header line present" "true" \
  "$(echo "$stderr" | grep -qF -- '=== pipeline failed' && echo true || echo false)"

# --- stderr file shown ---
echo "[stderr file shown when present]"
reset_work_dir
printf '%s' 'some error output' >"$WORK_DIR/agent.stderr"

stderr=$(run_emit_failure agent 1 "crash")
assert_eq "contains stderr header" "true" \
  "$(echo "$stderr" | grep -qF -- '--- agent stderr ---' && echo true || echo false)"
assert_eq "contains stderr content" "true" \
  "$(echo "$stderr" | grep -qF -- 'some error output' && echo true || echo false)"

# --- exit code propagated ---
echo "[exit code propagated]"
reset_work_dir
exit_code=0
( emit_failure agent 42 "test" ) 2>/dev/null || exit_code=$?
assert_eq "exit code is 42" "42" "$exit_code"

# ─── Summary ─────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════"
echo "  $PASS passed, $FAIL failed"
echo "═══════════════════════════════"
[ "$FAIL" -eq 0 ]
