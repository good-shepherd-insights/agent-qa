import { dirname, resolve } from 'node:path'
import { readLabelCalibration } from '../eval-session-composition.js'
import type { TrustPriorTable } from '@vostride/agent-qa-schema'

export type ResolveTrustPriors = () => TrustPriorTable | undefined
export interface TrustPriorDisclosure {
  readonly status: 'provisional' | 'calibrated'
  readonly digest?: string
  readonly nByOrigin: Readonly<Record<'agent-verified' | 'agent-observed', number>>
}
const REFUSAL = 'Trust prior calibration is invalid or unavailable; repair the committed calibration before composing this host.'
export type TrustPriorsResolution =
  | { readonly kind: 'ready'; readonly resolve: ResolveTrustPriors; readonly disclosure: TrustPriorDisclosure }
  | { readonly kind: 'refused'; readonly reason: typeof REFUSAL }

/** Read and validate once. No producer, revision or correction data leaves this boundary. */
export function buildTrustPriorsResolver(input: { configPath: string }): TrustPriorsResolution {
  const read = readLabelCalibration(resolve(dirname(resolve(input.configPath)), 'agent-qa-eval'))
  if (read.kind === 'refused') return Object.freeze({ kind: 'refused', reason: REFUSAL })
  const table: Partial<Record<'agent-verified' | 'agent-observed', { alpha: number; beta: number }>> = {}
  const nByOrigin = { 'agent-verified': 0, 'agent-observed': 0 }
  if (read.kind === 'loaded') {
    for (const [origin, channel] of [['agent-verified', 'recorded-verdict'], ['agent-observed', 'self-heal-pair']] as const) {
      nByOrigin[origin] = read.artifact.channels[channel].n
      const prior = read.artifact.priors[origin]
      if (prior !== undefined) table[origin] = Object.freeze({ alpha: prior.alpha, beta: prior.beta })
    }
  }
  const priors = Object.keys(table).length === 0 ? undefined : Object.freeze(table)
  const disclosure: TrustPriorDisclosure = Object.freeze({
    status: priors === undefined ? 'provisional' : 'calibrated',
    ...(read.kind === 'loaded' ? { digest: read.artifact.generationId } : {}),
    nByOrigin: Object.freeze(nByOrigin),
  })
  return Object.freeze({ kind: 'ready', resolve: () => priors, disclosure })
}

export class TrustPriorsRefusedError extends Error {
  readonly kind = 'trust-priors-refused'
  constructor() { super(REFUSAL); this.name = 'TrustPriorsRefusedError' }
}

/** Composing hosts fail explicitly; malformed persisted data never becomes provisional. */
export function trustPriorsForHost(input: { configPath: string }): Extract<TrustPriorsResolution, { kind: 'ready' }> {
  const result = buildTrustPriorsResolver(input)
  if (result.kind === 'refused') throw new TrustPriorsRefusedError()
  return result
}
