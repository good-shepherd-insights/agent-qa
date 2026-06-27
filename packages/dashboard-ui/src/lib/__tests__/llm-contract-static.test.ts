import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import type { LLMProviderMetadata } from '../api'

vi.mock('monaco-editor', () => ({
  languages: {
    CompletionItemKind: {
      Module: 0,
      Value: 1,
      Property: 2,
      Enum: 3,
      EnumMember: 4,
    },
    CompletionItemInsertTextRule: {
      None: 0,
    },
    registerCompletionItemProvider: vi.fn(),
  },
}))

import { LLM_PROVIDER_COMPLETION_VALUES } from '../yaml-completions'

const EXPECTED_PROVIDER_MODES = [
  'openai-compatible',
  'anthropic-compatible',
  'openai-subscription',
  'anthropic-subscription',
  'gemini',
] as const

const completionSource = readFileSync(new URL('../yaml-completions.ts', import.meta.url), 'utf-8')
const llmSectionSource = readFileSync(new URL('../../components/config-manager/llm-section.tsx', import.meta.url), 'utf-8')

describe('LLM provider static contract', () => {
  it('yaml completions expose exactly five provider modes', () => {
    expect([...LLM_PROVIDER_COMPLETION_VALUES]).toEqual([...EXPECTED_PROVIDER_MODES])
  })

  it('yaml completions do not expose authMethod or inline apiKey', () => {
    expect(completionSource).not.toMatch(/\bauthMethod\b/)
    expect(completionSource).not.toMatch(/\bapiKey\b/)
  })

  it('accepts descriptor metadata fields from the provider endpoint', () => {
    const provider: LLMProviderMetadata = {
      id: 'plugin-compatible',
      label: 'Plugin compatible',
      auth: { kind: 'api-key', credentialTypes: ['api-key', 'bearer-token'], optional: true },
      modelAdapter: 'openai-responses',
      needsBaseURL: true,
      authModes: ['api-key', 'bearer-token'],
      subscription: false,
      baseURLPlaceholder: 'https://plugin.example/v1',
      defaultModel: 'plugin-model',
    }

    expect(provider.needsBaseURL).toBe(true)
    expect(provider.authModes).toEqual(['api-key', 'bearer-token'])
    expect(provider.baseURLPlaceholder).toBe('https://plugin.example/v1')
  })

  it('config UI branches on provider metadata instead of a compatible-provider literal set', () => {
    const modelPackageImport = '@vostride/' + 'agent-qa-model'

    expect(llmSectionSource).not.toMatch(/COMPATIBLE_PROVIDERS\s*=\s*new Set/)
    expect(llmSectionSource).toContain('providerInfo?.needsBaseURL === true')
    expect(llmSectionSource).toContain('providerInfo?.baseURLPlaceholder ??')
    expect(llmSectionSource).not.toContain(modelPackageImport)
  })

  it('offline fallback marks compatible providers with baseURL metadata', () => {
    expect(llmSectionSource).toMatch(/id:\s*"openai-compatible"[\s\S]*needsBaseURL:\s*true[\s\S]*baseURLPlaceholder:\s*"https:\/\/openrouter\.ai\/api\/v1"/)
    expect(llmSectionSource).toMatch(/id:\s*"anthropic-compatible"[\s\S]*needsBaseURL:\s*true[\s\S]*baseURLPlaceholder:\s*"https:\/\/anthropic-proxy\.example\/messages"/)
  })
})
