import { join } from 'node:path'

import {
  committedFileText,
  extractRunCassettes,
  projectCorpusEntry,
  projectPartitionManifest,
} from '@vostride/agent-qa-eval'
import { asRunId, computeBriefDigest } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'

import { FsCassetteStore } from '../../cassette-store.js'
import { loadCassetteBundles } from '../../replay-sweep.js'
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
export function writeCommittedFloorFixture(root: string) {
  const committedRoot = join(root, 'committed')
  const bundles = writeFloorLeaves(committedRoot, 3, (handoff, index) => {
    const scope = { tier: 'product', key: index === 2 ? 'beta' : 'alpha' } as const
    handoff.scope = scope
    const brief = handoff.tests[0]!.steps[0]!.servedBrief!
    brief.scope = scope
    brief.briefDigest = computeBriefDigest(brief)
  })
  const store = new FsCommittedRootStore({ committedRoot })
  store.scaffold(COMMITTED_GITIGNORE_TEXT, committedFileText(buildRootMarkerValue()))
  for (const { cassette } of bundles.selected) {
    if (cassette.granularity !== 'leaf') throw new Error('expected fixture leaf')
    const index = RUN_IDS.findIndex(id => cassette.receipt.runId === id)
    const product = index === 2 ? 'beta' : 'alpha'
    const entry = projectCorpusEntry({
      cassette, product, runId: cassette.receipt.runId,
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
