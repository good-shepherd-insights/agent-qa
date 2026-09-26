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
#   C01  a fourth op joins ConfigWriteOp and CONFIG_WRITE_OPS                     -> C429-CONFIG-WRITE-OPS-EXACT
#   C02  a seventh refusal joins ConfigWriteRefusal and its array                 -> C429-CONFIG-WRITE-REFUSALS-EXACT
#   C03  a fourth named array joins ConfigNamedArray and CONFIG_NAMED_ARRAYS       -> C429-CONFIG-NAMED-ARRAYS-EXACT
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
#   C19  the map classes services.mcp.tokens[].tokenEnvVar secret                 -> ENV-VAR-NAME-IN-CLEAR (D-08)
#   C20  connect writes the typed credential before its test                      -> CONNECT-NOTHING-WRITTEN-ON-FAIL (D-17)
#   C21  applyChanges no longer calls the mask guard                              -> MASK-NEVER-WRITTEN-BACK
#   C22  the undo store's take keeps the entry it hands out                       -> UNDO-TOKEN-SINGLE-USE (D-24)
#   C23  applyChanges skips the whole-config safeParse                            -> INVALID-MERGE-KEEPS-BYTES
#   C24  the credential guard drops its provider-conflict check                   -> CREDENTIAL-PROVIDER-CONFLICT-REFUSED
#   C25  one leaf line leaves CONFIG_MASKING_MAP                                  -> CONFIG-SCHEMA-LEAVES-PINNED (D-06)
#   C26  the map classes services.mcp.tokens[].tokenEnvVar secret, in config show -> CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR (D-08)
#   C27  a retired per-section write route answers again                          -> LEGACY-WRITE-ROUTES-GONE (429-32)
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
# AGENT_QA_429_CONFIG_CONTRACT_MUTATION_LEG=C01..C27 runs one leg (normal or neutered runs only).
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
const AUTH_T = 'src/__tests__/auth-test.test.ts'
const LINT_T = 'src/__tests__/429-classifier-lint.test.ts'
const SHOW_T = 'src/composition/__tests__/masked-config.test.ts'
const PARITY_T = 'src/composition/__tests__/429-masking-parity.test.ts'

const instruments = {
  schema: { pkg: 'packages/schema', files: [SCHEMA_T, SCHEMA_D], typecheck: true, count: 24 },
  core: { pkg: 'packages/core', files: [CORE_SCHEMA_T, LEAVES_T], typecheck: false, count: 101 },
  server: {
    pkg: 'packages/dashboard-server',
    files: [WRITE_T, MASKING_T, REVEAL_T, UNDO_T, CONNECT_T, DRAFT_T, MANAGER_T],
    typecheck: false,
    count: 146,
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
const write = (name, count) => cell('server', WRITE_T, name, count)
const masking = (name, count) => cell('server', MASKING_T, name, count)
const reveal = (name, count) => cell('server', REVEAL_T, name, count)
const undo = (name, count) => cell('server', UNDO_T, name, count)
const connect = (name, count) => cell('server', CONNECT_T, name, count)
const draft = (name, count) => cell('server', DRAFT_T, name, count)
const manager = (name, count) => cell('server', MANAGER_T, name, count)
const auth = (name, count) => cell('cli', AUTH_T, name, count)
const lint = (name, count) => cell('cli', LINT_T, name, count)
const show = (name, count) => cell('cli', SHOW_T, name, count)
const parity = (name, count) => cell('cli', PARITY_T, name, count)

const legs = [
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-WRITE-OPS-EXACT',
    operation: 'add a fourth op to ConfigWriteOp and CONFIG_WRITE_OPS',
    edits: [
      { from: "export type ConfigWriteOp = 'set' | 'unset' | 'append'\n", to: "export type ConfigWriteOp = 'set' | 'unset' | 'append' | 'prepend'\n" },
      { from: "  'append',\n] as const satisfies readonly ConfigWriteOp[]", to: "  'append',\n  'prepend',\n] as const satisfies readonly ConfigWriteOp[]" },
    ],
    reds: [schemaD('C429-CONFIG-WRITE-OPS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-CONFIG-WRITE-OPS-EXACT')],
    greens: [schemaD('C429-CONFIG-WRITE-REFUSALS-EXACT'), schemaD('C429-CONFIG-NAMED-ARRAYS-EXACT'), schemaT('C429-CONFIG-CHANGE-STRICT')],
  },
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-WRITE-REFUSALS-EXACT',
    operation: 'add a seventh refusal to ConfigWriteRefusal and CONFIG_WRITE_REFUSALS',
    edits: [
      { from: "  | 'write_failed'\n// prettier-ignore\n", to: "  | 'write_failed'\n  | 'write_conflict'\n// prettier-ignore\n" },
      { from: "  'write_failed',\n] as const satisfies readonly ConfigWriteRefusal[]", to: "  'write_failed',\n  'write_conflict',\n] as const satisfies readonly ConfigWriteRefusal[]" },
    ],
    reds: [schemaD('C429-CONFIG-WRITE-REFUSALS-EXACT')],
    // The runtime twin pins the array by value, so the extra member moves it too.
    allowed: [schemaT('C429-CONFIG-WRITE-REFUSALS-EXACT')],
    greens: [schemaD('C429-CONFIG-WRITE-OPS-EXACT'), schemaD('C429-CONFIG-ACTION-REFUSALS-EXACT'), schemaT('C429-CONFIG-CHANGE-STRICT')],
  },
  {
    subject: WRITE_SRC, instrument: 'schema', claim: 'C429-CONFIG-NAMED-ARRAYS-EXACT',
    operation: 'add a fourth named array to ConfigNamedArray and CONFIG_NAMED_ARRAYS',
    edits: [
      {
        from: "export type ConfigNamedArray = 'registry.llms' | 'services.mcp.tokens' | 'services.dashboard.runServiceTokens'\n",
        to: "export type ConfigNamedArray = 'registry.llms' | 'services.mcp.tokens' | 'services.dashboard.runServiceTokens' | 'plugins.auth'\n",
      },
      { from: "  'services.dashboard.runServiceTokens',\n] as const satisfies readonly ConfigNamedArray[]", to: "  'services.dashboard.runServiceTokens',\n  'plugins.auth',\n] as const satisfies readonly ConfigNamedArray[]" },
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
      from: '          doc.setIn(path, doc.createNode(change.value))\n',
      to: "          if (path.length > 2 && path.every((key) => typeof key === 'string')) {\n            doc.setIn(path.slice(0, -1), doc.createNode({ [String(path[path.length - 1])]: change.value }))\n          } else doc.setIn(path, doc.createNode(change.value))\n",
    }],
    reds: [write('SC3-FIELD-MERGE')],
    // Each writes a field inside a block and needs its siblings kept: every PATCH cell drives the
    // step-timeout autosave, which now drops test and navigation and fails validation; the headless
    // cell keeps browser.name; the empty-document cell builds use.timeout one field at a time.
    allowed: [write('PATCH-ONE-ATOMIC-WRITE'), write('PATCH-CROSS-SITE-REFUSED'), write('PATCH-RETURNS-REVISION'),
      write('TWO-SETTLES-BOTH-LAND'), write('APPLY-TWICE-IDEMPOTENT'), write('MODE-PRESERVED'), write('SYMLINK-KEPT'),
      write('LEGACY-WRITE-ROUTES-GONE'), manager('LEGACY-HEADLESS-MIGRATED'), manager('ENOENT-STARTS-EMPTY-DOCUMENT')],
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
    allowed: [masking('FILE-VIEW-LINES-CLASSED'), masking('GET-FILE-ISSUES'), reveal('REVEAL-RETURNS-ONE-VALUE')],
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
    operation: 'class services.mcp.tokens[].tokenEnvVar secret in the masking map',
    crossing: schema('"services.mcp.tokens[].tokenEnvVar": "secret"'),
    edits: [{
      from: "  'services.mcp.tokens[].tokenEnvVar': 'env-var-name',\n",
      to: '  "services.mcp.tokens[].tokenEnvVar": "secret",\n',
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
      from: "    if (changes.some((change) => change.op !== 'unset' && carriesMaskPlaceholder(change.value))) {\n      return { kind: 'refused', error: MASK_WRITTEN_BACK }\n    }\n",
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
    allowed: [manager('keeps authored recording omissions through GET, no-op and unrelated saves', 6),
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
    allowed: [],
    greens: [coreSchema('DOTTED-NAMES-ACCEPTED'), coreSchema('parses a full 4-bucket config successfully'),
      coreSchema('rejects root use.headless and accepts browser-scoped headless')],
  },
  {
    subject: MASKING_SRC, instrument: 'cli', claim: 'CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR',
    operation: 'class services.mcp.tokens[].tokenEnvVar secret in the masking map, read by config show',
    crossing: schema('"services.mcp.tokens[].tokenEnvVar": "secret"'),
    edits: [{
      from: "  'services.mcp.tokens[].tokenEnvVar': 'env-var-name',\n",
      to: '  "services.mcp.tokens[].tokenEnvVar": "secret",\n',
    }],
    reds: [show('CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR')],
    // Both parity cells and the D-06 token cell pin the same leaf's env-var-name class.
    allowed: [parity('MASKED-BEFORE-429-SNAPSHOT'), parity('MASKING-PARITY-NOTHING-NEWLY-VISIBLE'),
      show('registers the D-06 token entry as inert, and holds no field a token VALUE could occupy')],
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
]

runGate({
  slug: '429-config-contract-mutation', envPrefix: 'AGENT_QA_429_CONFIG_CONTRACT_MUTATION', idPrefix: 'C',
  instruments, legs, expectedLegs: 27, banner: 'CONFIG_CONTRACT_MUTATION_OK',
})
NODE
