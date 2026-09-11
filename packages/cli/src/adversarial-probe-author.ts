import { generateText } from 'ai'
import type { RunExecutionContext, RunMaskingContext } from '@vostride/agent-qa-agent-local'
import {
  createModel, JsonlAuditSink, runSafetyScope, renderAdversarialProbePrompt,
  type GenerationRequest, type ProbeAuthorPort, type ProbeGeneratorKind, type ProbeText,
} from './eval-session-composition.js'
import type { AdversarialProbeAuthorSelection } from './adversarial-probe-preflight.js'

export const PROBE_AUTHOR_MAX_OUTPUT_TOKENS = 200
export const PROBE_AUTHOR_TIMEOUT_MS = 20_000

export interface ProbeCallAttempt {
  seedCassetteId: string
  kind: ProbeGeneratorKind
  promptVersion: number
  authoringModelId: string
}

export interface AdversarialProbeAuthorInput {
  author: AdversarialProbeAuthorSelection
  executionContext: RunExecutionContext
  maskingContextFactory: () => RunMaskingContext
  auditDir: string
  onCallAttempted?: (attempt: ProbeCallAttempt) => void | Promise<void>
  createModelImpl?: typeof createModel
  generateTextImpl?: typeof generateText
}

export function createAdversarialProbeAuthor(
  _input: AdversarialProbeAuthorInput,
): ProbeAuthorPort {
  return {
    async author(_request: GenerationRequest): Promise<ProbeText> {
      return { text: '', usage: { promptTokens: 0, completionTokens: 0 } }
    },
  }
}

// The skeleton keeps the real collaborators referenced so the RED run fails on the named
// behaviour rather than on an unused-import type error.
export const PROBE_AUTHOR_COLLABORATORS = {
  createModel, JsonlAuditSink, runSafetyScope, renderAdversarialProbePrompt, generateText,
} as const
