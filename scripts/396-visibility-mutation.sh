#!/usr/bin/env bash
#
# 396-visibility-mutation.sh — the acceptance bar for MCPS-04 (396-05; rebuilt 2026-10-02 by 432-45 on
# the shared 423 engine for D-12 and D-13).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Until 432-20 the thesis of
# `mcp-visibility-differential.test.ts` was an ABSENCE: a caller without `config-write` did not see
# the config tools, behind two independent walls. D-12 deleted both walls and the bearer, and the
# suite was re-spelled in place to pin the opposite — every caller lists the same catalogue, reaches
# every op, and no header a caller sends is read or echoed — while the Host/Origin guards and the
# environment masking (D-13) stay. A sameness claim is as easy to fake as an absence: it passes over a
# server that lists nothing and over a harness that only ever asks as one caller. So each leg puts ONE
# removed mechanism back, or tears one retained guard, and requires its OWN named cell to red:
#
#   V1  CARRIES W1 (`visibleToCaller` severed). The listing hides the config tool from a caller that
#       presents a read-only legacy bearer — a per-caller listing at the socket.
#                                                   -> 1 · a read-only caller sees the config tool
#   V2  CARRIES W2 (`invokeFunction`'s scope refusal deleted). The function layer refuses a config op
#       for a caller whose legacy scope set lacks config-write (agent dist rebuilt).
#                                                   -> 3 · serves a config op to a caller without the scope
#   V3  CARRIES K2 (the 401 body echoing the presented header). The bearer rung returns on the
#       listener and its refusal quotes what it refused.
#                                                   -> 9 · serves an undeclared legacy bearer like none and NEVER echoes it
#   V4  CARRIES K1 (the masker's declared-credential seeding cut). D-12 deleted the declared tokens,
#       so the environment is the seed left; V4 cuts it.
#                                                   -> 9 · the masker the COMMAND composes hides the environment secret
#   V5  NEW (432-45): the factory filters the config tools on the caller's legacy scope set — wall
#       one again, inside `buildAgentQaMcpServer` (mcp dist rebuilt).
#                                                   -> 4 · a config-write-only grant and a read-only grant list the same tools
#   V6  NEW (432-45): the deleted `mcp/src/visibility.ts` returns with `visibleToCaller`, measured by
#       the deletion census in `packages/arch`.     -> C432-RETURN-A58
#
# Each behavioural leg's CROSS-WALL cells are its positive controls: V1 leaves the function layer
# green, V2 leaves every listing green, and the Host/Origin guards stay green under every leg.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named cell. Co-reds were measured by
# planting every leg once (432-45) and are listed per leg with the reason.
#
# DIST REBUILDS: `packages/cli`'s vitest config declares no aliases, so its imports of
# `@vostride/agent-qa-mcp` and `@vostride/agent-qa-agent` resolve through those packages' BUILT dist.
# V2 and V5 rebuild their package and find their own string marker in it; V1, V3 and V4 mutate
# `packages/cli` itself, which vitest resolves from source.
#
# THE WIRING GREPS (re-spelled 2026-10-02, 432-45): mcp.ts emits no CORS header, binds a constant
# loopback host, calls the Host and Origin guards once each, shares ONE `buildAgentQaMcpServer` call
# site between stdio and HTTP, seeds the masker from the environment once (`buildRunMaskingContext`),
# and calls neither `matchBearer` nor the deleted declared-token seed `mcpTokenSecretStore` (was one
# each). `mcp-token-resolution.ts` is deleted, so its constant-time and derived-default greps left with
# it (C432-RETURN-A59/A60 own the return).
#
# Engine, arrival proof, counted selection, byte-exact restoration, rebuilds and positive controls:
# scripts/423-mutation-engine.cjs.
#
# USAGE
#   bash agent-qa/scripts/396-visibility-mutation.sh   # from the super-repository root
#   bash scripts/396-visibility-mutation.sh            # from the agent-qa root
#
# KNOBS — VISIBILITY_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# VISIBILITY_MUTATION_LEG=V1..V6 runs one leg; VISIBILITY_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${VISIBILITY_MUTATION_LIST:-}" != "1" ]]; then
  MCP_CMD=packages/cli/src/commands/mcp.ts
  cors="$(grep -v '^[[:space:]]*//' "$MCP_CMD" | grep -ci 'access-control-allow-origin' || true)"
  bind="$(grep -c "MCP_HTTP_BIND_HOST = '127.0.0.1'" "$MCP_CMD" || true)"
  host_guard="$(grep -c 'validateHostHeader(' "$MCP_CMD" || true)"
  origin_guard="$(grep -c 'validateOriginHeader(' "$MCP_CMD" || true)"
  build_calls="$(grep -c 'buildAgentQaMcpServer(' "$MCP_CMD" || true)"
  env_seed="$(grep -c 'buildRunMaskingContext(' "$MCP_CMD" || true)"
  bearer_calls="$(grep -c 'matchBearer(' "$MCP_CMD" || true)"
  token_seed="$(grep -c 'mcpTokenSecretStore(' "$MCP_CMD" || true)"
  fail() { echo "FATAL: $*" >&2; exit 1; }
  [[ "$cors" == "0" ]]         || fail "the mcp command emits a CORS header ($cors) — recorded prohibition"
  [[ "$bind" == "1" ]]         || fail "the loopback bind host is not a constant ($bind)"
  [[ "$host_guard" == "1" ]]   || fail "expected exactly one Host guard call site, saw $host_guard"
  [[ "$origin_guard" == "1" ]] || fail "expected exactly one Origin guard call site, saw $origin_guard"
  [[ "$build_calls" == "1" ]]  || fail "stdio and HTTP no longer share ONE buildAgentQaMcpServer call site (saw $build_calls)"
  [[ "$env_seed" == "1" ]]     || fail "expected exactly one environment masker seeding call site, saw $env_seed"
  [[ "$bearer_calls" == "0" ]] || fail "a bearer match is back on the MCP listener ($bearer_calls) — D-12"
  [[ "$token_seed" == "0" ]]   || fail "the declared-token masker seed is back ($token_seed) — D-12"
  echo "wiring greps: cors 0 · bind 1 · host 1 · origin 1 · buildServer 1 · env-seed 1 · matchBearer 0 · token-seed 0"
fi

exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const SUITE = 'src/__tests__/mcp-visibility-differential.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'
const MCP_CMD = 'packages/cli/src/commands/mcp.ts'
const INVOKE = 'packages/agent/src/functions/invoke.ts'
const CATALOG = 'packages/mcp/src/catalog.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-45).
const instruments = {
  visibility: { pkg: 'packages/cli', files: [SUITE], typecheck: false, count: 31, env: { VITEST_MAX_WORKERS: '1' } },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
}

const edit = (from, to) => ({ from, to })
const vis = name => cell('visibility', SUITE, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)
const CENSUS_CONTROLS = [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')]

const G1 = '1 · the config tools are PRESENT for every caller (432-20) > '
const RO_SEES = vis(`${G1}a read-only caller sees the config tool`)
const CFG_SEES = vis(`${G1}a config-write caller sees BOTH — the same machinery, answering the same way`)
const IDENTICAL = vis(`${G1}the two listings are identical`)
const IN_BAND = vis('2 · no tool is hidden, so a formerly hidden tool answers unlike a nonexistent one > answers the config tool in band for a read-only caller, and a ghost as not found')
const G3 = '3 · the function layer reads no grant (432-20) > '
const NO_SCOPE = vis(`${G3}serves a config op to a caller without the scope, with no scope refusal`)
const SAME_ANSWER = vis(`${G3}admits the same op for a caller that holds the scope — the same answer either way`)
const ANY_SERVER = vis(`${G3}serves the op whatever caller the SERVER was built for`)
const G4 = '4 · every grant set sees a three-scope tool, with no adjacency boundary (432-20) > '
const EXACT_SET = vis(`${G4}the exact set sees it`)
const SAME_TOOLS = vis(`${G4}a config-write-only grant and a read-only grant list the same tools`)
const NOTHING = vis('5 · a caller granted NOTHING is served the full catalogue (432-20) > lists every tool a read caller lists')
const ORDER = vis('6 · tools/list order is stable and derived from the mapping > equals the mapping\'s DECLARED order, filtered to what this composition serves')
const INTERLEAVED = vis('7 · interleaved requests bearing different tokens all get the same catalogue > answers four simultaneous connections identically')
const CACHE_PRIVATE = vis('8 · two callers\' listings never share a cacheable identity > stamps cacheScope private and ttlMs 0 on BOTH callers\' lists, on the 2026-07-28 era')
const G9 = '9 · the walls in front of the handler refuse without becoming a channel > '
const HOST = vis(`${G9}refuses a rebound Host with 403, before anything else`)
const LOOPBACK = vis(`${G9}accepts a loopback Host — the guard is a filter, not a wall against everything`)
const ORIGIN = vis(`${G9}refuses a cross-origin Origin with 403`)
const HOST_FIRST = vis(`${G9}checks Host BEFORE the credential — a valid token does not buy a rebound host`)
const NEVER_ECHOES = vis(`${G9}serves an undeclared legacy bearer like none and NEVER echoes it`)
const SAME_BODY = vis(`${G9}answers the SAME body for a malformed header as for a wrong credential`)
const NO_LEAK = vis(`${G9}a valid credential presented to a formerly REFUSED tool still does not leak it into the answer`)
const SMUGGLED = vis(`${G9}masks an environment secret a caller smuggles back through a tool argument`)
const SEEDED = vis(`${G9}the masker the COMMAND composes hides the environment secret it was seeded with`)
const GUARDS = [HOST, LOOPBACK, ORIGIN, HOST_FIRST]

const LISTENER_AFTER_ORIGIN = "      return refuse(res, 403, 'forbidden_origin')\n    }\n"
const LISTENER_DEPS = '    const nodeHandler = createAgentQaMcpNodeHandler(() => mcpServerDeps({\n      registry: input.registry,\n'
const VISIBILITY_MODULE = `import type { FunctionCaller } from '@vostride/agent-qa-schema'

// 432-45 V6: the deleted per-caller visibility predicate, returned.
export function visibleToCaller(required: readonly string[], caller: FunctionCaller): boolean {
  const granted = (caller as { readonly grantedScopes?: readonly string[] }).grantedScopes ?? []
  return required.every((scope) => granted.includes(scope))
}
`

const legs = [
  {
    id: 'V1', claim: 'TOKENLESS-LISTING', instrument: 'visibility', subject: MCP_CMD,
    operation: 'the listener hides the config tool from a caller presenting a read-only legacy bearer',
    edits: [edit(LISTENER_DEPS,
      "    const hiddenLeg396V1 = String(req.headers.authorization ?? '').includes('-ro-')\n"
      + '    const nodeHandler = createAgentQaMcpNodeHandler(() => mcpServerDeps({\n'
      + '      registry: hiddenLeg396V1\n'
      + '        ? Object.assign(Object.create(input.registry) as typeof input.registry, {\n'
      + "            list: (caller: Parameters<typeof input.registry.list>[0]) => input.registry.list(caller).filter((d) => !d.id.startsWith('config.')),\n"
      + '          })\n'
      + '        : input.registry,\n')],
    reds: [RO_SEES],
    // Every cell that compares a read-only caller's listing with another's sees the difference, and
    // the formerly hidden tool answers not-found again. SMUGGLED reds as a side effect of the plant:
    // the delegating registry carries no dispatch internals, so the read-only caller's digest call
    // answers an unknown-function error instead of the echoing refusal (measured 2026-10-02).
    allowed: [IDENTICAL, IN_BAND, INTERLEAVED, CACHE_PRIVATE, SMUGGLED],
    greens: [CFG_SEES, NO_SCOPE, SAME_ANSWER, ANY_SERVER, SAME_TOOLS, NOTHING, ...GUARDS, NO_LEAK, SEEDED],
  },
  {
    id: 'V2', claim: 'NO-FUNCTION-WALL', instrument: 'visibility', subject: INVOKE,
    operation: "the function layer refuses a config op for a caller whose legacy scope set lacks config-write",
    edits: [edit('    throw new UnknownFunctionError(functionId)\n  }\n',
      '    throw new UnknownFunctionError(functionId)\n  }\n'
      + '  const scopesLeg396V2 = (_caller as { readonly grantedScopes?: readonly string[] }).grantedScopes\n'
      + "  if (functionId.startsWith('config.') && scopesLeg396V2 !== undefined && !scopesLeg396V2.includes('config-write')) {\n"
      + "    throw Object.assign(new Error('scopeWallLeg396V2: config-write is missing'), { name: 'FunctionScopeError' })\n"
      + '  }\n')],
    crossing: { pkg: '@vostride/agent-qa-agent', dir: 'packages/agent', marker: 'scopeWallLeg396V2' },
    reds: [NO_SCOPE],
    // The other two function-layer cells call the op with a scope set that lacks config-write too
    // (measured 2026-10-02).
    allowed: [SAME_ANSWER, ANY_SERVER],
    greens: [RO_SEES, CFG_SEES, IDENTICAL, SAME_TOOLS, NOTHING, ...GUARDS, SEEDED],
  },
  {
    id: 'V3', claim: 'HEADER-NEVER-READ', instrument: 'visibility', subject: MCP_CMD,
    operation: 'a bearer rung returns on the listener and its 401 body quotes the refused header',
    edits: [edit(LISTENER_AFTER_ORIGIN, LISTENER_AFTER_ORIGIN
      + '    const presentedLeg396V3 = req.headers.authorization\n'
      + "    if (presentedLeg396V3 !== undefined && presentedLeg396V3.includes('never-declared')) {\n"
      + "      res.writeHead(401, { 'content-type': 'application/json' })\n"
      + "      res.end(JSON.stringify({ error: 'invalid_token', presented: presentedLeg396V3 }))\n"
      + '      return\n'
      + '    }\n')],
    reds: [NEVER_ECHOES],
    // A wrong bearer now gets a 401 and a malformed header does not (measured 2026-10-02).
    allowed: [SAME_BODY],
    greens: [RO_SEES, IDENTICAL, NO_SCOPE, ...GUARDS, SEEDED],
  },
  {
    id: 'V4', claim: 'ENVIRONMENT-SEED-REACHES-MASKER', instrument: 'visibility', subject: MCP_CMD,
    operation: 'the environment stops seeding the masker the command composes',
    edits: [edit('  return buildRunMaskingContext({ env: input.env })\n', '  return buildRunMaskingContext({ env: {} })\n')],
    reds: [SEEDED],
    // The smuggled environment secret rides back unmasked through the echoing digest refusal
    // (measured 2026-10-02).
    allowed: [SMUGGLED],
    greens: [RO_SEES, IDENTICAL, NO_SCOPE, NEVER_ECHOES, NO_LEAK, ...GUARDS],
  },
  {
    id: 'V5', claim: 'TOKENLESS-FACTORY', instrument: 'visibility', subject: CATALOG,
    operation: "the server factory skips the config tools for a caller whose legacy scope set lacks config-write",
    edits: [edit('    const contracts = AGENT_QA_OP_CONTRACTS[declaration.id]\n    if (contracts === undefined) continue\n',
      '    const contracts = AGENT_QA_OP_CONTRACTS[declaration.id]\n    if (contracts === undefined) continue\n'
      + "    const hiddenLeg396V5 = 'config-write'\n"
      + "    if (declaration.id.startsWith('config.') && (deps.caller as { readonly grantedScopes?: readonly string[] }).grantedScopes?.includes(hiddenLeg396V5) === false) continue\n")],
    crossing: { pkg: '@vostride/agent-qa-mcp', dir: 'packages/mcp', marker: 'hiddenLeg396V5' },
    reds: [SAME_TOOLS],
    allowed: [],
    greens: [RO_SEES, IDENTICAL, NOTHING, NO_SCOPE, ANY_SERVER, ...GUARDS, SEEDED],
  },
  {
    id: 'V6', claim: 'C432-RETURN-A58', instrument: 'census', subject: 'packages/mcp/src/visibility.ts',
    operation: 'the deleted mcp/src/visibility.ts returns with visibleToCaller',
    create: VISIBILITY_MODULE,
    reds: [census('C432-RETURN-A58', 'A58: mcp/src/visibility.ts is back')],
    // The module is also on the deleted-module list and declares its deleted export (measured
    // 2026-10-02).
    allowed: [census('C432-DELETED-SYMBOLS: every deleted module file is absent'),
      census('C432-DELETED-SYMBOLS: no production source in any package declares a deleted export in code')],
    greens: [...CENSUS_CONTROLS, census('C432-RETURN-A54'), census('C432-RETURN-A60')],
  },
]

runGate({
  slug: '396-visibility-mutation', envPrefix: 'VISIBILITY_MUTATION',
  instruments, legs, expectedLegs: 6, explicitIds: true, parseCheck: true, banner: 'VISIBILITY_MUTATION_OK',
})
NODE
