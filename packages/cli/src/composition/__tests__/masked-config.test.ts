// The T-384-07 mitigation, asserted directly (Phase 384, Plan 03).
//
// `config.get`'s security claim is masked-AT-CONSTRUCTION: the secret is dropped while the
// entry is built, never carried in the DTO and redacted later. These cases pin that on the
// builder itself, so the claim holds for every surface that ever renders the result — not
// just for the one CLI leg that happens to print it today.

import { CONFIG_MASK_PLACEHOLDER, MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { buildMaskedResolvedConfig, isSecretConfigKey } from '../masked-config.js'

const SECRET = 'sk-live-DO-NOT-LEAK-4242'
/** Planted inside a URL's userinfo, where no key name can mark it as secret. */
const USERINFO_PASSWORD = 'hunter2-DO-NOT-LEAK'

describe('isSecretConfigKey', () => {
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
    // entirely. These are matched by exact segment, outside any opaque subtree.
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
      // A segment mid-path counts too — the leaf never gets to decide alone.
      'deploy.creds.region',
      'plugins.auth.0.package',
    ]) {
      expect(isSecretConfigKey(key), key).toBe(true)
    }
  })

  it('masks the free-form credential subtrees by provenance, whatever the key is called', () => {
    // Two schema-level records exist whose whole purpose is operator-chosen credentials:
    // provider configs and provider headers. Under those, the NAME never decides.
    for (const key of [
      'registry.llms.0.providerHeaders.x-key',
      'registry.llms.0.providerHeaders.x-cred',
      'registry.llms.0.providerHeaders.x-pwd',
      'registry.llms.0.providerHeaders.anything-at-all',
      'registry.providers.acme.key',
      // The intended over-masking: an innocuous-looking leaf under an opaque subtree.
      'registry.providers.acme.baseURL',
      'registry.providers.acme.region',
      'registry.providers.acme',
    ]) {
      expect(isSecretConfigKey(key), key).toBe(true)
    }
  })

  it('leaves ordinary configuration keys alone', () => {
    for (const key of [
      'workspace.testMatch',
      'knowledge.dir',
      'registry.llms.0.model',
      // A SCHEMA-CONSTRAINED field, not an operator-chosen one: it is not under an opaque
      // subtree, so it stays visible. Its userinfo is stripped at render instead.
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

describe('buildMaskedResolvedConfig', () => {
  it('drops secret-shaped values at construction and keeps the rest', () => {
    const config = buildMaskedResolvedConfig({
      configPath: '/workspace/agent-qa.config.yaml',
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
        // Masked by PROVENANCE: it sits under an opaque provider subtree, where the key
        // name never decides. Deliberate over-masking, visibly flagged.
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      },
    ])
    expect(JSON.stringify(config)).not.toContain(SECRET)
  })

  it('strips URL userinfo from values that stay visible', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
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
      resolved: {
        services: { dashboard: { origin: 'https://dashboard.acme.test' } },
        knowledge: { dir: 'agent-qa-knowledge' },
        workspace: { hooksFile: 'hooks.yaml' },
      },
      layers: [],
    })

    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry.value]))
    // No trailing-slash normalisation: a value with no userinfo is not re-rendered at all.
    expect(byKey['services.dashboard.origin']).toBe('https://dashboard.acme.test')
    expect(byKey['knowledge.dir']).toBe('agent-qa-knowledge')
    expect(byKey['workspace.hooksFile']).toBe('hooks.yaml')
  })

  it('renders every value as a string so no value type bypasses masking', () => {
    const config = buildMaskedResolvedConfig({
      configPath: 'agent-qa.config.yaml',
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
      resolved: { b: { z: 1, a: 2 }, a: { m: 3 } },
      layers: [],
    }

    expect(buildMaskedResolvedConfig(input).entries.map((entry) => entry.key))
      .toEqual(['a.m', 'b.a', 'b.z'])
    expect(buildMaskedResolvedConfig(input)).toEqual(buildMaskedResolvedConfig(input))
  })
})
