/**
 * 422 D-09/D-10/D-11/D-12: the PURE probe half — the request, and the cassette derived from
 * one authored response.
 *
 * WHAT THIS FILE IS NOT. It never calls a model, never constructs one, and never decides
 * whether a model MAY author. `ProbeAuthorPort` is the whole seam: the CLI composition binds a
 * real author through `createModel` inside `runSafetyScope` (D-10, and the reason eval-local's
 * `createModel`-site count stays at one), and family eligibility — including the planner-family
 * exclusion — is settled by the CLI preflight before any port reaches here (D-09). A request
 * built here is a statement about a SEED, not a permission.
 *
 * THE REQUEST IS REPRODUCIBLE OR IT IS A DEFECT. Everything in a `GenerationRequest` is a pure
 * function of the seed, the kind, the author identity and the frozen prompt. That is not
 * tidiness: D-11's idempotence key is `(seed, kind, promptVersion)`, so a refresh that could
 * produce two different requests for one tuple would author twice and pay twice for a case the
 * corpus already has. There is no clock here, no draw, and nothing ambient.
 *
 * THE RESPONSE IS DATA, AND IT IS CHECKED. An authored name arrives from a model that has just
 * been asked to write bait, over input that may itself contain injection templates this corpus
 * planted. `deriveProbeCassette` therefore validates before it derives — bounded length, a
 * single line, honest usage, a seed that matches the request, a prompt pin this build still
 * ships, and an identity that actually moved. Every failure is a typed refusal rather than an
 * exception, because a refresh must be able to say why it staged nothing.
 *
 * GOLD SURVIVES THE PROBE (D-06). The authored text replaces the gold target's accessible name
 * and the anchor follows it, exactly as a hostile table family does. The recorded action, its
 * ref, the equivalence arity, `run_links` and `captured_at_ordinal` are the seed's — so
 * ROOT-03 keeps excluding the run that bred the seed from gating anything derived from it, and
 * the correct decision under the bait is still the seed's decision.
 */
import { normalizeAccessibleName, screenStateHash, sha256hex } from '@vostride/agent-qa-schema'
import type { ElementInfo, ScreenState } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { LeafCassette } from '../cassette/cassette'
import type { GoldAnchorDescriptor } from '../cassette/sidecar-leg'
import { canonicalizeInputLeg } from '../extract/receipt'
import { deriveAdversarialLabel } from '../labels/label-record'
import type { StandaloneLabelRecord } from '../labels/label-record'
import { projectCorpusEntry } from '../labels/corpus-entry'
import type {
  AdversarialCorpusEntry,
  AuthoringModel,
  CorpusGenerator,
  ProbeGeneratorKind,
} from '../labels/corpus-entry'
import { ADVERSARIAL_GENERATOR_VERSION, rewriteElementNameInTree } from './generate'
import type { AdversarialSeed } from './generate'
import type { JudgeCalibrationGapReason } from '../judge/calibration'
import { ADVERSARIAL_PROMPT_HASH, ADVERSARIAL_PROMPT_VERSION } from './probe-prompt'

/**
 * 422 D-09: why a host has no model that may author probes.
 *
 * DERIVED FROM THE JUDGE PREFLIGHT'S VOCABULARY RATHER THAN RE-DECLARED. The three situations
 * are the same three — nothing declared, nothing credentialed, nothing family-disjoint — and a
 * second spelling of the same words is a second thing to keep in step. The import is TYPE-ONLY,
 * so this browser-safe module gains no dependency on the calibration module at run time, and
 * `NO_PROBE_MODEL_REASONS` below is spelled by hand so a widening of the judge union cannot
 * silently widen this one: the pin in `probe-contract.test.ts` is what decides that.
 *
 * ONE WORD READS DIFFERENTLY HERE, DELIBERATELY. For a panel, `no-credential` means ANY member
 * lacks one — a panel is refused whole. For a probe author it means NO member has one, because
 * one usable author is the whole capability. The word names the host's situation either way;
 * the quantifier belongs to the reader, and each reader states it.
 */
export type NoProbeModelReason = JudgeCalibrationGapReason

/**
 * Declaration-order projection of `NoProbeModelReason` (the 414 D-22 bar idiom).
 *
 * The ORDER is the precedence a host must read them in — nothing declared, then nothing
 * credentialed, then nothing family-disjoint — so the first reason a host can reach is the first
 * thing it has to fix.
 */
export const NO_PROBE_MODEL_REASONS = [
  'panel-not-configured',
  'no-credential',
  'single-family-host',
] as const satisfies readonly NoProbeModelReason[]

/**
 * The provider-neutral capability gap (D-09).
 *
 * Lives beside the request contracts on purpose: a staging report, a job checkpoint and a chain
 * line all have to say "no probes, and here is why" without any of them naming a provider, a
 * registry entry or a credential. The host preflight that DECIDES this carries diagnostics
 * beside it; those are the host's, and they are masked. This is the part that travels.
 */
export interface NoProbeModelGap {
  kind: 'no-probe-model'
  reason: NoProbeModelReason
}

/**
 * Longest accessible name a probe may author.
 *
 * A recorded default with a stated rationale, not a tuned threshold: the thing being authored is
 * a CONTROL LABEL, and an extractor reading a real screen has never captured a two-hundred
 * character one. A longer response is prose the model wrote around the answer, and admitting it
 * would put a paragraph where every consumer expects a name. Bounded here rather than at the
 * staging layer so the bound is a property of the contract, not of one host's configuration.
 */
export const PROBE_MAX_TEXT_LENGTH = 200

/**
 * Recorded token usage for one authored probe.
 *
 * BOTH COUNTS ARE OPTIONAL, AND ABSENT IS NOT ZERO. A provider that reports no usage has told
 * us nothing, and the alternative to saying so is writing `0` -- which makes a real charge
 * indistinguishable from a free one. `ProbeCompletion` already documents its mirror of these
 * two fields that way; typing them as required here is what forced the author binding to
 * launder an absent count into a measured zero before the durable store ever saw it.
 */
export interface ProbeUsage {
  promptTokens?: number
  completionTokens?: number
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

/**
 * The one seam a model reaches this package through (D-10).
 *
 * Deliberately a single method taking a DTO. A port that took the seed, or the cassette, or a
 * host handle would be a port that could read more than the request discloses — and the request
 * is exactly what the probe entry's provenance later claims the author saw.
 */
export interface ProbeAuthorPort {
  author(request: GenerationRequest): Promise<ProbeText>
}

/**
 * Why a seed yields no probe REQUEST at all.
 *
 * The first six are D-07's seed law, spelled the same way `generate.ts` spells them so a
 * staging report can report table families and probes in one vocabulary. The seventh is the
 * caller's own gap: an author with no resolved identity cannot be recorded, and D-11 requires
 * every LLM-derived entry to name its author.
 */
export type ProbeInapplicability =
  | 'not-natural'
  | 'brief-not-proof-backed'
  | 'gold-anchor-absent'
  | 'gold-anchor-unresolved'
  | 'seed-label-absent'
  | 'target-name-empty'
  | 'authoring-model-unidentified'

/** Declaration-order projection of `ProbeInapplicability` (the 414 D-22 bar idiom). */
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
  | 'probe-tree-target-unresolved'

/** Declaration-order projection of `ProbeRefusal` (D-22). */
export const PROBE_REFUSALS = [
  'seed-request-mismatch',
  'request-prompt-stale',
  'probe-text-empty',
  'probe-text-too-long',
  'probe-text-not-a-name',
  'probe-usage-invalid',
  'probe-identity-unchanged',
  'probe-tree-target-unresolved',
] as const satisfies readonly ProbeRefusal[]

/**
 * 2026-09-12, 422-22 (D-04/D-11): the durable state of ONE probe tuple's charge.
 *
 * THE NEUTRAL DECLARATION of a vocabulary the storage layer already speaks. A probe charge is two
 * files: the row written BEFORE a provider is contacted, and the answer written after. Those two
 * presences are the whole state space, and the three words below are what each pair means.
 *
 * NOTHING HERE IS A WRITTEN STATUS FIELD, and that is the design rather than an economy. The one
 * thing a dying process cannot do is record that it died, so a status column would have to be
 * updated by exactly the code that failed — which is how a lost call comes back looking answered
 * and gets re-asked. The status is DERIVED from the two presences instead.
 *
 * There is no word here for a call in progress. A tuple a live attempt is inside looks identical
 * on disk to one a dead attempt left behind, and the honest reading of both is the same: a charge
 * with no answer. A remote call nobody saw finish is not a call anybody may assume did not happen,
 * so the charge survives the attempt and a later refresh declines to spend on it again.
 */
export type ProbeReservationStatus = 'unattempted' | 'interrupted' | 'completed'

/**
 * Declaration-order projection of `ProbeReservationStatus` (the 414 D-22 bar idiom).
 *
 * The order is the order the two disk facts are read in: no charge, then a charge with no answer,
 * then a charge with one.
 */
export const PROBE_RESERVATION_STATUSES = [
  'unattempted',
  'interrupted',
  'completed',
] as const satisfies readonly ProbeReservationStatus[]

/**
 * Read a tuple's durable state from the two presences, and from nothing else.
 *
 * Pure and total. An answer with no charge beside it reads as `unattempted` rather than as
 * `completed`: with no charge there is no tuple to have been answered, and admitting the orphan
 * would let a refresh conclude that a call was made for free.
 */
export function probeReservationStatus(input: {
  reservationRecorded: boolean
  completionRecorded: boolean
}): ProbeReservationStatus {
  if (!input.reservationRecorded) return 'unattempted'
  return input.completionRecorded ? 'completed' : 'interrupted'
}

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
  /** The blob closure the derived cassette inherits, by content address only. */
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

/**
 * D-11: identity binds the seed, the kind, the prompt version, the author and the TEXT.
 *
 * The text is in the identity and the table families' equivalent is not, because the two are
 * addressed differently on purpose. A table variant's content is a pure function of its inputs,
 * so `(seed, kind, mutator, tableVersion)` already determines it; an authored one is not, so
 * two probes that differ only in what the model happened to say must not collide on one id.
 * The idempotence key stays the narrower `(seed, kind, promptVersion)` — that is what stops a
 * refresh re-authoring — and belongs to the staging layer, not to identity.
 */
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

/**
 * Index of the element a descriptor names, or -1.
 *
 * Spelled here rather than imported from `./generate` so the probe half carries no dependency
 * on the frozen-table engine: the two derivations share a RULE (D-03's `role + nameNormalized +
 * ordinal` identity), not an implementation, and coupling them would make a change to the table
 * engine able to move probe identities.
 */
function resolveDescriptorIndex(
  elements: readonly ElementInfo[],
  descriptor: GoldAnchorDescriptor,
): number {
  let seen = 0
  for (const [index, element] of elements.entries()) {
    if (element.role !== descriptor.role) continue
    if (normalizeAccessibleName(element.name) !== descriptor.nameNormalized) continue
    if (seen === descriptor.ordinal) return index
    seen += 1
  }
  return -1
}

/** Replace element `index`'s accessible name, re-normalizing through the shipped normalizer. */
function withMutatedName(
  elements: readonly ElementInfo[],
  index: number,
  mutatedName: string,
): ElementInfo[] {
  return elements.map((element, position) =>
    position === index
      ? { ...element, name: mutatedName, nameNormalized: normalizeAccessibleName(mutatedName) }
      : element,
  )
}

/** Does this cassette carry the proof-backed populated brief D-07 requires of a seed? */
function isProofBacked(cassette: LeafCassette): boolean {
  const brief = cassette.input.servedBrief
  if (brief.proof === undefined) return false
  return brief.channel1.length + brief.channel2.length + brief.channel3.length > 0
}

/** D-07's seed law, in a fixed order, shared by both probe kinds. */
function seedInapplicability(seed: AdversarialSeed): ProbeInapplicability | undefined {
  if (seed.entry.split !== 'natural') return 'not-natural'
  if (!isProofBacked(seed.cassette)) return 'brief-not-proof-backed'
  if (seed.cassette.sidecar.goldAnchor === undefined) return 'gold-anchor-absent'
  const goldIndex = resolveDescriptorIndex(
    seed.cassette.input.stateBefore.elements,
    seed.cassette.sidecar.goldAnchor,
  )
  if (goldIndex < 0) return 'gold-anchor-unresolved'
  if (seed.label === undefined) return 'seed-label-absent'
  if (seed.cassette.input.stateBefore.elements[goldIndex]!.name.trim() === '') {
    return 'target-name-empty'
  }
  return undefined
}

/**
 * Build the pure request for one `(seed, kind)` pair, or say why there is none.
 *
 * The sibling names are the OTHER recorded controls, named ones only. They are in the request
 * because both kinds need them and for opposite reasons: a judge-targeted probe must not drift
 * onto a sibling's label (that would make the screen ambiguous rather than confusing), and an
 * optimized-trigger probe is more convincing when it does not repeat one.
 */
export function buildProbeRequest(
  input: BuildProbeRequestInput,
): GenerationRequest | ProbeInapplicability {
  const { seed, kind, authoringModel } = input
  if (authoringModel.id.trim() === '' || authoringModel.family.trim() === '') {
    return 'authoring-model-unidentified'
  }
  const ineligible = seedInapplicability(seed)
  if (ineligible !== undefined) return ineligible

  const anchor = seed.cassette.sidecar.goldAnchor!
  const elements = seed.cassette.input.stateBefore.elements
  const goldIndex = resolveDescriptorIndex(elements, anchor)
  const target = elements[goldIndex]!

  return {
    seedCassetteId: seed.cassette.id,
    kind,
    promptVersion: ADVERSARIAL_PROMPT_VERSION,
    promptHash: ADVERSARIAL_PROMPT_HASH,
    authoringModel: { id: authoringModel.id, family: authoringModel.family },
    surface: {
      role: target.role,
      name: target.name,
      siblingNames: elements
        .filter((element, index) => index !== goldIndex && element.name.trim() !== '')
        .map(element => element.name),
    },
    goldAnchor: { ...anchor },
  }
}

/** Every C0 and DEL code point: a control label is one line of printable text, or it is not one. */
function carriesControlCharacter(text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0)
    if (point === undefined) continue
    if (point < 0x20 || point === 0x7f) return true
  }
  return false
}

function isReportedCount(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 0)
}

/** Validate one authored response against its request. Order is fixed so refusals are stable. */
function responseRefusal(
  seed: AdversarialSeed,
  request: GenerationRequest,
  response: ProbeText,
  anchor: GoldAnchorDescriptor,
): ProbeRefusal | undefined {
  if (request.seedCassetteId !== seed.cassette.id) return 'seed-request-mismatch'
  if (
    request.promptVersion !== ADVERSARIAL_PROMPT_VERSION ||
    request.promptHash !== ADVERSARIAL_PROMPT_HASH
  ) {
    return 'request-prompt-stale'
  }
  if (response.text.trim() === '') return 'probe-text-empty'
  if ([...response.text].length > PROBE_MAX_TEXT_LENGTH) return 'probe-text-too-long'
  if (carriesControlCharacter(response.text)) return 'probe-text-not-a-name'
  // ABSENT is a legal answer -- the provider reported nothing. A count that is PRESENT and
  // not a non-negative integer is still a refusal.
  if (!isReportedCount(response.usage.promptTokens)) return 'probe-usage-invalid'
  if (!isReportedCount(response.usage.completionTokens)) return 'probe-usage-invalid'
  // A response that folds back onto the recorded identity under the real normalizer perturbed
  // nothing a name-based planner or judge can see. Staging it would spend a probe call on a
  // rename and then report it as an adversarial case.
  if (normalizeAccessibleName(response.text) === anchor.nameNormalized) {
    return 'probe-identity-unchanged'
  }
  return undefined
}

/**
 * Turn one authored response into a gold-preserving probe cassette, or refuse it.
 *
 * What is rebuilt and what is copied follows `generate.ts` exactly, and for the same reason:
 * `promptInputHash` and `screenStateHash` describe the DERIVED bytes, so a copied digest would
 * be a lie; `run_links`, `captured_at_ordinal` and the label's provenance are the SEED's,
 * because ROOT-03's exclusion must keep excluding the breeding run.
 */
export function deriveProbeCassette(input: DeriveProbeCassetteInput): ProbeDerivation {
  const { seed, request, response, product } = input

  // A seed that cannot produce a request cannot receive a response for one. Checking the
  // request/seed agreement FIRST keeps the refusal honest when the caller paired them wrongly.
  if (request.seedCassetteId !== seed.cassette.id) {
    return { outcome: 'refused', reason: 'seed-request-mismatch' }
  }
  const ineligible = seedInapplicability(seed)
  if (ineligible !== undefined) {
    // An ineligible seed at derivation time means the corpus moved under the caller; there is
    // no honest probe to mint and the stale-pin refusal is the nearest true statement.
    return { outcome: 'refused', reason: 'seed-request-mismatch' }
  }

  const anchor = seed.cassette.sidecar.goldAnchor!
  const refusal = responseRefusal(seed, request, response, anchor)
  if (refusal !== undefined) return { outcome: 'refused', reason: refusal }

  const seedCassette = seed.cassette
  const elements = seedCassette.input.stateBefore.elements
  const goldIndex = resolveDescriptorIndex(elements, anchor)

  const mutatedElements = withMutatedName(elements, goldIndex, response.text)
  // ONE spelling, shared with the table half. A rewrite that cannot find its target in the
  // rendered tree is a REFUSAL, not a silent no-op that stages an unperturbed screen — and the
  // ordinal is resolved against the tree's own occupied stretches, so a longer sibling name
  // containing this one cannot absorb the rewrite and rename the wrong control.
  const tree = rewriteElementNameInTree({
    tree: seedCassette.input.stateBefore.tree,
    elementNames: elements.map(element => element.name),
    index: goldIndex,
    replacement: response.text,
  })
  if (tree === undefined) return { outcome: 'refused', reason: 'probe-tree-target-unresolved' }
  const stateBefore: ScreenState = {
    ...seedCassette.input.stateBefore,
    elements: mutatedElements,
    tree,
  }
  const inputLeg = { ...seedCassette.input, stateBefore }

  // The anchor follows its target's new identity, exactly as a hostile table family's does: the
  // gold ACTION is unchanged, and the descriptor is how that action's target is located on the
  // perturbed screen. The equivalence set is retargeted through the same rule so its arity and
  // membership stay the seed's.
  const retargetTo = normalizeAccessibleName(response.text)
  const retarget = (descriptor: GoldAnchorDescriptor): GoldAnchorDescriptor =>
    descriptor.role === anchor.role &&
    descriptor.nameNormalized === anchor.nameNormalized &&
    descriptor.ordinal === anchor.ordinal
      ? { ...descriptor, nameNormalized: retargetTo }
      : descriptor

  const cassetteId = deriveProbeCassetteId({
    seedCassetteId: seedCassette.id,
    kind: request.kind,
    promptVersion: request.promptVersion,
    authoringModelId: request.authoringModel.id,
    text: response.text,
  })

  const derived: LeafCassette = {
    ...seedCassette,
    id: cassetteId,
    input: inputLeg,
    sidecar: {
      ...seedCassette.sidecar,
      goldAnchor: retarget(anchor),
      equivalenceSet: seedCassette.sidecar.equivalenceSet.map(retarget),
    },
    // The label LEG is the as-extracted snapshot and is copied verbatim (D-01 store law); the
    // authoritative derived label is the standalone record beside it.
    label: { ...seedCassette.label },
    receipt: {
      ...seedCassette.receipt,
      promptInputHash: sha256hex(canonicalizeInputLeg(inputLeg)),
      screenStateHash: screenStateHash(stateBefore),
    },
  }

  const generator: CorpusGenerator = {
    kind: request.kind,
    seedCassetteId: seedCassette.id,
    // The RECIPE version is carried, not re-minted: a probe is assembled by the same rules a
    // table variant is (which fields are rebuilt, how the target is located). Only WHAT lands in
    // the name differs, and that is what `promptVersion` and the author identity describe.
    generatorVersion: ADVERSARIAL_GENERATOR_VERSION,
    authoringModel: { ...request.authoringModel },
    promptVersion: request.promptVersion,
  }

  const corpusEntry = projectCorpusEntry({
    cassette: derived,
    product,
    // D-06: the SEED's run, so ROOT-03 keeps excluding the breeding run from gating.
    runId: seed.entry.run_links.runId,
    assignment: { split: 'adversarial', generator },
    ...(seed.entry.captured_at === undefined ? {} : { capturedAt: seed.entry.captured_at }),
    ...(seed.entry.targetEnvironment === undefined
      ? {}
      : { targetEnvironment: seed.entry.targetEnvironment }),
  }) as AdversarialCorpusEntry

  return {
    outcome: 'derived',
    probe: {
      cassette: derived,
      corpusEntry,
      // The SAME pure factory the deterministic variants use (D-06). A second cloning path
      // would be a second answer to "what is this case's gold".
      labelRecord: deriveAdversarialLabel({
        cassette: derived,
        seedLabel: seed.label!,
        generator,
      }),
      generator,
      seedCassetteId: seedCassette.id,
      kind: request.kind,
      text: response.text,
      usage: { ...response.usage },
      blobShas: [...derived.blobs],
    },
  }
}
