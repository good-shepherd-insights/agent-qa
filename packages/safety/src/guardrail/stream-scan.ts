import type { GuardrailDetectorFamily, GuardrailPolicy, ScanAction } from '@vostride/agent-qa-schema'
import type { LanguageModelMiddleware } from 'ai'

import type { AuditSink } from '../ports/audit-sink'
import { DETECTOR_PRECEDENCE, findDetectorMatches, type GuardrailMatch } from './detectors'
import { scan } from './scan'

type WrapStream = NonNullable<LanguageModelMiddleware['wrapStream']>
type DoStream = Parameters<WrapStream>[0]['doStream']
type StreamResult = Awaited<ReturnType<DoStream>>
export type LanguageModelV3StreamPart = StreamResult['stream'] extends ReadableStream<infer Part>
  ? Part
  : never

type StreamDeltaPart = Extract<
  LanguageModelV3StreamPart,
  { type: 'text-delta' | 'reasoning-delta' }
>
type FiringAction = Exclude<ScanAction, 'pass'>
type DetectorAction = GuardrailPolicy['detectors'][GuardrailDetectorFamily]

interface ActiveStreamMatch extends GuardrailMatch {
  action: FiringAction
}

export type GuardrailStreamScanFactory = () => TransformStream<
  LanguageModelV3StreamPart,
  LanguageModelV3StreamPart
>

// 128 exceeds the longest fixed-width detector token (40-char API/base64, AWS ID,
// card candidate, PEM marker). Variable-length bearer/API matches are also guarded
// by refusing to cut through any active match in the pending buffer.
export const GUARDRAIL_STREAM_SCAN_HOLDBACK = 128

function isFiringAction(action: DetectorAction): action is FiringAction {
  return action === 'block' || action === 'redact'
}

function isScannableDelta(part: LanguageModelV3StreamPart): part is StreamDeltaPart {
  return part.type === 'text-delta' || part.type === 'reasoning-delta'
}

function isAllowlisted(match: GuardrailMatch, policy: GuardrailPolicy): boolean {
  return policy.allowlist.includes(match.value)
}

function activeMatches(text: string, policy: GuardrailPolicy): ActiveStreamMatch[] {
  return DETECTOR_PRECEDENCE.flatMap((detector) => {
    const action = policy.detectors[detector]
    if (!isFiringAction(action)) return []

    return findDetectorMatches(detector, text)
      .filter((match) => !isAllowlisted(match, policy))
      .map((match) => ({ ...match, action }))
  })
}

function redactionToken(detector: GuardrailDetectorFamily): string {
  return `<REDACTED:${detector}>`
}

function redactAllFiringMatches(text: string, policy: GuardrailPolicy): string {
  const matches = activeMatches(text, policy).sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )

  if (matches.length === 0) return text

  let output = ''
  let cursor = 0

  for (const match of matches) {
    if (match.start < cursor) continue

    output += text.slice(cursor, match.start)
    output += redactionToken(match.kind)
    cursor = match.end
  }

  output += text.slice(cursor)
  return output
}

export function safeCutIndex(text: string, holdback = GUARDRAIL_STREAM_SCAN_HOLDBACK): number {
  if (text.length <= holdback) return 0

  const holdbackCut = text.length - holdback
  const newlineCut = text.lastIndexOf('\n', holdbackCut)
  if (newlineCut >= 0) return newlineCut + 1

  return holdbackCut
}

function cutBeforeOpenMatch(text: string, policy: GuardrailPolicy, cut: number): number {
  let safeCut = cut

  for (const match of activeMatches(text, policy)) {
    if (match.start < safeCut && match.end > safeCut) {
      safeCut = Math.min(safeCut, match.start)
    }
  }

  return safeCut
}

async function scanStreamChunk(
  chunk: string,
  policy: GuardrailPolicy,
  auditSink: AuditSink | undefined,
): Promise<string> {
  const output = scan(chunk, policy)

  for (const fired of output.fired) {
    await auditSink?.appendGuardrailAudit({
      channel: 'stream',
      action: fired.action,
      detector: fired.detector,
      redactedFingerprint: fired.redactedFingerprint,
    })
  }

  if (output.result.action === 'pass') return chunk

  return redactAllFiringMatches(chunk, policy)
}

export function createGuardrailStreamScan(
  policy: GuardrailPolicy,
  auditSink?: AuditSink,
): GuardrailStreamScanFactory {
  return () => {
    let pending = ''
    let pendingPart: StreamDeltaPart | undefined

    async function flushPending(
      controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
    ): Promise<void> {
      if (!pending || !pendingPart) return

      const delta = await scanStreamChunk(pending, policy, auditSink)
      pending = ''

      if (delta.length > 0) {
        controller.enqueue({ ...pendingPart, delta })
      }
    }

    async function emitSafePrefix(
      controller: TransformStreamDefaultController<LanguageModelV3StreamPart>,
    ): Promise<void> {
      if (!pending || !pendingPart) return

      const cut = cutBeforeOpenMatch(pending, policy, safeCutIndex(pending))
      if (cut <= 0) return

      const chunk = pending.slice(0, cut)
      pending = pending.slice(cut)

      const delta = await scanStreamChunk(chunk, policy, auditSink)
      if (delta.length > 0) {
        controller.enqueue({ ...pendingPart, delta })
      }
    }

    return new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
      async transform(part, controller) {
        if (!isScannableDelta(part)) {
          await flushPending(controller)
          controller.enqueue(part)
          return
        }

        if (pendingPart && (pendingPart.type !== part.type || pendingPart.id !== part.id)) {
          await flushPending(controller)
        }

        pendingPart = part
        pending += part.delta
        await emitSafePrefix(controller)
      },
      async flush(controller) {
        await flushPending(controller)
      },
    })
  }
}
