import type { GuardrailDetectorFamily, GuardrailPolicy } from '@vostride/agent-qa-schema'
import { scan } from '@vostride/agent-qa-safety'

export const EMBED_GATE_REDACTION_PLACEHOLDER = '<REDACTED:secret>'

const SECRET_DETECTOR_FAMILIES = [
  'awsKey',
  'creditCard',
  'pemKey',
  'bearer',
  'apiKey',
] as const satisfies readonly GuardrailDetectorFamily[]

export type EmbedGateDetection = ReturnType<typeof scan>['fired'][number]

export interface EmbedGateVerdict {
  suppressDense: boolean
  redactedLexicalInput: string
  detections: EmbedGateDetection[]
}

export interface AssessEmbeddingInput {
  renderedEmbeddingInput: string
  llmAuthoredFields: readonly string[]
  secretFlaggedAtEmit: boolean
  policy: GuardrailPolicy
}

function isSecretFamily(detector: GuardrailDetectorFamily): boolean {
  return SECRET_DETECTOR_FAMILIES.some((family) => family === detector)
}

function redactWhenEnabled(
  action: GuardrailPolicy['detectors'][GuardrailDetectorFamily],
): 'redact' | 'off' {
  return action === 'off' ? 'off' : 'redact'
}

function lexicalRedactionPolicy(policy: GuardrailPolicy): GuardrailPolicy {
  return {
    ...policy,
    detectors: {
      ...policy.detectors,
      awsKey: redactWhenEnabled(policy.detectors.awsKey),
      creditCard: redactWhenEnabled(policy.detectors.creditCard),
      pemKey: redactWhenEnabled(policy.detectors.pemKey),
      bearer: redactWhenEnabled(policy.detectors.bearer),
      apiKey: redactWhenEnabled(policy.detectors.apiKey),
    },
  }
}

function normalizeSecretRedactions(text: string): string {
  let redacted = text
  for (const detector of SECRET_DETECTOR_FAMILIES) {
    redacted = redacted
      .split(`<REDACTED:${detector}>`)
      .join(EMBED_GATE_REDACTION_PLACEHOLDER)
  }
  return redacted
}

/**
 * Applies SAFE-02 to the exact persisted embedding rendering and every LLM-authored field.
 * Detector matching stays exclusively in the governed safety package; injectionShape remains a
 * reported SAFE-03 routing signal and never enters the dense-suppression decision by itself.
 */
export function assessEmbeddingInput(input: AssessEmbeddingInput): EmbedGateVerdict {
  const scans = [input.renderedEmbeddingInput, ...input.llmAuthoredFields]
    .map((text) => scan(text, input.policy))
  const detections = scans.flatMap(({ fired }) => fired)
  const secretDetected = detections.some(({ detector }) => isSecretFamily(detector))
  const lexicalScan = scan(
    input.renderedEmbeddingInput,
    lexicalRedactionPolicy(input.policy),
  )

  return {
    suppressDense: input.secretFlaggedAtEmit || secretDetected,
    redactedLexicalInput: normalizeSecretRedactions(lexicalScan.redactedText),
    detections,
  }
}
