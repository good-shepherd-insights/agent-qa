#!/usr/bin/env bash
# validate:release-gate is a standalone process with its own budget, NEVER a vitest cell
# (FLOOR-05; the architecture isolation cell measures that boundary). Every invocation replays
# the whole committed corpus unless --report <batchKey> is passed for offline comparison (D-16).
# The exit code IS the verdict: 0 / 1 / 2. Invocation failures are FAIL + 2, never a regression.
# Fresh builds are mandatory unless M3_RELEASE_GATE_SKIP_BUILD=1 is explicitly set.
# M3_RELEASE_GATE_VERB_OVERRIDE is a command string for the internal --selftest-verb path ONLY;
# normal invocations refuse it. --selftest uses an isolated copy, fake CLI and failing build stub:
# it never builds the workspace or calls a model, even when the real dist/config are absent.

set -euo pipefail

fail() { echo "FAIL release-gate: $1" >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)" || fail "cannot resolve repository directory"
CONFIG="${AGENT_QA_CONFIG:-$ROOT/../demo/init/agent-qa.config.yaml}"
CLI="$ROOT/packages/cli/dist/cli.js"

# Resolve relative config paths against the invocation cwd BEFORE entering the config directory.
case "$CONFIG" in /*) ;; *) CONFIG="$PWD/$CONFIG" ;; esac

selftest() (
  set -euo pipefail
  local work script config cli n expected status log build_log verb_log
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  mkdir -p "$work/repo/scripts" "$work/repo/packages/cli/dist" "$work/config space" "$work/bin"
  work="$(cd "$work" && pwd -P)"
  script="$work/repo/scripts/m3-release-gate.sh"
  config="$work/config space/agent-qa.config.yaml"
  cli="$work/repo/packages/cli/dist/cli.js"
  log="$work/result.log"
  build_log="$work/build.log"
  verb_log="$work/verb.json"
  cp "$ROOT/scripts/m3-release-gate.sh" "$script"
  printf '%s\n' 'eval: {}' > "$config"
  printf '%s\n' \
    'require("node:fs").writeFileSync(process.env.M3_SELFTEST_VERB_LOG, JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}))' \
    > "$cli"
  printf '%s\n' '#!/usr/bin/env bash' \
    'printf "%s\n" "$*" >> "$M3_SELFTEST_BUILD_LOG"' 'exit 1' > "$work/bin/pnpm"
  chmod +x "$work/bin/pnpm"
  export PATH="$work/bin:$PATH"
  export AGENT_QA_CONFIG="$config" M3_RELEASE_GATE_SKIP_BUILD=1
  export M3_SELFTEST_BUILD_LOG="$build_log" M3_SELFTEST_VERB_LOG="$verb_log"
  unset M3_RELEASE_GATE_VERB_OVERRIDE

  failed() { echo "SELFTEST FAILED: $1" >&2; cat "$log" >&2; exit 1; }
  expect_failure() {
    local label="$1" reason="$2"
    shift 2
    status=0
    "$@" > "$log" 2>&1 || status=$?
    [ "$status" -eq 2 ] || failed "$label returned $status, expected 2"
    grep -Fq "FAIL release-gate: $reason" "$log" || failed "$label did not print its FAIL reason"
    [ ! -e "$verb_log" ] || failed "$label reached the CLI"
    echo "PASS selftest: $label -> FAIL + 2"
  }

  for n in 0 1 2 3; do
    expected="$n"
    [ "$n" -ne 3 ] || expected=2
    status=0
    M3_RELEASE_GATE_VERB_OVERRIDE="node -e 'process.exit($n)'" \
      bash "$script" --selftest-verb > "$log" 2>&1 || status=$?
    [ "$status" -eq "$expected" ] || failed "verb exit $n returned $status, expected $expected"
    if [ "$n" -eq 3 ]; then
      grep -Fq 'FAIL release-gate: verb exited 3 (not a gate verdict)' "$log" \
        || failed 'non-verdict exit did not print FAIL'
    elif grep -q 'FAIL release-gate:' "$log"; then
      failed "verdict $n was reported as an invocation failure"
    fi
    echo "PASS selftest: verb $n -> $expected"
  done

  # Exercise the normal node invocation too; only the copied fixture CLI can run here.
  (
    cd "$work"
    AGENT_QA_CONFIG='config space/agent-qa.config.yaml' bash "$script" \
      --report 'batch key' --json --staged-dir 'audit dir' --seed 0
  ) > "$log" 2>&1 || failed 'relative config and argument passthrough'
  node -e '
    const fs = require("node:fs")
    const assert = require("node:assert/strict")
    const actual = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
    assert.deepEqual(actual, {
      cwd: process.argv[2],
      args: ["--config", process.argv[3], "eval", "gate", "--report", "batch key", "--json", "--staged-dir", "audit dir", "--seed", "0"],
    })
  ' "$verb_log" "$work/config space" "$config" > "$log" 2>&1 \
    || failed 'config directory or exact arguments changed'
  rm "$verb_log"
  echo 'PASS selftest: relative config, session cwd and exact argument passthrough'

  expect_failure 'override outside selftest' 'verb override is test-only' \
    env M3_RELEASE_GATE_VERB_OVERRIDE='exit 0' bash "$script"
  expect_failure 'selftest override without skip-build' 'selftest verb requires skip-build and an override' \
    env M3_RELEASE_GATE_SKIP_BUILD=0 M3_RELEASE_GATE_VERB_OVERRIDE='exit 0' bash "$script" --selftest-verb
  expect_failure 'missing config' 'config is absent' \
    env AGENT_QA_CONFIG="$work/missing.yaml" bash "$script"
  mv "$cli" "$cli.saved"
  expect_failure 'missing CLI' 'CLI is absent' bash "$script"
  mv "$cli.saved" "$cli"

  # A read-only shell fault simulates an inaccessible config directory without chmod tricks.
  printf '%s\n' \
    'cd() { if [ "$1" = "$M3_SELFTEST_CONFIG_DIR" ]; then return 1; fi; builtin cd "$@"; }' \
    > "$work/refuse-cd.sh"
  expect_failure 'cannot enter config directory' 'cannot enter config directory' \
    env BASH_ENV="$work/refuse-cd.sh" M3_SELFTEST_CONFIG_DIR="$work/config space" bash "$script"

  [ ! -e "$build_log" ] || failed 'skip-build or selftest invoked a build'
  expect_failure 'build exit 1' 'build failed' env M3_RELEASE_GATE_SKIP_BUILD=0 bash "$script"
  grep -Fxq -- "--dir $work/repo build --force --filter=agent-qa..." "$build_log" \
    || failed 'fresh build arguments changed'
  [ "$(wc -l < "$build_log" | tr -d ' ')" -eq 1 ] || failed 'unexpected additional build'
  echo 'SELFTEST PASSED: verdicts, invocation failures and passthrough; no real build or model'
)

selftest_verb=0
case "${1:-}" in
  --selftest) selftest; exit "$?" ;;
  --selftest-verb)
    selftest_verb=1
    shift
    [ "${M3_RELEASE_GATE_SKIP_BUILD:-}" = 1 ] && [ -n "${M3_RELEASE_GATE_VERB_OVERRIDE:-}" ] \
      || fail "selftest verb requires skip-build and an override"
    ;;
esac
if [ "$selftest_verb" = 0 ] && [ -n "${M3_RELEASE_GATE_VERB_OVERRIDE:-}" ]; then
  fail "verb override is test-only (requires --selftest-verb)"
fi

if [ "${M3_RELEASE_GATE_SKIP_BUILD:-}" != 1 ]; then
  pnpm --dir "$ROOT" build --force --filter=agent-qa... >/dev/null \
    || fail "build failed before a gate verdict was produced"
fi
[ -f "$CONFIG" ] || fail "config is absent: $CONFIG"
[ -f "$CLI" ] || fail "CLI is absent: $CLI"
cd "$(dirname "$CONFIG")" || fail "cannot enter config directory: $(dirname "$CONFIG")"
status=0
if [ "$selftest_verb" = 1 ]; then
  bash -c "$M3_RELEASE_GATE_VERB_OVERRIDE" -- --config "$CONFIG" eval gate "$@" || status=$?
else
  node "$CLI" --config "$CONFIG" eval gate "$@" || status=$?
fi
case "$status" in 0|1|2) exit "$status";;
  *) fail "verb exited $status (not a gate verdict)" ;;
esac
