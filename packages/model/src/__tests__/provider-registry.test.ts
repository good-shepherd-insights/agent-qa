import { beforeEach, describe, expect, it } from 'vitest'

import type { ProviderAuthMode, ProviderDescriptor } from '../providers/registry.js'

import { stubModel } from './stub-model.js'
import {
  clearProviderRegistry,
  getProvider,
  listProviders,
  registerProvider,
} from '../providers/registry.js'

const BUILTIN_IDS = [
  'openai-compatible',
  'anthropic-compatible',
  'openai-subscription',
  'anthropic-subscription',
  'gemini',
]

function pluginDescriptor(overrides: Partial<ProviderDescriptor> = {}): ProviderDescriptor {
  return {
    id: 'plugin-provider',
    label: 'Plugin provider',
    adapter: (_transport, modelId) => stubModel({ provider: 'plugin-provider', modelId }),
    needsBaseURL: true,
    authModes: ['api-key'],
    defaultModel: 'plugin-model',
    ...overrides,
  }
}

describe('provider registry', () => {
  beforeEach(() => {
    clearProviderRegistry()
  })

  it('lists the built-in provider descriptors in seed order', () => {
    const providers = listProviders()

    expect(providers.map(provider => provider.id)).toEqual(BUILTIN_IDS)
    expect(providers).toHaveLength(5)

    for (const provider of providers) {
      expect(provider.label).toEqual(expect.any(String))
      expect(provider.adapter).toEqual(expect.any(Function))
      expect(provider.needsBaseURL).toEqual(expect.any(Boolean))
      expect(provider.authModes.length).toBeGreaterThan(0)
      expect(provider.defaultModel).toEqual(expect.any(String))
    }

    expect(getProvider('openai-compatible')).toMatchObject({
      needsBaseURL: true,
      credentialOptional: true,
      baseURLPlaceholder: 'https://openrouter.ai/api/v1',
    })
    expect(getProvider('anthropic-compatible')).toMatchObject({
      needsBaseURL: true,
      credentialOptional: true,
      baseURLPlaceholder: 'https://anthropic-proxy.example/messages',
    })
    expect(getProvider('openai-subscription')).toMatchObject({ subscription: true })
    expect(getProvider('anthropic-subscription')).toMatchObject({ subscription: true })
  })

  it('registers a new provider id and preserves built-ins', () => {
    const descriptor = pluginDescriptor()

    registerProvider(descriptor)

    expect(getProvider('plugin-provider')).toBe(descriptor)
    expect(listProviders().map(provider => provider.id)).toEqual([...BUILTIN_IDS, 'plugin-provider'])
  })

  it('overwrites an existing provider id with last-writer-wins semantics', () => {
    const descriptor = pluginDescriptor({
      id: 'gemini',
      label: 'Gemini override',
      needsBaseURL: true,
      authModes: ['bearer-token'],
    })

    expect(() => registerProvider(descriptor)).not.toThrow()

    expect(getProvider('gemini')).toBe(descriptor)
    expect(getProvider('gemini')?.label).toBe('Gemini override')
    expect(listProviders().map(provider => provider.id)).toEqual(BUILTIN_IDS)
  })

  it('clears plugin registrations and re-seeds the built-ins', () => {
    registerProvider(pluginDescriptor())

    clearProviderRegistry()

    expect(getProvider('plugin-provider')).toBeUndefined()
    expect(listProviders().map(provider => provider.id)).toEqual(BUILTIN_IDS)
  })

  it('rejects descriptors missing required fields', () => {
    const invalidAuthModes = undefined as unknown as ProviderAuthMode[]

    expect(() => registerProvider(pluginDescriptor({ id: undefined as unknown as string })))
      .toThrow(/id is required/)
    expect(() => registerProvider(pluginDescriptor({ label: undefined as unknown as string })))
      .toThrow(/label is required/)
    expect(() => registerProvider(pluginDescriptor({ adapter: undefined as unknown as ProviderDescriptor['adapter'] })))
      .toThrow(/adapter is required/)
    expect(() => registerProvider(pluginDescriptor({ authModes: invalidAuthModes })))
      .toThrow(/authModes must be a non-empty array/)
    expect(() => registerProvider(pluginDescriptor({ authModes: [] })))
      .toThrow(/authModes must be a non-empty array/)
  })
})
