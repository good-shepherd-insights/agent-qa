// The T-384-07 / T-384-17 mitigation, asserted directly (Phase 384, Plans 03, 08 and 10).
//
// `config.get`'s security claim is masked-AT-CONSTRUCTION: the secret is dropped while the
// entry is built, never carried in the DTO and redacted later. These cases pin that on the
// builder itself, so the claim holds for every surface that ever renders the result — not
// just for the one CLI leg that happens to print it today.
//
// The disclosure rule is DERIVED from the config schema rather than enumerated, so the
// cases below are drawn from the schema's shape and from credential names this repo's
// masker has never listed. Two round-2 findings are the reason: a corpus generated from an
// implementation's own constant list cannot vary along the axis that still leaks, and a
// masker that judges by name cannot tell a credential from a package name.

// The oracle is built from the real config schema on purpose — test files are excluded
// from the arch specifier scan, so this proves the walk against the shipped tree without
// relaxing the firewall the production masker obeys.
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import {
  CONFIG_MASK_PLACEHOLDER,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  remoteDeviceSchema,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildConfigVisibilityOracle, CONSTRAINED_LEAF_TYPES } from '../config-visibility.js'
import {
  buildMaskedResolvedConfig,
  CREDENTIAL_BEARING_URL_LEAVES,
  isCredentialBearingUrlField,
  isMaskedConfigPath,
  isSecretConfigKey,
} from '../masked-config.js'

const SECRET = 'sk-live-DO-NOT-LEAK-4242'
/** Planted inside a URL's userinfo, where no key name can mark it as secret. */
const USERINFO_PASSWORD = 'hunter2-DO-NOT-LEAK'

/**
 * Credentials planted in the parts of a URL that belong to no configuration key at all
 * (round-3 CR-01): a query parameter and a fragment on a schema-VISIBLE field.
 *
 * The parameter names are the OUT_OF_VOCABULARY discipline applied to the axis that leaked.
 * `ticket`, `assertion` and `sso` each read 0 in `masked-config.ts`'s bytes — measured with
 * a positive control (`SECRET_KEY_TERMS` = 2) in the same read — so no name the masker has
 * ever seen decides these cases. The round-3 verifier falsified a parameter-name regex with
 * its own `?session=` repro; what closes them is the shape of the VALUE.
 */
const URL_QUERY_SECRET = 'sk-live-TICKET-DO-NOT-LEAK-9001'
const URL_QUERY_SECRET_2 = 'sk-live-SSO-DO-NOT-LEAK-9002'
const URL_FRAGMENT_SECRET = 'sk-live-FRAGMENT-DO-NOT-LEAK-9003'
const RENDERED_LEAF_SECRET = 'sk-live-RENDERED-DO-NOT-LEAK-9004'

/**
 * Credentials planted in URL forms the render rule's own PRECONDITION rejects (round-4 CR-01).
 *
 * Round 3's corpus was disciplined on one axis and blind on the other: every planted
 * parameter name was measured outside the implementation's vocabulary, and every planted
 * VALUE was an absolute `https://` URL — precisely the shape `new URL(value)` with no base
 * accepts. A rule guarded by a precondition needs corpus cases the precondition REJECTS.
 *
 * These four forms are taken from the round-4 verification report, not from the fix: three
 * of them make a bare `new URL()` throw and the fourth parses with an EMPTY host, which the
 * characterisation block at the end of this file asserts against the platform parser rather
 * than against any branch of ours. The parameter names — `waybill`, `hallmark`, `emblem`,
 * `lanyard` — each read 0 in `masked-config.ts`'s bytes, measured with a positive control
 * (`SECRET_KEY_TERMS` = 2) in the same read.
 */
const PROTOCOL_RELATIVE_USERINFO_SECRET = 'sk-live-USERINFO-DO-NOT-LEAK-9105'
const PROTOCOL_RELATIVE_QUERY_SECRET = 'sk-live-WAYBILL-DO-NOT-LEAK-9106'
const PROTOCOL_RELATIVE_FRAGMENT_SECRET = 'sk-live-HALLMARK-DO-NOT-LEAK-9107'
const HOST_RELATIVE_SECRET = 'sk-live-EMBLEM-DO-NOT-LEAK-9108'
const PATH_RELATIVE_SECRET = 'sk-live-LANYARD-DO-NOT-LEAK-9109'
const OPAQUE_SCHEME_SECRET = 'sk-live-OPAQUE-DO-NOT-LEAK-9110'

/** The four precondition-rejected carriers, each on a schema-VISIBLE field. */
const PROTOCOL_RELATIVE_URL =
  `//opsx:${PROTOCOL_RELATIVE_USERINFO_SECRET}@x.test/checkout`
  + `?waybill=${PROTOCOL_RELATIVE_QUERY_SECRET}`
  + `#hallmark=${PROTOCOL_RELATIVE_FRAGMENT_SECRET}`
const HOST_RELATIVE_URL = `llm.acme.test/v1?emblem=${HOST_RELATIVE_SECRET}`
const PATH_RELATIVE_URL = `/checkout?lanyard=${PATH_RELATIVE_SECRET}`
const OPAQUE_SCHEME_URL = `ops:${OPAQUE_SCHEME_SECRET}@llm.acme.test/v1`

/** A scoped package name: an '@'-carrying value that is NOT a credential carrier. */
const SCOPED_PACKAGE_NAME = '@acme/auth-plugin-SHOW-ME-9111'

/**
 * The OVER-MASK corpus (round-5 CR-02), drawn from FIELD SEMANTICS rather than value shape.
 *
 * Round 5's second failure direction: a rule that inspects every value cannot tell "this is a
 * URL carrying a query" from "this string contains a `?`", so a required glob field, an
 * ignore glob and a CSS selector each rendered `[masked]` to the one capability whose purpose
 * is configuration triage. Each value below is chosen because its FIELD means it: `?` is the
 * standard single-character glob wildcard on `workspace.testMatch` (a required `.min(1)`
 * array), `#id` is the commonest CSS selector form on `services.accessibility.exclude`, and
 * `@scope/name` is what a plugin package is called.
 */
const GLOB_WILDCARD_VALUE = 'tests/**/case-?.yaml'
const IGNORE_GLOB_VALUE = 'tests/legacy#old/**'
const CSS_SELECTOR_VALUE = '#cookie-banner'
const OVER_MASK_PACKAGE_VALUE = '@acme/plugin-foo-SHOW-ME-9210'

/**
 * The CREDENTIAL corpus (round-5 CR-03), spread across all FOUR registered URL field names
 * and all FIVE value forms, with a sentinel in a DIFFERENT URL component per case.
 *
 * The round-5 law this obeys: plant a sentinel in every component a reduction KEEPS. Rounds
 * 3 and 4 cleared userinfo, query and fragment and kept the PATH, so a credential written
 * into a path survived a rule that ran and reported success. Reduction to `scheme://host` has
 * no kept component left, and these eight cases prove it by carrying a distinct sentinel in
 * the path, the userinfo, the query and the fragment in turn.
 *
 * The carrier NAMES — `cartouche`, `plinth`, `obelisk`, `quiver`, `trellis`, `bramble`,
 * `thicket`, `cairn` — each read 0 in `masked-config.ts`'s bytes, measured with a positive
 * control (`isMaskedConfigPath` >= 1) in the same read, so no name the masker has ever seen
 * decides any of them.
 */
const PATH_BORNE_TARGET_SECRET = 'sk-live-CARTOUCHE-DO-NOT-LEAK-9201'
const QUERY_BORNE_BASEURL_SECRET = 'sk-live-PLINTH-DO-NOT-LEAK-9202'
const USERINFO_APPIUM_SECRET = 'sk-live-OBELISK-DO-NOT-LEAK-9203'
const FRAGMENT_WDA_SECRET = 'sk-live-QUIVER-DO-NOT-LEAK-9204'
const PROTOREL_PATH_SECRET = 'sk-live-TRELLIS-DO-NOT-LEAK-9205'
const HOST_RELATIVE_QUERY_SECRET = 'sk-live-BRAMBLE-DO-NOT-LEAK-9206'
const PATH_RELATIVE_QUERY_SECRET = 'sk-live-THICKET-DO-NOT-LEAK-9207'
const OPAQUE_PATH_SECRET = 'sk-live-CAIRN-DO-NOT-LEAK-9208'

const visibility = buildConfigVisibilityOracle(AgentQaConfigSchema)

/**
 * Ten credential key names drawn from OUTSIDE this repo's masker.
 *
 * Not one of them appears in `SECRET_KEY_TERMS` or `SECRET_KEY_SEGMENTS`, and the name
 * census misses every one — which is the point. They are masked because the SCHEMA declares
 * `registry.devices.<name>.match` free-form, not because anyone recognised the word.
 */
const OUT_OF_VOCABULARY_CREDENTIAL_NAMES = [
  'jwt',
  'pem',
  'pfx',
  'dsn',
  'otp',
  'mnemonic',
  'seedPhrase',
  'connectionString',
  'signingKey',
  'hmacKey',
] as const

describe('buildConfigVisibilityOracle (the schema-derived rule)', () => {
  it('reads the config schema through its OUTPUT side, so ordinary keys stay visible', () => {
    // The positive control for the whole oracle, and it is not decoration. The config
    // schema's root is a retired-key pre-scan piped into the strict object, and the
    // pre-scan's input side is `z.any()`. A walker that unwrapped the pipe the wrong way
    // would report EVERY path free-form — every leak assertion below would then pass for
    // the wrong reason. This case fails loudly in exactly that situation.
    for (const key of [
      'workspace.testMatch',
      'workspace.testMatch.0',
      'workspace.hooksFile',
      'knowledge.dir',
      'knowledge.commitArtifacts',
      'services.dashboard.port',
      'services.logging.level',
      'use.browser.headless',
      'registry.llms.0.model',
      'registry.llms.0.baseURL',
      'eval.judge',
    ]) {
      expect(visibility.classify(key), key).toBe('constrained')
    }
  })

  it('classifies every operator-named record with a free-form value as free-form', () => {
    // The three the schema declares TODAY. They are not listed anywhere in the masker —
    // the walk finds them because a `z.record` with an open string key and an
    // unknown/primitive value is what "the operator names this" looks like in the schema.
    for (const key of [
      // z.record(z.string(), z.unknown()) — the device-farm match block (round 2's leak)
      'registry.devices.pixel.match',
      'registry.devices.pixel.match.anything-at-all',
      // z.record(z.string(), z.unknown()) — a provider config
      'registry.providers.acme',
      'registry.providers.acme.region',
      // z.record(z.string(), z.string()) — operator-named key, primitive value
      'registry.llms.0.providerHeaders',
      'registry.llms.0.providerHeaders.x-key',
      // The FOURTH the schema already had, which no plan had enumerated: an analytics
      // attribute predicate is `string | { regex }`, and the bare-string arm means the
      // schema constrains the shape of the value and nothing about its content — the same
      // relation providerHeaders has. The rule finds it without being told.
      'analytics.passRateScope.attributes.tier',
    ]) {
      expect(visibility.classify(key), key).toBe('free-form')
    }
  })

  it('descends INTO records whose values the schema structures', () => {
    // `targets` and `devices` are operator-named records too, but their values are strict
    // objects, so the walk goes through the operator's key into constrained leaves rather
    // than masking the subtree wholesale. Only the inner free-form node is opaque.
    for (const key of [
      'registry.devices.pixel.platform',
      'registry.devices.pixel.transport',
      'registry.targets.web.url',
      'registry.targets.web.platform',
    ]) {
      expect(visibility.classify(key), key).toBe('constrained')
    }
  })

  it('resolves a path through a union of declaration shapes', () => {
    // A plugin declaration is `{ package } | { path }`. Either arm is a real declaration,
    // so a path constrained under SOME option is constrained.
    for (const key of [
      'plugins.auth.0.package',
      'plugins.auth.0.path',
      'plugins.providers.0.package',
      'plugins.providers.0.path',
    ]) {
      expect(visibility.classify(key), key).toBe('constrained')
    }
  })

  it('reports a path the schema does not describe as undeclared', () => {
    for (const key of [
      'deploy.creds.region',
      'services.dashboard.origin',
      'registry.llms.0.apiKey',
      'a.password',
    ]) {
      expect(visibility.classify(key), key).toBe('undeclared')
    }
  })

  it('is LIVE against the schema it is handed, not a snapshot of today\'s free-form set', () => {
    // The staleness guard. A synthetic variant of the REAL config schema — same piped,
    // strict root — carrying a FOURTH free-form record at a path that does not exist today.
    // The oracle masks it with no edit to the masker, so the day the schema grows another
    // operator-named record, this rule already covers it. If the walk ever degrades into an
    // enumeration, this is the case that reddens.
    const inner = AgentQaConfigSchema.def.out as unknown as z.ZodObject
    const grownSchema = z.any().superRefine(() => {}).pipe(
      inner.extend({
        deployment: z.object({
          // A free-form record the masker has never heard of, at a fresh path.
          capabilities: z.record(z.string(), z.unknown()),
          // …beside a constrained sibling, so the assertion cannot pass by masking the
          // whole new subtree.
          region: z.string(),
        }).strict(),
      }),
    )
    const grown = buildConfigVisibilityOracle(grownSchema)

    expect(grown.classify('deployment.capabilities')).toBe('free-form')
    expect(grown.classify('deployment.capabilities.browserstackKey')).toBe('free-form')
    expect(grown.classify('deployment.region')).toBe('constrained')
    // The pre-existing tree is unaffected, so this is a genuine addition rather than a
    // schema that masks everything.
    expect(grown.classify('workspace.testMatch')).toBe('constrained')
    expect(grown.classify('registry.devices.pixel.match.jwt')).toBe('free-form')
    // And the real schema does NOT have that path — the guard is measuring a difference.
    expect(visibility.classify('deployment.capabilities')).toBe('undeclared')
  })
})

/**
 * Extend the REAL config schema through its own piped root, exactly as the staleness guard
 * above does, so every case below is measured against the shipped tree rather than a
 * hand-mirrored lookalike.
 */
function growRealSchema(extension: Record<string, z.ZodType>): z.ZodType {
  const inner = AgentQaConfigSchema.def.out as unknown as z.ZodObject
  return z.any().superRefine(() => {}).pipe(inner.extend(extension))
}

describe('the walker fails CLOSED (CR-02)', () => {
  // The four node kinds the round-3 verifier reproduced as PUBLISHED. None of them appears
  // in today's schema, so none was a live disclosure — but the failure DIRECTION was
  // disclosure, and the module's header claimed the opposite. Each case carries a
  // constrained sibling so it cannot pass by masking the whole new subtree.

  it('masks a record whose value type is an intersection', () => {
    const grown = buildConfigVisibilityOracle(growRealSchema({
      deployment: z.object({
        caps: z.record(
          z.string(),
          z.intersection(
            z.object({ browserKey: z.string() }).strict(),
            z.object({ region: z.string() }).strict(),
          ),
        ),
        region: z.string(),
      }).strict(),
    }))

    expect(grown.classify('deployment.caps')).not.toBe('constrained')
    expect(grown.classify('deployment.caps.browserstack')).not.toBe('constrained')
    expect(grown.isOpaque('deployment.caps.browserstack')).toBe(true)
    // The sibling control, in the same grown schema.
    expect(grown.classify('deployment.region')).toBe('constrained')
  })

  it('masks a z.custom() node at a fixed key', () => {
    const grown = buildConfigVisibilityOracle(growRealSchema({
      deployment: z.object({
        attestation: z.custom(() => true),
        region: z.string(),
      }).strict(),
    }))

    expect(grown.classify('deployment.attestation')).not.toBe('constrained')
    expect(grown.isOpaque('deployment.attestation')).toBe(true)
    expect(grown.classify('deployment.region')).toBe('constrained')
  })

  it('masks records of z.map and z.tuple, which admitsFreeFormValue calls containers', () => {
    // The internal contradiction the review found: `admitsFreeFormValue` lists map/set/tuple
    // among the containers "the walk descends into", and `classifyFrom` has no branch to
    // descend with — so the walk landed on them and called them constrained.
    const grown = buildConfigVisibilityOracle(growRealSchema({
      deployment: z.object({
        mapped: z.record(z.string(), z.map(z.string(), z.string())),
        tupled: z.record(z.string(), z.tuple([z.string(), z.string()])),
        listed: z.record(z.string(), z.set(z.string())),
        region: z.string(),
      }).strict(),
    }))

    for (const key of [
      'deployment.mapped',
      'deployment.mapped.anything',
      'deployment.tupled',
      'deployment.tupled.anything',
      'deployment.listed',
      'deployment.listed.anything',
    ]) {
      expect(grown.classify(key), key).not.toBe('constrained')
      expect(grown.isOpaque(key), key).toBe(true)
    }
    expect(grown.classify('deployment.region')).toBe('constrained')
  })

  it('masks a union carrying a free-form arm, whatever its other arms declare', () => {
    // The two union rules in one module used to point opposite ways: `admitsFreeFormValue`
    // called a union free-form if ANY arm was, while `classifyFrom` called it constrained if
    // ANY arm was. An arm the operator can fill freely means the VALUE may be anything, so
    // free-form has to dominate.
    const grown = buildConfigVisibilityOracle(growRealSchema({
      deployment: z.object({
        vault: z.union([z.unknown(), z.object({ region: z.string() }).strict()]),
        region: z.string(),
      }).strict(),
    }))

    expect(grown.classify('deployment.vault')).not.toBe('constrained')
    expect(grown.classify('deployment.vault.region')).not.toBe('constrained')
    expect(grown.isOpaque('deployment.vault')).toBe(true)
    expect(grown.classify('deployment.region')).toBe('constrained')
    // …and a union with NO free-form arm keeps today's behaviour: the plugin declaration
    // union is `{ package } | { path }`, and either arm is a real declaration.
    expect(visibility.classify('plugins.auth.0.package')).toBe('constrained')
    expect(visibility.classify('plugins.auth.0.path')).toBe('constrained')
  })
})

/**
 * The node kinds the walker decides by NAME, in one place.
 *
 * `CONSTRAINED_LEAF_TYPES` is imported from the module, so the allowlist and its guard
 * cannot drift apart. The remainder is local because it names the branches of a function
 * rather than a shipped constant — and it is kept honest by this table asserting that the
 * five kinds the round-3 verifier found published were ACTUALLY probed and are masked, so
 * the corpus provably reaches past the vocabulary it is checking.
 */
const WALKER_NAMED_VOCABULARY: ReadonlySet<string> = new Set([
  ...CONSTRAINED_LEAF_TYPES,
  // Decided by their own `classifyFrom` branches rather than by the landing allowlist.
  'unknown',
  'any',
  'union',
  'record',
  // Consumed by `unwrap` before any verdict is reached, so they never survive to a landing.
  'optional',
  'nullable',
  'nonoptional',
  'default',
  'prefault',
  'catch',
  'readonly',
  'lazy',
  'pipe',
])

/**
 * Argument shapes to try against each export, so the corpus does not need a list of factory
 * NAMES. Anything that does not yield a structural `def.type` under any of them is not a
 * schema constructor and is discarded.
 */
const PROBE_ARGUMENTS: readonly (readonly unknown[])[] = [
  [],
  [z.string()],
  [z.string(), z.string()],
  [[z.string(), z.string()]],
  ['probe-literal'],
  [() => z.string()],
]

/** One representative schema per zod node kind, derived from zod's own export surface. */
function probeSchemasByNodeKind(): Map<string, z.ZodType> {
  const byKind = new Map<string, z.ZodType>()
  for (const name of Object.keys(z)) {
    const factory = (z as unknown as Record<string, unknown>)[name]
    if (typeof factory !== 'function') continue
    for (const args of PROBE_ARGUMENTS) {
      let produced: unknown
      try {
        produced = (factory as (...callArgs: unknown[]) => unknown)(...args)
      } catch {
        continue
      }
      // Some exports are parse helpers that hand back a promise; never leave one unhandled.
      if (
        typeof produced === 'object' && produced !== null
        && typeof (produced as { then?: unknown }).then === 'function'
      ) {
        void (produced as Promise<unknown>).catch(() => {})
        continue
      }
      const kind = (produced as { def?: { type?: unknown } } | null | undefined)?.def?.type
      if (typeof kind !== 'string') continue
      if (!byKind.has(kind)) byKind.set(kind, produced as z.ZodType)
      break
    }
  }
  return byKind
}

describe('no node kind outside the walker\'s vocabulary earns visibility (CR-02 companion)', () => {
  // The class-closing half, and the reason the allowlist is shippable at all. Its corpus is
  // the LIBRARY's export surface rather than this walker's vocabulary, so a zod upgrade that
  // mints a node kind reddens this table instead of silently widening what config.get
  // publishes. Without it, the allowlist would be the enumeration move one layer down.

  const probes = probeSchemasByNodeKind()

  it('probes zod\'s export surface and reaches past the walker\'s own vocabulary', () => {
    expect(probes.size).toBeGreaterThan(0)
    // Non-vacuity: the corpus must contain the kinds the walker does NOT name, or the
    // implication below would be trivially satisfied by a corpus of allowlisted kinds.
    const unnamed = [...probes.keys()].filter((kind) => !WALKER_NAMED_VOCABULARY.has(kind))
    expect(unnamed.length).toBeGreaterThan(0)
  })

  it('classifies constrained only for kinds the walker names', () => {
    for (const [kind, schema] of probes) {
      const grown = buildConfigVisibilityOracle(growRealSchema({ probeNode: schema }))
      if (grown.classify('probeNode') === 'constrained') {
        expect(WALKER_NAMED_VOCABULARY.has(kind), `${kind} classified constrained`).toBe(true)
      }
    }
  })

  it('masks the five kinds the round-3 report found published', () => {
    for (const kind of ['intersection', 'custom', 'map', 'set', 'tuple']) {
      // Asserted PROBED first: a corpus that silently missed these would pass the
      // implication above without ever exercising it.
      expect(probes.has(kind), `${kind} probed`).toBe(true)
      const grown = buildConfigVisibilityOracle(growRealSchema({ probeNode: probes.get(kind)! }))
      expect(grown.classify('probeNode'), kind).not.toBe('constrained')
      expect(grown.isOpaque('probeNode'), kind).toBe(true)
    }
  })

  it('carries a positive control: the string probe is constrained', () => {
    // Without this, a walker that masked EVERYTHING would satisfy every assertion above.
    expect(probes.has('string')).toBe(true)
    const grown = buildConfigVisibilityOracle(growRealSchema({ probeNode: probes.get('string')! }))
    expect(grown.classify('probeNode')).toBe('constrained')
    // …and the real schema's own controls, in the same file, are asserted constrained by the
    // oracle describe above.
  })
})

describe('isSecretConfigKey (the additive name census)', () => {
  it('recognises the secret-shaped key families', () => {
    for (const key of [
      'registry.providers.acme.apiKey',
      'registry.providers.acme.API_KEY',
      'services.auth.token',
      'services.auth.refreshToken',
      'a.password',
      'a.passphrase',
      'a.clientSecret',
      'a.credentials',
      'a.privateKey',
      'a.authorization',
      'a.bearerToken',
      'workspace.secretsFile',
    ]) {
      expect(isSecretConfigKey(key), key).toBe(true)
    }
  })

  it('recognises short whole-segment credential names the substring scan misses', () => {
    // 'key'.includes('apikey') is false, so a bare `key` segment slipped the term relation
    // entirely. These are matched by exact segment on the value-bearing leaf.
    for (const key of [
      'deploy.key',
      'deploy.keys',
      'deploy.auth',
      'deploy.pass',
      'deploy.pwd',
      'deploy.pat',
      'deploy.sig',
      'deploy.cred',
      'deploy.creds',
    ]) {
      expect(isSecretConfigKey(key), key).toBe(true)
    }
  })

  it('reads the value-bearing LEAF, so an ancestor never masks a constrained child', () => {
    // This is the M-01 correction, at the level it is decided. A census cannot tell a
    // credential from a package name, and when it scanned ancestors it guessed wrong:
    // `plugins.auth.<n>.package` names code that runs in-process with full Node access, and
    // the word `auth` three segments up was the whole reason it was hidden.
    //
    // Narrowing the census gives up nothing, because the schema rule now carries what the
    // ancestor scan used to: `deploy.creds.region` is still masked (see the combined
    // decision below), it is simply masked for a reason that holds for names no list
    // contains.
    expect(isSecretConfigKey('plugins.auth.0.package')).toBe(false)
    expect(isSecretConfigKey('deploy.creds.region')).toBe(false)
  })

  it('misses every out-of-vocabulary credential name, which is why it is not the rule', () => {
    // Stated as an assertion rather than left implicit: this is the census's known blind
    // spot, and the schema rule is what covers it.
    for (const name of OUT_OF_VOCABULARY_CREDENTIAL_NAMES) {
      expect(isSecretConfigKey(`registry.devices.pixel.match.${name}`), name).toBe(false)
    }
  })

  it('leaves ordinary configuration keys alone', () => {
    for (const key of [
      'workspace.testMatch',
      'knowledge.dir',
      'registry.llms.0.model',
      'registry.llms.0.baseURL',
      'services.dashboard.port',
      'use.browser.headless',
      // A token BUDGET is a count, not a credential — the one named carve-out.
      'knowledge.contextBudgetTokens',
    ]) {
      expect(isSecretConfigKey(key), key).toBe(false)
    }
  })
})

describe('isMaskedConfigPath (the whole disclosure decision)', () => {
  it('masks ten credential names the census has never listed, by schema derivation alone', () => {
    for (const name of OUT_OF_VOCABULARY_CREDENTIAL_NAMES) {
      const key = `registry.devices.pixel.match.${name}`
      expect(isMaskedConfigPath(key, visibility), key).toBe(true)
    }
  })

  it('masks every free-form record the schema declares, whatever the key is called', () => {
    for (const key of [
      'registry.llms.0.providerHeaders.x-key',
      'registry.llms.0.providerHeaders.x-cred',
      'registry.llms.0.providerHeaders.x-pwd',
      'registry.llms.0.providerHeaders.anything-at-all',
      'registry.providers.acme.key',
      // The intended over-masking: an innocuous-looking leaf inside a free-form record.
      'registry.providers.acme.baseURL',
      'registry.providers.acme.region',
      'registry.providers.acme',
      'registry.devices.pixel.match',
      'analytics.passRateScope.attributes.tier',
    ]) {
      expect(isMaskedConfigPath(key, visibility), key).toBe(true)
    }
  })

  it('masks a path the schema does not describe, whatever its segments are called', () => {
    // The ancestor-scan property, moved to a stronger carrier. `deploy.creds.region` used
    // to be masked because the word `creds` sat mid-path; it is now masked because the
    // schema does not describe the path at all — which also covers the mid-path words no
    // list contains.
    for (const key of [
      'deploy.creds.region',
      'deploy.vault.endpoint',
      'registry.llms.0.apiKey',
      'a.mnemonic',
    ]) {
      expect(isMaskedConfigPath(key, visibility), key).toBe(true)
    }
  })

  it('adds the census on top of a schema-constrained path', () => {
    // The census is additive, and this proves it still bites: the schema constrains
    // `workspace.secretsFile` end-to-end, and it is masked anyway because its own leaf
    // names a credential file. Its neighbour is the one named carve-out.
    expect(visibility.classify('workspace.secretsFile')).toBe('constrained')
    expect(isMaskedConfigPath('workspace.secretsFile', visibility)).toBe(true)
    expect(isMaskedConfigPath('knowledge.contextBudgetTokens', visibility)).toBe(false)
  })

  it('leaves a schema-constrained package name VISIBLE (M-01)', () => {
    // `package` here is the identity of code the project loads in-process with full Node
    // access. Hiding it from the one capability whose purpose is configuration triage is a
    // disclosure failure of its own, and the round-2 asymmetry — auth hidden, providers
    // shown — was produced entirely by the word `auth` appearing in one path.
    expect(isMaskedConfigPath('plugins.auth.0.package', visibility)).toBe(false)
    expect(isMaskedConfigPath('plugins.providers.0.package', visibility)).toBe(false)
  })

  it('leaves ordinary configuration keys visible', () => {
    for (const key of [
      'workspace.testMatch.0',
      'knowledge.dir',
      'registry.llms.0.model',
      // SCHEMA-CONSTRAINED fields, not operator-chosen ones, so PATH-level visibility is
      // correct for both — the schema means them to be readable. What guards them is the
      // render: both leaf NAMES are registered as addresses, so each value is reduced to
      // `scheme://host[:port]` and the entry is flagged `masked: true`. Nothing about the
      // value is read, so no parameter name and no character sequence has to be recognised.
      'registry.llms.0.baseURL',
      'services.dashboard.port',
      'use.browser.headless',
      'registry.devices.pixel.platform',
      'registry.targets.web.url',
    ]) {
      expect(isMaskedConfigPath(key, visibility), key).toBe(false)
    }
  })
})

describe('buildMaskedResolvedConfig', () => {
  it('drops secret-shaped values at construction and keeps the rest', () => {
    const config = buildMaskedResolvedConfig({
      configPath: '/workspace/agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: { providers: { acme: { apiKey: SECRET, baseURL: 'https://acme.test' } } },
      },
      layers: [{ source: 'config-file', values: { registry: { providers: { acme: { apiKey: SECRET, baseURL: 'https://acme.test' } } } } }],
    })

    expect(config.schemaVersion).toBe(MASKED_RESOLVED_CONFIG_SCHEMA_VERSION)
    expect(config.configPath).toBe('/workspace/agent-qa.config.yaml')
    expect(config.entries).toEqual([
      {
        key: 'registry.providers.acme.apiKey',
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      },
      {
        key: 'registry.providers.acme.baseURL',
        // Masked by the SCHEMA: it sits inside a free-form record, where the key name never
        // decides. Deliberate over-masking, visibly flagged.
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      },
    ])
    expect(JSON.stringify(config)).not.toContain(SECRET)
  })

  it('masks ten out-of-vocabulary credentials planted in a free-form record', () => {
    const planted = Object.fromEntries(
      OUT_OF_VOCABULARY_CREDENTIAL_NAMES.map((name) => [name, `sk-live-${name}-DO-NOT-LEAK`]),
    )
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: {
          devices: { pixel: { platform: 'android', transport: 'browserstack', match: planted } },
        },
        workspace: { hooksFile: 'hooks.yaml' },
      },
      layers: [],
    })

    const serialized = JSON.stringify(config)
    for (const [name, value] of Object.entries(planted)) {
      const key = `registry.devices.pixel.match.${name}`
      expect(config.entries.find((entry) => entry.key === key), key).toEqual({
        key,
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'default',
        masked: true,
      })
      expect(serialized, name).not.toContain(value)
    }
    // The positive control: this read is capable of seeing a value, so "no planted string
    // present" is a fact about the mask rather than about an empty output.
    expect(serialized).toContain('hooks.yaml')
    expect(config.entries.find((entry) => entry.key === 'registry.devices.pixel.platform'))
      .toMatchObject({ value: 'android', masked: false })
  })

  it('reduces a registered URL field carrying userinfo to its origin', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: {
          llms: [{
            name: 'judge',
            baseURL: `https://ops:${USERINFO_PASSWORD}@llm.acme.test/v1`,
          }],
        },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry.value]))
    // FLIP (round 5): the rendered value drops the PATH too, because `baseURL` is a
    // registered address name and a reduction that keeps a path keeps somewhere for a
    // credential to ride. The userinfo property this case was written for is unchanged.
    expect(byKey['registry.llms.0.baseURL']).toBe('https://llm.acme.test')
    // FLIP (round 3): the entry is now `masked: true`. The value the operator wrote is NOT
    // what the caller reads — the render dropped part of it — and round-2's WR-01 was
    // exactly that alteration going out reported as unaltered.
    expect(config.entries.find((entry) => entry.key === 'registry.llms.0.baseURL')?.masked)
      .toBe(true)
    for (const entry of config.entries) {
      expect(entry.value).not.toContain(USERINFO_PASSWORD)
      expect(entry.value).not.toContain('ops:')
    }
    expect(JSON.stringify(config)).not.toContain(USERINFO_PASSWORD)
  })

  it('reduces a registered URL field carrying a query string to its origin (CR-01)', () => {
    // The round-3 leak, closed at round 5 by the FIELD's name rather than by the value's
    // shape. `ticket` and `sso` read 0 in masked-config.ts, so nothing here can pass because
    // someone recognised a word — and now nothing reads the parameter names at all.
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: {
          llms: [{
            name: 'judge',
            baseURL: `https://llm.acme.test/v1?ticket=${URL_QUERY_SECRET}&sso=${URL_QUERY_SECRET_2}`,
          }],
          targets: { web: { platform: 'web', url: `https://x.test/checkout?ticket=${URL_QUERY_SECRET}` } },
        },
        knowledge: { dir: 'agent-qa-knowledge' },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    // FLIP (round 5): the path is gone from both renders. `/v1` and `/checkout` were
    // innocuous here, and dropping them anyway is the disclosed cost of a rule that never has
    // to decide whether a particular path segment is a credential.
    expect(byKey['registry.llms.0.baseURL']).toMatchObject({
      value: 'https://llm.acme.test',
      masked: true,
    })
    expect(byKey['registry.targets.web.url']).toMatchObject({
      value: 'https://x.test',
      masked: true,
    })
    const serialized = JSON.stringify(config)
    for (const planted of [URL_QUERY_SECRET, URL_QUERY_SECRET_2]) {
      expect(serialized, planted).not.toContain(planted)
    }
    // The positive control, read from the same serialization: this read can see a value, so
    // "no planted string present" is a fact about the render and not about an empty output.
    expect(serialized).toContain('agent-qa-knowledge')
  })

  it('reduces a registered URL field carrying a fragment to its origin (CR-01)', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: {
          llms: [{ name: 'judge', baseURL: `https://llm.acme.test/v1#assertion=${URL_FRAGMENT_SECRET}` }],
        },
        knowledge: { dir: 'agent-qa-knowledge' },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    // FLIP (round 5): origin only — see the query case above for why the path goes too.
    expect(byKey['registry.llms.0.baseURL']).toMatchObject({
      value: 'https://llm.acme.test',
      masked: true,
    })
    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain(URL_FRAGMENT_SECRET)
    expect(serialized).toContain('agent-qa-knowledge')
  })

  it('DROPS a registered carrier that has no absolute rendering (CR-01, round 4)', () => {
    // The round-4 leak. Each of these four forms is one a bare `new URL(value)` cannot turn
    // into an origin — three throw, the opaque one parses with an empty host and carries its
    // credential in `pathname` — so there is nothing to reduce them TO, and a value this
    // module cannot read is not published.
    //
    // KEPT (round 5) with a new reason. Under the deleted rule these dropped because a
    // placeholder-base probe found secret-bearing parts in them; under the shipped rule they
    // drop because `baseURL` and `url` are registered address names and `reduceToOrigin`
    // yields no origin. The assertions are unchanged; only what makes them true is.
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: {
          llms: [
            { name: 'host-relative', baseURL: HOST_RELATIVE_URL },
            { name: 'opaque-scheme', baseURL: OPAQUE_SCHEME_URL },
          ],
          targets: {
            web: { platform: 'web', url: PROTOCOL_RELATIVE_URL },
            checkout: { platform: 'web', url: PATH_RELATIVE_URL },
          },
        },
        knowledge: { dir: 'agent-qa-knowledge' },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    for (const key of [
      'registry.llms.0.baseURL',
      'registry.llms.1.baseURL',
      'registry.targets.web.url',
      'registry.targets.checkout.url',
    ]) {
      expect(byKey[key], key).toEqual({
        key,
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'default',
        masked: true,
      })
    }

    const serialized = JSON.stringify(config)
    for (const planted of [
      PROTOCOL_RELATIVE_USERINFO_SECRET,
      PROTOCOL_RELATIVE_QUERY_SECRET,
      PROTOCOL_RELATIVE_FRAGMENT_SECRET,
      HOST_RELATIVE_SECRET,
      PATH_RELATIVE_SECRET,
      OPAQUE_SCHEME_SECRET,
    ]) {
      expect(serialized, planted).not.toContain(planted)
    }
    // The positive control, from the SAME serialization: this read can see a value, so the
    // six absences above are facts about the render and not about an empty output. A
    // neighbouring constrained leaf under a dropped entry's own object is visible too, so
    // the drop cannot pass by masking a subtree.
    expect(serialized).toContain('agent-qa-knowledge')
    expect(byKey['registry.targets.web.platform']).toMatchObject({
      value: 'web',
      masked: false,
    })
    expect(byKey['registry.llms.0.name']).toMatchObject({
      value: 'host-relative',
      masked: false,
    })
  })

  it('leaves an @-carrying value that is not a credential carrier byte-identical', () => {
    // The collision every value-inspecting rule had to survive by luck: a scoped package
    // name carries an '@' and is not a URL. It stays visible now for a reason that cannot
    // go wrong — `package` is not a registered address name, so nothing about the value is
    // read at all. This is what the plan-10 SHOW-ME assertions depend on: a package that
    // runs in-process with full Node access belongs in a configuration triage read.
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        plugins: { auth: [{ package: SCOPED_PACKAGE_NAME }] },
        knowledge: { dir: 'agent-qa-knowledge' },
      },
      layers: [],
    })

    expect(config.entries.find((entry) => entry.key === 'plugins.auth.0.package')).toEqual({
      key: 'plugins.auth.0.package',
      value: SCOPED_PACKAGE_NAME,
      source: 'default',
      masked: false,
    })
  })

  it('applies the rule to the RENDERED string of a leaf, not only to string inputs', () => {
    // The round-2 WR-07 residue, and a CLOSED finding this plan preserves rather than
    // reopens: the rule used to be gated on `typeof value === 'string'`, so a leaf that
    // RENDERS as a URL without being one skipped it entirely. Every leaf is stringified
    // first, so the input's runtime type still decides nothing.
    //
    // REWRITTEN (round 5): the carrier moved from `workspace.hooksFile` to
    // `registry.targets.<name>.url`. The old case asserted the opposite of what this plan
    // ships — it proved the rule was NOT scoped to URL-shaped field names, which is exactly
    // the value-inspection that over-masked ordinary configuration. What the ordering
    // property needs is a non-string leaf on a REGISTERED field, which is this. The
    // `hooksFile` half is kept as the control: it is stringified too, and then returned as
    // written because its name is not registered.
    const urlish = Object.defineProperties({}, {
      toJSON: { value: () => undefined },
      toString: { value: () => `https://leaf.acme.test/p/${RENDERED_LEAF_SECRET}` },
    })
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: { targets: { web: { platform: 'web', url: urlish } } },
        workspace: { hooksFile: 4242 },
        knowledge: { dir: 'agent-qa-knowledge' },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    expect(byKey['registry.targets.web.url']).toMatchObject({
      value: 'https://leaf.acme.test',
      masked: true,
    })
    // The control: a non-string leaf on a non-registered field is rendered to a string and
    // then left alone.
    expect(byKey['workspace.hooksFile']).toMatchObject({ value: '4242', masked: false })
    expect(JSON.stringify(config)).not.toContain(RENDERED_LEAF_SECRET)
    expect(JSON.stringify(config)).toContain('agent-qa-knowledge')
  })

  it('leaves non-URL and userinfo-free strings byte-identical', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: { llms: [{ name: 'judge', baseURL: 'https://llm.acme.test' }] },
        knowledge: { dir: 'agent-qa-knowledge' },
        workspace: { hooksFile: 'hooks.yaml' },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry.value]))
    // No trailing-slash normalisation: a registered value that already IS its origin is
    // returned as written, so nothing an operator wrote is silently normalised.
    //
    // RESTATED (round 5): what these three have in common is no longer a property of their
    // characters. `baseURL` is registered and reduces to an origin it already equals;
    // `knowledge.dir` and `workspace.hooksFile` are not registered and are never looked at.
    // The round-4 phrasing — "each resolves with empty username, password, search and hash"
    // — described the placeholder-base probe this plan deleted, and that probe is precisely
    // what made a glob wildcard and a CSS selector render as `[masked]`.
    expect(byKey['registry.llms.0.baseURL']).toBe('https://llm.acme.test')
    expect(byKey['knowledge.dir']).toBe('agent-qa-knowledge')
    expect(byKey['workspace.hooksFile']).toBe('hooks.yaml')
    // …and the entry says so: an unaltered render is `masked: false`, which is what makes
    // the flag readable as "the operator's raw value is absent" on the cases above.
    for (const key of ['registry.llms.0.baseURL', 'knowledge.dir', 'workspace.hooksFile']) {
      expect(config.entries.find((entry) => entry.key === key)?.masked, key).toBe(false)
    }
  })

  it('renders every value as a string so no value type bypasses masking', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        services: { dashboard: { port: 4000 } },
        use: { browser: { headless: true } },
        workspace: { testMatch: [] },
        knowledge: { contextBudgetTokens: null },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry.value]))
    expect(byKey['services.dashboard.port']).toBe('4000')
    expect(byKey['use.browser.headless']).toBe('true')
    expect(byKey['workspace.testMatch']).toBe('[]')
    expect(byKey['knowledge.contextBudgetTokens']).toBe('null')
    for (const entry of config.entries) {
      expect(typeof entry.value).toBe('string')
    }
  })

  it('descends into arrays so a secret nested in one is still masked', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        registry: { llms: [{ name: 'judge', apiKey: SECRET }] },
      },
      layers: [],
    })

    expect(config.entries).toEqual([
      {
        key: 'registry.llms.0.apiKey',
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'default',
        masked: true,
      },
      { key: 'registry.llms.0.name', value: 'judge', source: 'default', masked: false },
    ])
    expect(JSON.stringify(config)).not.toContain(SECRET)
  })

  it('attributes each key to the highest-precedence layer that carries it', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        knowledge: { dir: 'agent-qa-knowledge' },
        services: { dashboard: { port: 9999 }, logging: { level: 'debug' } },
      },
      layers: [
        { source: 'config-file', values: { services: { dashboard: { port: 4000 }, logging: { level: 'info' } } } },
        { source: 'env', values: { services: { logging: { level: 'debug' } } } },
        { source: 'cli-flag', values: { services: { dashboard: { port: 9999 } } } },
      ],
    })

    const bySource = Object.fromEntries(config.entries.map((entry) => [entry.key, entry.source]))
    expect(bySource['services.dashboard.port']).toBe('cli-flag')
    expect(bySource['services.logging.level']).toBe('env')
    // A key no layer supplied came from a schema default.
    expect(bySource['knowledge.dir']).toBe('default')
  })

  it('emits entries in a deterministic key order', () => {
    const input = {
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: { b: { z: 1, a: 2 }, a: { m: 3 } },
      layers: [],
    }

    expect(buildMaskedResolvedConfig(input).entries.map((entry) => entry.key))
      .toEqual(['a.m', 'b.a', 'b.z'])
    expect(buildMaskedResolvedConfig(input)).toEqual(buildMaskedResolvedConfig(input))
  })
})

describe('the four drop forms have no origin to reduce to, per Node\'s own parser', () => {
  // RETAINED and RESTATED (round 5). Round 4 wrote this block to prove its corpus came from
  // outside the render rule's PRECONDITION — a precondition the shipped rule no longer has,
  // because the reduction runs for every registered field regardless of what the value looks
  // like. The characterisation itself survives the redesign intact and is worth more than its
  // original framing: it establishes, against Node's `URL` rather than against any branch of
  // `masked-config.ts`, WHY these four forms reach the placeholder instead of an origin.
  // Three cannot be parsed at all and the fourth parses with no host, so there is no
  // `scheme://host` to render. That stays true however the fix is written.

  it('makes a bare new URL() throw for the three relative forms', () => {
    for (const value of [PROTOCOL_RELATIVE_URL, HOST_RELATIVE_URL, PATH_RELATIVE_URL]) {
      expect(() => new URL(value), value).toThrow()
    }
  })

  it('parses the opaque-scheme form with an empty host and the credential in the path', () => {
    // The form that defeated every four-field check: it PARSES, and
    // username/password/search/hash are all empty because an opaque-path URL has no userinfo
    // slot — the credential rides in `pathname`. An empty host is why it drops today.
    const url = new URL(OPAQUE_SCHEME_URL)
    expect(url.host).toBe('')
    expect([url.username, url.password, url.search, url.hash]).toEqual(['', '', '', ''])
    expect(url.pathname).toContain(OPAQUE_SCHEME_SECRET)
  })

  it('accepts the absolute control, which is what the round-3 corpus was made of', () => {
    // The positive control for this block: the precondition really does accept something, so
    // the three throws above are facts about the planted forms rather than about a parser
    // that rejects everything.
    expect(() => new URL('https://llm.acme.test/v1?ticket=x')).not.toThrow()
  })
})

describe('a non-registered leaf is never inspected, so it cannot be over-masked (CR-02)', () => {
  // Round 5's second direction, and the half a security rule is never graded on. Each value
  // below is the ordinary content of the field it sits on, and each contains a character the
  // previous rule read as a URL part. The claim is not "these particular strings survive" —
  // it is that NOTHING about a non-registered value is read at all, so there is no character
  // a future operator can write that changes the answer.

  it('returns glob, selector and package values byte-identical with masked: false', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        workspace: {
          testMatch: [GLOB_WILDCARD_VALUE],
          testPathIgnore: [IGNORE_GLOB_VALUE],
          hooksFile: 'hooks.yaml',
        },
        services: { accessibility: { enabled: false, exclude: [CSS_SELECTOR_VALUE] } },
        plugins: { auth: [{ package: OVER_MASK_PACKAGE_VALUE }] },
        registry: { providers: { acme: { apiKey: SECRET } } },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    for (const [key, value] of [
      ['workspace.testMatch.0', GLOB_WILDCARD_VALUE],
      ['workspace.testPathIgnore.0', IGNORE_GLOB_VALUE],
      ['services.accessibility.exclude.0', CSS_SELECTOR_VALUE],
      ['plugins.auth.0.package', OVER_MASK_PACKAGE_VALUE],
      ['workspace.hooksFile', 'hooks.yaml'],
    ] as const) {
      expect(byKey[key], key).toEqual({ key, value, source: 'default', masked: false })
    }
    // The NEGATIVE control, in the same build: masking still bites. Without it, a masker that
    // had stopped masking entirely would satisfy every assertion above.
    expect(byKey['registry.providers.acme.apiKey']).toEqual({
      key: 'registry.providers.acme.apiKey',
      value: CONFIG_MASK_PLACEHOLDER,
      source: 'default',
      masked: true,
    })
  })

  it('is decided by the FIELD, not the characters — the same value flips on a registered leaf', () => {
    // The differential that makes the rule's shape observable rather than asserted. One
    // value, two fields: on a non-registered leaf it is returned as written; on a registered
    // one it is reduced. Nothing about the string changed between the two reads.
    const shared = 'https://x.test/a?q=1#f'
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: {
        workspace: { hooksFile: shared },
        registry: { targets: { web: { platform: 'web', url: shared } } },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    expect(byKey['workspace.hooksFile']).toMatchObject({ value: shared, masked: false })
    expect(byKey['registry.targets.web.url']).toMatchObject({
      value: 'https://x.test',
      masked: true,
    })
  })
})

/**
 * The real `remoteDeviceSchema`, grafted onto the real config schema.
 *
 * `appiumUrl` and `webDriverAgentUrl` are declared as plain `z.string()` in the SHIPPED
 * schema package (`config/remote-device.ts`), and their canonical values carry a device-farm
 * access key in the userinfo. Grafting the shipped declaration rather than hand-mirroring it
 * means this corpus measures the same node the product ships.
 */
const grownVisibility = buildConfigVisibilityOracle(growRealSchema({
  deployment: z.object({
    remoteDevice: remoteDeviceSchema,
    region: z.string(),
  }).strict(),
}))

/** One credential case: a field, the component its sentinel rides in, and what must come back. */
interface CredentialCase {
  key: string
  component: 'path' | 'userinfo' | 'query' | 'fragment'
  form: 'absolute' | 'protocol-relative' | 'host-relative' | 'path-relative' | 'opaque-scheme'
  sentinel: string
  expected: string
}

const CREDENTIAL_CASES: readonly CredentialCase[] = [
  {
    key: 'registry.targets.hook.url',
    component: 'path',
    form: 'absolute',
    sentinel: PATH_BORNE_TARGET_SECRET,
    expected: 'https://hooks.acme.test',
  },
  {
    key: 'registry.llms.0.baseURL',
    component: 'query',
    form: 'absolute',
    sentinel: QUERY_BORNE_BASEURL_SECRET,
    expected: 'https://llm.acme.test',
  },
  {
    key: 'deployment.remoteDevice.appiumUrl',
    component: 'userinfo',
    form: 'absolute',
    sentinel: USERINFO_APPIUM_SECRET,
    expected: 'https://hub.provider.test',
  },
  {
    key: 'deployment.remoteDevice.webDriverAgentUrl',
    component: 'fragment',
    form: 'absolute',
    sentinel: FRAGMENT_WDA_SECRET,
    expected: 'https://wda.provider.test',
  },
  {
    key: 'registry.targets.relhook.url',
    component: 'path',
    form: 'protocol-relative',
    sentinel: PROTOREL_PATH_SECRET,
    expected: CONFIG_MASK_PLACEHOLDER,
  },
  {
    key: 'registry.llms.1.baseURL',
    component: 'query',
    form: 'host-relative',
    sentinel: HOST_RELATIVE_QUERY_SECRET,
    expected: CONFIG_MASK_PLACEHOLDER,
  },
  {
    key: 'registry.targets.pathrel.url',
    component: 'query',
    form: 'path-relative',
    sentinel: PATH_RELATIVE_QUERY_SECRET,
    expected: CONFIG_MASK_PLACEHOLDER,
  },
  {
    key: 'registry.llms.2.baseURL',
    component: 'path',
    form: 'opaque-scheme',
    sentinel: OPAQUE_PATH_SECRET,
    expected: CONFIG_MASK_PLACEHOLDER,
  },
]

const CREDENTIAL_CORPUS_CONFIG = {
  registry: {
    llms: [
      { name: 'judge', baseURL: `https://llm.acme.test/v1?plinth=${QUERY_BORNE_BASEURL_SECRET}` },
      { name: 'host-rel', baseURL: `llm.acme.test/v1?bramble=${HOST_RELATIVE_QUERY_SECRET}` },
      { name: 'opaque', baseURL: `ops:${OPAQUE_PATH_SECRET}@llm.acme.test/v1` },
    ],
    targets: {
      hook: {
        platform: 'web',
        url: `https://hooks.acme.test/services/T00/B00/${PATH_BORNE_TARGET_SECRET}`,
      },
      relhook: { platform: 'web', url: `//hooks.acme.test/services/${PROTOREL_PATH_SECRET}` },
      pathrel: { platform: 'web', url: `/checkout?thicket=${PATH_RELATIVE_QUERY_SECRET}` },
      // A URL that already IS its own origin: reduced to itself, so it comes back
      // byte-identical and UNFLAGGED.
      clean: { platform: 'web', url: 'https://clean.acme.test' },
    },
  },
  deployment: {
    remoteDevice: {
      appiumUrl: `https://user:${USERINFO_APPIUM_SECRET}@hub.provider.test/wd/hub`,
      webDriverAgentUrl: `https://wda.provider.test/session#quiver=${FRAGMENT_WDA_SECRET}`,
    },
    region: 'eu-west',
  },
  knowledge: { dir: 'agent-qa-knowledge' },
}

describe('a registered URL field is reduced to its origin, whatever the credential rides in (CR-03)', () => {
  const config = buildMaskedResolvedConfig({
    configPath: 'agent-qa.config.yaml',
    visibility: grownVisibility,
    resolved: CREDENTIAL_CORPUS_CONFIG,
    layers: [],
  })
  const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
  const serialized = JSON.stringify(config)

  it('covers all four registered names, all five value forms and all four components', () => {
    // Non-vacuity, asserted before the claims that depend on it: a corpus that quietly lost
    // a name, a form or a component would satisfy every case below by not containing it.
    expect(new Set(CREDENTIAL_CASES.map((entry) => entry.key.split('.').at(-1)))).toEqual(
      new Set(['url', 'baseURL', 'appiumUrl', 'webDriverAgentUrl']),
    )
    expect(new Set(CREDENTIAL_CASES.map((entry) => entry.form)).size).toBe(5)
    expect(new Set(CREDENTIAL_CASES.map((entry) => entry.component)).size).toBe(4)
    // …and every planted key really is one the oracle CLEARED, so each case exercises the
    // render rule rather than the path decision.
    for (const entry of CREDENTIAL_CASES) {
      expect(grownVisibility.classify(entry.key), entry.key).toBe('constrained')
      expect(isMaskedConfigPath(entry.key, grownVisibility), entry.key).toBe(false)
    }
  })

  it('publishes no sentinel and renders origin-or-placeholder with masked: true', () => {
    for (const entry of CREDENTIAL_CASES) {
      expect(byKey[entry.key], `${entry.key} (${entry.form}, ${entry.component})`).toEqual({
        key: entry.key,
        value: entry.expected,
        source: 'default',
        masked: true,
      })
      expect(serialized, `${entry.sentinel} (${entry.component})`).not.toContain(entry.sentinel)
    }
  })

  it('keeps the host an operator triages with, and the neighbours the drop cannot swallow', () => {
    // The POSITIVE CONTROLS, from the SAME serialization: this read can see values, so the
    // eight absences above are facts about the render and not about an empty output.
    expect(serialized).toContain('hooks.acme.test')
    expect(serialized).toContain('agent-qa-knowledge')
    expect(byKey['deployment.region']).toMatchObject({ value: 'eu-west', masked: false })
    expect(byKey['registry.llms.0.name']).toMatchObject({ value: 'judge', masked: false })
    expect(byKey['registry.targets.hook.platform']).toMatchObject({ value: 'web', masked: false })
  })

  it('leaves a value that already IS its origin byte-identical and unflagged', () => {
    // The disclosed cost has a floor: reduction is not normalisation. A registered value with
    // nothing to drop is returned exactly as written, and `masked: false` says so.
    expect(byKey['registry.targets.clean.url']).toEqual({
      key: 'registry.targets.clean.url',
      value: 'https://clean.acme.test',
      source: 'default',
      masked: false,
    })
  })
})

/**
 * The staleness guard for `CREDENTIAL_BEARING_URL_LEAVES`, and the reason a NAME list is
 * shippable at all.
 *
 * A registered-name list is the same object class that failed at the path level three times:
 * whatever it lists, the schema's next field has a different name. What makes this one
 * different is not care — it is that a leaf's ARRIVAL is a RED BUILD. The walk below reads the
 * shipped config schema as data, collects every string-bearing leaf PATH it declares, and pins
 * that whole set; it never consults the registered names. So schema growth cannot go unnoticed,
 * while a leaf already pinned and unregistered is the census note's residual class rather than
 * this guard's. The corpus is therefore the SCHEMA's own surface, not this file's vocabulary,
 * which is the same discipline the visibility walker's `Object.keys(z)` companion table uses.
 *
 * Failing means over-masking a new field until someone registers it, never disclosure — so
 * the guard's own failure direction is the safe one.
 */
interface ProbeNodeDef {
  type: string
  innerType?: unknown
  getter?: unknown
  out?: unknown
  valueType?: unknown
  element?: unknown
  options?: unknown
  left?: unknown
  right?: unknown
  shape?: unknown
}

function probeDefOf(node: unknown): ProbeNodeDef | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const def = (node as { def?: unknown }).def
  if (typeof def !== 'object' || def === null) return undefined
  const type = (def as { type?: unknown }).type
  return typeof type === 'string' ? (def as ProbeNodeDef) : undefined
}

function probeArmsOf(def: ProbeNodeDef): readonly unknown[] {
  if (Array.isArray(def.options)) return def.options
  if (def.left !== undefined || def.right !== undefined) {
    return [def.left, def.right].filter((arm) => arm !== undefined)
  }
  return []
}

/** The landing kinds that mean "the operator writes text here". */
const STRING_BEARING_LEAF_TYPES: ReadonlySet<string> = new Set(['string', 'transform'])

/**
 * Every dot-PATH the schema declares a string-bearing value at.
 *
 * Paths, not names. A name-keyed pin cannot see a NEW field that reuses an already-pinned
 * name: adding `telemetry.host` to the schema contributes the name `host`, which is pinned
 * already, so the pin stays green while an unregistered address leaf ships visible. Keying on
 * the path makes every added leaf a new entry whatever it is called, which is what the pin
 * claims to guarantee.
 *
 * Array elements and record values contribute a `*` segment — the operator chooses those
 * keys, so they are not structure the schema declares. Wrappers pass the path through. The
 * visit ledger is keyed by node AND path, so a shared leaf schema reused at several paths is
 * recorded at each of them rather than only the first.
 */
function declaredStringLeafPaths(schema: unknown): Set<string> {
  const names = new Set<string>()
  const visited = new Map<unknown, Set<string | undefined>>()

  const visit = (node: unknown, name: string | undefined, depth: number): void => {
    if (depth > 40) return
    const def = probeDefOf(node)
    if (def === undefined) return
    let seenNames = visited.get(node)
    if (seenNames === undefined) {
      seenNames = new Set()
      visited.set(node, seenNames)
    }
    if (seenNames.has(name)) return
    seenNames.add(name)

    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'nonoptional':
      case 'default':
      case 'prefault':
      case 'catch':
      case 'readonly':
        visit(def.innerType, name, depth + 1)
        return
      case 'lazy':
        if (typeof def.getter === 'function') {
          visit((def.getter as () => unknown)(), name, depth + 1)
        }
        return
      case 'pipe':
        visit(def.out, name, depth + 1)
        return
      case 'object':
      case 'interface': {
        const shape = def.shape
        if (typeof shape === 'object' && shape !== null) {
          for (const [key, child] of Object.entries(shape as Record<string, unknown>)) {
            visit(child, name === undefined ? key : `${name}.${key}`, depth + 1)
          }
        }
        return
      }
      case 'array':
        visit(def.element, name === undefined ? '*' : `${name}.*`, depth + 1)
        return
      case 'record':
        visit(def.valueType, name === undefined ? '*' : `${name}.*`, depth + 1)
        return
      case 'union':
      case 'intersection':
        for (const arm of probeArmsOf(def)) visit(arm, name, depth + 1)
        return
      default:
        if (STRING_BEARING_LEAF_TYPES.has(def.type) && name !== undefined) names.add(name)
    }
  }

  visit(schema, undefined, 0)
  return names
}

/**
 * Every dot-PATH the shipped config schema declares a string-bearing value at — PINNED.
 *
 * Two earlier revisions of this guard were each tested from inside their own assumptions,
 * which is the mistake the render rule stopped making, repeated one level up:
 *
 *   1. A pattern filter, `/(?:url|uri|endpoint|webhook)$/`, applied before the registration
 *      check. Drawn from the registered set's own vocabulary, it could only catch a name the
 *      registry already knew — `dsn`, `serverAddress`, `apiHost`, `origin`, `href`,
 *      `hubAddress`, `endpoints` and `webhooks` all walked past it.
 *   2. A pin on NAMES. It caught a new name, but not a new FIELD reusing a pinned one:
 *      adding `telemetry.host` contributes the name `host`, already pinned, so the pin stayed
 *      green while an unregistered address leaf shipped visible.
 *
 * Keying on the PATH removes both. Every added leaf is a new entry whatever it is called and
 * wherever it sits, so the pin reddens on any schema growth and a human then registers the
 * leaf in `CREDENTIAL_BEARING_URL_LEAVES` or records it here as inert. Array elements and
 * record values are `*` — the operator chooses those keys, so they are not declared structure.
 *
 * The residue this pin does NOT close, named rather than denied: a field that exists TODAY
 * and is not registered can still be handed a credential-bearing URL by an operator.
 * `services.mcp.host` is the reproducible example — a plain `z.string()` whose name promises a
 * bare hostname, so registering it would mask the ordinary value `localhost` (which
 * `new URL()` rejects). It is left visible deliberately, and an operator who writes
 * `https://u:pw@h/p` into a field called `host` is disclosed. Closing that needs the schema to
 * say the field is an address, not this test to guess.
 */
const DECLARED_STRING_LEAF_PATHS: readonly string[] = [
  'analytics.passRateScope.attributes.*',
  'analytics.passRateScope.attributes.*.regex',
  'eval.judge',
  'knowledge.dir',
  'plugins.auth.*.package',
  'plugins.auth.*.path',
  'plugins.providers.*.package',
  'plugins.providers.*.path',
  'registry.llms.*.baseURL',
  'registry.llms.*.contextWindow',
  'registry.llms.*.model',
  'registry.llms.*.name',
  'registry.llms.*.provider',
  'registry.llms.*.providerHeaders.*',
  'registry.targets.*.app.browserstack',
  'registry.targets.*.app.path',
  'registry.targets.*.appActivity',
  'registry.targets.*.appPackage',
  'registry.targets.*.bundleId',
  'registry.targets.*.product',
  'registry.targets.*.url',
  'services.accessibility.disableRules.*',
  'services.accessibility.exclude.*',
  'services.authState.dir',
  'services.cache.dir',
  'services.cache.ttl',
  'services.dashboard.artifactsDir',
  'services.dashboard.dbPath',
  'services.mcp.host',
  'services.mcp.path',
  'services.vision.screenshotSize',
  'use.buildTag',
  'use.llm',
  'use.timeout.navigation',
  'use.timeout.step',
  'use.timeout.test',
  'workspace.envFile',
  'workspace.hooksFile',
  'workspace.secretsFile',
  'workspace.suiteMatch.*',
  'workspace.testMatch.*',
  'workspace.testPathIgnore.*',
]

function unpinnedStringLeafPaths(schema: unknown): string[] {
  const pinned = new Set(DECLARED_STRING_LEAF_PATHS)
  return [...declaredStringLeafPaths(schema)].filter((path) => !pinned.has(path)).sort()
}

describe('the registered URL-name set cannot silently go stale', () => {
  it('reaches the shipped schema\'s real string leaves', () => {
    // Non-vacuity first: an empty or shallow walk would satisfy the pin below by finding
    // nothing at all. These are paths the shipped config schema genuinely declares, at four
    // different depths and through an array, a record and a union.
    const declared = declaredStringLeafPaths(AgentQaConfigSchema)
    for (const path of [
      'registry.targets.*.url',
      'registry.llms.*.baseURL',
      'workspace.hooksFile',
      'knowledge.dir',
      'registry.llms.*.model',
      'plugins.auth.*.package',
      'eval.judge',
    ]) {
      expect(declared.has(path), path).toBe(true)
    }
    expect(declared.size).toBeGreaterThan(20)
  })

  it('pins every string-leaf PATH the shipped schema declares', () => {
    // The whole set, both directions — a leaf added to the schema fails here, and a leaf
    // removed from the schema fails here too, so the pin cannot rot in either direction.
    expect([...declaredStringLeafPaths(AgentQaConfigSchema)].sort())
      .toEqual([...DECLARED_STRING_LEAF_PATHS].sort())
  })

  it('FAILS for names OUTSIDE the registered vocabulary (negative control)', () => {
    // The pin's falsifiability, executed rather than asserted, controlled from outside the
    // vocabulary: not one of these eight names ends in url, uri, endpoint or webhook, so
    // every one defeated the pattern filter this pin replaced. Each would ship VISIBLE.
    const grown = growRealSchema({
      deployment: z.object({
        dsn: z.string(),
        apiHost: z.string(),
        serverAddress: z.string(),
        origin: z.string(),
        href: z.string(),
        hubAddress: z.string(),
        endpoints: z.string(),
        webhooks: z.string(),
      }).strict(),
    })

    expect(unpinnedStringLeafPaths(grown)).toEqual([
      'deployment.apiHost', 'deployment.dsn', 'deployment.endpoints', 'deployment.href',
      'deployment.hubAddress', 'deployment.origin', 'deployment.serverAddress',
      'deployment.webhooks',
    ])
    expect(unpinnedStringLeafPaths(AgentQaConfigSchema)).toEqual([])
  })

  it('FAILS for a NEW field reusing an ALREADY-PINNED name (the name-pin\'s blind spot)', () => {
    // The case a name-keyed pin could not see. `host`, `path`, `dir`, `name`, `provider`,
    // `test`, `step` and `product` are all names the schema already declares elsewhere, so a
    // name pin stays green while each of these new fields ships visible and unregistered.
    const grown = growRealSchema({
      telemetry: z.object({
        host: z.string(),
        path: z.string(),
        dir: z.string(),
        name: z.string(),
        provider: z.string(),
        test: z.string(),
        step: z.string(),
        product: z.string(),
      }).strict(),
    })

    expect(unpinnedStringLeafPaths(grown)).toEqual([
      'telemetry.dir', 'telemetry.host', 'telemetry.name', 'telemetry.path',
      'telemetry.product', 'telemetry.provider', 'telemetry.step', 'telemetry.test',
    ])
  })

  it('FAILS for a registered-vocabulary name too, so the pin did not narrow the old cover', () => {
    const grown = growRealSchema({
      deployment: z.object({ callbackUrl: z.string(), region: z.string() }).strict(),
    })
    expect(unpinnedStringLeafPaths(grown)).toEqual(['deployment.callbackUrl', 'deployment.region'])
  })

  it('registers the four names the corpus above plants credentials on', () => {
    for (const name of ['url', 'baseURL', 'appiumUrl', 'webDriverAgentUrl']) {
      expect(isCredentialBearingUrlField(name), name).toBe(true)
    }
    // The traversal is the census's, so an array index or an operator-named record key
    // cannot change the answer.
    expect(isCredentialBearingUrlField('registry.llms.0.baseURL')).toBe(true)
    expect(isCredentialBearingUrlField('registry.targets.web.url')).toBe(true)
    // …and an ordinary leaf is not registered, which is why it is never inspected.
    for (const key of [
      'workspace.testMatch.0',
      'services.accessibility.exclude.0',
      'plugins.auth.0.package',
      'knowledge.dir',
    ]) {
      expect(isCredentialBearingUrlField(key), key).toBe(false)
    }
    // The set is normalized, which is what makes the case-insensitive match above work.
    for (const registered of CREDENTIAL_BEARING_URL_LEAVES) {
      expect(registered, registered).toBe(registered.toLowerCase().replaceAll(/[^a-z0-9]/gu, ''))
    }
  })
})
