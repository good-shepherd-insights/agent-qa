#!/usr/bin/env bash
#
# 396-mapping-mutation.sh — the acceptance bar for D-04's bump guard (396-04; rebuilt 2026-10-02 by
# 432-45 on the shared 423 engine for D-03, D-05 and D-12).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `mapping-bump-guard.test.ts` passing
# says the catalogue agrees with itself today. It does NOT say the guard would CATCH the drift D-04
# exists to forbid. Each leg is a change somebody would plausibly make and believe harmless, and each
# must red its OWN named cell by its own assertion:
#
#   M1  a twenty-first tool planted (`agent_qa_cancel_run` over the dispositioned `runs.get`) — the
#       shape of "we needed one more verb".                               -> MCP-NAMES-EXACT
#   M2  `agent_qa_start_run` RENAMED, adding and removing nothing. The leg a count-only guard cannot
#       see, and the reason D-04 forbids one by name.                     -> MCP-NAMES-EXACT
#   M3  RE-AIMED 2026-10-02 (432-45). This leg remapped `agent_qa_show_proposal` onto `proposals.list`;
#       432-12 deleted that tool and 432-17 that op. The claim — neither the name list nor the count
#       moves, only which capability a door reaches — is carried by swapping the ops of the two
#       feedback read tools.                                              -> MCP-OPS-EXACT
#   M4  `config.get` added to the config fold WITHOUT leaving `UNPROJECTED_OPS` — an op in both sets
#       (re-anchored: the config fold's last arm is `config.project.scaffold` since 432-12).
#                                                                          -> MCP-PARTITION
#   M5  NEW (432-45, the map row "old mapping/permission names -> twenty-tool exact set"): the config
#       change tool goes back to its retired proposal-era name. -> C432-MCP-TWENTY-TOOLS (names cell)
#   M6  NEW (432-45, "renamed change operations in 432-12"): `knowledge.forget` moves from the knowledge
#       change tool to the config one; every count and the op set as a whole stay the same.
#                                                       -> C432-MCP-TWENTY-TOOLS (change-fold cell)
#   M7  NEW (432-45): the same retired name as M5, measured by the deletion census in `packages/arch`
#       rather than by the bump guard.                                   -> C432-RETURN-A37
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named assertion. Co-reds were measured by
# planting every leg once (432-45) and are listed per leg with the reason.
#
# NO DIST REBUILD for M1-M6: the subject (`packages/mcp/src/mapping.ts`) and the bump guard live in the
# same package and vitest resolves the import from source. M7's census reads source text.
#
# THE WIRING GREPS (re-spelled 2026-10-02, 432-45): catalog.ts has exactly one entity-resource
# registration, no prompt registration, no task-seam import and — since 432-12 deleted the apply
# primitive — no `createApplyToolHandler` call (was exactly one).
#
# Engine, arrival proof, counted selection, byte-exact restoration, rebuilds and positive controls:
# scripts/423-mutation-engine.cjs.
#
# USAGE
#   bash agent-qa/scripts/396-mapping-mutation.sh   # from the super-repository root
#   bash scripts/396-mapping-mutation.sh            # from the agent-qa root
#
# KNOBS — MAPPING_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# MAPPING_MUTATION_LEG=M1..M7 runs one leg; MAPPING_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${MAPPING_MUTATION_LIST:-}" != "1" ]]; then
  CATALOG=packages/mcp/src/catalog.ts
  apply_calls="$(grep -c 'createApplyToolHandler(' "$CATALOG" || true)"
  resource_calls="$(grep -c 'registerEntityResources(' "$CATALOG" || true)"
  prompts="$(grep -c 'registerPrompt' "$CATALOG" || true)"
  task_seam="$(grep -cE '^import .*task-seam' "$CATALOG" || true)"
  [[ "$apply_calls" == "0" ]]    || { echo "FATAL: catalog.ts calls the deleted apply primitive ($apply_calls) — D-05" >&2; exit 1; }
  [[ "$resource_calls" == "1" ]] || { echo "FATAL: expected exactly one registerEntityResources call site, saw $resource_calls" >&2; exit 1; }
  [[ "$prompts" == "0" ]]        || { echo "FATAL: catalog.ts names the prompt registration verb ($prompts) — D-14" >&2; exit 1; }
  [[ "$task_seam" == "0" ]]      || { echo "FATAL: catalog.ts imports the task seam ($task_seam) — MCPS-06/D-12" >&2; exit 1; }
  echo "wiring greps (catalog.ts): apply primitive 0 · resources 1 · prompts 0 · task-seam imports 0"
fi

exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const MAPPING = 'packages/mcp/src/mapping.ts'
const GUARD_T = 'src/__tests__/mapping-bump-guard.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-45).
const instruments = {
  guard: { pkg: 'packages/mcp', files: [GUARD_T], typecheck: false, count: 30 },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
}

const edit = (from, to) => ({ from, to })
const guard = (name, message) => cell('guard', GUARD_T, name, 1, message)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)

const NAMES = 'the pinned catalogue (D-04) > MCP-NAMES-EXACT: declares exactly the pinned sorted tool-name list'
const OPS = 'the pinned catalogue (D-04) > MCP-OPS-EXACT: declares exactly the pinned op set for every tool'
const BAND = 'the pinned catalogue (D-04) > holds a tool count inside the MCPS-02 band, at both ends'
const NEAR_MISS = 'the pinned catalogue (D-04) > matches nothing for a near-miss tool name or a near-miss op id'
const ONE_DOOR = 'the projection resolves against the registry, produced not literal > projects each op through exactly one tool'
const CONTRACTS = 'the projection resolves against the registry, produced not literal > carries a contract-table entry for every projected op'
const PARTITION = 'the partition law (D-03 / D-15) > MCP-PARTITION: disposition every registry op exactly once, in exactly one of the two sets'
const COUNTS = 'the partition law (D-03 / D-15) > measures the registry at the count this suite header records'
const FOLD_ARMS = 'the composed fold contracts answer for the ops the mapping declares > advertises exactly the declared arms, in the declared order'
const RENAMED_TARGETS = 'the pinned migration map (D-14) > declares exactly the pinned renamed-to target for every renamed name'
const MIGRATION_OVERLAP = 'the pinned migration map (D-14) > shares no name with the live catalogue'
const APP_CARRIERS = 'the pinned catalogue (D-04) > declares exactly the pinned App carriers, with the pinned runId source (408 D-05)'
const DEGRADED = 'the degradation list names tools that exist (D-16) > names a declared tool and one of its declared ops for every entry'
const COMPOSED_ALL = 'the composed fold contracts answer for the ops the mapping declares > gives every multi-arm tool a composed contract, and no 1:1 tool one'
const TWO_TOOLS = '423-21 feedback read tools (D-18) > MCP-TWO-TOOLS: two read-only feedback tools over their exact contracts, evidence folded, no new write authority'
const TWENTY_NAMES = 'C432-MCP-TWENTY-TOOLS: twenty tools, the change tools renamed, no proposal round > C432-MCP-TWENTY-TOOLS: declares exactly twenty tools by name, and none of the retired names'
const TWENTY_FOLDS = 'C432-MCP-TWENTY-TOOLS: twenty tools, the change tools renamed, no proposal round > C432-MCP-TWENTY-TOOLS: the change tools fold the direct ops, and no tool projects an apply or proposal op'
const RUNTIME_SETS = 'C432-RUNTIME-SETS: the actual registry partition after the cutover > C432-RUNTIME-SETS: 44 registered ops, 30 projected by twenty tools, 14 dispositioned'
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

const CONFIG_TOOL = "    name: 'agent_qa_change_config',\n"
const RETIRED_CONFIG_TOOL = "    name: 'agent_qa_propose_config_change',\n"

const legs = [
  {
    id: 'M1', claim: 'MCP-NAMES-EXACT', instrument: 'guard', subject: MAPPING,
    operation: 'a twenty-first tool, agent_qa_cancel_run over the dispositioned runs.get',
    edits: [edit("  Object.freeze({\n    name: 'agent_qa_list_runs',\n",
      "  Object.freeze({\n    name: 'agent_qa_cancel_run',\n    ops: Object.freeze(['runs.get']),\n    kind: 'read',\n  }),\n"
      + "  Object.freeze({\n    name: 'agent_qa_list_runs',\n")],
    reds: [guard(NAMES, 'agent_qa_cancel_run')],
    // One more tool moves every exact pin over the catalogue; runs.get is then in both sets with no
    // contract entry, and agent_qa_cancel_run is a retired v1 name, so the live and retired
    // vocabularies overlap (measured 2026-10-02).
    allowed: [guard(OPS), guard(BAND), guard(CONTRACTS), guard(PARTITION), guard(COUNTS), guard(MIGRATION_OVERLAP),
      guard(TWENTY_NAMES), guard(RUNTIME_SETS)],
    greens: [guard(TWENTY_FOLDS), guard(ONE_DOOR), guard(RENAMED_TARGETS), guard(TWO_TOOLS)],
  },
  {
    id: 'M2', claim: 'MCP-NAMES-EXACT', instrument: 'guard', subject: MAPPING,
    operation: 'agent_qa_start_run renamed to agent_qa_begin_run, adding and removing nothing',
    edits: [edit("    name: 'agent_qa_start_run',\n", "    name: 'agent_qa_begin_run',\n")],
    reds: [guard(NAMES, 'agent_qa_begin_run')],
    // The rename moves the op pin's key, the App-carrier pin, the near-miss presence probe, the
    // degradation list's tool name and the twenty-name pin; no count moves, and the v1 redirect pin
    // reads the map, not the live name (measured 2026-10-02).
    allowed: [guard(OPS), guard(APP_CARRIERS), guard(NEAR_MISS), guard(DEGRADED), guard(TWENTY_NAMES)],
    greens: [guard(BAND), guard(PARTITION), guard(COUNTS), guard(CONTRACTS), guard(RUNTIME_SETS), guard(TWENTY_FOLDS),
      guard(RENAMED_TARGETS)],
  },
  {
    id: 'M3', claim: 'MCP-OPS-EXACT', instrument: 'guard', subject: MAPPING,
    operation: 'the two feedback read tools swap ops: same names, same count, other capability behind each door',
    edits: [
      edit("    name: 'agent_qa_get_run_marks',\n    ops: Object.freeze(['runs.marks.history']),\n",
        "    name: 'agent_qa_get_run_marks',\n    ops: Object.freeze(['runs.mark.preview']),\n"),
      edit("    name: 'agent_qa_preview_run_mark',\n    ops: Object.freeze(['runs.mark.preview']),\n",
        "    name: 'agent_qa_preview_run_mark',\n    ops: Object.freeze(['runs.marks.history']),\n"),
    ],
    reds: [guard(OPS)],
    // The feedback-read cell pins each tool's exact op too (measured 2026-10-02).
    allowed: [guard(TWO_TOOLS)],
    greens: [guard(NAMES), guard(BAND), guard(PARTITION), guard(COUNTS), guard(ONE_DOOR), guard(CONTRACTS), guard(TWENTY_NAMES), guard(TWENTY_FOLDS), guard(RUNTIME_SETS)],
  },
  {
    id: 'M4', claim: 'MCP-PARTITION', instrument: 'guard', subject: MAPPING,
    operation: 'config.get added to the config fold without leaving UNPROJECTED_OPS',
    edits: [edit("      'config.project.scaffold',\n    ]),\n", "      'config.project.scaffold',\n      'config.get',\n    ]),\n")],
    reds: [guard(PARTITION, 'ops declared BOTH projected and unprojected')],
    // The fold gains an arm its composed contract does not advertise and an op with no contract entry;
    // the op pins, counts and the change-fold cell all see the seventh arm (measured 2026-10-02).
    allowed: [guard(OPS), guard(CONTRACTS), guard(COUNTS), guard(FOLD_ARMS), guard(TWENTY_FOLDS), guard(RUNTIME_SETS)],
    greens: [guard(NAMES), guard(BAND), guard(ONE_DOOR), guard(TWENTY_NAMES)],
  },
  {
    id: 'M5', claim: 'C432-MCP-TWENTY-TOOLS', instrument: 'guard', subject: MAPPING,
    operation: 'the config change tool goes back to its retired proposal-era name',
    edits: [edit(CONFIG_TOOL, RETIRED_CONFIG_TOOL)],
    // The cell's first assertion (the exact twenty names) is the one that fails; its message spells
    // the sorted lists, which no longer start with the config change tool.
    reds: [guard(TWENTY_NAMES)],
    // A rename moves the name and op pins, both composed-fold cells (the composed contract is keyed by
    // the current name) and the change-fold cell, which looks the config tool up by that name
    // (measured 2026-10-02).
    allowed: [guard(NAMES), guard(OPS), guard(FOLD_ARMS), guard(COMPOSED_ALL), guard(TWENTY_FOLDS)],
    greens: [guard(BAND), guard(PARTITION), guard(COUNTS), guard(ONE_DOOR), guard(CONTRACTS), guard(RUNTIME_SETS)],
  },
  {
    id: 'M6', claim: 'C432-MCP-TWENTY-TOOLS', instrument: 'guard', subject: MAPPING,
    operation: 'knowledge.forget moves from the knowledge change tool to the config change tool',
    edits: [
      edit("      'config.project.scaffold',\n    ]),\n", "      'config.project.scaffold',\n      'knowledge.forget',\n    ]),\n"),
      edit("      'knowledge.reject',\n      'knowledge.forget',\n    ]),\n", "      'knowledge.reject',\n    ]),\n"),
    ],
    reds: [guard(TWENTY_FOLDS)],
    // Both folds now advertise arms their composed contracts do not declare (measured 2026-10-02).
    allowed: [guard(OPS), guard(FOLD_ARMS)],
    greens: [guard(NAMES), guard(TWENTY_NAMES), guard(BAND), guard(PARTITION), guard(COUNTS), guard(ONE_DOOR), guard(CONTRACTS), guard(RUNTIME_SETS)],
  },
  {
    id: 'M7', claim: 'C432-RETURN-A37', instrument: 'census', subject: MAPPING,
    operation: 'the retired propose-config-change tool name returns in the mapping (census)',
    edits: [edit(CONFIG_TOOL, RETIRED_CONFIG_TOOL)],
    reds: [census('C432-RETURN-A37', 'A37: the propose-config-change tool returned (agent_qa_propose_config_change)')],
    allowed: [],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A35'), census('C432-RETURN-A38')],
  },
]

runGate({
  slug: '396-mapping-mutation', envPrefix: 'MAPPING_MUTATION',
  instruments, legs, expectedLegs: 7, explicitIds: true, parseCheck: true, banner: 'MAPPING_MUTATION_OK',
})
NODE
