import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { buildFixture, payloadsForFixture, writeFixture } from './fixtures.js'
import { LOGICAL_DUMP_EXCLUDED_COLUMNS } from './logical-dump.js'
import {
  DUAL_HOST_ENV,
  LEG_TIMEOUT_MS,
  cleanupDualHostRoots,
  makeRoot,
  runLeg,
} from './spawn-helpers.js'

const childMode = process.env[DUAL_HOST_ENV.child] === '1'

if (childMode) {
  it('runs the selected dual-host child leg', async () => {
    const host = process.env[DUAL_HOST_ENV.host]
    if (host === 'one-shot') {
      const { runOneShotLeg } = await import('./one-shot-leg.fixture.js')
      await runOneShotLeg()
      return
    }
    if (host === 'daemon') {
      const { runDaemonLeg } = await import('./daemon-leg.fixture.js')
      await runDaemonLeg()
      return
    }
    throw new Error(`unsupported dual-host child role: ${String(host)}`)
  }, LEG_TIMEOUT_MS)
} else {
  afterAll(cleanupDualHostRoots)

  describe('DAEM-08 dual-host byte identity', () => {
    it('leaves byte-identical bundles and ordered logical rows for mixed run postures', async () => {
    const fixtureRoot = makeRoot('fixture-mixed')
    const fixtureFile = join(fixtureRoot.root, 'shared-fixture.json')
    const fixture = buildFixture('mixed')
    writeFixture(fixtureFile, fixture)

    const oneShot = await runLeg('one-shot', makeRoot('one-shot-mixed'), fixtureFile, 'mixed')
    const daemon = await runLeg('daemon', makeRoot('daemon-mixed'), fixtureFile, 'mixed')

    expect(oneShot.bundleTree).toBe(daemon.bundleTree)
    expect(oneShot.logicalDump).toBe(daemon.logicalDump)
    expect(oneShot.epoch).toBe(1)
    expect(daemon.epoch).toBe(1)
    expect(oneShot.bundleCount).toBe(2)
    expect(daemon.bundleCount).toBe(2)
    expect(oneShot.candidateIds).toEqual(daemon.candidateIds)
    expect(oneShot.authorOrder).toEqual([...fixture.candidates]
      .map(({ candidateId }) => candidateId)
      .sort())
    expect(daemon.authorOrder).toEqual(oneShot.authorOrder)
    expect(oneShot.commitOrder).toEqual(oneShot.authorOrder)
    expect(daemon.commitOrder).toEqual(oneShot.commitOrder)
    expect(oneShot.dispositions).toEqual(daemon.dispositions)
    const payloads = payloadsForFixture(fixture)
    const localId = payloads.find(({ executionContext }) =>
      executionContext === 'local-interactive')?.candidateId
    const ciId = payloads.find(({ executionContext }) => executionContext === 'ci')?.candidateId
    expect(oneShot.dispositions.find(({ candidateId }) => candidateId === localId))
      .toMatchObject({ status: 'active' })
    expect(oneShot.dispositions.find(({ candidateId }) => candidateId === ciId))
      .toMatchObject({ status: 'candidate' })
    expect(oneShot.embedStatuses).toEqual(['pending', 'pending'])

    const dump = JSON.parse(oneShot.logicalDump) as Array<{
      table: string
      columns: string[]
      orderByColumns: string[]
    }>
    expect(LOGICAL_DUMP_EXCLUDED_COLUMNS).toEqual(['embedding'])
    for (const table of dump) {
      expect(table.orderByColumns, `${table.table} must order by every selected column`)
        .toEqual(table.columns)
      expect(table.columns).not.toContain('embedding')
    }
    const records = dump.find(({ table }) => table === 'records')
    expect(records?.columns).toContain('embed_status')
    }, LEG_TIMEOUT_MS)
  })
}
