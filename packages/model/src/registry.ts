import { createProviderRegistry, customProvider } from 'ai'

import type { LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { ModelProfile } from '@vostride/agent-qa-schema'

import { ADAPTERS } from './adapters/index.js'
import type { AdapterBody } from './adapters/index.js'
import { deriveTransport } from './auth.js'
import type { ResolvedModelAuth } from './auth.js'
import { toolSchemaMiddleware } from './middleware.js'
import { validateProfile } from './validate.js'

const MIDDLEWARE: LanguageModelMiddleware[] = [toolSchemaMiddleware]
const SUPPORTED_PROVIDERS = Object.keys(ADAPTERS)

export interface ModelProviderOverrides {
  languageModels?: Record<string, LanguageModelV3>
}

export function createModel(
  profile: ModelProfile,
  auth: ResolvedModelAuth,
  overrides: ModelProviderOverrides = {},
): LanguageModelV3 {
  validateProfile(profile)

  const transport = deriveTransport(profile, auth)
  const build = ADAPTERS[profile.provider as keyof typeof ADAPTERS] as AdapterBody | undefined
  if (!build) {
    throw new Error(
      `Unknown provider "${profile.provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}.`,
    )
  }

  const baseProvider = toProviderV3((modelId) => build(transport, modelId))
  const provider: ProviderV3 = customProvider({
    languageModels: overrides.languageModels ?? {},
    fallbackProvider: baseProvider,
  })
  const registry = createProviderRegistry(
    { [profile.provider]: provider },
    { languageModelMiddleware: MIDDLEWARE },
  )

  return registry.languageModel(`${profile.provider}:${profile.model}`)
}

function toProviderV3(build: (modelId: string) => LanguageModelV3): ProviderV3 {
  return {
    specificationVersion: 'v3',
    languageModel: build,
    embeddingModel(modelId) {
      throw new Error(`No embedding model for provider model "${modelId}"`)
    },
    imageModel(modelId) {
      throw new Error(`No image model for provider model "${modelId}"`)
    },
  }
}
