#!/usr/bin/env bash
#
# 396-06-credential-mutation.sh — the acceptance bar for the credential surface (396-06, Pitfall 9).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Every claim in
# `mcp-credential-surface.test.ts` is an ABSENCE, and an absence is the easiest kind of claim to
# fake: it passes over a channel that returns nothing, over a fixture that lost its plant, and over
# a value the pipeline never saw. The suite carries its own controls for the first two (an integrity
# half on every cell, a hostile control that requires a value to be FOUND). This script carries the
# third: each leg removes one masking mechanism and requires the cells aimed at it to go red.
#
# THE LEGS
#
#   C1  the SUCCESS path stops masking at all (`masked-result.ts`). Every tool's serialized output
#       is then raw on both channels — the ordinary path a model reads.
#   C2  THE SHIPPED DEFECT, restored: `structuredContent` is parsed from the UNMASKED serialization
#       while `content` stays masked. This is the exact shape 396-06 found on the wire, and the leg
#       exists because the whole-masking leg above cannot tell a corpus that reads only `content`
#       from one that reads both. It must red the cell that reads the machine channel.
#   C3  the ERROR path stops masking. T-395-R5-10's own channel: the 395 defect travelled out
#       through an error serialization, not through a success payload, and the two are separate
#       call sites — so they get separate legs.
#   C4  the apply refusal's teach stops masking (`apply-refusal.ts`). That handler is registered
#       DIRECTLY and does not pass through `catalog.ts`'s generic handler, which is exactly why
#       plan 02 made `maskText` a required dep of it — and why it needs its own leg here.
#   C5  the declared credentials stop reaching the masker (`composeMcpMasking`). The environment arm
#       is untouched, so this leg must red the DECLARED-token cells while the environment-seeded
#       cells stay green — the two arms measured separately, which is what makes A2's pairing a
#       claim about two mechanisms rather than one.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# DIST REBUILDS ARE MANDATORY FOR C1-C3 AND ARE PERFORMED HERE: `packages/cli`'s vitest config
# declares no aliases, so its import of `@vostride/agent-qa-mcp` resolves through that package's
# BUILT `dist`. C4 mutates `packages/cli` itself, which vitest resolves from source; the asymmetry
# is stated per leg rather than left implicit.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. Subjects are restored from byte
# snapshots and every restore is proven by sha256.
#
# THE LEG BODIES LIVE IN THE PYTHON BLOCK, NEVER IN A SHELL STRING (396-03's lesson: shell quoting
# mangled `?? ''` into `?? ` and the leg measured an implementation nobody wrote).
#
# USAGE
#   bash agent-qa/scripts/396-06-credential-mutation.sh
#
# KNOBS
#   CREDENTIAL_MUTATION_SELFTEST=neutered   apply a NO-OP in place of every leg; must FATAL.
#   SHOW_REDS=1                             print every cell that red under each leg.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE="src/__tests__/mcp-credential-surface.test.ts"
LEGS_PY="$(mktemp -t 396credlegs).py"
SELFTEST="${CREDENTIAL_MUTATION_SELFTEST:-}"

subject_of() {
  case "$1" in
    C1|C2|C3) echo "$ROOT/packages/mcp/src/masked-result.ts" ;;
    C4) echo "$ROOT/packages/mcp/src/apply-refusal.ts" ;;
    C5) echo "$ROOT/packages/cli/src/commands/mcp.ts" ;;
    *) return 1 ;;
  esac
}

rebuild_of() {
  case "$1" in
    C1|C2|C3|C4) echo "@vostride/agent-qa-mcp" ;;
    *) echo "" ;;
  esac
}

reds_of() {
  case "$1" in
    C1) echo "${C1_REDS:-1}" ;;
    C2) echo "${C2_REDS:-1}" ;;
    C3) echo "${C3_REDS:-2}" ;;
    C4) echo "${C4_REDS:-1}" ;;
    C5) echo "${C5_REDS:-3}" ;;
    *) return 1 ;;
  esac
}

# The cells that must stay GREEN in the same run — the arm-independence claim (C4 only: the
# environment seed is a different mechanism from the declared-token seed).
cross_of() {
  case "$1" in
    C5) echo "the config-write channel refuses" ;;
    *) echo "" ;;
  esac
}

fatal() { echo "FATAL: $*" >&2; exit 1; }

SNAP_DIR="$(mktemp -d)"

snapshot() {
  local key="$1" file
  file="$(subject_of "$key")"
  [[ -f "$file" ]] || fatal "subject not found: $file"
  cp "$file" "$SNAP_DIR/$key"
  shasum -a 256 "$SNAP_DIR/$key" | cut -d' ' -f1 > "$SNAP_DIR/$key.sha"
}

restore() {
  local key="$1" file rebuild now
  file="$(subject_of "$key")"
  cp "$SNAP_DIR/$key" "$file"
  now="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  [[ "$now" == "$(cat "$SNAP_DIR/$key.sha")" ]] \
    || fatal "$key: restore did not reproduce the subject byte-identically"
  rebuild="$(rebuild_of "$key")"
  if [[ -n "$rebuild" ]]; then
    (cd "$ROOT" && pnpm --filter "$rebuild" build >/dev/null 2>&1) \
      || fatal "$key: rebuild after restore failed"
  fi
}

restore_all() {
  local key
  for key in C1 C2 C3 C4 C5; do
    [[ -f "$SNAP_DIR/$key" ]] && cp "$SNAP_DIR/$key" "$(subject_of "$key")"
  done
  rm -rf "$SNAP_DIR" "$LEGS_PY"
}
trap restore_all EXIT

cat > "$LEGS_PY" <<'PYLEGS'
import sys

LEGS = {
    # The success path stops masking entirely: both channels carry the raw serialization.
    "C1": (
        "  const text = maskText(serialized)\n",
        "  const text = serialized\n",
    ),
    # THE SHIPPED DEFECT RESTORED: the object channel is parsed from the UNMASKED document while the
    # text channel stays masked. This is what 396-06 measured on the wire, and the only leg that
    # tells a corpus reading `structuredContent` from one reading `content` alone.
    "C2": (
        "    structuredContent = JSON.parse(text)\n",
        "    structuredContent = JSON.parse(serialized)\n",
    ),
    # The error path stops masking — T-395-R5-10's own channel.
    "C3": (
        "        text: maskText(err instanceof Error ? err.message : String(err)),\n",
        "        text: err instanceof Error ? err.message : String(err),\n",
    ),
    # The apply refusal's teach stops masking. Registered directly; crosses no generic handler.
    "C4": (
        "    const text = maskText(parts.text)\n",
        "    const text = parts.text\n",
    ),
    # The declared credentials stop reaching the masker. The environment arm is untouched.
    "C5": (
        "    secretStore: mcpTokenSecretStore(input.tokens),\n",
        "",
    ),
}

leg, snapshot, subject, neutered = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "neutered"
anchor, replacement = LEGS[leg]
if neutered:
    replacement = anchor
src = open(snapshot).read()
n = src.count(anchor)
if n != 1:
    sys.exit("anchor for %s occurs %d times in the subject, expected exactly 1" % (leg, n))
open(subject, "w").write(src.replace(anchor, replacement))
PYLEGS

run_suite() {
  local filter="$1" out status
  if [[ -n "$filter" ]]; then
    out="$(cd "$ROOT/packages/cli" && npx vitest run "$SUITE" -t "$filter" --typecheck.enabled=false 2>&1)" && status=0 || status=$?
  else
    out="$(cd "$ROOT/packages/cli" && npx vitest run "$SUITE" --typecheck.enabled=false 2>&1)" && status=0 || status=$?
  fi
  SUITE_OUT="$out"
  SUITE_STATUS="$status"
}

run_leg() {
  local leg="$1" want reds rebuild cross
  want="$(reds_of "$leg")"
  snapshot "$leg"
  python3 "$LEGS_PY" "$leg" "$SNAP_DIR/$leg" "$(subject_of "$leg")" "$SELFTEST" \
    || fatal "$leg: anchor drift"
  rebuild="$(rebuild_of "$leg")"
  if [[ -n "$rebuild" ]]; then
    (cd "$ROOT" && pnpm --filter "$rebuild" build >/dev/null 2>&1) \
      || { restore "$leg"; fatal "$leg: rebuild under the mutation failed"; }
  fi

  run_suite ""
  if [[ $SUITE_STATUS -eq 0 ]]; then
    restore "$leg"
    fatal "$leg: the suite stayed green under the mutation — the cells aimed at it are decoration"
  fi
  reds="$(printf '%s\n' "$SUITE_OUT" | grep -c '^ FAIL ' || true)"
  [[ "$reds" == "$want" ]] \
    || { restore "$leg"; fatal "$leg: expected $want failing cell(s), saw $reds"; }
  if [[ -n "${SHOW_REDS:-}" ]]; then
    printf '%s\n' "$SUITE_OUT" | grep -E '^ FAIL |^AssertionError' | sed "s/^/    $leg| /"
  fi

  cross="$(cross_of "$leg")"
  if [[ -n "$cross" ]]; then
    run_suite "$cross"
    if [[ $SUITE_STATUS -ne 0 ]]; then
      restore "$leg"
      fatal "$leg: the OTHER arm's cells also red — the two seeding arms are not independent"
    fi
    echo "  $leg RED ($reds cell(s)) · other-arm GREEN"
  else
    echo "  $leg RED ($reds cell(s))"
  fi

  restore "$leg"
}

echo "396-06 credential-surface mutation legs"

run_leg C1
run_leg C2
run_leg C3
run_leg C4
run_leg C5

# THE WIRING GREPS. Call sites, never import lines — 396-04 measured that an import left behind by
# a deleted call answers identically on both sides of its own line.
echo "wiring greps:"
CATALOG="$ROOT/packages/mcp/src/catalog.ts"
APPLY="$ROOT/packages/mcp/src/apply-refusal.ts"
MASKED="$ROOT/packages/mcp/src/masked-result.ts"
MCP_CMD="$ROOT/packages/cli/src/commands/mcp.ts"

# The raw shape this plan deleted must not come back anywhere: a handler that sets
# `structuredContent` from the op output rather than from the masked document IS the defect.
raw_structured="$({ grep -rc 'structuredContent: output' "$CATALOG" "$APPLY" || true; } | awk -F: '{ n += $2 } END { print n + 0 }')"
one_result_site="$(grep -c 'maskedToolResult(' "$CATALOG" || true)"
apply_result_site="$(grep -c 'maskedToolResult(' "$APPLY" || true)"
apply_masks="$(grep -c 'maskText(' "$APPLY" || true)"
seed_calls="$(grep -c 'mcpTokenSecretStore(' "$MCP_CMD" || true)"
env_seed="$(grep -c 'env: process.env' "$MCP_CMD" || true)"
reparse="$(grep -c 'JSON.parse(text)' "$MASKED" || true)"

[[ "$raw_structured" == "0" ]] \
  || fatal "a handler sets structuredContent from the raw op output again ($raw_structured sites) — 396-06's defect"
[[ "$one_result_site" == "1" ]] || fatal "the generic handler no longer routes through maskedToolResult ($one_result_site)"
[[ "$apply_result_site" == "1" ]] || fatal "the apply handler no longer routes through maskedToolResult ($apply_result_site)"
# apply-refusal.ts still masks the teach and the four structured refusal fields itself.
[[ "$apply_masks" -ge "4" ]] \
  || fatal "the apply handler masks fewer channels than it composes ($apply_masks call sites)"
[[ "$seed_calls" == "1" ]] || fatal "expected one declared-credential seeding site, saw $seed_calls"
[[ "$env_seed" -ge "1" ]] || fatal "the masker is no longer seeded from the process environment"
[[ "$reparse" == "1" ]] \
  || fatal "the object channel is no longer parsed from the MASKED document ($reparse)"

echo "  raw-structured 0 · maskedToolResult 1+1 · apply-mask $apply_masks · declared-seed 1 · env-seed $env_seed · reparse 1"

echo "OK — every masking channel torn separately, and each one's cells red."
