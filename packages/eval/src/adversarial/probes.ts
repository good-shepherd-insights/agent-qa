/**
 * 422 D-09/D-10/D-11/D-12: the PURE probe half — the request, and the cassette derived from
 * one authored response.
 *
 * SKELETON (422-04-T1 RED). Every contract below is declared so the probe cells can load and
 * state what they expect; the two behaviours the cells name are stubbed and land in GREEN.
 */
import { sha256hex } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { LeafCassette } from '../cassette/cassette'
import type { GoldAnchorDescriptor } from '../cassette/sidecar-leg'
import type { StandaloneLabelRecord } from '../labels/label-record'
import type {
  AdversarialCorpusEntry,
  AuthoringModel,
  CorpusGenerator,
  ProbeGeneratorKind,
} from '../labels/corpus-entry'
import type { AdversarialSeed } from './generate'

/** Longest accessible name a probe may author (recorded default; see GREEN for rationale). */
export const PROBE_MAX_TEXT_LENGTH = 200

/** Recorded token usage for one authored probe. */
export interface ProbeUsage {
  promptTokens: number
  completionTokens: number
}

/** The captured application strings a probe rewrites — untrusted data, never instructions. */
export interface ProbeSurface {
  /** The gold target's recorded accessibility role. */
  role: string
  /** The gold target's recorded accessible name, verbatim. */
  name: string
  /** Recorded names of the other controls on the same screen, in recorded order. */
  siblingNames: readonly string[]
}

/** The pure DTO handed to a `ProbeAuthorPort`. Reproducible from its inputs alone (D-10). */
export interface GenerationRequest {
  seedCassetteId: string
  kind: ProbeGeneratorKind
  promptVersion: number
  promptHash: string
  authoringModel: AuthoringModel
  surface: ProbeSurface
  goldAnchor: GoldAnchorDescriptor
}

/** What an author returns: the replacement name plus its recorded spend. */
export interface ProbeText {
  text: string
  usage: ProbeUsage
}

/** The one seam a model reaches this package through (D-10). No model construction here. */
export interface ProbeAuthorPort {
  author(request: GenerationRequest): Promise<ProbeText>
}

/** Why a seed yields no probe REQUEST at all. */
export type ProbeInapplicability =
  | 'not-natural'
  | 'brief-not-proof-backed'
  | 'gold-anchor-absent'
  | 'gold-anchor-unresolved'
  | 'seed-label-absent'
  | 'target-name-empty'
  | 'authoring-model-unidentified'

/** Declaration-order projection of `ProbeInapplicability` (D-22). */
export const PROBE_INAPPLICABILITIES = [
  'not-natural',
  'brief-not-proof-backed',
  'gold-anchor-absent',
  'gold-anchor-unresolved',
  'seed-label-absent',
  'target-name-empty',
  'authoring-model-unidentified',
] as const satisfies readonly ProbeInapplicability[]

/** Why an authored RESPONSE yields no probe cassette. */
export type ProbeRefusal =
  | 'seed-request-mismatch'
  | 'request-prompt-stale'
  | 'probe-text-empty'
  | 'probe-text-too-long'
  | 'probe-text-not-a-name'
  | 'probe-usage-invalid'
  | 'probe-identity-unchanged'

/** Declaration-order projection of `ProbeRefusal` (D-22). */
export const PROBE_REFUSALS = [
  'seed-request-mismatch',
  'request-prompt-stale',
  'probe-text-empty',
  'probe-text-too-long',
  'probe-text-not-a-name',
  'probe-usage-invalid',
  'probe-identity-unchanged',
] as const satisfies readonly ProbeRefusal[]

/** One derived probe: the three documents plus the provenance that explains them. */
export interface AdversarialProbe {
  cassette: LeafCassette
  corpusEntry: AdversarialCorpusEntry
  labelRecord: StandaloneLabelRecord
  generator: CorpusGenerator
  seedCassetteId: string
  kind: ProbeGeneratorKind
  /** The authored text exactly as returned; part of the derived identity (D-11). */
  text: string
  usage: ProbeUsage
  blobShas: readonly string[]
}

/** The typed answer for one authored response. */
export type ProbeDerivation =
  | { outcome: 'derived'; probe: AdversarialProbe }
  | { outcome: 'refused'; reason: ProbeRefusal }

export interface BuildProbeRequestInput {
  seed: AdversarialSeed
  kind: ProbeGeneratorKind
  authoringModel: AuthoringModel
}

export interface DeriveProbeCassetteInput {
  seed: AdversarialSeed
  request: GenerationRequest
  response: ProbeText
  product: string
}

/** D-11: identity binds the seed, the kind, the prompt version, the author and the TEXT. */
export function deriveProbeCassetteId(input: {
  seedCassetteId: string
  kind: ProbeGeneratorKind
  promptVersion: number
  authoringModelId: string
  text: string
}): string {
  return sha256hex(
    canonicalJson({
      base: input.seedCassetteId,
      kind: input.kind,
      promptVersion: input.promptVersion,
      authoringModelId: input.authoringModelId,
      text: input.text,
    }),
  )
}

/** Build the pure request for one `(seed, kind)` pair, or say why there is none. */
export function buildProbeRequest(
  _input: BuildProbeRequestInput,
): GenerationRequest | ProbeInapplicability {
  return 'target-name-empty'
}

/** Turn one authored response into a gold-preserving probe cassette, or refuse it. */
export function deriveProbeCassette(_input: DeriveProbeCassetteInput): ProbeDerivation {
  return { outcome: 'refused', reason: 'probe-text-empty' }
}
