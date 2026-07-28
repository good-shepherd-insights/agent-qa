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
import { CONFIG_MASK_PLACEHOLDER, MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { buildConfigVisibilityOracle, CONSTRAINED_LEAF_TYPES } from '../config-visibility.js'
import {
  buildMaskedResolvedConfig,
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
      // render: a visible value that parses as a URL is rendered as `scheme://host[:port]/
      // path` only, with userinfo, query and fragment dropped unconditionally and the entry
      // flagged `masked: true`. That rule reads the value's own structure, so it does not
      // depend on anyone recognising what a query parameter is called.
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

  it('strips URL userinfo from values that stay visible', () => {
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
    expect(byKey['registry.llms.0.baseURL']).toBe('https://llm.acme.test/v1')
    // FLIP (round 3): the entry is now `masked: true`. The value the operator wrote is NOT
    // what the caller reads — the render dropped part of it — and round-2's WR-01 was
    // exactly that alteration going out reported as unaltered. The value is unchanged.
    expect(config.entries.find((entry) => entry.key === 'registry.llms.0.baseURL')?.masked)
      .toBe(true)
    for (const entry of config.entries) {
      expect(entry.value).not.toContain(USERINFO_PASSWORD)
      expect(entry.value).not.toContain('ops:')
    }
    expect(JSON.stringify(config)).not.toContain(USERINFO_PASSWORD)
  })

  it('reduces a visible URL carrying a query string to scheme://host/path (CR-01)', () => {
    // The round-3 leak, closed by the shape of the VALUE rather than the name of a
    // parameter. `ticket` and `sso` read 0 in masked-config.ts, so nothing here can pass
    // because someone recognised a word.
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
    expect(byKey['registry.llms.0.baseURL']).toMatchObject({
      value: 'https://llm.acme.test/v1',
      masked: true,
    })
    expect(byKey['registry.targets.web.url']).toMatchObject({
      value: 'https://x.test/checkout',
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

  it('reduces a visible URL carrying a fragment to scheme://host/path (CR-01)', () => {
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
    expect(byKey['registry.llms.0.baseURL']).toMatchObject({
      value: 'https://llm.acme.test/v1',
      masked: true,
    })
    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain(URL_FRAGMENT_SECRET)
    expect(serialized).toContain('agent-qa-knowledge')
  })

  it('DROPS a visible carrier the parser cannot resolve absolutely (CR-01, round 4)', () => {
    // The round-4 leak, and the axis it moved to: not WHICH PARTS of a URL are dropped, but
    // WHICH VALUES the rule will look at. Each of these four forms is one the bare
    // `new URL(value)` precondition rejects — three throw, the opaque one parses with an
    // empty host and carries its credential in `pathname` — so round 3's reduce branch never
    // saw them and they rode out byte-identical with `masked: false`. A value the parser
    // cannot vouch for has no absolute rendering to reduce to, so it is DROPPED.
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
    // The collision the drop rule has to survive: a scoped package name carries an '@' and
    // is not an absolute URL, so a marker scan alone would hide it. Probed against a
    // placeholder base the '@' lands in the PATH and all four secret-bearing fields are
    // empty, so the value stays visible — which is what the plan-10 SHOW-ME assertions
    // (a package that runs in-process with full Node access belongs in a config triage
    // read) depend on.
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

  it('applies the URL rule to the RENDERED string of a leaf, not only to string inputs', () => {
    // The round-2 WR-07 residue: the strip used to be gated on `typeof value === 'string'`,
    // so a leaf that RENDERS as a URL without being one skipped it entirely. The rule reads
    // the rendered string, so the input's runtime type decides nothing — and the field is
    // `workspace.hooksFile`, which proves the rule is not scoped to URL-shaped field names.
    const urlish = Object.defineProperties({}, {
      toJSON: { value: () => undefined },
      toString: { value: () => `https://leaf.acme.test/p?ticket=${RENDERED_LEAF_SECRET}` },
    })
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
      visibility,
      resolved: { workspace: { hooksFile: urlish }, knowledge: { dir: 'agent-qa-knowledge' } },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    expect(byKey['workspace.hooksFile']).toMatchObject({
      value: 'https://leaf.acme.test/p',
      masked: true,
    })
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
    // No trailing-slash normalisation: a URL carrying no userinfo, query or fragment is not
    // re-rendered at all, so nothing an operator wrote is silently normalised.
    //
    // SHARPENED (round 4): what these three values have in common is not "the parser did not
    // recognise them" — `hooks.yaml` and `agent-qa-knowledge` are not absolute URLs at all —
    // but that they are SECRET-PART-FREE: probed against a placeholder base, each resolves
    // with empty username, password, search and hash. That is why they stay byte-identical,
    // and it is what distinguishes them from a value whose secret-bearing parts the bare
    // parser could not see (`/checkout?lanyard=…`), which now DROPS. Before round 4 this
    // case pinned both classes as "unchanged", which is how the second one rode out.
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

describe('the drop corpus comes from OUTSIDE the render rule\'s precondition (round-4 M-05)', () => {
  // Round 4's finding was not that the corpus was weak — every planted parameter name was
  // measured at 0 in the implementation's bytes — but that it was drawn from INSIDE the
  // rule's precondition: every planted value was an absolute `https://` URL, which is
  // exactly what `new URL(value)` with no base accepts. This block proves the four values
  // above are on the other side of that precondition, and it proves it against Node's own
  // `URL` rather than against any branch of `masked-config.ts`, so it stays true no matter
  // how the fix is written.

  it('makes a bare new URL() throw for the three relative forms', () => {
    for (const value of [PROTOCOL_RELATIVE_URL, HOST_RELATIVE_URL, PATH_RELATIVE_URL]) {
      expect(() => new URL(value), value).toThrow()
    }
  })

  it('parses the opaque-scheme form with an empty host and the credential in the path', () => {
    // The form that defeats the four-field early return: it PARSES, so the catch path never
    // runs, and username/password/search/hash are all empty because an opaque-path URL has
    // no userinfo slot — the credential rides in `pathname`.
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
