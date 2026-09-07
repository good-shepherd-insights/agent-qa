import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { slugBranch } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'
import * as evalLocal from '../index.js'
import { gate1Responder, warmGateRoot, writeGate1Fixture } from './fixtures/gate1-fixtures.js'
import { actionGenerateResult, respondingStub, type CapturedCallOptions } from './fixtures/replay-fixtures.js'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gate1-'))
  roots.push(root)
  return writeGate1Fixture(root)
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function cacheInput(f: ReturnType<typeof fixture>) {
  return { agentQaRoot: f.agentQaRoot, ...f.identity, gateRootSeed: 11, gateRootSeedSource: 'floor',
    cassettes: f.selected.map(row => ({ id: row.cassette.id, promptInputHash: row.cassette.receipt.promptInputHash })) }
}

describe('gate-1 fixture and the profile-keyed baseline cache', () => {
  it('exports the cache resolution and root discovery operations', () => {
    expect(Reflect.get(evalLocal, 'resolveBaselineCache')).toBeTypeOf('function')
    expect(Reflect.get(evalLocal, 'listBaselineRunRoots')).toBeTypeOf('function')
  })
  it('lists the gate root first, sorted floor roots with seeds, and no cold roots', async () => {
    const f = fixture()
    await warmGateRoot(f, respondingStub(gate1Responder(f)))
    const floor = join(f.agentQaRoot, 'eval', 'floor', slugBranch(f.profileKey), 'r0-seed7')
    mkdirSync(floor, { recursive: true })
    expect(evalLocal.listBaselineRunRoots(f.agentQaRoot, f.profileKey)).toEqual([
      { root: f.gateRoot, kind: 'gate' }, { root: floor, kind: 'floor', seed: 7 },
    ])
    expect(evalLocal.listBaselineRunRoots(join(f.root, 'cold'), f.profileKey)).toEqual([])
  })
  it('resolves every warm row cached with seedSource and no new provider call', async () => {
    const f = fixture()
    const stub = respondingStub(gate1Responder(f))
    const warmed = await warmGateRoot(f, stub)
    const calls = stub.captured.length
    const result = evalLocal.resolveBaselineCache(cacheInput(f))
    expect(result.rows).toHaveLength(6)
    for (const row of result.rows) expect(row).toMatchObject({ kind: 'cached', seed: 11, seedSource: 'floor', seedHonored: warmed.report.seedHonored })
    expect(result.roots).toEqual([f.gateRoot])
    expect(stub.captured.length).toBe(calls)
  })
  it('names missing replay records on a cold root and fingerprint mismatch on a foreign root', async () => {
    const f = fixture()
    const cold = evalLocal.resolveBaselineCache(cacheInput(f))
    expect(cold.rows.every(row => row.kind === 'uncached' && row.reason.includes('replay record'))).toBe(true)
    await warmGateRoot(f, respondingStub(gate1Responder(f)))
    const foreign = evalLocal.resolveBaselineCache({ ...cacheInput(f), fingerprint: 'f'.repeat(64) })
    expect(foreign.rows.every(row => row.kind === 'uncached' && row.reason.includes('fingerprint'))).toBe(true)
  })
  it('responds with gold except for a target missing the renderedLine', () => {
    const f = fixture()
    const respond = gate1Responder(f)
    const call = (text: string) => ({ prompt: [{ role: 'user', content: [{ type: 'text', text }] }] }) as CapturedCallOptions
    expect(respond(call('gate1-collateral-0'))).toEqual(actionGenerateResult())
    expect(respond(call('gate1-target-run'))).toEqual(actionGenerateResult('web', 'e-other'))
    expect(respond(call('gate1-target-run ' + f.injection.renderedLine))).toEqual(actionGenerateResult())
  })
})
