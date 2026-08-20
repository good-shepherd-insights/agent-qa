#!/usr/bin/env bash
# Phase 399.1 — the UAT item the automated lane could not reach, discharged by a HARNESS.
#
# THE ITEM. 399.1-VERIFICATION.md carried exactly one `behavior_unverified` truth: every op whose
# output union has a refusal arm declares a classifier mapping it to `refused` — measured on
# `authoring.draft.write`, the op phase 399 filed reporting `executed` over a dedup refusal. The
# classifier is unit-proven (`refusal-classifiers.test.ts`, 47/47), but the truth's own NAMED
# witness is end-to-end: the SHIPPED chat binary must print the refusal on a terminal.
#
# WHY IT LOOKED HUMAN, AND WHY IT IS NOT. The op is `mutating-shared`, so `invokeFunction`'s gate
# demands an interactive confirmation. `createChatConfirmPort` returns `undefined` unless BOTH
# `process.stdin.isTTY` and `process.stdout.isTTY` are true, and a pipe satisfies neither — so
# every scripted drive lands on `FunctionDeniedError` before the dedup screen runs. That is a
# HARNESS need, not a judgement need: nothing here asks a person to decide anything. The expected
# bytes are fully specified, and a pseudo-terminal supplies what a pipe cannot. `script(1)` is
# already installed everywhere this project runs, so no dependency is added to buy it.
#
# THE THREE-WAY DIFFERENTIAL IS THE POINT. A single green drive would not distinguish "the
# approval opened the gate" from "the gate was never closed". Each arm below fixes one variable:
#
#   A0 `fn` door, no pty             -> FunctionDeniedError, dedup never runs
#   A1 `chat` door, no pty           -> `failed`, NO approval prompt, dedup never runs
#   B  `chat` door, pty, answered `n`-> `failed`   (the person refused; gate reached, not passed)
#   C  `chat` door, pty, answered `y`-> `refused`  + `duplicate-of:<ref>` (gate passed, dedup ran)
#
# A0 is the door the phase's own verifier measured, kept because it is the shipped `fn` surface.
# A1 EXISTS BECAUSE A0 IS NOT A ONE-VARIABLE CONTROL FOR C: it changes the door AND the terminal at
# once. A1 holds the door fixed at `chat` and varies only the terminal, so the pair (A1, B) isolates
# the pty and the pair (B, C) isolates the answered byte. An earlier revision shipped A0 alone under
# a banner claiming "A and B differ from C in ONE byte" — true of B, FALSE of A0. The claim was
# corrected by MEASURING the missing cell rather than by softening the sentence.
#
# NOTE ON A1 vs B: both print `failed  authoring.draft.write`, so that line does NOT discriminate
# them. What does is the approval PROMPT — absent without a pty, present with one — which is why
# each pty arm checks for it FIRST and why A1 asserts its absence.
#
# NON-VACUITY. Arm C asserts the refusal is the DEDUP arm — `matchedRef`, and a `score` at or above
# the pinned `threshold` — before it asserts the receipt word. A drive that refused for any other
# reason cannot satisfy it.
#
# Exit 0 = all three arms held. Any other exit = a FATAL below, printed with what it expected.

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLI_ENTRY="$REPO_ROOT/packages/cli/dist/cli.js"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/agent-qa-399.1-uat-XXXXXX")
FAILURES=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

fatal () { echo "FATAL: $*" >&2; FAILURES=$((FAILURES + 1)); }
note  () { echo "  ok — $*"; }

# ---- the pty primitive, portable across BSD and util-linux `script` ---------------------------
#
# The two spellings are incompatible and neither errors usefully on the other's syntax, so this is
# resolved ONCE by probing what the host actually has rather than by branching on `uname`.
# Resolved ONCE, from `script`'s own help text, and never from a trial invocation. An earlier
# revision probed by RUNNING `script -q /dev/null true` and branching on its exit status; that
# reads the ambient stdin the probe inherits, so once a caller had consumed stdin the probe
# started failing and silently selected the util-linux spelling on macOS. Both arms then died on
# `illegal option -- c` — and a harness whose pty primitive is broken FAILS EVERY ARM, which is
# indistinguishable at a glance from the defect it exists to catch. Caught by exactly that
# confusion during this script's own mutation test.
if script --help 2>&1 | grep -q -- '--command'; then
  SCRIPT_FLAVOUR=util-linux
else
  SCRIPT_FLAVOUR=bsd
fi

pty_run () {
  local input_producer="$1"; shift
  # The producer's stderr is discarded: its trailing writes land after `script` has exited, so a
  # harmless SIGPIPE would otherwise print "write error: Broken pipe" into a PASSING run — noise
  # that reads like a failure and teaches people to skim this output.
  if [ "$SCRIPT_FLAVOUR" = bsd ]; then
    { eval "$input_producer"; } 2>/dev/null | script -q /dev/null "$@" 2>&1
  else
    { eval "$input_producer"; } 2>/dev/null | script -qec "$(printf '%q ' "$@")" /dev/null 2>&1
  fi
}

strip_ansi () { sed 's/\x1b\[[0-9;]*m//g; s/\x1b\[[0-9]*[GJK]//g'; }

# ---- the fixture: a project whose suite contains EXACTLY ONE test ------------------------------
#
# One test, so `comparedTests` is a number this script can assert rather than a number that drifts
# with whatever else a fixture happened to carry. The intent driven below is that test's name
# VERBATIM, so the screen's similarity is 1.0 — far above the 0.45 pin, and independent of the
# tokenizer's treatment of any particular word. This harness pins the RENDER, not the threshold;
# `__tests__/fixtures/dedup-corpus/` is where the pin itself is measured.
FIXTURE="$WORK/project"
mkdir -p "$FIXTURE/tests" "$FIXTURE/.agent-qa"
DUP_TEST_NAME="Submit the local form as a returning user"
EXPECTED_REF="tests/uat-381-ladder.yaml::${DUP_TEST_NAME}"

cat > "$FIXTURE/agent-qa.config.yaml" <<'YAML'
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local
use:
  mobile:
    appState: preserve
registry:
  targets:
    local-form:
      platform: web
      url: http://127.0.0.1:8931/form.html
YAML

cat > "$FIXTURE/tests/uat-381-ladder.yaml" <<YAML
name: ${DUP_TEST_NAME}
test-id: t_posing-clock-inject-pill-adds-ima-rename-video-emu-fault
target: local-form
use:
  browser:
    headless: true
steps:
  - Type "returning-user" into the Username field
  - Click the Submit button
  - Verify the page says "Received!"
YAML

UTTERANCE='/fn authoring.draft.write {"intent":"'"${DUP_TEST_NAME}"'","scope":{"tier":"product","key":"local-form"}}'

# The child's whole environment, constructed rather than inherited — `hermeticEnv`'s reasoning in
# `conformance/spawned-chat.ts`: a developer with a provider key exported must not be running a
# different composition from CI, and HOME/TMPDIR point INTO the fixture so nothing escapes it.
run_chat () {
  local producer="$1"
  pty_run "$producer" env -i PATH="$PATH" HOME="$FIXTURE" TMPDIR="$FIXTURE/.agent-qa" \
    NODE_ENV=test node "$CLI_ENTRY" --config "$FIXTURE/agent-qa.config.yaml" chat | strip_ansi
}

# ---- stale-dist guard -------------------------------------------------------------------------
#
# Every arm below resolves through the BUILT cli.js. A dist older than the source would measure a
# composition nobody is shipping — the failure mode this project files as "green that never ran".
if [ ! -f "$CLI_ENTRY" ]; then
  fatal "no built CLI at $CLI_ENTRY — run \`pnpm build --force\` at $REPO_ROOT first"
  exit 1
fi
# `__tests__` is EXCLUDED deliberately: no test file compiles into `dist`, so a newer one says
# nothing about whether the binary is current. Ranging over them made this guard fire on an
# untouched checkout — a guard that cries stale on a fresh build is one people learn to skip.
NEWER=$(find "$REPO_ROOT/packages/cli/src" "$REPO_ROOT/packages/agent/src" \
  -type d -name '__tests__' -prune -o \
  -name '*.ts' ! -name '*.test.ts' -newer "$CLI_ENTRY" -print -quit 2>/dev/null)
if [ -n "$NEWER" ]; then
  fatal "dist is STALE — $NEWER is newer than $CLI_ENTRY. Run \`pnpm build --force\` at $REPO_ROOT."
  exit 1
fi
note "dist is newer than every source file in packages/cli and packages/agent"

echo
echo "── ARM A0 — \`fn\` door, no pty: the gate cannot be answered, so the screen never runs ──"
A_OUT=$(printf '%s\n' "$UTTERANCE" | env -i PATH="$PATH" HOME="$FIXTURE" \
  TMPDIR="$FIXTURE/.agent-qa" NODE_ENV=test node "$CLI_ENTRY" \
  --config "$FIXTURE/agent-qa.config.yaml" fn authoring.draft.write \
  --input '{"intent":"'"${DUP_TEST_NAME}"'","scope":{"tier":"product","key":"local-form"}}' 2>&1 | strip_ansi)
if printf '%s' "$A_OUT" | grep -q 'FunctionDeniedError'; then
  note "denied without a terminal (FunctionDeniedError)"
else
  fatal "ARM A0 expected FunctionDeniedError without a pty; got:"; printf '%s\n' "$A_OUT" >&2
fi
if printf '%s' "$A_OUT" | grep -q 'duplicate-of:'; then
  fatal "ARM A0 reached the dedup screen — the gate is NOT closed on a pipe, which invalidates arm C"
else
  note "the dedup screen was never reached (no duplicate-of: in arm A0)"
fi

echo
echo "── ARM A1 — \`chat\` door, no pty: same door as C, only the terminal removed ──"
A1_OUT=$(printf '%s\n/exit\n' "$UTTERANCE" | env -i PATH="$PATH" HOME="$FIXTURE" \
  TMPDIR="$FIXTURE/.agent-qa" NODE_ENV=test node "$CLI_ENTRY" \
  --config "$FIXTURE/agent-qa.config.yaml" chat 2>&1 | strip_ansi)
if printf '%s' "$A1_OUT" | grep -q 'needs your approval'; then
  fatal "ARM A1 saw an approval prompt on a PIPE — the tty guard is not holding, so arm C's pty proves nothing"
else
  note "no approval prompt without a pty (the tty guard holds on the chat door)"
fi
if printf '%s' "$A1_OUT" | grep -q 'duplicate-of:'; then
  fatal "ARM A1 reached the dedup screen on a pipe — arm C would then measure nothing; got:"; printf '%s\n' "$A1_OUT" >&2
else
  note "the dedup screen was never reached (no duplicate-of: in arm A1)"
fi

echo
echo "── ARM B — pty, answered \`n\`: the gate is REACHED and refused by the person ──"
B_OUT=$(run_chat "{ sleep 6; printf '%s\\n' '$UTTERANCE'; sleep 8; printf 'n\\n'; sleep 12; printf '/exit\\n'; sleep 4; }")
if printf '%s' "$B_OUT" | grep -q 'needs your approval'; then
  note "the approval prompt was reached on a pty"
else
  fatal "ARM B never reached the approval prompt — the pty primitive is not working; got:"; printf '%s\n' "$B_OUT" >&2
fi
if printf '%s' "$B_OUT" | grep -qE '^[[:space:]]*failed[[:space:]]+authoring\.draft\.write'; then
  note "a denied approval renders \`failed authoring.draft.write\`"
else
  fatal "ARM B expected a 'failed  authoring.draft.write' receipt after answering n; got:"; printf '%s\n' "$B_OUT" >&2
fi
if printf '%s' "$B_OUT" | grep -q 'duplicate-of:'; then
  fatal "ARM B reached the dedup screen despite refusing the gate — arm C would then prove nothing"
else
  note "the dedup screen was never reached (no duplicate-of: in arm B)"
fi

echo
echo "── ARM C — pty, answered \`y\`: the gate PASSES and the dedup refusal is rendered ──"
C_OUT=$(run_chat "{ sleep 6; printf '%s\\n' '$UTTERANCE'; sleep 8; printf 'y\\n'; sleep 15; printf '/exit\\n'; sleep 5; }")

# NON-VACUITY FIRST: prove the refusal is the DEDUP arm before reading the receipt word.
if printf '%s' "$C_OUT" | grep -Fq "\"matchedRef\": \"${EXPECTED_REF}\""; then
  note "the payload names the matched test: ${EXPECTED_REF}"
else
  fatal "ARM C payload did not carry matchedRef ${EXPECTED_REF}; got:"; printf '%s\n' "$C_OUT" >&2
fi
C_SCORE=$(printf '%s' "$C_OUT" | grep -E '^\s*"score":' | head -1 | tr -dc '0-9.')
C_THRESHOLD=$(printf '%s' "$C_OUT" | grep -E '^\s*"threshold":' | head -1 | tr -dc '0-9.')
if [ -n "$C_SCORE" ] && [ -n "$C_THRESHOLD" ] && \
   awk -v s="$C_SCORE" -v t="$C_THRESHOLD" 'BEGIN{exit !(s>=t)}'; then
  note "the screen refused on its own arithmetic: score $C_SCORE >= threshold $C_THRESHOLD"
else
  fatal "ARM C could not read score>=threshold from the payload (score='$C_SCORE' threshold='$C_THRESHOLD')"
fi

# The fixture carries EXACTLY ONE test, so the screen must report comparing exactly one. The
# header claims this is assertable; asserting it is what makes the claim true. A fixture that
# silently grew a second test would change what `score` means without changing any word above.
C_COMPARED=$(printf '%s' "$C_OUT" | grep -E '^\s*"comparedTests":' | head -1 | tr -dc '0-9')
if [ "$C_COMPARED" = "1" ]; then
  note "the screen compared exactly the one test the fixture contains"
else
  fatal "ARM C expected comparedTests 1 (the fixture has one test); got '$C_COMPARED'"
fi

# THE ITEM'S OWN TWO ASSERTIONS.
if printf '%s' "$C_OUT" | grep -qE '^[[:space:]]*refused[[:space:]]+authoring\.draft\.write'; then
  note "the receipt line reads \`refused  authoring.draft.write\`"
else
  fatal "ARM C expected a 'refused  authoring.draft.write' receipt line; got:"; printf '%s\n' "$C_OUT" >&2
fi
if printf '%s' "$C_OUT" | grep -Fq "duplicate-of:${EXPECTED_REF}"; then
  note "the outcome names duplicate-of:${EXPECTED_REF}"
else
  fatal "ARM C expected the outcome to name duplicate-of:${EXPECTED_REF}; got:"; printf '%s\n' "$C_OUT" >&2
fi
# The success word must be ABSENT on this op's receipt — the 399 witness printed exactly that.
if printf '%s' "$C_OUT" | grep -qE '^[[:space:]]*executed[[:space:]]+authoring\.draft\.write'; then
  fatal "ARM C printed an \`executed  authoring.draft.write\` receipt — the 399 defect, reproduced"
else
  note "no \`executed  authoring.draft.write\` line anywhere in the transcript"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "FAILED — $FAILURES check(s) did not hold." >&2
  exit 1
fi
cat <<'DONE'
PASS — the 399.1 UAT item is discharged end-to-end, on the shipped binary:

  A0 fn door,   no pty         -> FunctionDeniedError, dedup never runs
  A1 chat door, no pty         -> failed   authoring.draft.write, NO approval prompt
  B  chat door, pty, answered n-> failed   authoring.draft.write, prompt SHOWN
  C  chat door, pty, answered y-> refused  authoring.draft.write
                                  duplicate-of:tests/uat-381-ladder.yaml::Submit the local form as a returning user

  A1 and B hold the door fixed and differ only in whether a terminal exists; B and C hold both
  fixed and differ only in the byte answered. So C measures the gate and the screen behind it
  rather than the absence of either — and no single arm changes two things at once.
DONE
