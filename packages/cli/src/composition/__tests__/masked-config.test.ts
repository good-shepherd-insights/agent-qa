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

import { buildConfigVisibilityOracle } from '../config-visibility.js'
import {
  buildMaskedResolvedConfig,
  isMaskedConfigPath,
  isSecretConfigKey,
} from '../masked-config.js'

const SECRET = 'sk-live-DO-NOT-LEAK-4242'
/** Planted inside a URL's userinfo, where no key name can mark it as secret. */
const USERINFO_PASSWORD = 'hunter2-DO-NOT-LEAK'

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
      // A SCHEMA-CONSTRAINED field, not an operator-chosen one: it stays visible, and its
      // userinfo is stripped at render instead.
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
    expect(config.entries.find((entry) => entry.key === 'registry.llms.0.baseURL')?.masked)
      .toBe(false)
    for (const entry of config.entries) {
      expect(entry.value).not.toContain(USERINFO_PASSWORD)
      expect(entry.value).not.toContain('ops:')
    }
    expect(JSON.stringify(config)).not.toContain(USERINFO_PASSWORD)
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
    // No trailing-slash normalisation: a value with no userinfo is not re-rendered at all.
    expect(byKey['registry.llms.0.baseURL']).toBe('https://llm.acme.test')
    expect(byKey['knowledge.dir']).toBe('agent-qa-knowledge')
    expect(byKey['workspace.hooksFile']).toBe('hooks.yaml')
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
