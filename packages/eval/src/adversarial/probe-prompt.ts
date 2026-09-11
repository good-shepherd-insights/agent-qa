/**
 * 422 D-11/D-12: the FROZEN probe prompt.
 *
 * SKELETON (422-04-T1 RED). The vocabulary and the hash pin are declared so the probe cells
 * can load; the constitution text itself lands in GREEN.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import { PROBE_GENERATOR_KINDS, type ProbeGeneratorKind } from '../labels/corpus-entry'

/** Version of the PROMPT (not of any document). A wording change bumps this (D-11). */
export const ADVERSARIAL_PROMPT_VERSION = 1

export interface ProbeKindPrompt {
  readonly goal: string
  readonly constraints: readonly string[]
}

export const ADVERSARIAL_PROBE_PROMPT = Object.freeze({
  systemTier: 'skeleton',
  frameBegin: 'skeleton',
  frameEnd: 'skeleton',
  goldRetention: 'skeleton',
  kinds: Object.freeze({
    'judge-targeted': Object.freeze({ goal: 'skeleton', constraints: Object.freeze([]) }),
    'optimized-trigger': Object.freeze({ goal: 'skeleton', constraints: Object.freeze([]) }),
  } as Readonly<Record<ProbeGeneratorKind, ProbeKindPrompt>>),
})

/** Recompute the live prompt hash over the declared kind order (the tables.ts idiom). */
export function computeAdversarialPromptHash(): string {
  return sha256hex(
    canonicalJson({
      version: ADVERSARIAL_PROMPT_VERSION,
      systemTier: ADVERSARIAL_PROBE_PROMPT.systemTier,
      frameBegin: ADVERSARIAL_PROBE_PROMPT.frameBegin,
      frameEnd: ADVERSARIAL_PROBE_PROMPT.frameEnd,
      goldRetention: ADVERSARIAL_PROBE_PROMPT.goldRetention,
      kinds: PROBE_GENERATOR_KINDS.map(kind => ({
        kind,
        ...ADVERSARIAL_PROBE_PROMPT.kinds[kind],
      })),
    }),
  )
}

/** Historical pins, one per SHIPPED prompt version. Entries are only ever ADDED (D-11). */
export const ADVERSARIAL_PROMPT_HASHES: Readonly<Record<number, string>> = Object.freeze({
  1: computeAdversarialPromptHash(),
})

/** The hash of the prompt version this build authors under. */
export const ADVERSARIAL_PROMPT_HASH: string = computeAdversarialPromptHash()

/** The structural slice of a `GenerationRequest` the renderer reads. */
export interface ProbePromptInput {
  kind: ProbeGeneratorKind
  surface: { role: string; name: string; siblingNames: readonly string[] }
  goldAnchor: { role: string; nameNormalized: string; ordinal: number }
}

export interface ProbePrompt {
  system: string
  user: string
}

/** Render the frozen prompt for one request. Pure and total. */
export function renderAdversarialProbePrompt(_input: ProbePromptInput): ProbePrompt {
  return { system: 'skeleton', user: 'skeleton' }
}
