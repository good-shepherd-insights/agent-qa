import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  buildEvalReport,
  committedFileText,
  composeBaselineProfileKey,
  computeCorpusDigest,
  extractRunCassettes,
  FLOOR_AXES,
  FLOOR_SPLITS,
  projectCorpusEntry,
  projectPartitionManifest,
  type AxisFloorSet,
  type NoiseFloorArtefact,
} from '@vostride/agent-qa-eval'
import { renderObservationLine } from '@vostride/agent-qa-runner'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import {
  asRecordId,
  asRef,
  asRunId,
  computeBriefDigest,
  slugBranch,
  type CandidateInjection,
} from '@vostride/agent-qa-schema'
import { FsCassetteStore } from '../../cassette-store.js'
import {
  FsCommittedRootStore,
  buildRootMarkerValue,
  COMMITTED_GITIGNORE_TEXT,
  committedCorpusPath,
  committedPartitionManifestPath,
} from '../../committed-root-store.js'
import { readCommittedCorpus } from '../../committed-corpus-source.js'
import { loadCassetteBundles } from '../../replay-sweep.js'
import { computeReplayProfileFingerprintFor } from '../../replay-composition.js'
import { replayCorpusOnce } from '../../aa-floor-composition.js'
import { writeNoiseFloorArtefact } from '../../noise-floor-writer.js'
import { incrementingClock } from './floor-fixtures.js'
import {
  actionGenerateResult,
  makeReplayHandoff,
  memArtifacts,
  noneAuth,
  stubProfile,
  respondingStub,
  type CapturingStub,
  type CapturedCallOptions,
} from './replay-fixtures.js'

// Minted with the canonical packages/ids generateRunId; frozen for reproducible corpus bytes.
const RUN_IDS = [
  'r_tile-speed-urde-dit-maybe-ruta-schule-angers-summer-church',
  'r_griff-pole-pool-leer-til-assert-fault-sob-meteor-tree',
  'r_roud-java-holt-subset-street-clare-beck-abama-fake-para',
  'r_bes-had-lou-car-campo-paque-agon-reduce-modal-revet',
  'r_gem-soever-jan-kop-boot-planet-unami-sign-agger-leed',
  'r_epoch-ind-stripe-spot-dating-eld-cod-fon-mort-footer',
] as const

export function writeGate1Fixture(
  root: string,
  options: {
    collateral?: number
    targetInCorpus?: boolean
    handoffForTarget?: boolean
    targetDecisions?: number
  } = {},
) {
  const {
    collateral = 5,
    targetInCorpus = true,
    handoffForTarget = false,
    targetDecisions = 1,
  } = options
  const count = collateral + 1
  if (count > RUN_IDS.length || count < 2)
    throw new Error('fixture supports one to five collateral leaves')
  const committedRoot = join(root, 'committed')
  const agentQaRoot = join(root, '.agent-qa')
  const cassettesRoot = join(committedRoot, 'cassettes')
  const store = new FsCommittedRootStore({ committedRoot })
  store.scaffold(COMMITTED_GITIGNORE_TEXT, committedFileText(buildRootMarkerValue()))
  const cassetteStore = new FsCassetteStore({ root, outputDir: cassettesRoot })
  const targetIds: string[] = []
  for (let index = 0; index < count; index++) {
    const handoff = makeReplayHandoff({
      vision: false,
      stepText: index === count - 1 ? 'gate1-target-run' : `gate1-collateral-${index}`,
    })
    handoff.runId = asRunId(RUN_IDS[index]!)
    handoff.scope = { tier: 'product', key: 'alpha' }
    // A valid non-gold control avoids exercising the planner's invalid-ref retry path.
    const screen = handoff.tests[0]!.steps[0]!.subActions![0]!.stateBefore!
    screen.elements.push({
      ...structuredClone(screen.elements[0]!),
      ref: asRef('e-other'),
      role: 'checkbox',
      name: 'Cancel',
      nameNormalized: 'cancel',
      labels: { ariaLabel: 'Cancel' },
      attributes: { 'data-fixture': 'cancel' },
      bounds: { x: 500, y: 500, width: 100, height: 40 },
      center: { x: 550, y: 520 },
    })
    screen.refMap[asRef('e-other')] = {
      ...structuredClone(screen.refMap[asRef('e-continue')]!),
      bounds: { x: 500, y: 500, width: 100, height: 40 },
      center: { x: 550, y: 520 },
    }
    const brief = handoff.tests[0]!.steps[0]!.servedBrief!
    brief.scope = handoff.scope
    brief.briefDigest = computeBriefDigest(brief)
    if (index === count - 1) {
      const step = handoff.tests[0]!.steps[0]!
      for (let ordinal = 1; ordinal < targetDecisions; ordinal++) {
        const sibling = structuredClone(step.subActions![0]!)
        sibling.stateBefore!.tree = `gate1-target-sibling-${ordinal}: button Continue`
        step.subActions!.push(sibling)
      }
      if (handoffForTarget) {
        const runDir = join(agentQaRoot, 'runs', slugBranch(handoff.runId))
        mkdirSync(runDir, { recursive: true })
        writeFileSync(join(runDir, 'handoff.json'), JSON.stringify(handoff))
      }
    }
    const leaves = extractRunCassettes({ handoff, artifacts: memArtifacts() }).cassettes.filter(
      (row) => row.cassette.granularity === 'leaf',
    )
    for (const leaf of leaves) {
      if (leaf.cassette.granularity !== 'leaf') throw new Error('expected leaf')
      if (index === count - 1) {
        targetIds.push(leaf.cassette.id)
        if (!targetInCorpus) continue
      }
      cassetteStore.write(leaf)
      const entry = projectCorpusEntry({
        cassette: leaf.cassette,
        product: 'alpha',
        runId: handoff.runId,
        assignment:
          index % 3 === 0
            ? { split: 'natural' }
            : {
                split: 'held-out',
                heldOutVisibility: index % 3 === 1 ? 'shared' : 'private',
              },
      })
      store.writeText(committedCorpusPath('alpha', leaf.cassette.id), committedFileText(entry))
    }
  }
  const partition = projectPartitionManifest({
    product: 'alpha',
    saltHex: 'a'.repeat(64),
    heldOutFraction: 0.5,
    privateFraction: 0.5,
  })
  store.writeText(committedPartitionManifestPath('alpha'), committedFileText(partition))
  const selected = loadCassetteBundles(cassettesRoot).loaded.map((row) => {
    if (row.cassette.granularity !== 'leaf') throw new Error('expected leaf')
    return { ...row, cassette: row.cassette }
  })
  const corpusDigest = computeCorpusDigest(readCommittedCorpus(committedRoot).snapshot.entries)
  const modelOverrides = {
    languageModels: respondingStub(() => actionGenerateResult()).languageModels,
  }
  const fingerprint = computeReplayProfileFingerprintFor({
    profile: stubProfile(),
    modelOverrides,
    seedPolicy: 'declared',
  })
  const identity = {
    plannerModelId: stubProfile().model,
    matcherVersion: buildEvalReport([]).matcherVersion,
    fingerprint,
  }
  const profileKey = composeBaselineProfileKey(identity)
  const gateRoot = join(agentQaRoot, 'eval', 'gate', slugBranch(profileKey))
  const targetId = targetIds[0]!
  const collateralIds = selected
    .filter((row) => !targetIds.includes(row.cassette.id))
    .map((row) => row.cassette.id)
  const line = {
    id: asRecordId('gate1-candidate'),
    kind: 'fact',
    summary: 'Choose the recorded Continue control',
    trust: 0.5,
    status: 'candidate',
    servedAsCanary: false,
    tier: 'L2',
  }
  const injection: CandidateInjection = {
    candidateId: line.id,
    kind: 'fact',
    product: 'alpha',
    scope: { tier: 'product', key: 'alpha' },
    anchors: [],
    status: 'candidate',
    line,
    renderedLine: renderObservationLine(line),
    target: { runId: RUN_IDS[count - 1]!, stepIndex: 0 },
    provenance: { runIds: [RUN_IDS[count - 1]!], receiptDigests: [], capturedAtOrdinals: [1] },
    latestOrdinal: 1,
  }
  const pairs = Array.from({ length: 3 }, (_, a) =>
    Array.from({ length: 3 - a }, (_, offset) => {
      const b = a + offset + 1
      return {
        a,
        b,
        kind: b < 3 ? ('same-seed' as const) : ('two-seed' as const),
        n: count,
        aOnly: 0,
        bOnly: 0,
        deltaAcc: 0,
        flipRate: 0,
        mcnemarP: 1,
      }
    }),
  ).flat()
  const measured = {
    n: count,
    reference: { correct: count - 1, n: count },
    aggregateFloor: 0.05,
    pairs,
  }
  const axes: AxisFloorSet = {
    headline: measured,
    elementIdentity: measured,
    value: measured,
    opClass: measured,
    sideEffect: measured,
    loop: { n: 0, pairs: [] },
  }
  const minimumGateSet = {
    lowerBound: 3 as const,
    baselineRate: { correct: count - 1, n: count },
    baselineRateSource: 'reference-run' as const,
    floor: 0.05,
    value: 3,
    derivation: 'authored gate fixture',
    searchedUpTo: count,
  }
  const artefact: NoiseFloorArtefact = {
    schemaVersion: 1,
    method: 'aa-repeat-spread-plus-wilson',
    ...identity,
    profileKey,
    corpusDigest,
    partitionVersion: partition.partitionVersion,
    seeds: [11, 29],
    repeats: 3,
    seedHonored: true,
    bootstrap: { B: 100, seed: 7 },
    population: {
      included: { proof: 0, empty: count },
      excludedRendered: 0,
      refusals: {},
      unpartitioned: 0,
    },
    axes,
    products: {
      alpha: {
        axes,
        minimumGateSet,
        census: { natural: 2, heldOutShared: 2, heldOutPrivate: 2 },
        populatedBriefs: 0,
      },
    },
    splits: Object.fromEntries(
      FLOOR_SPLITS.map((split) => [split, { axes }]),
    ) as NoiseFloorArtefact['splits'],
    minimumGateSet,
    runs: [11, 11, 11, 29].map((seed, index) => ({
      index,
      seed,
      seedHonored: true,
      headline: { correct: count - 1, n: count },
      axes: Object.fromEntries(
        FLOOR_AXES.map((axis) => [
          axis,
          axis === 'loop' ? { correct: 0, n: 0 } : { correct: count - 1, n: count },
        ]),
      ) as NoiseFloorArtefact['runs'][number]['axes'],
      refusalCounts: {},
      briefSourceCounts: { empty: count },
      harnessErrorCount: 0,
      cost: { wallClockMs: 0 },
      reportDigest: String(index).repeat(64),
    })),
    cost: { wallClockMs: 0 },
  }
  const written = writeNoiseFloorArtefact({
    artefact,
    committedRoot,
    reportOutputBaseDir: join(agentQaRoot, 'fixture-audit'),
  })
  if (written.kind !== 'written') throw new Error(JSON.stringify(written))
  return {
    root,
    committedRoot,
    agentQaRoot,
    cassettesRoot,
    selected,
    profileKey,
    fingerprint,
    corpusDigest,
    identity: { ...identity, profileKey },
    gateRoot,
    collateralIds,
    targetId,
    targetIds,
    injection,
    artefact,
  }
}

export async function warmGateRoot(
  fixture: ReturnType<typeof writeGate1Fixture>,
  stub: CapturingStub,
) {
  return replayCorpusOnce({
    selected: fixture.selected,
    cassettesRoot: fixture.cassettesRoot,
    agentQaRoot: fixture.agentQaRoot,
    runRoot: fixture.gateRoot,
    profile: stubProfile(),
    auth: noneAuth,
    modelOverrides: { languageModels: stub.languageModels },
    maskingContextFactory: createMaskingContext,
    seed: 11,
    k: 1,
    replayOutputBaseDir: fixture.gateRoot,
    source: 'committed',
    corpusDigest: fixture.corpusDigest,
    clock: incrementingClock(),
  })
}

export function gate1Responder(fixture: Pick<ReturnType<typeof writeGate1Fixture>, 'injection'>) {
  return (call: CapturedCallOptions) => {
    const text = JSON.stringify(call.prompt)
    return actionGenerateResult(
      'web',
      text.includes('gate1-target-run') && !text.includes(fixture.injection.renderedLine)
        ? 'e-other'
        : 'e-continue',
    )
  }
}
