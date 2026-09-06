#!/usr/bin/env bash
#
# 413-eval-root-hygiene.sh — validate:eval-root-hygiene (413 D-12; SC2, SC4, D-18; 414 D-03).
#
# WHAT THIS PROVES. Six properties of the committed measurement substrate that must hold for
# every later v55 phase, not just for the commit that introduced them:
#
#   L1  no absolute machine path anywhere in the committed eval root  -> PASS L1 / FAIL L1
#       — the scan is the WHOLE root, so it covers `corpus/`, `labels/`, `cassettes/`,
#       `contracts/`, `exclusions/` and `reports/` BY CONSTRUCTION rather than by a dir list
#       (414 D-02). `contracts/partition-<product>.json` and `exclusions/<product>/<runSlug>.json`
#       are the two dirs Phase 414 adds; the self-test plants under both, because "covered by
#       construction" is exactly the kind of claim that is true until someone narrows the scan.
#   L2  no inherited-threshold literal on any gate path               -> PASS L2 / FAIL L2
#   L3  the same-family judge override is not enabled in the demo cfg -> PASS L3 / FAIL L3
#   L4  the v50 39/45 same-family report is still in place, still     -> PASS L4 / FAIL L4
#       carrying its familyOverride marker (D-18 refusal fixture)
#   L5  valid noise-floor artefacts (415, 2026-09-05)                 -> PASS L5 / FAIL L5
#       — canonical schema + committability, explained exact-zero floors, no noise-floor.json
#   L6  no schemaVersion 1 entry under corpus/                        -> PASS L6 / FAIL L6
#       — the 414 D-03 reviewed migration rewrote all 155 committed entries to schemaVersion 2
#       (414-10). A v1 entry reappearing under `corpus/` means an unmigrated re-seed slipped in
#       behind the one-way partition, so its `split` was never assigned by a committed manifest.
#       The scope is `corpus/` ONLY, and deliberately so: `schemaVersion: 1` is the CURRENT and
#       correct version of `eval-root.json`, of every `contracts/*.json` and of every
#       `cassettes/**/cassette.json`, and the v1 guard fixture that proves the one v1|v2 guard
#       lives in `packages/eval/src/labels/__tests__/fixtures/`. A whole-root scan would red on
#       all of them. Only `corpus/` entries were migrated by 414 D-03, so only `corpus/` is law.
#
# WHY A GREEN SUITE DOES NOT PROVE IT. The workspace vitest suite never reads the committed eval
# root and never reads the demo config — `packages/eval` is pure by construction (its own
# module-discipline cell forbids runtime IO) and every gate is deliberately kept out of vitest
# (FLOOR-05, plus the suite's known contention flake). So each of these six is a property of
# BYTES ON DISK OUTSIDE THE SUITE'S REACH: a home-directory path re-seeded into a corpus entry, a
# threshold constant smuggled onto a gate path, the override flipped back on, the refusal fixture
# quietly regenerated, or an invalid floor published — none of them turn a single existing
# test red. This script is the instrument that sees them.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS. `--selftest` plants a
# home-directory path into a throwaway copy of the eval root, then a Windows drive-letter path into
# the same copy, then a home-directory path under `exclusions/`, then one inside a
# `contracts/partition-*.json`, then a threshold literal into a throwaway gate file, and finally a
# `{"schemaVersion": 1}` entry under `corpus/`, and REQUIRES L1 four times, L2 once and L6 once to
# red under those six plants. Phase 415 adds incomplete/malformed and unusable floors, an
# unexplained zero floor and the forbidden literal noise-floor.json path (all must FAIL L5),
# plus complete measured and explained-zero floor fixtures (must PASS L5).
# Every invalid plant uses a literal or a path that never appears in the
# shipped tree, and each is removed before the next so no plant can mask another. A leg that stays
# green under its own plant exits 1 with SELFTEST FAILED.
#
# EXIT CODES ARE READ FROM THE PROCESS, NEVER THROUGH A PIPE. `grep` returns 1 for "no match",
# which is this script's success condition on five of six legs, so every grep's status is captured
# with `|| status=$?` and read as 0=hit / 1=clean / >=2=grep itself failed (also a FAIL — a leg
# that could not run has not passed).
#
# L2 SCOPE IS DELIBERATELY NARROW (Pitfall 8). A bare `0.867` matches cassette geometry
# (`310.8671875`), so the pattern is anchored on both sides and the scope is the gate surface only:
# the committed reports plus the eval / eval-local / cli-eval sources, with `--exclude-dir=__tests__`
# because a test may legitimately cite the inherited number as a fixture. The fixture report's own
# `0.8666666666666667` does not match the anchored pattern and must not.
#
# L5 IS THE VALIDITY LEG (Phase 415, 2026-09-05). The phase-scoped no-floor leg is retired.
# Phase 413 publishes none; 415 uses the built eval package schema and committability guards, and
# forbids the literal reports/**/noise-floor.json path in favor of reports/noise-floor/<key>.json.
#
# ENV OVERRIDES exist for the self-test only:
#   EVAL_ROOT             the committed eval root to scan
#   DEMO_CONFIG           the demo config to read for L3
#   GATE_PATHS_OVERRIDE   colon-separated replacement for L2's gate path list

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVAL_ROOT="${EVAL_ROOT:-$ROOT/../demo/init/agent-qa-eval}"
DEMO_CONFIG="${DEMO_CONFIG:-$ROOT/../demo/init/agent-qa.config.yaml}"

FIXTURE_BATCH_KEY='358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e'

# L1's three absolute-path shapes. The drive-letter arm is boundary-anchored on the left and
# requires a path character after the separator, because a bare `[A-Za-z]:\` matches JSON string
# escapes that are not paths at all — the committed tree really contains `fields:\n-` and
# `Search:\"`, and a leg that reds on those would be turned off within a phase. A genuine Windows
# path (`C:\Users\…` in markdown, `"C:\\Users\\…"` in JSON) still matches both forms.
ABSOLUTE_PATH_PATTERN='(/Users/|/home/|(^|[^A-Za-z0-9])[A-Za-z]:\\+[A-Za-z0-9_.$-])'

pass() { echo "PASS $1" >&2; }
fail() { echo "FAIL $1: $2" >&2; fail_count=1; }

gate_paths() {
  if [ -n "${GATE_PATHS_OVERRIDE:-}" ]; then
    local IFS=':'
    # shellcheck disable=SC2086
    for path in $GATE_PATHS_OVERRIDE; do [ -n "$path" ] && echo "$path"; done
    return 0
  fi
  echo "$EVAL_ROOT/reports"
  # eval/src/gate and eval/src/stats are already inside packages/eval/src.
  echo "$ROOT/packages/eval/src"
  echo "$ROOT/packages/eval-local/src"
  echo "$ROOT/packages/cli/src/commands/eval.ts"
  [ -e "$ROOT/scripts/m3-release-gate.sh" ] && echo "$ROOT/scripts/m3-release-gate.sh"
  for file in "$ROOT/packages/cli/src/"eval-*.ts; do
    [ -e "$file" ] && echo "$file"
  done
}

run_legs() {
  fail_count=0
  local status hits

  # ---- L1: no absolute machine path in the committed eval root -----------------------------
  # A leg that scanned nothing has not passed (T-413-15). `grep -r` over a missing directory
  # returns "no match" on this platform, so the root's existence is asserted before the scan
  # rather than inferred from the scan's exit code.
  if [ ! -d "$EVAL_ROOT/corpus" ]; then
    fail L1 "no committed corpus at $EVAL_ROOT/corpus — the scan would cover nothing"
  else
    status=0
    hits=$(grep -rEl "$ABSOLUTE_PATH_PATTERN" "$EVAL_ROOT" --include='*.json' --include='*.md') || status=$?
    if [ "$status" -eq 0 ]; then
      fail L1 "absolute path in the committed eval root: $(echo "$hits" | head -5 | tr '\n' ' ')"
    elif [ "$status" -eq 1 ]; then
      pass L1
    else
      fail L1 "grep could not scan $EVAL_ROOT (exit $status)"
    fi
  fi

  # ---- L2: no inherited-threshold literal on a gate path -----------------------------------
  local -a paths=()
  while IFS= read -r line; do paths+=("$line"); done < <(gate_paths)
  status=0
  if [ "${#paths[@]}" -eq 0 ]; then
    fail L2 "no gate paths resolved — the leg would scan nothing"
  else
    hits=$(grep -rEn --exclude-dir=__tests__ '(^|[^0-9.])(0\.867|86\.7)([^0-9]|$)' "${paths[@]}") || status=$?
    if [ "$status" -eq 0 ]; then
      fail L2 "inherited threshold literal on a gate path: $(echo "$hits" | head -3 | tr '\n' ' ')"
    elif [ "$status" -eq 1 ]; then
      pass L2
    else
      fail L2 "grep could not scan the gate paths (exit $status)"
    fi
  fi

  # ---- L3: the same-family override is not enabled in the demo config ----------------------
  if [ ! -f "$DEMO_CONFIG" ]; then
    fail L3 "demo config not found at $DEMO_CONFIG"
  else
    status=0
    hits=$(grep -vE '^[[:space:]]*#' "$DEMO_CONFIG" | grep -E 'judgeAllowSameFamily:[[:space:]]*true') || status=$?
    if [ "$status" -eq 0 ]; then
      fail L3 "the D-10 same-family override is enabled: $hits"
    else
      pass L3
    fi
  fi

  # ---- L4: the D-18 refusal fixture is in place, untouched ---------------------------------
  local fixture="$EVAL_ROOT/reports/$FIXTURE_BATCH_KEY/report.json"
  if [ ! -f "$fixture" ]; then
    fail L4 "the v50 same-family refusal fixture is missing: $fixture"
  else
    status=0
    grep -q '"familyOverride": "same-family-allowed"' "$fixture" || status=$?
    if [ "$status" -eq 0 ]; then
      pass L4
    else
      fail L4 "the refusal fixture no longer carries its same-family override marker: $fixture"
    fi
  fi

  # ---- L5: noise-floor validity (415, 2026-09-05) ------------------------------------------
  local floor_dir="$EVAL_ROOT/reports/noise-floor" floor_file reason floor_count=0 l5_failed=0
  if [ ! -d "$EVAL_ROOT/reports" ]; then
    fail L5 "reports/ not found under $EVAL_ROOT"
  else
    status=0
    hits=$(find "$EVAL_ROOT/reports" -name 'noise-floor.json') || status=$?
    if [ "$status" -ne 0 ]; then
      fail L5 "find could not scan reports/ (exit $status)"
    elif [ -n "$hits" ]; then
      fail "L5 ${hits%%$'\n'*}" "literal noise-floor.json is forbidden; use reports/noise-floor/<profile-key>.json"
    elif [ ! -e "$floor_dir" ]; then
      pass "L5 (no floor committed yet)"
    elif [ ! -d "$floor_dir" ]; then
      fail "L5 $floor_dir" "expected a noise-floor directory"
    else
      status=0
      hits=$(find "$floor_dir" -name '*.json') || status=$?
      if [ "$status" -ne 0 ]; then
        fail "L5 $floor_dir" "find could not scan floor artefacts (exit $status)"
      else
        while IFS= read -r floor_file; do
          [ -n "$floor_file" ] || continue
          floor_count=$((floor_count + 1))
          status=0
          reason=$(node -e '
            const { guardNoiseFloorArtefact, assertFloorArtefactCommittable,
              renderFloorRefusal } = require(process.argv[2])
            let floor
            try {
              floor = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
            } catch (error) {
              console.error("cannot parse floor JSON: " + error.message)
              process.exit(1)
            }
            const guarded = guardNoiseFloorArtefact(floor)
            if (guarded.kind === "rejected") {
              console.error(guarded.reason)
              process.exit(1)
            }
            const admission = assertFloorArtefactCommittable(guarded.artefact)
            if (!admission.ok) {
              console.error(renderFloorRefusal(admission.refusal))
              process.exit(1)
            }
          ' "$floor_file" "$ROOT/packages/eval/dist/index.cjs" 2>&1) || status=$?
          if [ "$status" -ne 0 ]; then
            fail "L5 $floor_file" "$reason"
            l5_failed=1
            break
          fi
        done < <(printf '%s\n' "$hits")
        if [ "$l5_failed" -eq 0 ]; then
          if [ "$floor_count" -eq 0 ]; then
            pass "L5 (noise-floor directory empty; no floor committed yet)"
          else
            pass "L5 ($floor_count noise-floor artefacts valid)"
          fi
        fi
      fi
    fi
  fi

  # ---- L6: no schemaVersion 1 entry remains under corpus/ (414 D-03) -----------------------
  # Same shape as L1: a leg that scanned nothing has not passed, so the corpus dir's existence
  # is asserted before the scan rather than inferred from grep's "no match" exit.
  if [ ! -d "$EVAL_ROOT/corpus" ]; then
    fail L6 "no committed corpus at $EVAL_ROOT/corpus — the scan would cover nothing"
  else
    status=0
    hits=$(grep -rl '"schemaVersion": 1' "$EVAL_ROOT/corpus") || status=$?
    if [ "$status" -eq 0 ]; then
      fail L6 "$(echo "$hits" | wc -l | tr -d ' ') v1 corpus entries remain (414 D-03): $(echo "$hits" | head -5 | tr '\n' ' ')"
    elif [ "$status" -eq 1 ]; then
      pass L6
    else
      fail L6 "grep could not scan $EVAL_ROOT/corpus (exit $status)"
    fi
  fi

  return "$fail_count"
}

# Generate synthetic evidence only in the self-test scratch root. The pure fold supplies the
# complete protocol/axis/split shape; each named mutation changes one property under test.
selftest_floor() {
  node -e '
    const { writeFileSync } = require("node:fs")
    const { buildEvalReport, deriveLeafCassetteId, foldNoiseFloorArtefact } = require(process.argv[1])
    const cassetteId = deriveLeafCassetteId({
      runSlug: "r_proper-ewer-rud-ignore-ula-junk-may-effect-eva-ada",
      testIndex: 0, stepIndex: 0, decisionOrdinal: 0,
    })
    const vector = {
      cassetteId, key: `${cassetteId}#-#0`, decisionOrdinal: 0, product: "example-web",
      briefSource: "proof", axes: {
        headline: "correct", elementIdentity: "correct", opClass: "correct",
        sideEffect: "correct", value: "not-applicable", loop: "not-applicable",
      },
    }
    const floor = foldNoiseFloorArtefact({
      profile: { profileKey: "hygiene-fixture", fingerprint: "hygiene-fixture",
        plannerModelId: "fixture-planner", matcherVersion: 1 },
      corpusDigest: "hygiene-fixture", partitionVersion: 1,
      seeds: [11, 29], repeats: 3, bootstrapSeed: 19,
      runs: [11, 11, 11, 29].map((seed, index) => ({
        seed, index, report: buildEvalReport([]), vectors: [vector], wallClockMs: 1,
      })),
      splitByCassetteId: new Map([[cassetteId, "natural"]]),
      censusByProduct: { "example-web": { natural: 1, heldOutShared: 0, heldOutPrivate: 0 } },
    })
    switch (process.argv[3]) {
      case "missing-products": delete floor.products; break
      case "missing-splits": delete floor.splits; break
      case "malformed-axis": floor.axes.headline.n = "1"; break
      case "empty-runs": floor.runs = []; break
      case "unexplained-zero": floor.axes.headline.aggregateFloor = 0; break
      case "explained-zero":
        floor.axes.headline.aggregateFloor = 0
        floor.explanation = "synthetic zero floor for the hygiene guard self-test"
        break
      case "valid": break
      default: throw new Error("unknown self-test floor mutation")
    }
    writeFileSync(process.argv[2], JSON.stringify(floor) + "\n")
  ' "$ROOT/packages/eval/dist/index.cjs" "$1" "$2"
}

selftest() {
  local tmp_root tmp_gate status stderr_file mutation
  tmp_root="$(mktemp -d)"
  tmp_gate="$(mktemp -d)"
  stderr_file="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp_root' '$tmp_gate' '$stderr_file'" EXIT

  echo "SELFTEST plant 1: a home-directory path in a throwaway copy of the eval root" >&2
  cp -R "$EVAL_ROOT/." "$tmp_root/"
  mkdir -p "$tmp_root/corpus/selftest"
  printf '{"handoffPath":"/Users/selftest/handoff.json"}\n' > "$tmp_root/corpus/selftest/planted.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ]; then
    echo "SELFTEST FAILED: L1 stayed green under a planted absolute path" >&2
    return 1
  fi
  if ! grep -q '^FAIL L1' "$stderr_file"; then
    echo "SELFTEST FAILED: the run reddened (exit $status) but not on L1" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L1' "$stderr_file" >&2

  echo "SELFTEST plant 1b: a Windows drive-letter path — the arm narrowed to skip JSON escapes" >&2
  printf '{"handoffPath":"C:\\\\Users\\\\selftest\\\\handoff.json"}\n' > "$tmp_root/corpus/selftest/planted.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L1' "$stderr_file"; then
    echo "SELFTEST FAILED: L1 stayed green under a planted Windows drive-letter path" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L1' "$stderr_file" >&2
  rm -f "$tmp_root/corpus/selftest/planted.json"

  # Plants 1c and 1d — the two dirs Phase 414 adds to the root anatomy (414 D-02). L1 greps the
  # WHOLE root, so both are covered by construction; these plants are what makes "by construction"
  # a measured claim rather than a reading of the grep. Each uses a literal that appears nowhere in
  # the shipped tree, and each is removed before the next leg so the plants cannot mask each other.
  echo "SELFTEST plant 1c: a home-directory path under exclusions/ (414 D-02)" >&2
  mkdir -p "$tmp_root/exclusions/selftest"
  printf '{"reason":"/Users/selftest/analysis.json"}\n' > "$tmp_root/exclusions/selftest/planted.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L1' "$stderr_file"; then
    echo "SELFTEST FAILED: L1 stayed green under an absolute path planted under exclusions/" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L1' "$stderr_file" >&2
  rm -rf "$tmp_root/exclusions/selftest"

  echo "SELFTEST plant 1d: a home-directory path in contracts/partition-selftest.json (414 D-02)" >&2
  mkdir -p "$tmp_root/contracts"
  printf '{"salt":"/home/selftest"}\n' > "$tmp_root/contracts/partition-selftest.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L1' "$stderr_file"; then
    echo "SELFTEST FAILED: L1 stayed green under an absolute path planted in a partition manifest" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L1' "$stderr_file" >&2
  rm -f "$tmp_root/contracts/partition-selftest.json"

  echo "SELFTEST plant 1e: a schemaVersion 1 entry under corpus/ (414 D-03)" >&2
  mkdir -p "$tmp_root/corpus/selftest"
  printf '{"schemaVersion": 1}\n' > "$tmp_root/corpus/selftest/v1.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L6' "$stderr_file"; then
    echo "SELFTEST FAILED: L6 stayed green under a planted schemaVersion 1 corpus entry" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L6' "$stderr_file" >&2
  rm -f "$tmp_root/corpus/selftest/v1.json"

  echo "SELFTEST plant 1f0: a floor missing the required groups must fail L5 (415)" >&2
  mkdir -p "$tmp_root/reports/noise-floor"
  printf '{"schemaVersion":1}\n' > "$tmp_root/reports/noise-floor/planted.json"
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L5' "$stderr_file"; then
    echo "SELFTEST FAILED: L5 stayed green under a floor missing required groups" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L5' "$stderr_file" >&2
  rm -f "$tmp_root/reports/noise-floor/planted.json"

  for mutation in missing-products missing-splits malformed-axis empty-runs; do
    echo "SELFTEST plant 1f0-$mutation: an invalid floor must fail L5 (415)" >&2
    selftest_floor "$tmp_root/reports/noise-floor/planted.json" "$mutation"
    status=0
    EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
    if [ "$status" -eq 0 ] || ! grep -q '^FAIL L5' "$stderr_file"; then
      echo "SELFTEST FAILED: L5 stayed green under floor mutation $mutation" >&2
      cat "$stderr_file" >&2
      return 1
    fi
    grep '^FAIL L5' "$stderr_file" >&2
    rm -f "$tmp_root/reports/noise-floor/planted.json"
  done

  echo "SELFTEST plant 1f: a zero noise floor without explanation (415)" >&2
  mkdir -p "$tmp_root/reports/noise-floor"
  selftest_floor "$tmp_root/reports/noise-floor/planted.json" unexplained-zero
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L5' "$stderr_file"; then
    echo "SELFTEST FAILED: L5 stayed green under an unexplained zero noise floor" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L5' "$stderr_file" >&2
  rm -f "$tmp_root/reports/noise-floor/planted.json"

  for mutation in valid explained-zero; do
    echo "SELFTEST plant 1g-$mutation: a complete floor must pass L5 (415)" >&2
    selftest_floor "$tmp_root/reports/noise-floor/planted.json" "$mutation"
    status=0
    EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
    if [ "$status" -ne 0 ] || grep -q '^FAIL L5' "$stderr_file" || ! grep -q '^PASS L5' "$stderr_file"; then
      echo "SELFTEST FAILED: the complete $mutation noise floor did not pass L5" >&2
      cat "$stderr_file" >&2
      return 1
    fi
    grep '^PASS L5' "$stderr_file" >&2
    rm -f "$tmp_root/reports/noise-floor/planted.json"
  done

  echo "SELFTEST plant 1h: the literal reports/noise-floor.json path is forbidden (415)" >&2
  selftest_floor "$tmp_root/reports/noise-floor.json" valid
  status=0
  EVAL_ROOT="$tmp_root" DEMO_CONFIG="$DEMO_CONFIG" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ] || ! grep -q '^FAIL L5' "$stderr_file"; then
    echo "SELFTEST FAILED: L5 stayed green under the forbidden noise-floor.json path" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L5' "$stderr_file" >&2
  rm -f "$tmp_root/reports/noise-floor.json"

  echo "SELFTEST plant 2: an inherited-threshold literal on a throwaway gate path" >&2
  printf 'export const THRESHOLD = 0.867\n' > "$tmp_gate/gate.ts"
  status=0
  GATE_PATHS_OVERRIDE="$tmp_gate" "$0" 2>"$stderr_file" || status=$?
  if [ "$status" -eq 0 ]; then
    echo "SELFTEST FAILED: L2 stayed green under a planted threshold literal" >&2
    return 1
  fi
  if ! grep -q '^FAIL L2' "$stderr_file"; then
    echo "SELFTEST FAILED: the run reddened (exit $status) but not on L2" >&2
    cat "$stderr_file" >&2
    return 1
  fi
  grep '^FAIL L2' "$stderr_file" >&2

  echo "SELFTEST PASSED: every plant reddened the leg that exists to catch it" >&2
  return 0
}

case "${1:-}" in
  --selftest)
    selftest
    exit "$?"
    ;;
  '')
    status=0
    run_legs || status=$?
    exit "$status"
    ;;
  *)
    echo "usage: $0 [--selftest]" >&2
    exit 2
    ;;
esac
