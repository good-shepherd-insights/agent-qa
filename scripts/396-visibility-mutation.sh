#!/usr/bin/env bash
#
# 396-visibility-mutation.sh — the acceptance bar for MCPS-04 (396-05).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `mcp-visibility-differential.test.ts`
# passing says the server agrees with itself today. The plan's thesis is an ABSENCE — a caller
# without `config-write` does not SEE the config tools — and an absence assertion is the easiest
# kind of claim to fake: it passes over a server that lists nothing, over a filter that was deleted,
# and over a tool nobody ships. So each leg below removes one mechanism and requires that the cells
# aimed at THAT mechanism go red.
#
# THE TWO WALLS ARE TORN SEPARATELY, WHICH IS THE POINT OF W1 AND W2 BEING TWO LEGS. D-08 claims two
# INDEPENDENT walls: a listing filter and the function layer's own scope check. A conjunction of two
# whole-input checks is weaker than the spec it implements — if both cells only ever passed together
# nothing here would tell you either one works. So:
#
#   W1  `visibleToCaller` severed to always-true. The listing wall is gone; the config tools appear
#       in every caller's `tools/list`. The absence cells must RED. The second-wall cells must stay
#       GREEN, because they reach `invokeFunction` without going through any listing at all.
#   W2  `invokeFunction`'s `missingScopes` refusal deleted. The function-layer wall is gone; a
#       caller that reaches an op it may not call is served. The second-wall cell must RED. The
#       absence cells must stay GREEN, because the listing filter is untouched.
#   K1  the declared credentials removed from the masker's seed (`composeMcpMasking`). The one
#       channel composed entirely of caller-supplied text stops being masked. 396-03 measured this
#       exact class going unnoticed by an entire green suite.
#   K2  the 401 body made to echo the `Authorization` header it just refused — the reflector a
#       refusal path becomes when somebody adds a "helpful" diagnostic.
#
# MEASURED 2026-08-16: W1 RED (10 cells) · W2 RED (2) · K1 RED (2) · K2 RED (2), with each leg's
# CROSS-WALL cells confirmed green in the same run (printed as `cross-wall GREEN`).
#
# W1's TEN is the number worth reading. Tearing the listing filter reds cells in four different
# describe groups — absence, adjacency, the empty floor, and concurrency — because they are all
# instances of D-05's ONE law rather than four rules that happen to agree. W2's TWO is equally
# worth reading for the opposite reason: it is confined to the second-wall group, which is what
# "independent" means.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS.
#
# DIST REBUILDS ARE MANDATORY FOR W1 AND W2 AND ARE PERFORMED HERE. `packages/cli`'s vitest config
# declares no aliases, so its imports of `@vostride/agent-qa-mcp` and `@vostride/agent-qa-agent`
# resolve through those packages' BUILT `dist`. A leg that edited the source and skipped the build
# would measure the previous implementation and report a confident green — the stale-dist trap,
# which is exactly how a mutation harness lies. K1 and K2 mutate `packages/cli` itself, which vitest
# resolves from source; that asymmetry is stated per leg rather than left implicit.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE.
#
# THE SUBJECTS ARE RESTORED FROM BYTE SNAPSHOTS AND EVERY RESTORE IS PROVEN by sha256, because a
# restore nobody checked is how a mutation survives into a commit.
#
# THE LEG BODIES ARE TYPESCRIPT AND LIVE IN THE PYTHON BLOCK, NEVER IN A SHELL STRING — 396-03's
# harness learned that the hard way: shell quoting mangled `?? ''` into `?? ` and the leg then
# measured an implementation nobody wrote. Anything containing a quote is data, and data goes
# through the file.
#
# USAGE
#   bash agent-qa/scripts/396-visibility-mutation.sh   # from the super-repository root
#   bash scripts/396-visibility-mutation.sh            # from the agent-qa root
#
# KNOBS
#   VISIBILITY_MUTATION_SELFTEST=neutered
#       apply a NO-OP edit in place of every mutation. The script must then FATAL with "the suite
#       stayed green" — which is what proves this script itself can fail.
#   SHOW_REDS=1
#       print the name of every cell that red under each leg. The SUMMARY quotes this output
#       rather than a hand-transcribed scrollback.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE="src/__tests__/mcp-visibility-differential.test.ts"
SELFTEST="${VISIBILITY_MUTATION_SELFTEST:-}"

# Per-leg metadata as CASE LOOKUPS rather than associative arrays: macOS ships bash 3.2, where
# `declare -A` silently becomes an indexed array and every named key reads as an unbound variable.
# A harness that dies on the operator's default shell is a harness nobody runs.
subject_of() {
  case "$1" in
    W1) echo "$ROOT/packages/mcp/src/visibility.ts" ;;
    W2) echo "$ROOT/packages/agent/src/functions/invoke.ts" ;;
    K1|K2) echo "$ROOT/packages/cli/src/commands/mcp.ts" ;;
    *) return 1 ;;
  esac
}

# Which workspace package must be rebuilt before the cli suite can see the leg. Empty = none.
rebuild_of() {
  case "$1" in
    W1) echo "@vostride/agent-qa-mcp" ;;
    W2) echo "@vostride/agent-qa-agent" ;;
    *) echo "" ;;
  esac
}

# The RED count is taken over the WHOLE suite rather than over a filtered group, deliberately: a
# torn wall is not confined to the describe block written for it, and a filter would hide the
# collateral — which is itself evidence about how much of the surface that wall holds up. The
# cross-wall check below is the filtered run.

# The cells that must stay GREEN in the same run — the cross-wall independence claim.
cross_of() {
  case "$1" in
    W1) echo "the function layer refuses independently" ;;
    W2) echo "the config tools are ABSENT" ;;
    *) echo "" ;;
  esac
}

fatal() { echo "FATAL: $*" >&2; exit 1; }

SNAP_DIR="$(mktemp -d)"
# THE LEGS SCRIPT LIVES INSIDE THE SNAPSHOT DIRECTORY (2026-08-16, UAT item 3 · CR-04). This was
# `LEGS_PY="$(mktemp -t 396vislegs).py"` at the top of the file, which has two defects in one
# expression. `mktemp -t <prefix>` is a BSD idiom that GNU coreutils REFUSES ("too few X's in
# template"), and under `set -euo pipefail` the assignment aborts the script — so this harness
# could not run on the ubuntu CI runner at all. And appending `.py` names a path `mktemp` never
# created: the exclusively-created file leaked, and the `.py` path was a predictable name in a
# world-writable directory that a local attacker could pre-place as a symlink, through which this
# script then writes executable Python and runs it. The directory above is made by ONE atomic
# `mktemp -d`, is already removed by the cleanup below, and holds the snapshots — so putting the
# generated script in it fixes both defects and adds no second thing to clean up.
LEGS_PY="$SNAP_DIR/legs.py"


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
  for key in W1 W2 K1 K2; do
    [[ -f "$SNAP_DIR/$key" ]] && cp "$SNAP_DIR/$key" "$(subject_of "$key")"
  done
  rm -rf "$SNAP_DIR"
}
trap restore_all EXIT

cat > "$LEGS_PY" <<'PYLEGS'
import sys

LEGS = {
    # WALL 1 severed: every tool is visible to every caller. The predicate still exists, still
    # takes both arguments, and answers the same thing for all of them.
    "W1": (
        "  return requiredScopes.every((scope) => grantedScopes.includes(scope))\n",
        "  return requiredScopes.length >= 0 && grantedScopes.length >= 0\n",
    ),
    # WALL 2 severed: the function layer stops refusing a caller that lacks a required scope. The
    # computation is left in place so nothing else about the file changes.
    "W2": (
        "  if (missingScopes.length > 0) {\n"
        "    throw new FunctionScopeError(functionId, missingScopes)\n"
        "  }\n",
        "  if (missingScopes.length > 999) {\n"
        "    throw new FunctionScopeError(functionId, missingScopes)\n"
        "  }\n",
    ),
    # The declared credentials stop reaching the masker. Everything else about the masker is
    # unchanged, which is the honest shape of this mistake: somebody simplifies a call.
    "K1": (
        "    secretStore: mcpTokenSecretStore(input.tokens),\n",
        "",
    ),
    # The refusal path becomes a reflector: the 401 body quotes what it just refused. This is what
    # a "more helpful error message" looks like on an auth path.
    "K2": (
        "      res.end(JSON.stringify({ error: 'invalid_token' }))\n",
        "      res.end(JSON.stringify({ error: 'invalid_token', presented: req.headers.authorization }))\n",
    ),
}

leg, snapshot, subject, neutered = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "neutered"
anchor, replacement = LEGS[leg]
if neutered:
    replacement = anchor
src = open(snapshot).read()
# An anchor that no longer occurs exactly once FATALs rather than silently mutating nothing: a leg
# that edited no bytes and then saw a green suite would read as a passing measurement.
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
  local leg="$1" want_reds="$2" reds rebuild cross
  snapshot "$leg"
  python3 "$LEGS_PY" "$leg" "$SNAP_DIR/$leg" "$(subject_of "$leg")" "$SELFTEST" \
    || fatal "$leg: anchor drift"
  rebuild="$(rebuild_of "$leg")"
  if [[ -n "$rebuild" ]]; then
    (cd "$ROOT" && pnpm --filter "$rebuild" build >/dev/null 2>&1) \
      || { restore "$leg"; fatal "$leg: rebuild under the mutation failed"; }
  fi

  # The whole suite, so the red count says how much of the surface this wall was holding.
  run_suite ""
  if [[ $SUITE_STATUS -eq 0 ]]; then
    restore "$leg"
    fatal "$leg: the suite stayed green under the mutation — the cells aimed at it are decoration"
  fi
  reds="$(printf '%s\n' "$SUITE_OUT" | grep -c '^ FAIL ' || true)"
  [[ "$reds" == "$want_reds" ]] || { restore "$leg"; fatal "$leg: expected $want_reds failing cell(s), saw $reds"; }
  # The names of the cells that red, on request — this is the evidence a SUMMARY quotes, and
  # transcribing it by hand from a scrollback is how a recorded RED stops matching the run.
  if [[ -n "${SHOW_REDS:-}" ]]; then
    printf '%s\n' "$SUITE_OUT" | grep -E '^ FAIL |^AssertionError' | sed "s/^/    $leg| /"
  fi

  # The CROSS-WALL cells must stay green under the same mutation — the leg that proves the walls
  # are two mechanisms and not one check spelled twice.
  cross="$(cross_of "$leg")"
  if [[ -n "$cross" ]]; then
    run_suite "$cross"
    if [[ $SUITE_STATUS -ne 0 ]]; then
      restore "$leg"
      fatal "$leg: the OTHER wall's cells also red — the two walls are not independent"
    fi
    echo "  $leg RED ($reds failing cell(s)) · cross-wall GREEN"
  else
    echo "  $leg RED ($reds failing cell(s))"
  fi

  restore "$leg"
}

echo "396-05 MCPS-04 visibility mutation legs"

run_leg W1 "${W1_REDS:-10}"
run_leg W2 "${W2_REDS:-2}"
run_leg K1 "${K1_REDS:-2}"
run_leg K2 "${K2_REDS:-2}"

# THE PROHIBITION GREPS, EACH MEASURED ON BOTH SIDES OF THE LINE IT DRAWS.
#
# None of these count IMPORT LINES. 396-04 measured that an import left behind by a deleted call
# makes an import-count grep answer identically on both sides of its own line, and a check that
# cannot tell "wired" from "unwired" is not a check. These count CALL SITES and symbol occurrences,
# which is what moves when the behaviour moves.
echo "wiring greps:"
MCP_CMD="$ROOT/packages/cli/src/commands/mcp.ts"
RESOLUTION="$ROOT/packages/cli/src/composition/mcp-token-resolution.ts"

cors="$(grep -v '^[[:space:]]*//' "$MCP_CMD" | grep -ci 'access-control-allow-origin' || true)"
bind="$(grep -c "MCP_HTTP_BIND_HOST = '127.0.0.1'" "$MCP_CMD" || true)"
bearer_calls="$(grep -c 'matchBearer(' "$MCP_CMD" || true)"
seed_calls="$(grep -c 'mcpTokenSecretStore(' "$MCP_CMD" || true)"
host_guard="$(grep -c 'validateHostHeader(' "$MCP_CMD" || true)"
origin_guard="$(grep -c 'validateOriginHeader(' "$MCP_CMD" || true)"
build_calls="$(grep -c 'buildAgentQaMcpServer(' "$MCP_CMD" || true)"
timing="$(grep -c 'timingSafeEqual(' "$RESOLUTION" || true)"
derived="$(grep -c 'FunctionScopeSchema.options.filter' "$RESOLUTION" || true)"
literal_default="$(grep -cE "^\s*'(read|run)',\s*$" "$RESOLUTION" || true)"

[[ "$cors" == "0" ]]           || fatal "the mcp command emits a CORS header ($cors) — recorded prohibition"
[[ "$bind" == "1" ]]           || fatal "the loopback bind host is not a constant ($bind)"
[[ "$bearer_calls" == "1" ]]   || fatal "expected exactly one matchBearer call site, saw $bearer_calls"
[[ "$seed_calls" == "1" ]]     || fatal "expected exactly one masker seeding call site, saw $seed_calls"
[[ "$host_guard" == "1" ]]     || fatal "expected exactly one Host guard call site, saw $host_guard"
[[ "$origin_guard" == "1" ]]   || fatal "expected exactly one Origin guard call site, saw $origin_guard"
[[ "$build_calls" == "1" ]]    || fatal "stdio and HTTP no longer share ONE buildAgentQaMcpServer call site (saw $build_calls)"
[[ "$timing" == "1" ]]         || fatal "the token comparison is not constant-time ($timing timingSafeEqual call sites)"
[[ "$derived" == "1" ]]        || fatal "DEFAULT_MCP_SCOPES is no longer derived from the scope union ($derived)"
[[ "$literal_default" == "0" ]] || fatal "a literal scope list appeared in the resolution module ($literal_default)"

echo "  cors 0 · bind 1 · matchBearer 1 · masker-seed 1 · host 1 · origin 1 · buildServer 1"
echo "  timingSafeEqual 1 · derived-default 1 · literal-scope-lines 0"

echo "OK — four legs red, each wall torn separately, the wiring greps discriminate."
