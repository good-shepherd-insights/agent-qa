import {
  addToolInputExamplesMiddleware,
  createProviderRegistry,
  customProvider,
  extractJsonMiddleware,
} from 'ai'

import type { LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { ModelProfile } from '@vostride/agent-qa-schema'
import {
  createHookRegistry,
  createProviderRequestMiddleware,
} from '@vostride/agent-qa-safety'

import { deriveTransport } from './auth.js'
import type { ResolvedModelAuth } from './auth.js'
import { resolveCapabilities } from './capability/resolve.js'
import { capabilityUpdateMiddleware } from './middleware/capability-update.js'
import { deriveExamplesMiddleware } from './middleware/examples.js'
import { extractJsonStrategy } from './middleware/extract-json.js'
import { repairMiddleware } from './middleware/repair.js'
import { retryMiddleware } from './middleware/retry.js'
import { toolSchemaMiddleware } from './middleware.js'
import { getProvider, listProviders } from './providers/registry.js'
import { validateProfile } from './validate.js'

// D-06 order: retry is outermost on response/errors; repair sees text after SDK
// extraction; request transforms normalize schema, derive examples, serialize, then
// the safety egress seam sees fully transformed params closest to the provider wire.
const MIDDLEWARE: LanguageModelMiddleware[] = [
  retryMiddleware(),
  repairMiddleware(),
  extractJsonMiddleware({ transform: extractJsonStrategy }),
  toolSchemaMiddleware,
  deriveExamplesMiddleware(),
  addToolInputExamplesMiddleware(),
  createProviderRequestMiddleware(createHookRegistry()),
]

export interface ModelProviderOverrides {
  languageModels?: Record<string, LanguageModelV3>
}

export function createModel(
  profile: ModelProfile,
  auth: ResolvedModelAuth,
  overrides: ModelProviderOverrides = {},
): LanguageModelV3 {
  validateProfile(profile)

  profile.capabilities ??= resolveCapabilities(profile)

  const transport = deriveTransport(profile, auth)
  const descriptor = getProvider(profile.provider as string)
  if (!descriptor) {
    throw new Error(
      `Unknown provider "${profile.provider}". Supported: ${listProviders().map(provider => provider.id).join(', ')}.`,
    )
  }

  const baseProvider = toProviderV3((modelId) => descriptor.adapter(transport, modelId))
  const provider: ProviderV3 = customProvider({
    languageModels: overrides.languageModels ?? {},
    fallbackProvider: baseProvider,
  })
  const middleware = [capabilityUpdateMiddleware(profile), ...MIDDLEWARE]
  const registry = createProviderRegistry(
    { [profile.provider]: provider },
    { languageModelMiddleware: middleware },
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
