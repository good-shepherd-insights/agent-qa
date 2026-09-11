/**
 * 422-02-T1 — REAL leaf seeds for the adversarial generator cells.
 *
 * Every seed here comes out of `extractRunCassettes` over a shipped handoff fixture, not out
 * of a hand-written object literal. That matters for this plan specifically: the benign
 * families are required to preserve the gold's `role + nameNormalized + ordinal` under the
 * REAL `normalizeAccessibleName`, and the only way to know that a family does is to run it
 * against a cassette whose anchor, equivalence set, refs and rendered tree were produced by
 * the same extraction that produces committed bytes.
 *
 * The knobs below rewrite the RECORDED observation before extraction (element names, a
 * restricted element set) or the extracted sidecar afterwards (an absent or unresolvable
 * anchor). The first kind keeps the cassette entirely real; the second kind exists only to
 * build the four ineligibility fixtures — a corpus cannot be asked to contain a seed whose
 * anchor does not resolve.
 *
 * Pure: no clock, no host modules, no randomness. The handoff fixture's own timestamps are
 * the only time values anywhere in this file.
 */
import { asRecordId, asRef, computeBriefDigest } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ElementInfo,
  LosslessServedBriefProofV1,
  ScreenState,
} from '@vostride/agent-qa-schema'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes } from '../../extract/extract-run'
import { projectCorpusEntry } from '../../labels/corpus-entry'
import type { SplitAssignment } from '../../labels/corpus-entry'
import { projectSilverLabelRecord } from '../../labels/label-record'
import type { StandaloneLabelRecord } from '../../labels/label-record'
import type { ArtifactSource } from '../../ports'
import type { AdversarialSeed } from '../generate'

/** The leaf this module always seeds from: run 0, test 0, step 0, decision 0. */
export const FIXTURE_LEAF_SUFFIX = 'test-00-step-00-d00-leaf'

/** The recorded gold target on the shipped fixture observation. */
export const FIXTURE_GOLD = { role: 'button', nameNormalized: 'continue', ordinal: 0 } as const

function artifacts(): ArtifactSource {
  const blobs = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: sha => blobs.get(sha) }
}

/**
 * A populated, lossless brief proof. D-07 admits only proof-backed populated briefs as
 * seeds, and the shipped handoff fixture carries a populated brief with no proof — so every
 * eligible fixture here stamps one and re-stamps the digest, exactly as the 422-01 tracer
 * does against the CLI's own fixture.
 */
function proof(): LosslessServedBriefProofV1 {
  return {
    schemaVersion: 1,
    completeness: 'lossless',
    recordCap: 8,
    combinedBudget: 2_048,
    admissionEvents: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        surface: 'caution',
        id: asRecordId('rec_checkout_caution'),
        sourceId: 'rec_checkout_caution',
        clusterKey: '{"role":"button","name":"continue"}',
        renderedCost: 24,
        chargeRepeated: false,
      },
    ],
    promptTurns: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        runDate: '2026-09-11',
        policyL0: 'policy',
        learnedL1: 'learned one',
        learnedL2: 'learned two',
        contextTier: 'context',
        volatileTier: 'volatile',
        policyDigest: '1'.repeat(64),
        contextTierDigest: '2'.repeat(64),
        volatileTierDigest: '3'.repeat(64),
      },
    ],
  }
}

/** Re-render the prose tree from the element list so the two surfaces keep telling one story. */
function renderTree(elements: readonly ElementInfo[]): string {
  return elements
    .map((element, index) => `${index === 0 ? '' : '  '}${element.role} ${element.name}`)
    .join('\n')
}

function rewriteObservation(
  state: ScreenState,
  options: { names?: Readonly<Record<string, string>>; keepRefs?: readonly string[] },
): void {
  const kept = options.keepRefs
  const elements = state.elements
    .filter(element => kept === undefined || kept.includes(String(element.ref)))
    .map(element => {
      const name = options.names?.[String(element.ref)]
      if (name === undefined) return element
      return { ...element, name, nameNormalized: name.trim().replace(/\s+/g, ' ').toLowerCase() }
    })
  state.elements = elements
  state.tree = renderTree(elements)
  if (kept !== undefined) {
    for (const ref of Object.keys(state.refMap)) {
      if (!kept.includes(ref)) delete (state.refMap as Record<string, unknown>)[ref]
    }
    for (const element of elements) {
      if (element.hierarchy?.childRefs !== undefined) {
        element.hierarchy = {
          ...element.hierarchy,
          childRefs: element.hierarchy.childRefs.filter(ref => kept.includes(String(ref))),
        }
      }
    }
  }
}

export interface SeedFixtureOptions {
  /** Rename recorded elements by ref before extraction; the tree is re-rendered to match. */
  names?: Readonly<Record<string, string>>
  /** Restrict the recorded observation to these refs — the sparse-surface fixtures. */
  keepRefs?: readonly string[]
  /** Default 'natural'; anything else makes the seed structurally ineligible. */
  assignment?: SplitAssignment
  /** Default true. `false` leaves the brief without its proof (D-07 ineligibility). */
  proofBacked?: boolean
  /** Default true. `false` omits the seed's effective standalone label. */
  labelled?: boolean
  /** Drop the extracted gold anchor entirely. */
  anchorAbsent?: boolean
  /** Keep the anchor but rename its element afterwards so it no longer resolves. */
  anchorUnresolvable?: boolean
  /** Blank every recorded accessible name after extraction. */
  targetNameBlank?: boolean
}

export interface SeedFixture extends AdversarialSeed {
  cassette: LeafCassette
  label?: StandaloneLabelRecord
  runId: string
}

/** One real, extracted leaf seed, shaped by the options above. */
export function makeAdversarialSeedFixture(options: SeedFixtureOptions = {}): SeedFixture {
  const handoff: CompletedRunHandoff = makeArtifactRefV2Handoff()
  const step = handoff.tests[0]!.steps[0]!
  if (options.proofBacked !== false) {
    step.servedBrief.proof = proof()
    step.servedBrief.briefDigest = computeBriefDigest({ ...step.servedBrief, briefDigest: '' })
  }
  if (options.names !== undefined || options.keepRefs !== undefined) {
    rewriteObservation(step.subActions[0]!.stateBefore!, {
      ...(options.names === undefined ? {} : { names: options.names }),
      ...(options.keepRefs === undefined ? {} : { keepRefs: options.keepRefs }),
    })
  }

  const extracted = extractRunCassettes({ handoff, artifacts: artifacts() })
  const found = extracted.cassettes
    .map(row => row.cassette)
    .find(
      (row): row is LeafCassette =>
        row.granularity === 'leaf' && row.id.endsWith(FIXTURE_LEAF_SUFFIX),
    )
  if (found === undefined) throw new Error('fixture leaf cassette missing')

  let cassette: LeafCassette = found
  if (options.anchorAbsent === true) {
    const { goldAnchor: _anchor, ...sidecar } = cassette.sidecar
    cassette = { ...cassette, sidecar: { ...sidecar, equivalenceSet: [] } }
  }
  if (options.anchorUnresolvable === true) {
    cassette = {
      ...cassette,
      input: {
        ...cassette.input,
        stateBefore: {
          ...cassette.input.stateBefore,
          elements: cassette.input.stateBefore.elements.map(element => ({
            ...element,
            name: `${element.name} moved`,
            nameNormalized: `${element.nameNormalized} moved`,
          })),
        },
      },
    }
  }
  if (options.targetNameBlank === true) {
    cassette = {
      ...cassette,
      sidecar: {
        ...cassette.sidecar,
        goldAnchor: { role: 'button', nameNormalized: '', ordinal: 0, ref: 'e-continue-1' },
        equivalenceSet: [],
      },
      input: {
        ...cassette.input,
        stateBefore: {
          ...cassette.input.stateBefore,
          elements: cassette.input.stateBefore.elements.map(element =>
            String(element.ref) === 'e-continue-1'
              ? { ...element, name: '   ', nameNormalized: '' }
              : element,
          ),
        },
      },
    }
  }

  const runId = String(handoff.runId)
  const entry = projectCorpusEntry({
    cassette,
    product: 'fixture',
    runId,
    assignment: options.assignment ?? { split: 'natural' },
  })
  return {
    cassette,
    entry,
    runId,
    ...(options.labelled === false
      ? {}
      : { label: projectSilverLabelRecord({ cassette, runId }) }),
  }
}

/** The recorded element list of a seed, projected to the fields the cells assert on. */
export function seedSurfaces(
  seed: AdversarialSeed,
): readonly { ref: string; role: string; name: string; nameNormalized: string }[] {
  return seed.cassette.input.stateBefore.elements.map(element => ({
    ref: String(element.ref),
    role: element.role,
    name: element.name,
    nameNormalized: element.nameNormalized,
  }))
}

/** The refs the shipped fixture observation records, in recorded order. */
export const FIXTURE_REFS = {
  root: String(asRef('e-root')),
  goldButton: String(asRef('e-continue-1')),
  siblingButton: String(asRef('e-continue-2')),
  status: String(asRef('e-status')),
} as const
