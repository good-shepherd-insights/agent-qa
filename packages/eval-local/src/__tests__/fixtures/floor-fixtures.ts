import { cpSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  committedFileText,
  deriveLeafCassetteId,
  extractRunCassettes,
  projectCorpusEntry,
  projectPartitionManifest,
} from '@vostride/agent-qa-eval'
import { asRunId, computeBriefDigest } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'

import { FsCassetteStore } from '../../cassette-store.js'
import { loadCassetteBundles } from '../../replay-sweep.js'
import { listCassetteBundleDirs } from '../../replay-read.js'
import { readCommittedCorpus } from '../../committed-corpus-source.js'
import {
  buildRootMarkerValue,
  COMMITTED_GITIGNORE_TEXT,
  committedCorpusPath,
  committedPartitionManifestPath,
  FsCommittedRootStore,
} from '../../committed-root-store.js'
import {
  actionGenerateResult,
  capturingStub,
  makeReplayHandoff,
  memArtifacts,
  noneAuth,
  stubProfile,
} from './replay-fixtures.js'

export { noneAuth, stubProfile }

// Generated with packages/ids' generateRunId; frozen so independent fixture rebuilds pair.
const RUN_IDS = [
  'r_proper-ewer-rud-ignore-ula-junk-may-effect-eva-ada',
  'r_unset-dirty-hop-axon-awn-folder-crete-bases-enable-client',
  'r_exit-amma-social-two-polis-block-gree-urge-inez-sip',
] as const

export function warningStub() {
  return capturingStub(() => ({
    ...actionGenerateResult(),
    warnings: [{ type: 'unsupported', feature: 'seed' }],
  }))
}

export function incrementingClock(increment = 10) {
  let value = 0
  return () => (value += increment)
}

/** Shared zero-network floor/gate fixture: real extraction, bundle writes and reloads. */
export function writeFloorLeaves(
  root: string,
  count = 3,
  configure?: (handoff: CompletedRunHandoff, index: number) => void,
) {
  const cassettesRoot = join(root, 'cassettes')
  const store = new FsCassetteStore({ root, outputDir: cassettesRoot })
  for (let index = 0; index < count; index++) {
    const handoff = makeReplayHandoff({ vision: false })
    const runId = RUN_IDS[index]
    if (runId === undefined) throw new Error('floor fixture supports at most three leaves')
    handoff.runId = asRunId(runId)
    configure?.(handoff, index)
    const leaf = extractRunCassettes({ handoff, artifacts: memArtifacts() }).cassettes
      .find(entry => entry.cassette.granularity === 'leaf')
    if (leaf === undefined) throw new Error('expected extracted floor leaf')
    store.write(leaf)
  }
  const selected = loadCassetteBundles(cassettesRoot).loaded
  return { cassettesRoot, selected }
}

/** Two products and all measured splits, projected through canonical corpus/partition helpers. */
export function writeCommittedFloorFixture(
  root: string,
  configure?: (handoff: CompletedRunHandoff, index: number) => void,
) {
  const committedRoot = join(root, 'committed')
  const bundles = writeFloorLeaves(committedRoot, 3, (handoff, index) => {
    const scope = { tier: 'product', key: index === 2 ? 'beta' : 'alpha' } as const
    handoff.scope = scope
    const brief = handoff.tests[0]!.steps[0]!.servedBrief!
    brief.scope = scope
    brief.briefDigest = computeBriefDigest(brief)
    configure?.(handoff, index)
  })
  const store = new FsCommittedRootStore({ committedRoot })
  store.scaffold(COMMITTED_GITIGNORE_TEXT, committedFileText(buildRootMarkerValue()))
  for (const { cassette } of bundles.selected) {
    if (cassette.granularity !== 'leaf') throw new Error('expected fixture leaf')
    const index = RUN_IDS.findIndex(id => cassette.runId === id)
    const product = index === 2 ? 'beta' : 'alpha'
    const entry = projectCorpusEntry({
      cassette, product, runId: cassette.runId,
      assignment: index === 0 ? { split: 'natural' } : {
        split: 'held-out', heldOutVisibility: index === 1 ? 'shared' : 'private',
      },
    })
    store.writeText(committedCorpusPath(product, cassette.id), committedFileText(entry))
  }
  for (const product of ['alpha', 'beta']) {
    store.writeText(committedPartitionManifestPath(product), committedFileText(projectPartitionManifest({
      product, saltHex: 'a'.repeat(64), heldOutFraction: 0.5, privateFraction: 0.5,
    })))
  }
  return { ...bundles, committedRoot }
}

export const MEMBERSHIP_DEFECTS = [
  'missing directory', 'missing marker', 'duplicate bundle', 'foreign bundle',
  'duplicate entry', 'invalid entry',
] as const

/** Mutate only the caller's temporary corpus; retain its committed membership in bundle cases. */
export function changeCommittedMembership(
  fixture: ReturnType<typeof writeCommittedFloorFixture>,
  defect: (typeof MEMBERSHIP_DEFECTS)[number],
): void {
  const bundle = listCassetteBundleDirs(fixture.cassettesRoot)[0]!
  if (defect === 'missing directory') rmSync(bundle, { recursive: true })
  if (defect === 'missing marker') unlinkSync(join(bundle, 'cassette.json'))
  if (defect === 'duplicate bundle') cpSync(bundle, join(fixture.cassettesRoot, 'duplicate'), { recursive: true })
  if (defect === 'foreign bundle') {
    const foreign = join(fixture.cassettesRoot, 'foreign')
    cpSync(bundle, foreign, { recursive: true })
    const cassette = JSON.parse(readFileSync(join(foreign, 'cassette.json'), 'utf8'))
    cassette.id = deriveLeafCassetteId({
      runSlug: cassette.runId, testIndex: 99, stepIndex: 0, decisionOrdinal: 0,
    })
    writeFileSync(join(foreign, 'cassette.json'), JSON.stringify(cassette))
  }
  if (defect === 'duplicate entry' || defect === 'invalid entry') {
    const entry = readCommittedCorpus(fixture.committedRoot).snapshot.entries[0]!
    const file = join(fixture.committedRoot, committedCorpusPath(entry.product, entry.cassetteId))
    if (defect === 'duplicate entry') cpSync(file, file.replace(/\.json$/, '.duplicate.json'))
    else writeFileSync(file, '{invalid')
  }
}
