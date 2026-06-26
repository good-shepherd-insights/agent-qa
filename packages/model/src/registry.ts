import {
  addToolInputExamplesMiddleware,
  createProviderRegistry,
  customProvider,
  extractJsonMiddleware,
} from 'ai'

import type { LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { ModelProfile } from '@vostride/agent-qa-schema'

import { ADAPTERS } from './adapters/index.js'
import type { AdapterBody } from './adapters/index.js'
import { deriveTransport } from './auth.js'
import type { ResolvedModelAuth } from './auth.js'
import { deriveExamplesMiddleware } from './middleware/examples.js'
import { extractJsonStrategy } from './middleware/extract-json.js'
import { repairMiddleware } from './middleware/repair.js'
import { retryMiddleware } from './middleware/retry.js'
import { toolSchemaMiddleware } from './middleware.js'
import { validateProfile } from './validate.js'

// D-06 order: retry is outermost on response/errors; repair sees text after SDK
// extraction; request transforms normalize schema, derive examples, then serialize.
const MIDDLEWARE: LanguageModelMiddleware[] = [
  retryMiddleware(),
  repairMiddleware(),
  extractJsonMiddleware({ transform: extractJsonStrategy }),
  toolSchemaMiddleware,
  deriveExamplesMiddleware(),
  addToolInputExamplesMiddleware(),
]
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
