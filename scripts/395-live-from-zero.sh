#!/usr/bin/env bash
#
# 395-live-from-zero.sh — phase 395's LIVE lane for CFGM-05 (scaffold from zero).
#
# ================================================================================================
# WHAT THIS LANE FOUND, STATED FIRST BECAUSE IT IS THE RESULT RATHER THAN A CAVEAT
# ================================================================================================
#
# D-16 asks for "the full CFGM-05 sentence on a fresh temp workspace: zero config, scaffold the
# local demo app from scratch, accept, authoring proceeds". This lane drove that sentence against
# the shipped build and it does not complete, for a reason no hermetic cell in this phase could
# see. `config.project.scaffold` is UNREACHABLE THROUGH CHAT, from both directions at once:
#
#   ARM A — A GENUINELY ZERO-CONFIG PROJECT HAS NO MODEL, SO NOTHING PLANS.
#     The pre-dispatch scaffold route fires only on a PLANNED `authoring.draft.write` step
#     (`turn-engine.ts`, the `step.functionId === AUTHORING_DRAFT_WRITE_FUNCTION_ID` arm). Planning
#     needs a chat model; `resolveCliChatCapabilities` builds one out of `registry.llms` +
#     `use.llm` READ FROM THE PROJECT CONFIG, and answers `undefined` when there is none. A project
#     with no config file therefore has no planner, so no `authoring.draft.write` is ever planned,
#     so the route never runs. The session header records it as `"model": "unbound"`.
#
#   ARM B — ANY CONFIG FILE AT ALL MAKES THE SCAFFOLD REFUSE.
#     Give the project the LLM entry arm A needs and the planner binds, the route resolves
#     `scaffold`, and `config.project.scaffold` refuses `already-configured` — because
#     scaffolding writes a WHOLE configuration and would replace the file that had to exist for
#     the planner to run at all (395-08's deliberate Rule-2 refusal, correct on its own terms).
#
# The two arms close on each other. Every hermetic cell in 395-08 is green because each one holds
# ONE side fixed: the route cells inject `configuredTargets` directly and never ask where a model
# came from, and the CLI scaffold cells drive the op against a config-less fixture and never ask
# how a turn reached it. The composition is the only place the pincer is visible, which is what
# D-16's live leg is for.
#
# AND THE LOCAL APP IS NOT EXPRESSIBLE THROUGH THE GATE EVEN IF THE PINCER OPENED. `parseHostnameToken`
# is a positive rule about what a hostname IS: `127.0.0.1` fails because its final label is not
# alphabetic, `localhost:8931` fails because it has no dot, and D-13's derivation is pinned to
# `https://<domain>` with no port. There is no spelling of `http://127.0.0.1:8931/form.html` that
# the shipped gate accepts and the shipped derivation reproduces. LEG 1 measures that through the
# real producer rather than asserting it, and it is a SEPARATE rung from the pincer: opening the
# pincer would not make D-16's "scaffold the local demo app" expressible.
#
# ================================================================================================
# SO WHAT THIS SCRIPT IS
# ================================================================================================
#
# A REGRESSION INSTRUMENT OVER A MEASURED LADDER, not a wish that the sentence completes. Each leg
# records the outcome the shipped build ACTUALLY produces, with the rung named, so that the day a
# rung is closed this lane reds and says which one moved. A lane whose every leg is written to pass
# proves less than one that can fail in a named direction, so each leg below states its red.
#
# THREE PROJECTS, ONE UTTERANCE SHAPE, THREE DIFFERENT DURABLE OUTCOMES (legs 2/3/4). That triple is
# what makes this an instrument rather than an assertion: a route that had stopped working would
# collapse them onto each other, and a route that refused on WORDING rather than on the PROJECT
# would make legs 3 and 4 agree. The refusal's precondition being the project — 395-08's load-bearing
# decision — is therefore measured live, from outside, over three real chat sessions.
#
# VERDICTS COME OUT OF THE PERSISTED SESSION JSONL, NEVER OUT OF THE TRANSCRIPT (the 392/394 lesson).
# `.agent-qa/sessions/<id>.jsonl` carries `stage_outcome`, `mark_unhandled` and `turn_complete` rows
# and the session header's `model` field; those are what every assertion below reads. The transcript
# is captured for the receipt and is never a verdict input — readline's own re-render of the line
# being typed spells the same bytes a turn boundary does (394's CR-03), so a transcript read is an
# instrument this lane declines to build.
#
# LOCAL ONLY, AND THE ONE NON-LOCAL-LOOKING NAME IS A NON-RESOLVING RESERVED ONE. P-08 forbids
# driving automation against a third-party production site. The local demo app at
# 127.0.0.1:8931 is this lane's only network subject. Legs 3 and 4 need a token the hostname gate
# ACCEPTS in order to reach the scaffold arm at all, and they use `agent-qa.test`: RFC 6761 reserves
# `.test` and guarantees it does not resolve, so the derived `https://agent-qa.test` addresses
# nothing at all. Both legs refuse before any navigation regardless — that is what they measure —
# but the choice of token is not left to luck.
#
# Usage:
#   bash scripts/395-live-from-zero.sh
#   LIVE_FROM_ZERO_SELFTEST=neutered bash scripts/395-live-from-zero.sh   # must exit 1
#   LIVE_FROM_ZERO_AUTHOR=1 bash scripts/395-live-from-zero.sh            # adds LEG 5 (browsers)

set -u
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPER_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
DEMO_INIT="${LIVE_FROM_ZERO_DEMO:-$SUPER_ROOT/demo/init}"
DEMO_MODULES="${LIVE_FROM_ZERO_DEMO_MODULES:-$SUPER_ROOT/demo/node_modules}"
CLI_ENTRY="$REPO_ROOT/packages/cli/dist/cli.js"
AGENT_DIST="$REPO_ROOT/packages/agent/dist/index.js"
FORM_URL="http://127.0.0.1:8931/form.html"

SELFTEST="${LIVE_FROM_ZERO_SELFTEST:-}"
RUN_AUTHOR="${LIVE_FROM_ZERO_AUTHOR:-0}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/395-live-from-zero.XXXXXX")"
TRANSCRIPTS="$WORK/transcripts"
mkdir -p "$TRANSCRIPTS"

banner() { printf '\n=== %s\n' "$*"; }
fatal() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

LEG_NAMES=(); LEG_VERDICTS=(); LEG_WHYS=()
record_leg() {
  LEG_NAMES+=("$1"); LEG_VERDICTS+=("$2"); LEG_WHYS+=("$3")
  printf '\n>>> LEG %-34s %s\n    %s\n' "$1" "$2" "$3"
}

SERVER_PID=""
cleanup() {
  local rc=$?
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  printf '\ntranscripts and workspaces kept at: %s\n' "$WORK"
  exit "$rc"
}
trap cleanup EXIT

# ------------------------------------------------------------------------------------------------
# LEG 0 — preflight. Everything below reads a BUILT dist, so a stale one measures a previous build
# while every source path in the output says otherwise. Proven by grepping a real exported
# identifier out of the artifact, never by trusting that a build ran.
# ------------------------------------------------------------------------------------------------

banner 'LEG 0 — preflight'

[ -f "$CLI_ENTRY" ] || fatal "the CLI dist is absent at $CLI_ENTRY — run 'pnpm turbo run build --force' first"
[ -f "$AGENT_DIST" ] || fatal "the agent dist is absent at $AGENT_DIST — run 'pnpm turbo run build --force' first"
[ -d "$DEMO_INIT" ] || fatal "the demo harness is absent at $DEMO_INIT (override with LIVE_FROM_ZERO_DEMO)"
[ -d "$DEMO_MODULES" ] || fatal "the demo's node_modules is absent at $DEMO_MODULES (override with LIVE_FROM_ZERO_DEMO_MODULES) — the temp projects symlink it so the subscription auth plugin resolves"

# THE FRESHNESS PROOF, over identifiers 395 introduced. `parseHostnameToken` is the LEG 1 subject and
# `config.project.scaffold` is the op legs 3 and 4 turn on; a dist predating this phase carries
# neither, and a dist predating 395-08 carries only the second.
for identifier in parseHostnameToken 'config.project.scaffold' resolveWriteTestRoute; do
  count="$(grep -c -- "$identifier" "$AGENT_DIST")"
  [ "$count" -ge 1 ] \
    || fatal "the agent dist does not contain '$identifier' — it predates this phase. Rebuild with 'pnpm turbo run build --force' before running this lane."
  printf 'dist freshness: %-28s %s occurrence(s) in packages/agent/dist/index.js\n' "$identifier" "$count"
done

command -v curl >/dev/null || fatal 'curl is required'
command -v git >/dev/null || fatal 'git is required'

start_server() {
  ( cd "$DEMO_INIT" && node scripts/serve-local-form.mjs >"$WORK/server.log" 2>&1 ) &
  SERVER_PID=$!
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS -o /dev/null "$FORM_URL" 2>/dev/null; then
      printf 'local-form server answering %s after %s probe(s)\n' "$FORM_URL" "$attempt"
      return 0
    fi
    sleep 0.25
  done
  fatal "the local demo app never answered $FORM_URL (see $WORK/server.log)"
}

if curl -fsS -o /dev/null "$FORM_URL" 2>/dev/null; then
  printf 'local-form server was ALREADY answering %s — this lane did not start it and will not stop it\n' "$FORM_URL"
else
  start_server
fi

# ------------------------------------------------------------------------------------------------
# the temp-project builders
# ------------------------------------------------------------------------------------------------
#
# GIT IDENTITY IS PASSED PER COMMAND WITH `-c`, NEVER SET GLOBALLY (RESEARCH Pitfall 7). A bare temp
# repo inherits whatever the machine's global config says, which on a machine with none at all makes
# every commit fail — and the failure would surface from inside the apply, reading as a product
# defect. `-c` scopes the identity to this lane's own commits and leaves the operator's config alone.
GIT_ID=(-c user.name='agent-qa 395 lane' -c user.email='395-lane@agent-qa.invalid')

new_project() { # $1 = name -> prints the path
  local dir="$WORK/$1"
  mkdir -p "$dir"
  git -C "$dir" init -q .
  # The auth plugin is resolved from the config file's own directory, so the temp project needs the
  # package on a resolution path of its own. A symlink rather than an install: this lane must not
  # spend a package manager's time, and the plugin it borrows is the one the demo already trusts.
  ln -sfn "$DEMO_MODULES" "$dir/node_modules"
  printf '%s' "$dir"
}

# The demo config with its targets emptied — the ONLY project shape in which the planner can bind
# and the scaffold arm is reachable. Derived from the committed demo config through the same YAML
# library the product parses with, so this lane cannot invent a config shape the product would
# reject for a reason unrelated to what is being measured.
# `node -e <script> a b c` PUTS THE FIRST USER ARGUMENT AT argv[1], NOT argv[2]. There is no script
# path in the vector under `-e`, and the obvious off-by-one reads the SOURCE config's path as the
# yaml library and dies with MODULE_NOT_FOUND. Measured on this lane's first run; recorded because
# the same mistake is one keystroke away in every `node -e` helper below.
write_config() { # $1 = project dir, $2 = 'no-targets' | 'local-form'
  node -e '
const { readFileSync, writeFileSync } = require("node:fs")
const [source, shape, yamlLib, destination] = process.argv.slice(1)
const YAML = require(yamlLib)
const doc = YAML.parse(readFileSync(source, "utf8"))
doc.registry.targets = shape === "local-form"
  ? { "local-form": { platform: "web", url: "http://127.0.0.1:8931/form.html" } }
  : {}
delete doc.registry.devices
doc.knowledge = { dir: "agent-qa-knowledge", commitArtifacts: "none" }
writeFileSync(destination, YAML.stringify(doc))
' "$DEMO_INIT/agent-qa.config.yaml" "$2" "$YAML_LIB" "$1/agent-qa.config.yaml" \
    || fatal "could not derive the lane config for $1"
  cp "$DEMO_INIT/hooks.yaml" "$1/hooks.yaml"
  mkdir -p "$1/agent-qa-knowledge" "$1/tests" "$1/suites"
  # `workspace.envFile` and `workspace.secretsFile` are declared by the demo config this lane derives
  # from, and a run REFUSES when a declared file is absent ("It may be empty, but it must exist").
  # BOTH WERE MEASURED THE HARD WAY, ONE PER DRIVE: LEG 5's first drive reached a real gate run and
  # died `RunProducedNoEventsError` on the secrets file, and its second died the same way on the env
  # file. From outside the process both read as an authoring failure, and both are facts about THIS
  # LANE's fixture rather than about the product — which is why the leg's RED arm prints the failure
  # class rather than a verdict about the loop.
  : >"$1/.env"
  : >"$1/.env.secrets.local"
}

YAML_LIB="$(node -e "console.log(require.resolve('yaml', { paths: ['$REPO_ROOT/packages/cli'] }))")" \
  || fatal 'could not resolve the yaml library the product parses with'

seal_project() { # $1 = project dir — one commit, so a later commit count is a lane measurement
  git -C "$1" "${GIT_ID[@]}" add -A >/dev/null
  git -C "$1" "${GIT_ID[@]}" commit -q -m 'seed: the state this lane starts from'
}

# One chat session, driven with piped stdin, and the SESSION FILE is the answer.
#
# PIPED STDIN IS DELIBERATE FOR LEGS 2-4 AND NAMED AS A BOUND. Under pipes the execution context
# resolves `local-headless`, which is exactly right for these legs: none of them reaches a confirm
# (every one refuses first, which is what they measure) and `config.field.set`-class propose ops are
# `mutating-local`, allowed in every context. LEG 5 — the only leg that reaches an approval — spawns
# through `expect(1)` for a real pty, on 394's measured precedent.
drive_chat() { # $1 = project dir, $2 = utterance, $3 = transcript label -> prints the session id
  local dir="$1" utterance="$2" label="$3"
  ( cd "$dir" && printf '%s\n/quit\n' "$utterance" \
      | timeout "${LIVE_FROM_ZERO_TURN_TIMEOUT:-900}" node "$CLI_ENTRY" chat ) \
    >"$TRANSCRIPTS/$label.txt" 2>&1
  local newest
  newest="$(ls -t "$dir/.agent-qa/sessions/"*.jsonl 2>/dev/null | head -1)"
  [ -n "$newest" ] || return 1
  printf '%s' "$newest"
}

# Every read of a session file goes through here, so no leg parses JSONL by hand.
session_query() { # $1 = session file, $2 = one of: model | planner | reason | receipts | status
  node -e '
const { readFileSync } = require("node:fs")
// argv[1] is the FIRST user argument under `-e` — see the note on write_config.
const rows = readFileSync(process.argv[1], "utf8").split("\n").filter((line) => line !== "")
  .map((line) => JSON.parse(line))
const header = rows[0]
const first = rows.find((row) => row.kind === "user_message")
const turn = first === undefined ? undefined : first.turnId
const of = (kind) => rows.find((row) => row.kind === kind && row.turnId === turn)
switch (process.argv[2]) {
  case "model": process.stdout.write(String(header.model ?? "")); break
  case "planner": {
    const row = rows.find((r) => r.kind === "stage_outcome" && r.stage === "planner" && r.turnId === turn)
    process.stdout.write(String(row === undefined ? "" : row.outcome)); break
  }
  case "reason": process.stdout.write(String(of("mark_unhandled")?.reason ?? "")); break
  case "receipts": process.stdout.write(rows.filter((r) => r.kind === "clause_receipt" && r.turnId === turn).map((r) => `${r.functionId}:${r.status}`).join(",")); break
  case "status": process.stdout.write(String(of("turn_complete")?.status ?? "")); break
}
' "$1" "$2"
}

commit_count() { git -C "$1" rev-list --count HEAD; }

# ------------------------------------------------------------------------------------------------
# LEG 1 — the local app is not expressible through the shipped hostname gate (D-13/D-15)
# ------------------------------------------------------------------------------------------------
#
# THROUGH THE REAL REGISTERED OP ON THE SHIPPED CLI SURFACE, not through a copy of the rule and not
# through the predicate in isolation. `parseHostnameToken` is deliberately NOT on `packages/agent`'s
# barrel — the FUNC-01/SC1 export set only shrinks — and reaching around that to import an internal
# symbol would be this lane inventing a surface nobody ships. `agent-qa fn config.project.scaffold`
# is the surface a person has, so that is what is asked.
#
# THE CONTROL IS BUILT INTO THE MECHANISM, WHICH IS WHY THIS SHAPE IS BETTER THAN THE PREDICATE. In a
# project that HAS a config, the op has two refusals available and the hostname gate is the FIRST
# thing it checks (395-08's cell (S2): the gate sits above CFGM-04's re-read). So a local address
# comes back `not-a-hostname` and a real domain comes back `already-configured` — from the SAME op,
# in the SAME project, one call apart. A gate that had stopped refusing collapses those two answers
# onto each other, and a gate that refused everything collapses them the other way. Neither can look
# like a pass.
#
# AND THE CONTROL ARM CARRIES THE DERIVATION. `already-configured`'s sentence names the target name
# D-13 derived — `booking-com`, `agent-qa-test` — so this leg reads the derivation's answer out of
# the product's own words rather than asserting it against a literal it typed.
#
# WHAT MAKES THIS LEG RED: a gate that started accepting IPv4 literals or bare `localhost` (rung 1
# closed — re-author this leg against the new behaviour), or a derivation that stopped producing the
# pinned target name (the D-13 pin regressed). It reds in the direction of the fix and says which.

banner 'LEG 1 — is the local demo app expressible through the D-15 gate?'

P1="$(new_project gate-probe)"
write_config "$P1" no-targets
seal_project "$P1"
LEG1_OUT="$WORK/leg1.txt"
: >"$LEG1_OUT"
LEG1_RC=0

probe_gate() { # $1 = domain token, $2 = expected reason, $3 = optional substring the detail must carry
  local answer reason
  answer="$( cd "$P1" && timeout 300 node "$CLI_ENTRY" fn config.project.scaffold \
    --input "$(node -e 'process.stdout.write(JSON.stringify({ domain: process.argv[1] }))' "$1")" 2>&1 )"
  reason="$(printf '%s' "$answer" | node -e '
const chunks = []
process.stdin.on("data", (chunk) => chunks.push(chunk))
process.stdin.on("end", () => {
  const text = chunks.join("")
  const start = text.indexOf("{")
  try { process.stdout.write(String(JSON.parse(text.slice(start)).reason ?? "")) } catch { process.stdout.write("") }
})' )"
  printf '  %-38s -> %s\n' "$1" "${reason:-<unparsable>}" | tee -a "$LEG1_OUT"
  if [ "$reason" != "$2" ]; then
    printf '    UNEXPECTED: expected reason %s\n' "$2" | tee -a "$LEG1_OUT"
    LEG1_RC=1
    return
  fi
  if [ -n "${3:-}" ]; then
    case "$answer" in
      *"$3"*) ;;
      *) printf '    UNEXPECTED: the answer does not carry %s\n' "$3" | tee -a "$LEG1_OUT"; LEG1_RC=1 ;;
    esac
  fi
}

# The four spellings of the local demo app a person could reasonably type.
probe_gate '127.0.0.1:8931' not-a-hostname
probe_gate '127.0.0.1' not-a-hostname
probe_gate 'localhost:8931' not-a-hostname
probe_gate 'localhost' not-a-hostname
probe_gate 'http://127.0.0.1:8931/form.html' not-a-hostname
# The controls: real hostnames get PAST the gate and are refused by the next thing, with the D-13
# derivation named in the refusal's own sentence.
probe_gate 'booking.com' already-configured 'booking-com'
probe_gate 'agent-qa.test' already-configured 'agent-qa-test'

if [ "$LEG1_RC" -eq 0 ]; then
  record_leg 'L1 local-app expressibility' 'PASS' \
    'RUNG 1 HOLDS AS MEASURED, THROUGH THE REGISTERED OP: every spelling of the local demo app is refused `not-a-hostname` (an IPv4 literal fails the alphabetic-TLD rule; bare `localhost` has no dot; the URL form parses down to the same IPv4 host), while both control domains get PAST the gate and are refused by the next check with the D-13 target name in the refusal`s own sentence. D-16 asks the live leg to scaffold the LOCAL app, and the shipped derivation cannot express it — it is pinned to `https://<domain>` with no port and no scheme choice at all.'
else
  record_leg 'L1 local-app expressibility' 'RED' \
    "the gate's answers moved — see $LEG1_OUT. If a local address is now ACCEPTED, rung 1 has been closed and this leg is the thing that must be re-authored (it is written to red in the direction of the fix). If a control domain stopped deriving, the D-13 pin regressed."
fi

# ------------------------------------------------------------------------------------------------
# LEG 2 — ARM A: a genuinely zero-config project (the literal D-16 sentence)
# ------------------------------------------------------------------------------------------------
#
# WHAT MAKES THIS LEG RED: a build in which a zero-config project DOES bind a model (which would open
# arm A of the pincer) or in which the scaffold route fires without one. Either is the fix, and this
# leg names it.
#
# THE EVIDENCE IS THE PRODUCT'S OWN WORD FOR IT. `"model": "unbound"` is written into the session
# header by the chat surface itself, so this leg does not have to infer "there was no planner" from
# an absence — it reads the field that says so, and reads `stage_outcome planner: unresolved` beside
# it.

banner 'LEG 2 — ARM A: zero config, one utterance naming the local app'

P2="$(new_project zero-config)"
seal_project "$P2"
P2_BEFORE="$(commit_count "$P2")"
S2="$(drive_chat "$P2" 'write a test for the login flow at 127.0.0.1:8931' leg2-zero-config)"

if [ -z "${S2:-}" ]; then
  record_leg 'L2 arm A (zero config)' 'RED' 'no session JSONL was written at all — the chat surface did not reach a usable state, so this leg took no reading'
else
  L2_MODEL="$(session_query "$S2" model)"
  L2_PLANNER="$(session_query "$S2" planner)"
  L2_REASON="$(session_query "$S2" reason)"
  L2_STATUS="$(session_query "$S2" status)"
  P2_AFTER="$(commit_count "$P2")"
  printf '  session   %s\n  model     %s\n  planner   %s\n  status    %s\n  reason    %s\n  commits   %s -> %s\n' \
    "$S2" "$L2_MODEL" "$L2_PLANNER" "$L2_STATUS" "$L2_REASON" "$P2_BEFORE" "$P2_AFTER"
  if [ "$L2_MODEL" = 'unbound' ] && [ "$L2_PLANNER" = 'unresolved' ] && [ "$P2_AFTER" = "$P2_BEFORE" ]; then
    record_leg 'L2 arm A (zero config)' 'PASS' \
      "RUNG 2 MEASURED — THE PINCER'S FIRST ARM. A project with no config has no \`registry.llms\`, so \`resolveCliChatCapabilities\` answers undefined and the session records \`model: unbound\`; the planner stage resolves \`unresolved\`, no \`authoring.draft.write\` is ever planned, and the pre-dispatch scaffold route therefore never runs. The turn's own sentence blames the BUILD ('No capability in this build handles…') when the fact is that this PROJECT has no model — recorded as a second, smaller finding. Nothing was committed."
  else
    record_leg 'L2 arm A (zero config)' 'RED' \
      "the zero-config arm moved: model='$L2_MODEL' planner='$L2_PLANNER' commits $P2_BEFORE->$P2_AFTER. A bound model here means arm A of the pincer is OPEN and the from-zero sentence may now be reachable — re-author this leg against the new behaviour. A commit here means a refusal mutated the repository, which is a different and worse finding."
  fi
fi

# ------------------------------------------------------------------------------------------------
# LEG 3 — ARM B: the smallest project in which the route can reach the scaffold at all
# ------------------------------------------------------------------------------------------------
#
# THIS LEG HAS TWO PASSING ARMS AND THE SPLIT IS ITSELF A FINDING (WINDOWS 131, observed live).
# `resolveWriteTestRoute` routes on the tokens of the intent THE MODEL EMITTED, not on the utterance
# a person typed. Driving the identical utterance twice against the identical project produced two
# different routes on two runs:
#
#   ARM B-scaffold — the intent carried `agent-qa.test` as an isolatable token, so the route resolved
#     `scaffold`, `config.project.scaffold` ran, and it refused `already-configured` naming the file
#     and the D-13-derived target name.
#   ARM B-refuse   — the intent paraphrased the site away, so no token parsed as a hostname, the
#     project declares no targets, and the route took D-15's refusal without the scaffold running.
#
# BOTH PROVE THE SAME THING and neither is a failure: the scaffold never completes from a from-zero
# chat turn. So this leg records WHICH ARM it took rather than demanding one, and the fact that it
# can take either is the live measurement of the stub 395-08 filed as WINDOWS 131 — a request naming
# its site only in prose the tokenizer cannot isolate falls through. A leg written to demand one arm
# would have reported that nondeterminism as a lane failure and hidden the finding inside it.
#
# WHAT MAKES THIS LEG RED, THEN: a scaffold that ACTUALLY RAN TO COMPLETION — a commit appearing, the
# config file's bytes changing, or a proposal record being filed. That is arm B of the pincer opening,
# and it is the only outcome here that is not the pincer. 395-06's property is that every config
# refusal lives ABOVE every mutation; the commit count and the config digest are read across the turn
# so that property is observed from outside the process, on a real repository, through a real turn.
#
# THE REFUSE ARM CARRIES A SECOND, SMALLER FINDING, recorded rather than corrected here: its sentence
# says "this project has no agent-qa configuration" when the project demonstrably HAS one and merely
# declares no targets. The precondition the code tests is `configuredTargetNames.length === 0`; the
# sentence describes a different fact.

banner 'LEG 3 — ARM B: config present so the planner binds, zero targets'

P3="$(new_project no-targets)"
write_config "$P3" no-targets
seal_project "$P3"
P3_BEFORE="$(commit_count "$P3")"
P3_DIGEST_BEFORE="$(shasum -a 256 "$P3/agent-qa.config.yaml" | awk '{print $1}')"
S3="$(drive_chat "$P3" 'write a test for agent-qa.test' leg3-no-targets)"

if [ -z "${S3:-}" ]; then
  record_leg 'L3 arm B (scaffold refused)' 'RED' 'no session JSONL was written at all — this leg took no reading'
else
  L3_MODEL="$(session_query "$S3" model)"
  L3_PLANNER="$(session_query "$S3" planner)"
  L3_REASON="$(session_query "$S3" reason)"
  P3_AFTER="$(commit_count "$P3")"
  P3_DIGEST_AFTER="$(shasum -a 256 "$P3/agent-qa.config.yaml" | awk '{print $1}')"
  printf '  session   %s\n  model     %s\n  planner   %s\n  reason    %s\n  commits   %s -> %s\n  config    %s -> %s\n' \
    "$S3" "$L3_MODEL" "$L3_PLANNER" "$L3_REASON" "$P3_BEFORE" "$P3_AFTER" "${P3_DIGEST_BEFORE:0:12}" "${P3_DIGEST_AFTER:0:12}"
  # THE PINCER IS THE CLAIM, AND IT IS UNTOUCHED BY WHICH ARM RAN: nothing was committed, the config
  # file's bytes did not move, and no proposal was filed. Read across the turn, from outside.
  L3_PROPOSALS="$(ls "$P3/.agent-qa/proposals/" 2>/dev/null | wc -l | tr -d ' ')"
  L3_MUTATED=0
  [ "$P3_AFTER" = "$P3_BEFORE" ] || L3_MUTATED=1
  [ "$P3_DIGEST_AFTER" = "$P3_DIGEST_BEFORE" ] || L3_MUTATED=1
  [ "${L3_PROPOSALS:-0}" = '0' ] || L3_MUTATED=1
  printf '  proposals %s filed\n' "${L3_PROPOSALS:-0}"

  L3_ARM='unrecognised'
  case "$L3_REASON" in
    *'already has agent-qa.config.yaml'*) L3_ARM='scaffold-then-already-configured' ;;
    *'I will not guess which site you meant'*) L3_ARM='d15-refuse (no hostname token in the emitted intent)' ;;
  esac

  if [ "$L3_MUTATED" -eq 1 ]; then
    record_leg 'L3 arm B (scaffold refused)' 'RED' \
      "ARM B OF THE PINCER IS OPEN — a from-zero chat turn CHANGED THE REPOSITORY. commits $P3_BEFORE->$P3_AFTER, config ${P3_DIGEST_BEFORE:0:12}->${P3_DIGEST_AFTER:0:12}, proposals filed ${L3_PROPOSALS:-0}. Arm: $L3_ARM. This is the one outcome here that is not the pincer, and it is either the fix landing or 395-06's above-every-mutation property breaking."
  elif [ "$L3_PLANNER" != 'resolved' ]; then
    record_leg 'L3 arm B (scaffold refused)' 'RED' \
      "the planner did not bind (planner='$L3_PLANNER') in a project that carries the LLM entry — this leg cannot distinguish arm B from arm A, so it took no reading of arm B at all"
  elif [ "$L3_ARM" = 'unrecognised' ]; then
    record_leg 'L3 arm B (scaffold refused)' 'RED' \
      "the turn refused with a sentence this leg does not recognise: '$L3_REASON'. Neither known arm was taken; the route's behaviour has moved and this leg must be re-authored against it."
  else
    record_leg 'L3 arm B (scaffold refused)' 'PASS' \
      "RUNG 3 MEASURED — THE PINCER'S SECOND ARM. The planner bound (this project carries the LLM entry arm A lacks) and the turn still authored nothing: ZERO commits, a byte-identical config file, ZERO proposals filed — 395-06's 'no refusal mutates the repository' observed from outside, on a real repo. ARM TAKEN THIS RUN: $L3_ARM. Both arms are legitimate and the split is WINDOWS 131 live — the route reads the tokens of the intent the MODEL emitted, so the identical utterance can reach the scaffold on one run and D-15's refusal on the next."
  fi
fi

# ------------------------------------------------------------------------------------------------
# LEG 4 — THE DIRECTIONAL CONTROL: the same build, the same shape of utterance, a project that HAS
#         a target. This is what stops legs 2 and 3 from being a lane that refuses everything.
# ------------------------------------------------------------------------------------------------
#
# 395-08's load-bearing decision is that the route's refusal precondition is the PROJECT rather than
# the wording, proven hermetically by cell (R7) driving four utterances through two projects. THIS is
# that claim measured live, from outside the process, over real chat sessions against a real model:
# legs 3 and 4 differ in NOTHING but whether the project declares a target, and they must produce
# DIFFERENT durable outcomes.
#
# WHAT MAKES THIS LEG RED: a route that refused here too (it would mean the precondition had become
# the wording, and 394's shipped authoring path would be broken for the majority of real requests),
# or one that scaffolded over a project that already declares the target.
#
# THE OUTCOME HERE IS NOT A SUCCESS AND IS NOT SUPPOSED TO BE. `authoring.draft.write` is
# `mutating-shared`, and piped stdio resolves `local-headless`, so the v48 gate fails it closed —
# BY THE TIER, not by the route. That is precisely the discrimination this leg is for: the refusal
# must come from the GATE and must not mention the scaffold or the hostname gate at all.

banner 'LEG 4 — the directional control: a project that HAS the local-form target'

P4="$(new_project local-form)"
write_config "$P4" local-form
seal_project "$P4"
P4_BEFORE="$(commit_count "$P4")"
S4="$(drive_chat "$P4" 'write a test for the login flow on local-form' leg4-local-form)"

if [ -z "${S4:-}" ]; then
  record_leg 'L4 directional control' 'RED' 'no session JSONL was written at all — this leg took no reading'
else
  L4_REASON="$(session_query "$S4" reason)"
  L4_RECEIPTS="$(session_query "$S4" receipts)"
  L4_STATUS="$(session_query "$S4" status)"
  P4_AFTER="$(commit_count "$P4")"
  printf '  session   %s\n  status    %s\n  receipts  %s\n  reason    %s\n  commits   %s -> %s\n' \
    "$S4" "$L4_STATUS" "$L4_RECEIPTS" "$L4_REASON" "$P4_BEFORE" "$P4_AFTER"
  L4_OK=1
  # The refusal, if any, must NOT be either of the two the from-zero arms produce. That is the whole
  # discrimination: same words, different project, different answer.
  case "$L4_REASON" in *'already has agent-qa.config.yaml'*) L4_OK=0 ;; esac
  case "$L4_REASON" in *'no agent-qa configuration'*) L4_OK=0 ;; esac
  case "$L4_REASON" in *'I will not guess which site you meant'*) L4_OK=0 ;; esac
  [ "$P4_AFTER" = "$P4_BEFORE" ] || L4_OK=0
  if [ "$L4_OK" -eq 1 ]; then
    record_leg 'L4 directional control' 'PASS' \
      "THE ROUTE DISCRIMINATES ON THE PROJECT, MEASURED LIVE. The same build and the same shape of request, in a project that declares \`local-form\`, produced NEITHER of the two from-zero refusals — so legs 2 and 3 are not a lane that refuses everything, and 395-08's decision that the refusal's precondition is the PROJECT rather than the wording holds outside the hermetic cells. Outcome: status='$L4_STATUS' receipts='$L4_RECEIPTS' reason='$L4_REASON' — a fail-closed here is the v48 gate answering about \`authoring.draft.write\`'s \`mutating-shared\` tier under piped stdio, which is a statement about THIS HARNESS and not about the route (LEG 5 removes it with a real pty)."
  else
    record_leg 'L4 directional control' 'RED' \
      "THE CONTROL COLLAPSED ONTO THE FROM-ZERO ARMS: a project that declares its target produced '$L4_REASON'. Either the route's precondition has become the WORDING — which breaks 394's shipped authoring path for every request that names no hostname — or a scaffold ran against a configured project (commits $P4_BEFORE->$P4_AFTER)."
  fi
fi

# ------------------------------------------------------------------------------------------------
# LEG 5 — OPTIONAL: authoring proceeds through REAL gate runs against the LOCAL app, under a pty
# ------------------------------------------------------------------------------------------------
#
# D-16's sentence ends "authoring proceeds through real gate runs against the local app". The
# scaffold half of that sentence is unreachable (legs 2/3), so this half is measured on its own, in a
# project whose target IS the local demo app. It costs real browser runs and real model latency, so
# it is opt-in — AND THE SKIP IS ANNOUNCED, because a credential-or-cost guard that degrades to a
# silent no-op has produced green runs measuring nothing in this codebase before.
#
# A REAL PTY, on 394's measured precedent: vitest workers and pipes both resolve `local-headless`, and
# `authoring.draft.write` is `mutating-shared`, so the gate denies before routing is exercised at all.

banner 'LEG 5 — authoring against the local app (optional)'

CHAT_ARRIVAL_EXP="$DEMO_INIT/scripts/394-chat-arrival.exp"
if [ "$RUN_AUTHOR" != '1' ]; then
  record_leg 'L5 authoring (local app)' 'SKIP' \
    'NOT RUN, AND SAYING SO: set LIVE_FROM_ZERO_AUTHOR=1 to drive it. It spawns a real `agent-qa chat` under `expect` in the local-form project and lets the authoring loop take its real gate runs against 127.0.0.1:8931, which costs browser runs and model latency. What it would add is the tail of D-16s sentence; what already holds that ground is 394s own lane (demo/init/scripts/drain-394-loop.sh, legs C and E), against the same local target.'
elif [ ! -x /usr/bin/expect ] || [ ! -f "$CHAT_ARRIVAL_EXP" ]; then
  record_leg 'L5 authoring (local app)' 'RED' \
    "requested but not runnable: /usr/bin/expect or $CHAT_ARRIVAL_EXP is absent. A leg asked for and not run is reported, never silently dropped."
else
  P5="$(new_project author-local-form)"
  write_config "$P5" local-form
  seal_project "$P5"
  ( cd "$P5" && /usr/bin/expect -f "$CHAT_ARRIVAL_EXP" "${LIVE_FROM_ZERO_AUTHOR_TIMEOUT:-2400}" \
      "$P5/agent-qa.config.yaml" 'write a test for the login flow on local-form' \
      'list the test runs recorded in this project' ) \
    >"$TRANSCRIPTS/leg5-authoring.txt" 2>&1
  L5_RC=$?
  S5="$(ls -t "$P5/.agent-qa/sessions/"*.jsonl 2>/dev/null | head -1)"
  if [ -z "${S5:-}" ]; then
    record_leg 'L5 authoring (local app)' 'RED' \
      "the drive exited $L5_RC and wrote no session JSONL — no reading was taken (transcript: $TRANSCRIPTS/leg5-authoring.txt)"
  else
    L5_RECEIPTS="$(session_query "$S5" receipts)"
    L5_STATUS="$(session_query "$S5" status)"
    L5_REASON="$(session_query "$S5" reason)"
    printf '  session   %s\n  drive rc  %s\n  status    %s\n  receipts  %s\n  reason    %s\n' \
      "$S5" "$L5_RC" "$L5_STATUS" "$L5_RECEIPTS" "$L5_REASON"
    case "$L5_RECEIPTS" in
      *authoring.draft.write:executed*)
        record_leg 'L5 authoring (local app)' 'PASS' \
          "AUTHORING PROCEEDED AGAINST THE LOCAL APP: the session's own clause receipt records \`authoring.draft.write\` EXECUTED in a project whose only target is $FORM_URL, with the approval answered on a real terminal. status='$L5_STATUS'"
        ;;
      *)
        # THE RUNG IS NAMED OUT OF THE TRANSCRIPT, not guessed. The CLI prints an op's failure class
        # under the receipt line, and a rung reported as "it failed" is a rung nobody can act on.
        L5_CLASS="$(LC_ALL=C sed $'s/\033\[[0-9;]*m//g' "$TRANSCRIPTS/leg5-authoring.txt" \
          | grep -oE '[A-Za-z]+Error' | head -1)"
        record_leg 'L5 authoring (local app)' 'RED' \
          "THE LADDER'S NEXT RUNG, RECORDED RATHER THAN SMOOTHED OVER: the approval was rendered and answered on a real terminal and the authoring op still did not execute. receipts='$L5_RECEIPTS' status='$L5_STATUS' failure class='${L5_CLASS:-unclassified}' reason='$L5_REASON' (drive rc $L5_RC). Transcript: $TRANSCRIPTS/leg5-authoring.txt"
        ;;
    esac
  fi
fi

# ------------------------------------------------------------------------------------------------
# THE SELF-TEST — an instrument that cannot fail is not an instrument
# ------------------------------------------------------------------------------------------------
#
# Neuters LEG 1's control half by asking the gate about a token it must accept and grading the answer
# as though a refusal were expected. The lane must exit 1. Run it whenever this file is edited: it is
# the same discipline `395-scan-mutation.sh` applies to itself, for the same reason.

if [ "$SELFTEST" = 'neutered' ]; then
  banner 'SELF-TEST — the lane is asked to grade a control it must refuse'
  # `booking.com` IS a hostname and this lane's LEG 1 knows it: the control arm asserts it reaches
  # `already-configured`. Asking the SAME `probe_gate` to expect `not-a-hostname` for it is the
  # measurement a lane that had stopped working would make, and it must not be able to report PASS.
  # Driven through the real helper rather than a re-typed copy, so what is proven falsifiable is the
  # instrument LEG 1 actually uses.
  LEG1_RC=0
  probe_gate 'booking.com' not-a-hostname
  if [ "$LEG1_RC" -eq 0 ]; then
    record_leg 'SELFTEST' 'RED' \
      'THE INSTRUMENT IS BLIND: `probe_gate` accepted a deliberately-wrong expectation for a token the gate demonstrably does not refuse. Every LEG 1 verdict above is therefore worthless.'
  else
    record_leg 'SELFTEST' 'RED' \
      'NEUTERED AS ASKED, AND REFUSED: `probe_gate` rejected the deliberately-wrong expectation, so LEG 1 is able to fail rather than able only to pass. This mode exits 1 BY DESIGN — a green here would be the finding.'
  fi
fi

# ------------------------------------------------------------------------------------------------
# the receipt
# ------------------------------------------------------------------------------------------------

banner 'RECEIPT'
LANE_RC=0
for index in "${!LEG_NAMES[@]}"; do
  printf '%-36s %s\n' "${LEG_NAMES[$index]}" "${LEG_VERDICTS[$index]}"
  [ "${LEG_VERDICTS[$index]}" = 'RED' ] && LANE_RC=1
done

printf '\n'
if [ "$LANE_RC" -eq 0 ]; then
  printf 'LANE GREEN — every leg measured what it was written to measure.\n'
  printf 'THE PHASE RESULT IS STILL THAT CFGM-05s FROM-ZERO SENTENCE DOES NOT COMPLETE.\n'
  printf 'Green here means the LADDER is exactly where legs 1-3 say it is, not that the sentence works.\n'
else
  printf 'LANE RED — at least one leg moved. Read its WHY: each is written to name which rung changed.\n'
fi
printf 'transcripts: %s\n' "$TRANSCRIPTS"
exit "$LANE_RC"
