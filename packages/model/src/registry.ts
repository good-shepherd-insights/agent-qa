import {
  addToolInputExamplesMiddleware,
  createProviderRegistry,
  customProvider,
  extractJsonMiddleware,
  wrapProvider,
} from 'ai'

import type { LanguageModelMiddleware } from 'ai'
import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider'
import type { ModelProfile } from '@vostride/agent-qa-schema'
import { registerFirstPartySafetyHooks } from '@vostride/agent-qa-safety'

import { deriveTransport } from './auth.js'
import type { ResolvedModelAuth } from './auth.js'
import { resolveCapabilities } from './capability/resolve.js'
import { capabilityUpdateMiddleware } from './middleware/capability-update.js'
import { debugLoggingMiddleware } from './middleware/debug-logging.js'
import { dropEmptyMessagesMiddleware } from './middleware/drop-empty-messages.js'
import { deriveExamplesMiddleware } from './middleware/examples.js'
import { extractJsonStrategy } from './middleware/extract-json.js'
import { repairMiddleware } from './middleware/repair.js'
import { retryMiddleware } from './middleware/retry.js'
import { stripUnsupportedParamsMiddleware } from './middleware/strip-unsupported-params.js'
import { toolSchemaMiddleware } from './middleware.js'
import { getProvider, listProviders } from './providers/registry.js'
import { validateProfile } from './validate.js'
import { openaiCompatible, openaiSubscription } from './adapters/openai.js'
import { anthropicCompatible, anthropicSubscription } from './adapters/anthropic.js'
import { gemini } from './adapters/gemini.js'
import { providerCallReport } from './provider-call-report.js'
import type { ModelCallEvent, ModelCallObservation, ModelCallReportOrigin } from './provider-call-report.js'
export type { ModelCallObservation } from './provider-call-report.js'

// D-06 order: retry is outermost on response/errors; repair sees text after SDK
// extraction; request transforms normalize schema, derive examples, serialize, then
// the safety egress seam sees fully transformed params closest to the provider wire.
// The safety entry is registrar-derived (D-01: the first-party registrar is the
// single composition point — model consumes it, never composes it). It MUST stay the
// last element of MIDDLEWARE so the mask+guardrail seam remains innermost/closest to
// the provider wire; this pinned-last placement is structurally enforced by
// validate:safety (plan 350-05's SAFE-03(a)).
const MIDDLEWARE: LanguageModelMiddleware[] = [
  retryMiddleware(),
  repairMiddleware(),
  extractJsonMiddleware({ transform: extractJsonStrategy }),
  toolSchemaMiddleware,
  deriveExamplesMiddleware(),
  addToolInputExamplesMiddleware(),
  // RUNX-04: flag-gated request/response debug logging (env AGENT_QA_DEBUG_LLM). Sits near the
  // wire so it observes the fully-transformed request shape and catches the provider's raw
  // APICallError first (statusCode/responseBody), then re-throws unchanged. Passthrough when the
  // flag is off. Immediately before dropEmpty + the pinned-last safety seam.
  debugLoggingMiddleware(),
  // RUNX-01 defense-in-depth: strip empty-content messages just before the wire. Sits
  // immediately BEFORE the pinned-last safety seam (which must stay the final element,
  // structurally enforced by validate:safety).
  dropEmptyMessagesMiddleware(),
  registerFirstPartySafetyHooks().middleware,
]

export interface ModelProviderOverrides {
  languageModels?: Record<string, LanguageModelV3>
  /** Trusted custom/override adapter assertion; omitted means no cache/model authority. */
  providerReportOrigin?: ModelCallReportOrigin
}

export function createModel(
  profile: ModelProfile,
  auth: ResolvedModelAuth,
  overrides: ModelProviderOverrides = {},
  observation: ModelCallObservation = {},
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
  // Wrap BOTH explicit overrides and adapter fallbacks before the central middleware stack.
  // A retry reaches this boundary again; a safety refusal never does. The SDK calls the raw
  // model's methods with their receiver intact and leaves streaming results untouched.
  const onProviderCall = observation.onProviderCall
  const onCall = observation.onCall
  const origin = overrides.providerReportOrigin ?? (
    overrides.languageModels?.[profile.model] ? undefined
      : descriptor.adapter === openaiCompatible ? 'openai-chat'
      : descriptor.adapter === openaiSubscription ? 'openai-responses'
      : descriptor.adapter === anthropicCompatible || descriptor.adapter === anthropicSubscription
        ? 'anthropic-messages'
      : descriptor.adapter === gemini ? 'gemini' : undefined
  )
  const observe = (event: ModelCallEvent) => {
    try {
      onCall?.(event)
    } catch {
      // Observation cannot prevent a call or replace its original result/error.
    }
  }
  const start = () => {
    try { onProviderCall?.() } catch { /* Legacy observation is isolated independently. */ }
    observe({ kind: 'start' })
  }
  const observedProvider = onProviderCall === undefined && onCall === undefined ? provider : wrapProvider({
    provider,
    languageModelMiddleware: {
      specificationVersion: 'v3',
      wrapGenerate: async ({ doGenerate }) => {
        start()
        try {
          const result = await doGenerate()
          // Reporting, including the live masker, cannot replace a provider outcome.
          try { observe({ kind: 'success', report: providerCallReport(result, origin) }) }
          catch { observe({ kind: 'success', report: {} }) }
          return result
        } catch (error) {
          observe({ kind: 'failure' })
          throw error
        }
      },
      wrapStream: ({ doStream }) => {
        start()
        return doStream()
      },
    },
  })
  // The provider-scoped strip is prepended into the per-model array (never appended to
  // MIDDLEWARE) so the safety seam stays the pinned-LAST element (validate:safety).
  const middleware = [
    capabilityUpdateMiddleware(profile),
    ...(descriptor.unsupportedParams?.length
      ? [stripUnsupportedParamsMiddleware(descriptor.unsupportedParams)]
      : []),
    ...MIDDLEWARE,
  ]
  const registry = createProviderRegistry(
    { [profile.provider]: observedProvider },
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
