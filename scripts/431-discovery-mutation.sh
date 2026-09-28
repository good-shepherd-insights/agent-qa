#!/usr/bin/env bash
# 431-discovery-mutation.sh — every closed set and negative claim of coding-agent knowledge discovery
# reds its named cell under a targeted harmful mutation (431-13, PXH-AGENT-01..07, D-03).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 431 narrowed and pinned closed
# sets (the MCP tool names, each tool's ops, the unprojected adjudicator vocabulary, the partition of
# registry ops, the cold read-scope membership) and made negative claims (no search tool, no eager
# embedding runtime on a cold MCP door). An exactness or absence cell is green whether or not it
# looks at the right bytes, so each leg below returns one removed member, or plants one forbidden
# member, in the source its cell exists to watch and requires that NAMED cell to red while the
# listed controls hold.
#
# THE LEGS — group `contracts`
#   D01  a retired v1 name returns as a live tool over runs.artifact            -> MCP-NAMES-EXACT (extra member)
#   D02  agent_qa_get_run_overview is deleted                                   -> MCP-NAMES-EXACT (missing member), MCP-PARTITION
#   D03  the evidence fold's ops are swapped                                    -> MCP-OPS-EXACT
#   D04  '407' returns to UNPROJECTED_ADJUDICATIONS                             -> MCP-ADJUDICATIONS
#   D05  '423' returns to UNPROJECTED_ADJUDICATIONS                             -> MCP-ADJUDICATIONS
#   D06  runs.knowledge is dispositioned unprojected again while projected      -> MCP-PARTITION
#   D07  an agent_qa_search_knowledge tool is projected                         -> REGISTRY-NO-SEARCH
#   D08  runs.overview leaves the cold read-scope allowlist                     -> OVERVIEW-COLD-SCOPE
#   D09  the floor tokenizer import turns eager again (rebuilt knowledge-local) -> COLD-MCP-NO-RUNTIME
#
# THE LEGS — group `guidance`
#   D10  the source knowledge skill names a tool that is not projected          -> LIVE-GUIDANCE-TOOLS
#   D11  the generated guide's map quotes a CLI verb that does not exist        -> LIVE-GUIDANCE-VERBS
#   D12  the source triage skill falls back to private run files                -> INSTRUCTIONS-STRUCTURED-READS
#   D13  the bundle scanner admits the knowledge root, where the guide lives    -> GUIDE-NOT-INDEXED
#   D14  the policy ladder reads the guide slot as a policy rung                -> GUIDE-NOT-SERVED
#   D15  an existing block with user bytes after it is moved to the end         -> MANAGED-BYTES
#   D16  an image built from the unmasked output joins a withheld result        -> IMAGE-MASK-WITHHOLD
#
# SOURCE, NEVER GENERATED. D10 and D12 mutate the source skills under skills/, which both cells read
# at run time; the packaged copies are left alone. D11 mutates the module the guide is generated
# from. The forbidden instruction wording D12 plants lives here and in its cell, nowhere in product.
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# USAGE
#   pnpm run validate:431-discovery-mutation                         # from the agent-qa root
#   bash agent-qa/scripts/431-discovery-mutation.sh --group contracts # one group
#
# KNOBS — AGENT_QA_431_DISCOVERY_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_431_DISCOVERY_MUTATION_LEG=D01.. runs one leg (normal or neutered runs only).
# AGENT_QA_431_DISCOVERY_MUTATION_LIST=1 prints the declared inventory and exits.
# AGENT_QA_431_DISCOVERY_MUTATION_EVIDENCE=<dir> keeps the evidence at <dir>, which must not exist.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - "$@" <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const MAPPING_SRC = 'packages/mcp/src/mapping.ts'
const COMPOSE_SRC = 'packages/agent-local/src/composition/compose-local-agent.ts'
const FLOOR_SRC = 'packages/knowledge-local/src/embedder-floor.ts'
const KNOWLEDGE_SKILL_SRC = 'skills/agent-qa-knowledge/SKILL.md'
const GUIDE_SRC = 'packages/cli/src/commands/knowledge-guide.ts'
const TRIAGE_SKILL_SRC = 'skills/agent-qa-result-triage/SKILL.md'
const SCAN_SRC = 'packages/knowledge-local/src/bundle-scan.ts'
const LADDER_SRC = 'packages/knowledge-local/src/serving/policy-ladder.ts'
const MANAGED_SRC = 'packages/cli/src/commands/managed-block.ts'
const CATALOG_SRC = 'packages/mcp/src/catalog.ts'

const GUARD_T = 'src/__tests__/mapping-bump-guard.test.ts'
const PROJECTION_T = 'src/__tests__/431-knowledge-projection.test.ts'
const COLD_SCOPE_T = 'src/composition/__tests__/431-overview-cold-scope.test.ts'
const COLD_RUNTIME_T = 'src/__tests__/431-mcp-no-embedder.test.ts'
const CENSUS_T = 'src/__tests__/conformance/help-census.test.ts'
const INSTRUCTIONS_T = 'src/__tests__/431-instruction-safety.test.ts'
const GUIDE_T = 'src/__tests__/431-guide-exclusion.test.ts'
const MANAGED_T = 'src/__tests__/431-managed-block.test.ts'
const IMAGE_T = 'src/__tests__/431-evidence-image.test.ts'

// Every count is measured from a fresh Vitest JSON report of exactly these files (2026-09-29).
const instruments = {
  'mcp-guard': { pkg: 'packages/mcp', files: [GUARD_T], typecheck: false, count: 26 },
  'mcp-projection': { pkg: 'packages/mcp', files: [PROJECTION_T], typecheck: false, count: 24 },
  'cold-scope': { pkg: 'packages/agent-local', files: [COLD_SCOPE_T], typecheck: false, count: 5 },
  'cold-runtime': { pkg: 'packages/cli', files: [COLD_RUNTIME_T], typecheck: false, count: 10, dist: true,
    env: { VITEST_MAX_WORKERS: '1' } },
  census: { pkg: 'packages/cli', files: [CENSUS_T], typecheck: false, count: 16, dist: true, env: { VITEST_MAX_WORKERS: '1' } },
  instructions: { pkg: 'packages/cli', files: [INSTRUCTIONS_T], typecheck: false, count: 9, dist: true },
  'guide-exclusion': { pkg: 'packages/knowledge-local', files: [GUIDE_T], typecheck: false, count: 4 },
  managed: { pkg: 'packages/cli', files: [MANAGED_T], typecheck: false, count: 56 },
  image: { pkg: 'packages/mcp', files: [IMAGE_T], typecheck: false, count: 19 },
}

const guard = (name, count) => cell('mcp-guard', GUARD_T, name, count)
const projection = name => cell('mcp-projection', PROJECTION_T, name)
const coldScope = name => cell('cold-scope', COLD_SCOPE_T, name)
const coldRuntime = name => cell('cold-runtime', COLD_RUNTIME_T, name)
const census = (name, count) => cell('census', CENSUS_T, name, count)
const instructions = name => cell('instructions', INSTRUCTIONS_T, name)
const guide = name => cell('guide-exclusion', GUIDE_T, name)
const managed = (name, count) => cell('managed', MANAGED_T, name, count)
const image = name => cell('image', IMAGE_T, name)
const edit = (from, to) => ({ from, to })

const COUNT_BAND = guard('holds a tool count inside the MCPS-02 band, at both ends')
const CONTRACT_ENTRY = guard('carries a contract-table entry for every projected op')
const REGISTRY_COUNT = guard('measures the registry at the count this suite header records')
const ONE_TOOL = guard('projects each op through exactly one tool')
const OVERVIEW_TOOL = "  Object.freeze({\n    name: 'agent_qa_get_run_overview',\n    ops: Object.freeze(['runs.overview']),\n    kind: 'read',\n    maxResultSizeChars: RUN_READ_MAX_RESULT_SIZE_CHARS,\n  }),\n"
const ADJUDICATIONS = "export const UNPROJECTED_ADJUDICATIONS = Object.freeze(['397', '398', '405', '408', '428'] as const)"

const legs = [
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-guard', claim: 'MCP-NAMES-EXACT',
    operation: 'return the retired agent_qa_get_run_artifact as a live tool over runs.artifact',
    edits: [edit("  Object.freeze({\n    name: 'agent_qa_list_runs',\n",
      "  Object.freeze({\n    name: 'agent_qa_get_run_artifact',\n    ops: Object.freeze(['runs.artifact']),\n    kind: 'read',\n  }),\n  Object.freeze({\n    name: 'agent_qa_list_runs',\n")],
    reds: [guard('MCP-NAMES-EXACT'), guard('shares no name with the live catalogue')],
    // The returned tool carries an op set, a 25th tool, and a second projection of runs.artifact,
    // which the op-set, band, one-tool, contract-table, partition and count walls each measure.
    allowed: [guard('MCP-OPS-EXACT'), COUNT_BAND, ONE_TOOL, CONTRACT_ENTRY, guard('MCP-PARTITION'), REGISTRY_COUNT],
    greens: [guard('MCP-ADJUDICATIONS'), guard('declares no duplicate tool name'),
      guard('declares exactly the pinned sorted v1-name list')],
  },
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-guard', claim: 'MCP-NAMES-EXACT',
    operation: 'delete agent_qa_get_run_overview from the projection',
    edits: [edit(OVERVIEW_TOOL, '')],
    reds: [guard('MCP-NAMES-EXACT'), guard('MCP-PARTITION')],
    // The deleted tool takes its op set, one tool of the band, one contract row and one projected op.
    allowed: [guard('MCP-OPS-EXACT'), COUNT_BAND, CONTRACT_ENTRY, REGISTRY_COUNT],
    greens: [guard('MCP-ADJUDICATIONS'), ONE_TOOL, guard('names only ops the registry actually declares')],
  },
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-guard', claim: 'MCP-OPS-EXACT',
    operation: "swap the evidence fold's ops to [runs.artifact, runs.evidence]",
    edits: [edit("    ops: Object.freeze(['runs.evidence', 'runs.artifact']),\n", "    ops: Object.freeze(['runs.artifact', 'runs.evidence']),\n")],
    reds: [guard('MCP-OPS-EXACT'), guard('advertises exactly the declared arms, in the declared order')],
    // The 423-21 cell pins the same fold's arm order from the feedback side.
    allowed: [guard('MCP-TWO-TOOLS')],
    greens: [guard('MCP-NAMES-EXACT'), guard('MCP-PARTITION'), ONE_TOOL],
  },
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-guard', claim: 'MCP-ADJUDICATIONS',
    operation: "return '407' to UNPROJECTED_ADJUDICATIONS",
    edits: [edit(ADJUDICATIONS, "export const UNPROJECTED_ADJUDICATIONS = Object.freeze(['397', '398', '405', '407', '408', '428'] as const)")],
    reds: [guard('MCP-ADJUDICATIONS')],
    allowed: [],
    greens: [guard('MCP-PARTITION'), REGISTRY_COUNT, guard('MCP-NAMES-EXACT')],
  },
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-guard', claim: 'MCP-ADJUDICATIONS',
    operation: "return '423' to UNPROJECTED_ADJUDICATIONS",
    edits: [edit(ADJUDICATIONS, "export const UNPROJECTED_ADJUDICATIONS = Object.freeze(['397', '398', '405', '408', '423', '428'] as const)")],
    reds: [guard('MCP-ADJUDICATIONS')],
    allowed: [],
    greens: [guard('MCP-PARTITION'), REGISTRY_COUNT, guard('MCP-NAMES-EXACT')],
  },
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-guard', claim: 'MCP-PARTITION',
    operation: 'disposition the projected runs.knowledge as unprojected again',
    edits: [edit("  Object.freeze({\n    opId: 'runs.detail',\n",
      "  Object.freeze({\n    opId: 'runs.knowledge',\n    reason: 'the run knowledge projection is read through the run digest instead',\n    adjudication: '397',\n  }),\n  Object.freeze({\n    opId: 'runs.detail',\n")],
    reds: [guard('MCP-PARTITION')],
    // The count cell measures the unprojected list, which the returned entry lengthens to 19.
    allowed: [REGISTRY_COUNT],
    greens: [guard('MCP-ADJUDICATIONS'), guard('MCP-NAMES-EXACT'), guard('MCP-OPS-EXACT'),
      guard('lists no op twice in the scoping note')],
  },
  {
    group: 'contracts', subject: MAPPING_SRC, instrument: 'mcp-projection', claim: 'REGISTRY-NO-SEARCH',
    operation: 'project an agent_qa_search_knowledge tool over the bundle listing',
    edits: [edit("  Object.freeze({\n    name: 'agent_qa_inspect_knowledge_records',\n",
      "  Object.freeze({\n    name: 'agent_qa_search_knowledge',\n    ops: Object.freeze(['knowledge.bundles.list']),\n    kind: 'read',\n  }),\n  Object.freeze({\n    name: 'agent_qa_inspect_knowledge_records',\n")],
    reds: [projection('registers no search op and projects no search tool')],
    allowed: [],
    greens: [projection('flags a planted knowledge.search declaration through the same census'),
      projection('declares each new tool as a plain read over exactly its canonical ops'),
      projection('lists all eight to a read caller with output schemas, read annotations and op-summary descriptions')],
  },
  {
    group: 'contracts', subject: COMPOSE_SRC, instrument: 'cold-scope', claim: 'OVERVIEW-COLD-SCOPE',
    operation: 'drop runs.overview from the cold read-scope allowlist',
    edits: [edit("  'runs.postprocessing', 'runs.knowledge', 'runs.evidence', 'runs.marks.history', 'runs.mark.preview',\n  'runs.overview', 'runs.list',\n]",
      "  'runs.postprocessing', 'runs.knowledge', 'runs.evidence', 'runs.marks.history', 'runs.mark.preview',\n  'runs.list',\n]")],
    reds: [coldScope('pins the cold read-scope allowlist to exactly seven stored-text reads'),
      coldScope('masks declared secrets in the cold overview and keeps the rest readable'),
      coldScope('opens the scope for the overview and not for an unrelated read')],
    allowed: [],
    greens: [coldScope('falls to the no-context marker, never cleartext, on a host with no masking sources'),
      coldScope('masks the run list test names and never matches the title filter on a masked span')],
  },
  {
    // The value binding is used at module scope, so the bundler keeps the eager import and carries
    // the arrival marker into every knowledge-local entry the built doors load.
    group: 'contracts', subject: FLOOR_SRC, instrument: 'cold-runtime', claim: 'COLD-MCP-NO-RUNTIME',
    operation: 'turn the floor tokenizer type import back into an eager value import',
    crossing: { pkg: '@vostride/agent-qa-knowledge-local', dir: 'packages/knowledge-local', marker: 'discovery431eagerTokenizer' },
    edits: [edit("import type { Tokenizer } from '@huggingface/tokenizers'\n",
      "import { Tokenizer } from '@huggingface/tokenizers'\n\nReflect.set(globalThis, 'discovery431eagerTokenizer', Tokenizer)\n")],
    reds: [coldRuntime('the stdio `agent-qa mcp` door starts, lists and answers every populated read with no runtime load'),
      coldRuntime('the dashboard co-hosted MCP door answers every read and both evidence arms with no runtime load')],
    // The real-acquisition control loads the knowledge-local barrel under the trap, which now refuses it.
    allowed: [coldRuntime('refuses a real acquisition through the shipped ladder, and the ladder degrades rather than loads')],
    // The forbidden runtime set stays pinned beside the controls that prove the trap can refuse.
    greens: [coldRuntime('derives the forbidden runtime from the acquisition imports and pins it'),
      coldRuntime('refuses an ESM import of the tokenizer runtime with the named sentinel'),
      coldRuntime('refuses a CommonJS require of the tokenizer runtime with the named sentinel'),
      coldRuntime('refuses an import of the inference runtime with the named sentinel')],
  },
  {
    group: 'guidance', subject: KNOWLEDGE_SKILL_SRC, instrument: 'census', claim: 'LIVE-GUIDANCE-TOOLS',
    operation: 'name the unprojected agent_qa_list_run in the source knowledge skill',
    reads: { root: 'skills/', reference: "const SKILLS_SOURCE_DIR = 'skills'" },
    edits: [edit('1. Find the run with `agent_qa_list_runs`:', '1. Find the run with `agent_qa_list_run`:')],
    reds: [census('LIVE-GUIDANCE-TOOLS'), census('every tool a skill names is one the shipped mapping actually projects')],
    allowed: [],
    greens: [census('LIVE-GUIDANCE-VERBS'), census('LIVE-GUIDANCE-INPUTS', 2)],
  },
  {
    group: 'guidance', subject: GUIDE_SRC, instrument: 'census', claim: 'LIVE-GUIDANCE-VERBS',
    operation: "quote the nonexistent 'agent-qa knowledge bundle' in the guide's question map",
    edits: [edit("    cli: 'agent-qa knowledge bundles',\n", "    cli: 'agent-qa knowledge bundle',\n")],
    reds: [census('LIVE-GUIDANCE-VERBS')],
    allowed: [],
    greens: [census('LIVE-GUIDANCE-TOOLS'), census('LIVE-GUIDANCE-INPUTS', 2)],
  },
  {
    group: 'guidance', subject: TRIAGE_SKILL_SRC, instrument: 'instructions', claim: 'INSTRUCTIONS-STRUCTURED-READS',
    operation: 'send the source triage skill to the private run files when the CLI is unavailable',
    reads: { root: 'skills/', reference: "join(AGENT_QA_ROOT, 'skills')" },
    edits: [edit('  to a new file; open it with your image viewer. Say which evidence was unavailable.\n',
      '  to a new file; open it with your image viewer. Say which evidence was unavailable.\n- If the CLI is unavailable too, read the local `.agent-qa` run artifacts as a fallback.\n')],
    reds: [instructions('sends no agent to private runtime files')],
    allowed: [],
    greens: [instructions('reds on a known-bad instruction subject'),
      instructions('agent-qa-result-triage reads the overview, then evidence, with a CLI fallback')],
  },
  {
    group: 'guidance', subject: SCAN_SRC, instrument: 'guide-exclusion', claim: 'GUIDE-NOT-INDEXED',
    operation: 'admit the knowledge root, where the guide lives, as a bundle directory',
    edits: [edit("      .map((bundleDir) => ({ product, dir: join(bundlesDir, bundleDir) }))\n  })\n}\n",
      "      .map((bundleDir) => ({ product, dir: join(bundlesDir, bundleDir) }))\n  }).concat(products.length === 0 ? [] : [{ product: products[0]!, dir: knowledgeRoot }])\n}\n")],
    reds: [guide('indexes only the real bundle while the guide slot holds record-shaped decoys')],
    allowed: [],
    greens: [guide('known-bad subject: the same assertion reds when the decoy sits in an admitted bundle'),
      guide('serves only the authored policy and the real record while the guide slot holds policy decoys')],
  },
  {
    group: 'guidance', subject: LADDER_SRC, instrument: 'guide-exclusion', claim: 'GUIDE-NOT-SERVED',
    operation: 'read the guide slot as the first policy rung',
    edits: [edit("  const requestedFiles = ['policies/global.md']\n", "  const requestedFiles = ['AGENTS.md', 'policies/global.md']\n")],
    reds: [guide('serves only the authored policy and the real record while the guide slot holds policy decoys')],
    allowed: [],
    greens: [guide('known-bad subject: the same assertions red when the guide bytes sit on a policy rung'),
      guide('indexes only the real bundle while the guide slot holds record-shaped decoys')],
  },
  {
    group: 'guidance', subject: MANAGED_SRC, instrument: 'managed', claim: 'MANAGED-BYTES',
    operation: 'move an existing block that has user bytes after it to the end of the file',
    edits: [edit('  if (span === undefined) return appendAtEof(existing, `${block}\\n`)\n',
      '  if (span === undefined) return appendAtEof(existing, `${block}\\n`)\n  if (existing.slice(span.end).trim() !== \'\') return appendAtEof(`${existing.slice(0, span.start)}${existing.slice(span.end)}`, `${block}\\n`)\n')],
    reds: [managed('replaces a middle block in place, keeping every outside byte and the block position', 2),
      managed('regenerates owned content and changes nothing outside the markers', 2),
      managed('leaves a differently named block of the same owner untouched', 2)],
    // Each writes through the same composer over a file whose block has user bytes after it.
    allowed: [managed('creates, updates and then preserves, keeping every outside byte'),
      managed('puts the .gitignore upsert on the same locked writer'),
      managed('applies twice to the same bytes, keeping every outside byte')],
    greens: [managed('returns the same bytes when composed a second time', 2),
      managed('appends an absent block after the original bytes', 12)],
  },
  {
    group: 'guidance', subject: CATALOG_SRC, instrument: 'image', claim: 'IMAGE-MASK-WITHHOLD',
    operation: 'append an image decided from the unmasked output whenever the masked result carries none',
    edits: [edit('      const result = opId === RUNS_ARTIFACT_FUNCTION_ID\n        ? decorateRunEvidenceImage({ result: masked, output, maskText })\n        : masked\n',
      "      const decorated = opId === RUNS_ARTIFACT_FUNCTION_ID\n        ? decorateRunEvidenceImage({ result: masked, output, maskText })\n        : masked\n      const raw = opId === RUNS_ARTIFACT_FUNCTION_ID\n        ? decorateRunEvidenceImage({ result: { content: [], structuredContent: output as Record<string, unknown> }, output, maskText })\n        : undefined\n      const result = raw === undefined || raw.isError === true || decorated.content.some((block) => block.type === 'image')\n        ? decorated\n        : { ...decorated, content: [...decorated.content, ...raw.content.filter((block) => block.type === 'image')] }\n")],
    reds: [image('(a) a masking refusal withholds the image and every byte'),
      image('(b) masking that altered the encoded bytes withholds the image and the altered result')],
    allowed: [],
    greens: [image('IMAGE-PNG'), image('IMAGE-JPEG'), image('(c) bytes carrying only the PNG magic are refused as an invalid image'),
      image('the step-document arm is never decorated')],
  },
]

runGate({
  slug: '431-discovery-mutation', envPrefix: 'AGENT_QA_431_DISCOVERY_MUTATION', idPrefix: 'D',
  instruments, legs, expectedLegs: 16, banner: 'DISCOVERY_MUTATION_OK', argv: process.argv.slice(2),
})
NODE
