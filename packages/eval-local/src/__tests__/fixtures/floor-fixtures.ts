import { join } from 'node:path'

import { extractRunCassettes } from '@vostride/agent-qa-eval'
import { asRunId } from '@vostride/agent-qa-schema'

import { FsCassetteStore } from '../../cassette-store.js'
import { loadCassetteBundles } from '../../replay-sweep.js'
import {
  actionGenerateResult,
  capturingStub,
  makeReplayHandoff,
  memArtifacts,
  noneAuth,
  stubProfile,
} from './replay-fixtures.js'

export { noneAuth, stubProfile }

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
export function writeFloorLeaves(root: string, count = 3) {
  const cassettesRoot = join(root, 'cassettes')
  const store = new FsCassetteStore({ root, outputDir: cassettesRoot })
  for (let index = 0; index < count; index++) {
    const handoff = makeReplayHandoff({ vision: false })
    handoff.runId = asRunId(`floor-fixture-${index}`)
    const leaf = extractRunCassettes({ handoff, artifacts: memArtifacts() }).cassettes
      .find(entry => entry.cassette.granularity === 'leaf')
    if (leaf === undefined) throw new Error('expected extracted floor leaf')
    store.write(leaf)
  }
  const selected = loadCassetteBundles(cassettesRoot).loaded
  return { cassettesRoot, selected }
}
