#!/usr/bin/env bash
# 429-config-contract-mutation.sh — task-oriented Config's contract side cannot silently regress
# (429-34, PXH-CONF-01..04 and -06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 429 closed seven vocabularies
# (the write ops, the write refusals, the named arrays, the masking classes, the provider error
# classes, the setup refusals and the reveal/Undo refusals) and made a set of promises about the
# config's write and read doors: a draft name takes a credential and a sign-in before it has a
# definition, `agent-qa auth test` exits non-zero on every failure arm, the CLI and the dashboard
# classify a provider failure through one module in one order, an autosave merges one field and
# never rewrites an outside edit, the GET payload carries no secret, the reveal door is same-site
# and secret-only, an env-var name reads in clear on the page and in `config show`, connect writes
# nothing before its test passes, a model name may hold a dot, the mask placeholder is never
# written back, an Undo token redeems once, a merge that fails whole-config validation keeps the
# file's bytes, another provider's credential is never overwritten, the masking map carries every
# schema leaf and the retired per-section write routes stay gone. Every suite that pins those is
# green today with nothing taken away, which is exactly what a green suite cannot tell you. So each
# leg below plants the regression that would re-open one set or break one promise, and requires its
# NAMED cell to red while the listed controls hold. The UI-side legs are 429-35's.
#
# THE LEGS
#   C01  a seventh op joins ConfigWriteOp and CONFIG_WRITE_OPS                    -> C429-CONFIG-WRITE-OPS-EXACT
#   C02  a ninth refusal joins ConfigWriteRefusal and its array                   -> C429-CONFIG-WRITE-REFUSALS-EXACT
#   C03  a second named array joins ConfigNamedArray and CONFIG_NAMED_ARRAYS      -> C429-CONFIG-NAMED-ARRAYS-EXACT
#   C04  a fourth class joins MaskingClass and MASKING_CLASSES                    -> C429-MASKING-CLASSES-EXACT
#   C05  a seventh class joins ProviderErrorClass and PROVIDER_ERROR_CLASSES      -> C429-PROVIDER-ERROR-CLASSES-EXACT
#   C06  a ninth refusal joins LlmSetupRefusal and LLM_SETUP_REFUSALS             -> C429-LLM-SETUP-REFUSALS-EXACT
#   C07  a fifth refusal joins ConfigActionRefusal and CONFIG_ACTION_REFUSALS     -> C429-CONFIG-ACTION-REFUSALS-EXACT
#   C08  NameSlugSchema's regex narrows back to hyphens only                      -> DOTTED-NAMES-ACCEPTED (D-13)
#   C09  the credential guard refuses a name absent from registry.llms again       -> DRAFT-CREDENTIAL-ACCEPTED (D-15)
#   C10  the sign-in guard refuses a name absent from registry.llms again          -> DRAFT-SIGN-IN-ACCEPTED (D-15)
#   C11  auth test's missing-credential arm drops its exit code                   -> AUTH-TEST-EXIT-MISSING-CREDENTIAL (D-18)
#   C12  auth test's provider-failure arm drops its exit code                     -> AUTH-TEST-EXIT-AUTH-ERROR (D-18)
#   C13  classifyProviderError tests network before rate                          -> CLASSIFIER-ORDER-PINNED (D-18)
#   C14  routes.ts spells a local classifier regex again                          -> CLASSIFIER-ONE-MODULE (D-18)
#   C15  applyChanges sets the whole parent block from a change                   -> SC3-FIELD-MERGE (D-19/D-22)
#   C16  the map classes registry.llms[].providerHeaders.* plain                  -> GET-CARRIES-NO-SECRET (D-08)
#   C17  the reveal route skips refuseCrossSiteRequest                            -> REVEAL-SAME-SITE-ONLY (D-09)
#   C18  the reveal route skips its secret-class check                            -> REVEAL-SECRET-PATHS-ONLY (D-09)
#   C19  the map classes the plain services.mcp.port leaf secret                  -> ENV-VAR-NAME-IN-CLEAR (D-08)
#   C20  connect writes the typed credential before its test                      -> CONNECT-NOTHING-WRITTEN-ON-FAIL (D-17)
#   C21  applyChanges no longer calls the mask guard                              -> MASK-NEVER-WRITTEN-BACK
#   C22  the undo store's take keeps the entry it hands out                       -> UNDO-TOKEN-SINGLE-USE (D-24)
#   C23  applyChanges skips the whole-config safeParse                            -> INVALID-MERGE-KEEPS-BYTES
#   C24  the credential guard drops its provider-conflict check                   -> CREDENTIAL-PROVIDER-CONFLICT-REFUSED
#   C25  one leaf line leaves CONFIG_MASKING_MAP                                  -> CONFIG-SCHEMA-LEAVES-PINNED (D-06)
#   C26  the map classes services.mcp.port secret, in config show                -> CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR (D-08)
#   C27  a retired per-section write route answers again                          -> LEGACY-WRITE-ROUTES-GONE (429-32)
#   C28  a write answers its post-merge revision as its base                      -> BASE-REVISION-ANSWERED (429-37)
#   C29  set-if-absent writes over a field the file already holds                 -> SET-IF-ABSENT-KEEPS-OUTSIDE-VALUE (429-42)
#   C30  set-if-absent ignores a root use.headless                                -> LEGACY-HEADLESS-KEPT-ON-COMPLETION (429-42)
#   C31  an expect skips its comparison with the file                             -> EXPECT-MISMATCH-REFUSED (429-42)
#   C32  an expect may name a secret path                                         -> EXPECT-ON-SECRET-REFUSED (429-42)
#   C33  a move skips its masking-class check                                     -> MOVE-ACROSS-CLASSES-REFUSED (429-52)
#   C34  readMasked keeps the comments                                            -> COMMENTED-SECRET-NEVER-SERVED (429-41)
#   C35  GET /api/config answers through json() with no same-site check           -> GET-CONFIG-SAME-SITE-NO-GRANT (429-41)
#   C36  the write door drops its page-writable check                             -> WRITE-DOOR-REFUSES-DENIED-ROOTS (429-44)
#   C37  a second root joins ConfigWriteDeniedRoot and CONFIG_WRITE_DENIED_ROOTS   -> C429-CONFIG-WRITE-DENIED-ROOTS-EXACT (429-44)
#   C38  the test route stops redacting saved header values                       -> SAVED-HEADER-NEVER-ECHOED (429-43)
#   C39  the auth store renames onto the symlink path                             -> AUTH-SYMLINK-KEPT (429-38)
#   C40  a completion's Undo loses the root use.headless it moved                 -> UNDO-LEGACY-HEADLESS-RESTORED (429-49)
#
# 2026-10-02 (432-44, D-12): FOUR LEGS RE-SPELLED AFTER THE TOKENLESS CONFIG. 432-22 deleted
# `services.mcp.tokens`, `services.dashboard.runServiceTokens` and the `safety` root, so the named
# arrays are `registry.llms` alone, the denied roots are `plugins` alone and no leaf is classed
# env-var-name. C03 and C37 add a SECOND member to the one left; C19 and C26 hide the plain MCP leaf
# their cells now read in clear (`services.mcp.port`). Each plants the same regression class as before
# and reds the same named cell.
#
# THE GAP CLOSURE (2026-09-27, 429-49). Plans 429-37, -38 and -41..-44 and -52 closed review
# findings CR-01, CR-02, WR-01 and WR-05 and deferred items 429-23 and 429-24 on the contract side,
# and C28..C39 give each of those promises its planted regression. C40 pins the one gap-closure
# behaviour no committed cell covered: an Undo of a set-if-absent completion that moved a root
# use.headless (429-42's prior, named uncovered by 429-42 and 429-45); its cell,
# UNDO-LEGACY-HEADLESS-RESTORED, was added with this leg. Four older legs moved with the source.
# C01 and C02 plant after the members 429-42 added to the ops and refusals ('expect',
# 'path_not_writable'). C15's anchor line now also appears in the set-if-absent branch, so it
# carries the next line to stay unique. C21's mask guard now skips a move, so its condition is
# spelled with that clause. C15 and C16 each gained co-reds from the new cells, listed with a
# reason. Each re-spelled leg plants the same regression it planted before. C33 plants the whole
# class check, both ends and leaf by leaf: with only the two-ends check dropped, the leaf check
# still refuses a scalar move (the leaf of a scalar is the value itself), and all six move cells
# stayed green (measured).
#
# C19 AND C26 PLANT ONE MUTATION TWICE. The engine gives a leg one instrument, and the env-var
# name's two promises live in two suites: the dashboard's GET payload (server) and `config show`
# (cli). Each is its own leg so each cell is required to red.
#
# C14 READS SOURCE AS TEXT. The classifier lint scans routes.ts by a path joined onto its own
# directory, so the leg's subject is dashboard-server source measured by the cli suite with no
# dist between them; the engine counts that read as reaching the file (429-34).
#
# ALLOWED CO-REDS are listed on each leg with a one-line reason; nothing else may red.
#
# C16, C19, C25 AND C26 CROSS THE DIST BOUNDARY. Their subject is schema source and their cell runs
# in dashboard-server, core or cli, each of which imports the built `@vostride/agent-qa-schema`. So
# each rebuilds that package and plants a marker the rebuilt dist must carry: the mutated map line
# written with the double quotes esbuild emits.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:429-config-contract-mutation              # from the agent-qa root
#   bash agent-qa/scripts/429-config-contract-mutation.sh       # from the super-repository root
#
# KNOBS — AGENT_QA_429_CONFIG_CONTRACT_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_429_CONFIG_CONTRACT_MUTATION_LEG=C01..C40 runs one leg (normal or neutered runs only).
# AGENT_QA_429_CONFIG_CONTRACT_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const WRITE_SRC = 'packages/schema/src/config/config-write.ts'
const MASKING_SRC = 'packages/schema/src/config/masking.ts'
const ERROR_SRC = 'packages/schema/src/llm/provider-error.ts'
const CONNECT_SRC = 'packages/schema/src/llm/connect.ts'
const PRIMITIVES_SRC = 'packages/core/src/schema/primitives.ts'
const MANAGER_SRC = 'packages/dashboard-server/src/config/config-manager.ts'
const UNDO_SRC = 'packages/dashboard-server/src/config/undo-store.ts'
const CONFIG_ROUTES_SRC = 'packages/dashboard-server/src/server/config-routes.ts'
const CONNECT_ROUTE_SRC = 'packages/dashboard-server/src/server/llm-connect-route.ts'
const ROUTES_SRC = 'packages/dashboard-server/src/server/routes.ts'
const AUTH_SRC = 'packages/cli/src/commands/auth.ts'
const AUTH_STORE_SRC = 'packages/core/src/auth/store.ts'

const SCHEMA_T = 'src/__tests__/429-config-contracts.test.ts'
const SCHEMA_D = 'src/__tests__/429-config-contracts.test-d.ts'
const CORE_SCHEMA_T = 'src/__tests__/config-schema.test.ts'
const LEAVES_T = 'src/__tests__/config-schema-leaves.test.ts'
const WRITE_T = 'src/__tests__/routes.config-write.test.ts'
const MASKING_T = 'src/__tests__/routes.config-masking.test.ts'
const REVEAL_T = 'src/__tests__/routes.config-reveal.test.ts'
const UNDO_T = 'src/__tests__/routes.config-undo.test.ts'
const CONNECT_T = 'src/__tests__/routes.llm-connect.test.ts'
const DRAFT_T = 'src/__tests__/routes.draft-credential.test.ts'
const MANAGER_T = 'src/__tests__/config-manager.test.ts'
const SAVED_HEADERS_T = 'src/__tests__/routes.llm-test-saved-headers.test.ts'
const AUTH_STORE_T = 'src/__tests__/auth-store.test.ts'
const AUTH_T = 'src/__tests__/auth-test.test.ts'
const LINT_T = 'src/__tests__/429-classifier-lint.test.ts'
const SHOW_T = 'src/composition/__tests__/masked-config.test.ts'
const PARITY_T = 'src/composition/__tests__/429-masking-parity.test.ts'

// 2026-10-02 (432-44): re-measured; the selected totals had drifted with later plans' cells
// (schema 27 -> 28, core 116 -> 132, server 170 -> 182), so the gate refused before any leg.
const instruments = {
  schema: { pkg: 'packages/schema', files: [SCHEMA_T, SCHEMA_D], typecheck: true, count: 28 },
  core: { pkg: 'packages/core', files: [CORE_SCHEMA_T, LEAVES_T, AUTH_STORE_T], typecheck: false, count: 132 },
  server: {
    pkg: 'packages/dashboard-server',
    files: [WRITE_T, MASKING_T, REVEAL_T, UNDO_T, CONNECT_T, DRAFT_T, MANAGER_T, SAVED_HEADERS_T],
    typecheck: false,
    count: 182,
  },
  cli: {
    pkg: 'packages/cli',
    files: [AUTH_T, LINT_T, SHOW_T, PARITY_T],
    typecheck: false,
    count: 98,
    env: { VITEST_MAX_WORKERS: '1' },
  },
}

const AUTH_DOORS = ['POST /api/auth/credential', 'POST /api/auth/credential/move', 'DELETE /api/auth/:configName',
  'POST /api/auth/plugin/:provider/start', 'POST /api/auth/plugin/:provider/exchange']

const schema = marker => ({ pkg: '@vostride/agent-qa-schema', dir: 'packages/schema', marker })

const schemaT = (name, count) => cell('schema', SCHEMA_T, name, count)
const schemaD = (name, count) => cell('schema', SCHEMA_D, name, count)
const coreSchema = (name, count) => cell('core', CORE_SCHEMA_T, name, count)
const leaves = (name, count) => cell('core', LEAVES_T, name, count)
const authStore = (name, count) => cell('core', AUTH_STORE_T, name, count)
const write = (name, count) => cell('server', WRITE_T, name, count)
const masking = (name, count) => cell('server', MASKING_T, name, count)
const reveal = (name, count) => cell('server', REVEAL_T, name, count)
const undo = (name, count) => cell('server', UNDO_T, name, count)
const connect = (name, count) => cell('server', CONNECT_T, name, count)
const draft = (name, count) => cell('server', DRAFT_T, name, count)
const manager = (name, count) => cell('server', MANAGER_T, name, count)
const savedHeaders = (name, count) => cell('server', SAVED_HEADERS_T, name, count)
const auth = (name, count) => cell('cli', AUTH_T, name, count)
const lint = (name, count) => cell('cli', LINT_T, name, count)
const show = (name, count) => cell('cli', SHOW_T, name, count)
const parity = (name, count) => cell('cli', PARITY_T, name, count)

const legs = [
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-WRITE-OPS-EXACT',
    operation: 'add a seventh op to ConfigWriteOp and CONFIG_WRITE_OPS',
    edits: [
      { from: "  | 'expect'\n// prettier-ignore\nexport const CONFIG_WRITE_OPS", to: "  | 'expect'\n  | 'prepend'\n// prettier-ignore\nexport const CONFIG_WRITE_OPS" },
      { from: "  'expect',\n] as const satisfies readonly ConfigWriteOp[]", to: "  'expect',\n  'prepend',\n] as const satisfies readonly ConfigWriteOp[]" },
    ],
    reds: [schemaD('C429-CONFIG-WRITE-OPS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-CONFIG-WRITE-OPS-EXACT')],
    greens: [schemaD('C429-CONFIG-WRITE-REFUSALS-EXACT'), schemaD('C429-CONFIG-NAMED-ARRAYS-EXACT'), schemaT('C429-CONFIG-CHANGE-STRICT')],
  },
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-WRITE-REFUSALS-EXACT',
    operation: 'add a ninth refusal to ConfigWriteRefusal and CONFIG_WRITE_REFUSALS',
    edits: [
      { from: "  | 'path_not_writable'\n// prettier-ignore\n", to: "  | 'path_not_writable'\n  | 'write_conflict'\n// prettier-ignore\n" },
      { from: "  'path_not_writable',\n] as const satisfies readonly ConfigWriteRefusal[]", to: "  'path_not_writable',\n  'write_conflict',\n] as const satisfies readonly ConfigWriteRefusal[]" },
    ],
    reds: [schemaD('C429-CONFIG-WRITE-REFUSALS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-CONFIG-WRITE-REFUSALS-EXACT')],
    greens: [schemaD('C429-CONFIG-WRITE-OPS-EXACT'), schemaD('C429-CONFIG-ACTION-REFUSALS-EXACT'), schemaT('C429-CONFIG-CHANGE-STRICT')],
  },
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-NAMED-ARRAYS-EXACT',
    // 2026-10-02 (432-44): the two token lists left the named arrays with their config (432-22), so
    // the one named array left gains a second.
    operation: 'add a second named array to ConfigNamedArray and CONFIG_NAMED_ARRAYS',
    edits: [
      { from: "export type ConfigNamedArray = 'registry.llms'\n", to: "export type ConfigNamedArray = 'registry.llms' | 'plugins.auth'\n" },
      { from: "  'registry.llms',\n] as const satisfies readonly ConfigNamedArray[]", to: "  'registry.llms',\n  'plugins.auth',\n] as const satisfies readonly ConfigNamedArray[]" },
    ],
    reds: [schemaD('C429-CONFIG-NAMED-ARRAYS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-CONFIG-NAMED-ARRAYS-EXACT')],
    greens: [schemaD('C429-CONFIG-WRITE-OPS-EXACT'), schemaD('C429-MASKING-CLASSES-EXACT'), schemaT('C429-CONFIG-CHANGE-STRICT')],
  },
  {
    subject: MASKING_SRC, instrument: 'schema', claim: 'C429-MASKING-CLASSES-EXACT',
    operation: 'add a fourth class to MaskingClass and MASKING_CLASSES',
    edits: [
      { from: "export type MaskingClass = 'secret' | 'env-var-name' | 'plain'\n", to: "export type MaskingClass = 'secret' | 'env-var-name' | 'plain' | 'redacted'\n" },
      { from: "  'plain',\n] as const satisfies readonly MaskingClass[]", to: "  'plain',\n  'redacted',\n] as const satisfies readonly MaskingClass[]" },
    ],
    reds: [schemaD('C429-MASKING-CLASSES-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-MASKING-CLASSES-EXACT')],
    greens: [schemaD('C429-PROVIDER-ERROR-CLASSES-EXACT'), schemaT('CLASSIFY-KNOWN-ANSWERS'), schemaT('CLASSIFY-UNKNOWN-FAILS-CLOSED')],
  },
  {
    subject: ERROR_SRC, instrument: 'schema', claim: 'C429-PROVIDER-ERROR-CLASSES-EXACT',
    operation: 'add a seventh class to ProviderErrorClass and PROVIDER_ERROR_CLASSES',
    edits: [
      { from: "  | 'provider_error'\n// prettier-ignore\n", to: "  | 'provider_error'\n  | 'quota_exceeded'\n// prettier-ignore\n" },
      { from: "  'provider_error',\n] as const satisfies readonly ProviderErrorClass[]", to: "  'provider_error',\n  'quota_exceeded',\n] as const satisfies readonly ProviderErrorClass[]" },
    ],
    reds: [schemaD('C429-PROVIDER-ERROR-CLASSES-EXACT')],
    // The runtime twin pins the array by value; the order pin closes by requiring its cases to land
    // on exactly PROVIDER_ERROR_CLASSES, and no case lands on the new class.
    allowed: [schemaT('C429-PROVIDER-ERROR-CLASSES-EXACT'), schemaT('CLASSIFIER-ORDER-PINNED')],
    greens: [schemaD('C429-LLM-SETUP-REFUSALS-EXACT'), schemaT('CLASSIFIER-EMPTY-MESSAGE'), schemaT('EXTRACT-PROVIDER-ERROR')],
  },
  {
    subject: CONNECT_SRC, instrument: 'schema', claim: 'C429-LLM-SETUP-REFUSALS-EXACT',
    operation: 'add a ninth refusal to LlmSetupRefusal and LLM_SETUP_REFUSALS',
    edits: [
      { from: "  | 'validation_failed'\n// prettier-ignore\n", to: "  | 'validation_failed'\n  | 'name_reserved'\n// prettier-ignore\n" },
      { from: "  'validation_failed',\n] as const satisfies readonly LlmSetupRefusal[]", to: "  'validation_failed',\n  'name_reserved',\n] as const satisfies readonly LlmSetupRefusal[]" },
    ],
    reds: [schemaD('C429-LLM-SETUP-REFUSALS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-LLM-SETUP-REFUSALS-EXACT')],
    greens: [schemaD('C429-CONFIG-ACTION-REFUSALS-EXACT'), schemaT('CONNECT-REQUEST-STRICT'), schemaT('REVEAL-UNDO-MOVE-STRICT')],
  },
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-ACTION-REFUSALS-EXACT',
    operation: 'add a fifth refusal to ConfigActionRefusal and CONFIG_ACTION_REFUSALS',
    edits: [
      { from: "  | 'reveal_not_found'\n// prettier-ignore\n", to: "  | 'reveal_not_found'\n  | 'undo_forbidden'\n// prettier-ignore\n" },
      { from: "  'reveal_not_found',\n] as const satisfies readonly ConfigActionRefusal[]", to: "  'reveal_not_found',\n  'undo_forbidden',\n] as const satisfies readonly ConfigActionRefusal[]" },
    ],
    reds: [schemaD('C429-CONFIG-ACTION-REFUSALS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-CONFIG-ACTION-REFUSALS-EXACT')],
    greens: [schemaD('C429-CONFIG-WRITE-REFUSALS-EXACT'), schemaD('C429-LLM-SETUP-REFUSALS-EXACT'), schemaT('REVEAL-UNDO-MOVE-STRICT')],
  },
  {
    subject: PRIMITIVES_SRC, instrument: 'core', claim: 'DOTTED-NAMES-ACCEPTED',
    operation: "narrow NameSlugSchema's regex back to letters, digits and hyphens",
    edits: [{ from: '  .regex(/^[a-z0-9][a-z0-9.-]*$/, ', to: '  .regex(/^[a-z0-9][a-z0-9-]*$/, ' }],
    reds: [coreSchema('DOTTED-NAMES-ACCEPTED')],
    allowed: [],
    greens: [leaves('CONFIG-SCHEMA-LEAVES-PINNED'), coreSchema('parses a full 4-bucket config successfully'),
      coreSchema('rejects root use.headless and accepts browser-scoped headless')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'DRAFT-CREDENTIAL-ACCEPTED',
    operation: 'restore the not-found refusal for a name absent from registry.llms in the credential guard',
    edits: [{
      from: "    return { ok: false, status: 400, error: 'Config manager is required to save credentials' }\n  }\n  return requireCredentialTarget(configManager, name.name, provider)\n",
      to: "    return { ok: false, status: 400, error: 'Config manager is required to save credentials' }\n  }\n  if (await findRegistryLlm(configManager, name.name) === undefined) {\n    return { ok: false, status: 404, error: `LLM config \"${name.name}\" not found` }\n  }\n  return requireCredentialTarget(configManager, name.name, provider)\n",
    }],
    reds: [draft('DRAFT-CREDENTIAL-ACCEPTED')],
    // Each saves a key under a name the fixture's registry.llms does not hold (gpt-5.6, shared,
    // draft-a, model-a, model-b), which the restored refusal now answers 404.
    allowed: [draft('CREDENTIAL-CREATED-FLAG'), draft('NAME-INVALID-REFUSED: a dotted name is accepted'),
      draft("CREDENTIAL-PROVIDER-CONFLICT-REFUSED: another provider's credential under the name is never overwritten"),
      draft('AUTH-DOORS-SAME-SITE: an admitted caller is answered with no wildcard grant'), draft('CREDENTIAL-WRITES-SERIALIZED', 2)],
    greens: [draft('DRAFT-SIGN-IN-ACCEPTED'), draft('CREDENTIAL-PROVIDER-CONFLICT-REFUSED: a name on disk keeps the provider-match refusal'),
      draft('CREDENTIAL-MOVE: a draft sign-in follows the name to a free name')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'DRAFT-SIGN-IN-ACCEPTED',
    operation: 'restore the not-found refusal for a name absent from registry.llms in the sign-in guard',
    edits: [{
      from: "    return { ok: false, status: 400, error: 'Config manager is required to save OAuth credentials' }\n  }\n  return requireCredentialTarget(configManager, name.name, plugin.providerId)\n",
      to: "    return { ok: false, status: 400, error: 'Config manager is required to save OAuth credentials' }\n  }\n  if (await findRegistryLlm(configManager, name.name) === undefined) {\n    return { ok: false, status: 404, error: `LLM config \"${name.name}\" not found` }\n  }\n  return requireCredentialTarget(configManager, name.name, plugin.providerId)\n",
    }],
    reds: [draft('DRAFT-SIGN-IN-ACCEPTED')],
    // Each starts a sign-in for a name the fixture's registry.llms does not hold: the created flag's
    // and both conflict cells' sign-in halves, and every door cell, which opens its session through a
    // same-site sign-in for claude-pending before it knocks.
    allowed: [draft('CREDENTIAL-CREATED-FLAG'),
      draft("CREDENTIAL-PROVIDER-CONFLICT-REFUSED: another provider's credential under the name is never overwritten"),
      draft('CREDENTIAL-PROVIDER-CONFLICT-REFUSED: an oauth entry compares by its product provider'),
      ...AUTH_DOORS.map(door => draft(`AUTH-DOORS-SAME-SITE: ${door} refuses`, 3)),
      draft('AUTH-DOORS-SAME-SITE: an admitted caller is answered with no wildcard grant')],
    greens: [draft('DRAFT-CREDENTIAL-ACCEPTED'), draft('AUTH-DOORS-SAME-SITE: refusals on the doors carry no wildcard grant either'),
      draft('CREDENTIAL-WRITES-SERIALIZED', 2)],
  },
  {
    subject: AUTH_SRC, instrument: 'cli', claim: 'AUTH-TEST-EXIT-MISSING-CREDENTIAL',
    operation: "drop the exit code from auth test's missing-credential arm",
    edits: [{
      from: '          console.log(pc.red(auth.message))\n          process.exitCode = 1\n          return\n',
      to: '          console.log(pc.red(auth.message))\n          return\n',
    }],
    reds: [auth('AUTH-TEST-EXIT-MISSING-CREDENTIAL')],
    allowed: [],
    greens: [auth('AUTH-TEST-EXIT-CONFIG-UNRESOLVED'), auth('AUTH-TEST-EXIT-CONSTRUCTION-THROW'), auth('AUTH-TEST-EXIT-AUTH-ERROR')],
  },
  {
    subject: AUTH_SRC, instrument: 'cli', claim: 'AUTH-TEST-EXIT-AUTH-ERROR',
    operation: "drop the exit code from auth test's provider-failure arm",
    edits: [{
      from: '          console.log(pc.dim(message))\n          process.exitCode = 1\n',
      to: '          console.log(pc.dim(message))\n',
    }],
    reds: [auth('AUTH-TEST-EXIT-AUTH-ERROR')],
    // The sibling arms: one catch serves every provider-failure class, and the unauthenticated
    // cell's second half fails through the same catch.
    allowed: [auth('AUTH-TEST-EXIT-MODEL-NOT-FOUND'), auth('AUTH-TEST-EXIT-RATE-LIMIT'), auth('AUTH-TEST-EXIT-NETWORK-ERROR'),
      auth('AUTH-TEST-EXIT-INVALID-REQUEST'), auth('AUTH-TEST-EXIT-PROVIDER-ERROR'), auth('AUTH-TEST-UNAUTHENTICATED-DECIDED-BY-TEST')],
    greens: [auth('AUTH-TEST-EXIT-MISSING-CREDENTIAL'), auth('AUTH-TEST-EXIT-ZERO-ONLY-CONNECTED'), auth('AUTH-TEST-EXIT-CONSTRUCTION-THROW')],
  },
  {
    subject: ERROR_SRC, instrument: 'schema', claim: 'CLASSIFIER-ORDER-PINNED',
    operation: 'test for a network failure before a rate limit in classifyProviderError',
    edits: [{
      from: "  if (/rate|429|quota|limit/i.test(fullContext)) return 'rate_limit'\n  if (/ECONNREFUSED|ENOTFOUND|timeout|abort|fetch failed|network/i.test(fullContext)) {\n    return 'network_error'\n  }\n",
      to: "  if (/ECONNREFUSED|ENOTFOUND|timeout|abort|fetch failed|network/i.test(fullContext)) {\n    return 'network_error'\n  }\n  if (/rate|429|quota|limit/i.test(fullContext)) return 'rate_limit'\n",
    }],
    reds: [schemaT('CLASSIFIER-ORDER-PINNED')],
    allowed: [],
    greens: [schemaT('C429-PROVIDER-ERROR-CLASSES-EXACT'), schemaT('CLASSIFIER-EMPTY-MESSAGE'), schemaT('SENTENCES-BYTE-IDENTICAL')],
  },
  {
    subject: ROUTES_SRC, instrument: 'cli', claim: 'CLASSIFIER-ONE-MODULE',
    operation: "spell a local auth-error regex in front of the shared classifier in the test route",
    edits: [{
      from: '            const errorClass = classifyProviderError(providerMessage, statusCode)\n',
      to: "            const errorClass = /auth|unauthorized|401|invalid.*key|permission/i.test(`${providerMessage} ${statusCode ?? ''}`)\n              ? 'auth_error'\n              : classifyProviderError(providerMessage, statusCode)\n",
    }],
    reds: [lint('CLASSIFIER-ONE-MODULE')],
    allowed: [],
    greens: [auth('AUTH-TEST-EXIT-AUTH-ERROR'), auth('AUTH-TEST-EXIT-NETWORK-ERROR'), parity('ORACLE-OPAQUE-IMPLIES-SECRET')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'SC3-FIELD-MERGE',
    operation: "set a block field's whole parent block from the change instead of the one field",
    edits: [{
      from: '          doc.setIn(path, doc.createNode(change.value))\n          writesBrowserHeadless ||= ',
      to: "          if (path.length > 2 && path.every((key) => typeof key === 'string')) {\n            doc.setIn(path.slice(0, -1), doc.createNode({ [String(path[path.length - 1])]: change.value }))\n          } else doc.setIn(path, doc.createNode(change.value))\n          writesBrowserHeadless ||= ",
    }],
    reds: [write('SC3-FIELD-MERGE')],
    // Each writes a field inside a block and needs its siblings kept: every PATCH cell drives the
    // step-timeout autosave, which now drops test and navigation and fails validation; the headless
    // cell keeps browser.name; the empty-document cell builds use.timeout one field at a time. 429-49:
    // the base-revision cell drives the same autosave, and set-if-absent's outside-value cell sets
    // maxSubActions, which now drops the outside previousStepCount its completion must keep.
    // 432-44, measured: the 432-07 path-queue cells write a field inside a block too, and need its siblings kept.
    allowed: [manager('two managers, one through a directory alias, merge every overlapping disjoint write'), manager('the PATCH autosave route and a co-hosted writer overlap on one path and every change lands'), write('PATCH-ONE-ATOMIC-WRITE'), write('PATCH-CROSS-SITE-REFUSED'), write('PATCH-RETURNS-REVISION'),
      write('TWO-SETTLES-BOTH-LAND'), write('APPLY-TWICE-IDEMPOTENT'), write('MODE-PRESERVED'), write('SYMLINK-KEPT'),
      write('LEGACY-WRITE-ROUTES-GONE'), manager('LEGACY-HEADLESS-MIGRATED'), manager('ENOENT-STARTS-EMPTY-DOCUMENT'),
      write('BASE-REVISION-ANSWERED'), write('SET-IF-ABSENT-KEEPS-OUTSIDE-VALUE')],
    greens: [write('INVALID-MERGE-KEEPS-BYTES'), manager('NAME-SELECTOR-RESOLVES'),
      manager('applyChanges writes a nested scalar and never a dotted top-level key'), connect('CONNECT-PASS-SAVES')],
  },
  {
    subject: MASKING_SRC, instrument: 'server', claim: 'GET-CARRIES-NO-SECRET',
    operation: 'class registry.llms[].providerHeaders.* plain in the masking map',
    crossing: schema('"registry.llms[].providerHeaders.*": "plain"'),
    edits: [{
      from: "  'registry.llms[].providerHeaders.*': 'secret',\n",
      to: '  "registry.llms[].providerHeaders.*": "plain",\n',
    }],
    reds: [masking('GET-CARRIES-NO-SECRET')],
    // The file view no longer tags the header line secret; the issues cell's fixture header carries
    // its DO-NOT-LEAK sentinel, now served in clear; the reveal cell reveals a header path, now plain.
    // 429-49: the comment cell's header value is served in clear; an expect on a header is no longer
    // a secret and is compared; a header moved onto model now shares its class and lands.
    allowed: [masking('FILE-VIEW-LINES-CLASSED'), masking('GET-FILE-ISSUES'), reveal('REVEAL-RETURNS-ONE-VALUE'),
      masking('COMMENTED-SECRET-NEVER-SERVED'), write('EXPECT-ON-SECRET-REFUSED'), write('MOVE-ACROSS-CLASSES-REFUSED')],
    greens: [masking('ENV-VAR-NAME-IN-CLEAR'), masking('GET-HAS-REVISION-AND-FILE'), reveal('REVEAL-SECRET-PATHS-ONLY')],
  },
  {
    subject: CONFIG_ROUTES_SRC, instrument: 'server', claim: 'REVEAL-SAME-SITE-ONLY',
    operation: 'let the reveal route skip refuseCrossSiteRequest',
    edits: [{
      from: "  if (refuseCrossSiteRequest(req) !== undefined) {\n    respondJson(res, 403, { error: 'cross_site_refused' })\n    return\n  }\n  const contentType = ",
      to: '  const contentType = ',
    }],
    reds: [reveal('REVEAL-SAME-SITE-ONLY')],
    // The not-logged cell also requires a foreign Origin to answer 403.
    allowed: [reveal('REVEAL-NOT-LOGGED')],
    greens: [reveal('REVEAL-POST-ONLY'), reveal('REVEAL-SECRET-PATHS-ONLY'), reveal('REVEAL-RETURNS-ONE-VALUE')],
  },
  {
    subject: CONFIG_ROUTES_SRC, instrument: 'server', claim: 'REVEAL-SECRET-PATHS-ONLY',
    operation: "drop the reveal route's secret-class check",
    edits: [{
      from: "    const classified = path.map((segment) => (typeof segment === 'object' ? 0 : segment))\n    if (classifyConfigPath(classified) !== 'secret') {\n      respondJson(res, 422, { error: 'reveal_not_secret' })\n      return\n    }\n",
      to: '',
    }],
    reds: [reveal('REVEAL-SECRET-PATHS-ONLY')],
    // The not-logged cell also requires a plain path to answer 422.
    allowed: [reveal('REVEAL-NOT-LOGGED')],
    greens: [reveal('REVEAL-SAME-SITE-ONLY'), reveal('REVEAL-RETURNS-ONE-VALUE'), reveal('REVEAL-NEVER-AUTH-JSON')],
  },
  {
    subject: MASKING_SRC, instrument: 'server', claim: 'ENV-VAR-NAME-IN-CLEAR',
    // 2026-10-02 (432-44): the env-var-name leaf was the MCP token variable, deleted with its list
    // (432-22); the cell's surviving claim is a plain MCP leaf in clear, so that leaf is hidden.
    operation: 'class the plain services.mcp.port leaf secret in the masking map',
    crossing: schema('"services.mcp.port": "secret"'),
    edits: [{
      from: "  'services.mcp.port': 'plain',\n",
      to: '  "services.mcp.port": "secret",\n',
    }],
    reds: [masking('ENV-VAR-NAME-IN-CLEAR')],
    // The reveal door's env-var-name probe now names a secret-class path, so it is admitted.
    allowed: [reveal('REVEAL-SECRET-PATHS-ONLY')],
    greens: [masking('GET-CARRIES-NO-SECRET'), masking('FILE-VIEW-LINES-CLASSED'), reveal('REVEAL-RETURNS-ONE-VALUE')],
  },
  {
    subject: CONNECT_ROUTE_SRC, instrument: 'server', claim: 'CONNECT-NOTHING-WRITTEN-ON-FAIL',
    operation: "write the typed credential to auth.json before connect's test runs",
    edits: [{
      from: '  let usedCredential = credential !== undefined\n  if (!request.skipTest) {\n',
      to: '  if (credential) await writeAuth(name, toStoredCredential(provider, credential))\n  let usedCredential = credential !== undefined\n  if (!request.skipTest) {\n',
    }],
    reds: [connect('CONNECT-NOTHING-WRITTEN-ON-FAIL')],
    // The rollback cells find the early write already made before their refused config write; a
    // passing connect now writes auth.json twice, which the repeat and round-trip cells count.
    allowed: [connect('CONNECT-WRITE-FAILURE-ROLLS-BACK-CREDENTIAL', 2), connect('CONNECT-TWICE-NO-DUPLICATE'),
      connect('CONNECT-ROUND-TRIP-NAME', 2)],
    greens: [connect('CONNECT-PASS-SAVES'), connect('CONNECT-SKIP-TEST-SAVES'), connect('CONNECT-EXISTING-CREDENTIAL')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'MASK-NEVER-WRITTEN-BACK',
    operation: 'remove the mask guard call from applyChanges',
    edits: [{
      from: "    if (changes.some((change) => change.op !== 'unset' && change.op !== 'move' && carriesMaskPlaceholder(change.value))) {\n      return { kind: 'refused', error: MASK_WRITTEN_BACK }\n    }\n",
      to: '',
    }],
    reds: [manager('MASK-NEVER-WRITTEN-BACK')],
    allowed: [],
    greens: [manager('FILE-INVALID-REFUSED'), manager('UNSET-PRUNES-EMPTY-PARENTS'), write('SC3-FIELD-MERGE')],
  },
  {
    subject: UNDO_SRC, instrument: 'server', claim: 'UNDO-TOKEN-SINGLE-USE',
    operation: "keep the entry the undo store's take hands out",
    edits: [{
      from: '      if (entry === undefined) return undefined\n      entries.delete(token)\n      return entry.payload\n',
      to: '      if (entry === undefined) return undefined\n      return entry.payload\n',
    }],
    reds: [undo('UNDO-TOKEN-SINGLE-USE', 2)],
    allowed: [],
    greens: [undo('UNDO-EXPIRES'), undo('UNDO-DELETE-MODEL-RESTORES'), undo('UNDO-CONFLICT', 3)],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'INVALID-MERGE-KEEPS-BYTES',
    operation: "skip applyChanges' whole-config safeParse",
    edits: [{
      from: '    const parsed = AgentQaConfigSchema.safeParse(normalizeForValidation(doc.toJSON()))\n    if (!parsed.success) {\n      return {\n',
      to: '    const parsed = { success: true } as ReturnType<typeof AgentQaConfigSchema.safeParse>\n    if (!parsed.success) {\n      return {\n',
    }],
    reds: [write('INVALID-MERGE-KEEPS-BYTES')],
    // Each also requires an invalid merge to answer 422: the recording cells close on an invalid
    // videoDir, the cross-site cell on an invalid step, and connect's rollback cells on an invalid file.
    // 432-44, measured: the 432-22 write-policy cell refuses retired key paths, whose refusal this leg's merge breaks too.
    allowed: [write('C432-CONFIG-WRITE-POLICY: allowProduction is an ordinary write with Undo, and every retired key path is refused before a write'), manager('keeps authored recording omissions through GET, no-op and unrelated saves', 6),
      write('PATCH-CROSS-SITE-REFUSED'), connect('CONNECT-WRITE-FAILURE-ROLLS-BACK-CREDENTIAL', 2)],
    greens: [write('SC3-FIELD-MERGE'), manager('MASK-NEVER-WRITTEN-BACK'), manager('FILE-INVALID-REFUSED')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'CREDENTIAL-PROVIDER-CONFLICT-REFUSED',
    operation: "drop the credential guard's provider-conflict check",
    edits: [{
      from: '  const existing = await readAuthEntry(name)\n  if (existing && credentialProductProvider(name, existing) !== provider) {\n    return { ok: false, ...CREDENTIAL_PROVIDER_CONFLICT }\n  }\n',
      to: '  const existing = await readAuthEntry(name)\n',
    }],
    reds: [draft("CREDENTIAL-PROVIDER-CONFLICT-REFUSED: another provider's credential under the name is never overwritten"),
      draft('CREDENTIAL-PROVIDER-CONFLICT-REFUSED: an oauth entry compares by its product provider')],
    allowed: [],
    // The registry match is a separate refusal, and it holds.
    greens: [draft('CREDENTIAL-PROVIDER-CONFLICT-REFUSED: a name on disk keeps the provider-match refusal'),
      draft('CREDENTIAL-CREATED-FLAG'), draft('DRAFT-CREDENTIAL-ACCEPTED')],
  },
  {
    subject: MASKING_SRC, instrument: 'core', claim: 'CONFIG-SCHEMA-LEAVES-PINNED',
    operation: 'delete the use.workers leaf line from CONFIG_MASKING_MAP',
    crossing: schema('"use.timeout.test": "plain",\n  "workspace.envFile": "plain"'),
    edits: [{
      from: "  'use.timeout.test': 'plain',\n  'use.workers': 'plain',\n  'workspace.envFile': 'plain',\n",
      to: '  "use.timeout.test": "plain",\n  "workspace.envFile": "plain",\n',
    }],
    reds: [leaves('CONFIG-SCHEMA-LEAVES-PINNED')],
    // 432-44, measured: the 432-22 leaf-count cell classifies the same leaf the leg deletes from the map.
    allowed: [leaves('C432-CONFIG-LEAVES-92: exactly 92 strict leaves, each classified, none of them retired')],
    greens: [coreSchema('DOTTED-NAMES-ACCEPTED'), coreSchema('parses a full 4-bucket config successfully'),
      coreSchema('rejects root use.headless and accepts browser-scoped headless')],
  },
  {
    subject: MASKING_SRC, instrument: 'cli', claim: 'CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR',
    // 2026-10-02 (432-44): re-aimed with C19 at the plain MCP leaf (432-22 deleted the token leaf).
    operation: 'class the plain services.mcp.port leaf secret in the masking map, read by config show',
    crossing: schema('"services.mcp.port": "secret"'),
    edits: [{
      from: "  'services.mcp.port': 'plain',\n",
      to: '  "services.mcp.port": "secret",\n',
    }],
    reds: [show('CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR')],
    // 432-44, measured: the one-map census pins the same leaf plain by name.
    allowed: [show('guesses nothing from a name: plain stays plain, undeclared stays secret')],
    greens: [parity('ORACLE-OPAQUE-IMPLIES-SECRET'), show('leaves ordinary configuration keys visible'), lint('CLASSIFIER-ONE-MODULE')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'LEGACY-WRITE-ROUTES-GONE',
    operation: 'give the router its retired PUT /api/config/default-llm write back',
    edits: [{
      from: '    // 429-01 D-19: the field-merge config write, ahead of the shared OPTIONS arm so its answers\n',
      to: "    if (path === '/api/config/default-llm' && req.method === 'PUT' && configManager) {\n      readJsonBody<{ llm?: string }>(req)\n        .then(async (body) => {\n          await configManager.applyChanges([{ op: 'set', path: ['use', 'llm'], value: body.llm }])\n          jsonNoCors(res, { saved: true })\n        })\n        .catch(() => jsonNoCors(res, { error: 'invalid_request' }, 400))\n      return\n    }\n\n    // 429-01 D-19: the field-merge config write, ahead of the shared OPTIONS arm so its answers\n",
    }],
    reds: [write('LEGACY-WRITE-ROUTES-GONE')],
    allowed: [],
    greens: [write('ONE-WRITE-PATH'), write('VALUES-READ-REFUSES-BROKEN-FILE'), write('SC3-FIELD-MERGE')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'BASE-REVISION-ANSWERED',
    operation: 'answer the post-merge revision as the base revision of a write',
    edits: [{
      from: '    const next = doc.toString()\n    await this.writeAtomic(next)\n    return capturePriors\n',
      to: '    const next = doc.toString()\n    await this.writeAtomic(next)\n    baseRevision = revisionOf(next)\n    return capturePriors\n',
    }],
    reds: [write('BASE-REVISION-ANSWERED')],
    // It pins the base to the bytes before the write too, which the planted base now misstates.
    // 432-44, measured: the 432-07 queued-write cell reads the same base revision inside its turn.
    allowed: [manager('a queued write reads the file inside its turn, so an outside edit made while it waited survives'), write('PATCH-RETURNS-REVISION')],
    greens: [write('APPLY-TWICE-IDEMPOTENT'), write('SC3-FIELD-MERGE'), manager('MASK-NEVER-WRITTEN-BACK')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'SET-IF-ABSENT-KEEPS-OUTSIDE-VALUE',
    operation: 'let set-if-absent write over a field the file already holds',
    edits: [{ from: '          if (doc.hasIn(path)) continue\n', to: '' }],
    reds: [write('SET-IF-ABSENT-KEEPS-OUTSIDE-VALUE')],
    allowed: [],
    greens: [write('SET-IF-ABSENT-FILLS-ABSENT'), write('LEGACY-HEADLESS-KEPT-ON-COMPLETION'), write('EXPECT-MATCH-WRITES')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'LEGACY-HEADLESS-KEPT-ON-COMPLETION',
    operation: 'let set-if-absent ignore a root use.headless when it completes use.browser.headless',
    edits: [{
      from: '          if (samePath(path, BROWSER_HEADLESS_PATH) && doc.hasIn(LEGACY_HEADLESS_PATH)) {\n',
      to: '          if (false && samePath(path, BROWSER_HEADLESS_PATH) && doc.hasIn(LEGACY_HEADLESS_PATH)) {\n',
    }],
    reds: [write('LEGACY-HEADLESS-KEPT-ON-COMPLETION')],
    // It drives the same completion before its Undo and checks the moved value first.
    allowed: [undo('UNDO-LEGACY-HEADLESS-RESTORED')],
    greens: [write('SET-IF-ABSENT-KEEPS-OUTSIDE-VALUE'), write('SET-IF-ABSENT-FILLS-ABSENT'), manager('LEGACY-HEADLESS-MIGRATED')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'EXPECT-MISMATCH-REFUSED',
    operation: 'let every expect skip its comparison with the file',
    edits: [{
      from: "    for (const change of expects) {\n      if (!isDeepStrictEqual(expectedFieldValue(doc, change.path), change.value ?? null)) {\n        return { kind: 'refused', error: 'field_changed', path: [...change.path] }\n      }\n    }\n",
      to: '',
    }],
    reds: [write('EXPECT-MISMATCH-REFUSED')],
    // 432-44, measured: the 432-07 and 432-22 stale-expectation cells drive the same expect check.
    allowed: [manager('a stale same-field expectation from the second writer refuses once the first has changed it'), write('C432-CONFIG-WRITE-POLICY: a stale expect on allowProduction is refused field_changed, and a fresh one lands')],
    greens: [write('EXPECT-MATCH-WRITES'), write('EXPECT-ON-SECRET-REFUSED'), write('SC3-FIELD-MERGE')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'EXPECT-ON-SECRET-REFUSED',
    operation: 'let an expect name a secret path and be compared',
    edits: [{
      from: "    if (expects.some((change) => classifySegments(change.path) === 'secret')) {\n      return { kind: 'refused', error: 'path_not_writable' }\n    }\n",
      to: '',
    }],
    reds: [write('EXPECT-ON-SECRET-REFUSED')],
    allowed: [],
    greens: [write('EXPECT-MISMATCH-REFUSED'), write('EXPECT-MATCH-WRITES'), manager('MASK-NEVER-WRITTEN-BACK')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'MOVE-ACROSS-CLASSES-REFUSED',
    operation: "drop the move's masking-class check, at both ends and leaf by leaf",
    edits: [
      { from: "  if (classifySegments(from) !== classifySegments(to)) return { kind: 'refused', error: 'path_not_writable' }\n", to: '' },
      {
        from: "  if (leaves.some((leaf) => classifySegments([...from, ...leaf]) !== classifySegments([...to, ...leaf]))) {\n    return { kind: 'refused', error: 'path_not_writable' }\n  }\n",
        to: '',
      },
    ],
    reds: [write('MOVE-ACROSS-CLASSES-REFUSED')],
    // The same class check, leaf by leaf: a secret block now lands on fields served in clear.
    allowed: [write('MOVE-SUBTREE-ACROSS-CLASSES-REFUSED')],
    greens: [write('MOVE-KEEPS-VALUE-SERVER-SIDE'), write('MOVE-INTO-ITSELF-REFUSED'), write('MOVE-FROM-MISSING-REFUSED')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'COMMENTED-SECRET-NEVER-SERVED',
    operation: 'let readMasked keep the comments in the served file view',
    edits: [{ from: '    stripComments(masked)\n', to: '' }],
    reds: [masking('COMMENTED-SECRET-NEVER-SERVED')],
    // Each pins a comment-free view of its own fixture: the accessKey line keeps its trailing
    // comment, the owner-notes head comment is served, and the head comment line is counted again.
    allowed: [masking('GET-CARRIES-NO-SECRET'), masking('GET-HAS-REVISION-AND-FILE'), masking('FILE-VIEW-LINES-CLASSED')],
    greens: [masking('ENV-VAR-NAME-IN-CLEAR'), masking('GET-CONFIG-SAME-SITE-NO-GRANT'), reveal('REVEAL-RETURNS-ONE-VALUE')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'GET-CONFIG-SAME-SITE-NO-GRANT',
    operation: 'answer GET /api/config through json() with no same-site check',
    edits: [
      {
        from: "      if (refuseCrossSiteDisplayRead(req, res)) return\n      if (!configManager) {\n        jsonNoCors(res, { error: 'Config management not available' }, 501)\n",
        to: "      if (!configManager) {\n        json(res, { error: 'Config management not available' }, 501)\n",
      },
      {
        from: "            jsonNoCors(res, { error: 'file_invalid', message: read.message }, 409)\n",
        to: "            json(res, { error: 'file_invalid', message: read.message }, 409)\n",
      },
      {
        from: '          const provider = (defaultCfg?.provider as string) ?? null\n          jsonNoCors(res, {\n',
        to: '          const provider = (defaultCfg?.provider as string) ?? null\n          json(res, {\n',
      },
      {
        from: "          jsonNoCors(res, { error: err instanceof Error ? err.message : 'Failed to read config' }, 500)\n",
        to: "          json(res, { error: err instanceof Error ? err.message : 'Failed to read config' }, 500)\n",
      },
    ],
    reds: [masking('GET-CONFIG-SAME-SITE-NO-GRANT')],
    allowed: [],
    greens: [masking('GET-CARRIES-NO-SECRET'), masking('COMMENTED-SECRET-NEVER-SERVED'), reveal('REVEAL-SAME-SITE-ONLY')],
  },
  {
    subject: CONFIG_ROUTES_SRC, instrument: 'server', claim: 'WRITE-DOOR-REFUSES-DENIED-ROOTS',
    operation: "drop the write door's page-writable check",
    edits: [{
      from: "    const refused = parsed.data.changes.some((change) =>\n      !isPageWritableConfigPath(change.path)\n      || (change.op === 'move' && !isPageWritableConfigPath(change.from)))\n    if (refused) {\n      respondJson(res, 422, { error: 'path_not_writable' })\n      return\n    }\n",
      to: '',
    }],
    reds: [write('WRITE-DOOR-REFUSES-DENIED-ROOTS')],
    // Each sends a path the schema does not describe (an unknown leaf, the retired
    // services.recording.videoDir), which now reaches validation and answers validation_failed.
    // 432-44, measured: the 432-22 write-policy cell refuses retired key paths through the same denied-root door.
    allowed: [write('C432-CONFIG-WRITE-POLICY: allowProduction is an ordinary write with Undo, and every retired key path is refused before a write'), write('WRITE-DOOR-REFUSES-UNKNOWN-PATH'),
      manager('keeps authored recording omissions through GET, no-op and unrelated saves', 6)],
    greens: [write('WRITE-DOOR-ADMITS-PAGE-WRITES'), write('SC3-FIELD-MERGE'), write('PATCH-CROSS-SITE-REFUSED')],
  },
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-WRITE-DENIED-ROOTS-EXACT',
    // 2026-10-02 (432-44): `safety` left the denied roots with the trust mode it held (432-22), so the
    // one denied root left gains a second.
    operation: 'add a second root to ConfigWriteDeniedRoot and CONFIG_WRITE_DENIED_ROOTS',
    edits: [
      { from: "export type ConfigWriteDeniedRoot = 'plugins'\n", to: "export type ConfigWriteDeniedRoot = 'plugins' | 'analytics'\n" },
      { from: "  'plugins',\n] as const satisfies readonly ConfigWriteDeniedRoot[]", to: "  'plugins',\n  'analytics',\n] as const satisfies readonly ConfigWriteDeniedRoot[]" },
    ],
    reds: [schemaD('C429-CONFIG-WRITE-DENIED-ROOTS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too; the 432 write
    // policy cell counts the page-writable leaves, which a denied `analytics` root removes.
    allowed: [schemaT('C429-CONFIG-WRITE-DENIED-ROOTS-EXACT'), schemaT('C432-CONFIG-WRITE-POLICY')],
    greens: [schemaT('PAGE-WRITABLE-EVERY-RENDERED-LEAF'), schemaD('C429-CONFIG-WRITE-OPS-EXACT'), schemaT('C429-CONFIG-CHANGE-STRICT')],
  },
  {
    subject: ROUTES_SRC, instrument: 'server', claim: 'SAVED-HEADER-NEVER-ECHOED',
    operation: "stop redacting the saved header values out of the test route's provider message",
    edits: [{
      from: '            const providerMessage = withoutSavedValues(rawProviderMessage, savedHeaderValues)\n',
      to: '            const providerMessage = rawProviderMessage\n',
    }],
    reds: [savedHeaders('SAVED-HEADER-NEVER-ECHOED')],
    allowed: [],
    greens: [savedHeaders('SAVED-HEADERS-SENT-BY-NAME'), savedHeaders('SAVED-HEADERS-ONLY-TO-SAVED-ENDPOINT'),
      savedHeaders('MASK-HEADER-NEVER-SENT')],
  },
  {
    subject: AUTH_STORE_SRC, instrument: 'core', claim: 'AUTH-SYMLINK-KEPT',
    operation: 'rename the auth store onto the symlink path instead of the file it names',
    edits: [{ from: '  const target = await authWriteTarget(authPath)\n', to: '  const target = authPath\n' }],
    reds: [authStore('AUTH-SYMLINK-KEPT')],
    // Both write through the same rename, which now replaces the link with a plain file.
    allowed: [authStore('AUTH-SYMLINK-REMOVE-KEEPS-LINK'), authStore('AUTH-SYMLINK-DANGLING-CREATES-TARGET')],
    greens: [authStore('WRITE-AUTH-ATOMIC', 2), authStore('deletes file when last credential is removed'),
      authStore('writes file with 0o600 permissions')],
  },
  {
    subject: MANAGER_SRC, instrument: 'server', claim: 'UNDO-LEGACY-HEADLESS-RESTORED',
    operation: "drop the Undo prior for the root use.headless a set-if-absent completion moves",
    edits: [{ from: '      if (legacyPrior !== undefined) priors.push(legacyPrior)\n', to: '' }],
    reds: [undo('UNDO-LEGACY-HEADLESS-RESTORED')],
    allowed: [],
    greens: [write('LEGACY-HEADLESS-KEPT-ON-COMPLETION'), undo('UNDO-DATA-PATH', 2), write('MOVE-UNDO-RESTORES-BOTH')],
  },
]

runGate({
  slug: '429-config-contract-mutation', envPrefix: 'AGENT_QA_429_CONFIG_CONTRACT_MUTATION', idPrefix: 'C',
  instruments, legs, expectedLegs: 40, banner: 'CONFIG_CONTRACT_MUTATION_OK',
})
NODE
