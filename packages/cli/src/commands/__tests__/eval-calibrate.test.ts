import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as model from '@vostride/agent-qa-model'
import { asRef } from '@vostride/agent-qa-schema'
import { readCommittedCorpus, readLabelCalibration } from '@vostride/agent-qa-eval-local'
import { files, markFixture } from '../../gates/__tests__/feedback-fixture.js'
import { resolveEvalSession, runSeedVerb } from '../../eval-session-composition.js'
import { createEvalCommand } from '../eval.js'

const roots: string[] = []
const bytes = (root: string) => files(root).map(path => [path, readFileSync(path).toString('hex')])
beforeEach(() => {
  process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('provider access forbidden') })
  vi.spyOn(model, 'createModel').mockImplementation(() => { throw new Error('model creation forbidden') })
})
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
  process.exitCode = 0
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function fixture(seed = true) {
  const f = markFixture(); roots.push(f.root)
  if (seed) {
    const member = f.handoff.tests[0]!, step = member.steps[0]!
    member.outcome = 'healed'; f.handoff.aggregateVerdict = 'healed'
    step.verifierVerdict = { pass: true, reasoning: 'Recovery verified' }
    step.modelProfile = { provider: 'openai', modelId: 'small-fixture', vision: true }
    const failed = step.subActions[0]!, ref = asRef('e-recovery')
    failed.result = { success: false, error: 'First action rejected' }
    failed.stateBefore.elements.push({ ...structuredClone(failed.stateBefore.elements[0]!), ref,
      name: 'Recovery', nameNormalized: 'recovery', labels: { ariaLabel: 'Recovery' } })
    failed.stateBefore.refMap[ref] = structuredClone(failed.stateBefore.refMap[failed.stateBefore.elements[0]!.ref]!)
    const recovering = structuredClone(failed)
    recovering.plannedAction = { type: 'click', ref }; recovering.result = { success: true }
    recovering.callRecord = { resolvedModelId: 'small-fixture' }
    step.subActions = [failed, recovering]
    step.selfHeal = { failedDecision: { plan: failed.plan, plannedAction: failed.plannedAction, result: failed.result },
      recoveringDecision: { plan: recovering.plan, plannedAction: recovering.plannedAction, result: recovering.result } }
    f.save()
    const session = await resolveEvalSession({ configPath: f.configPath, keyOnly: true })
    const seeded = await runSeedVerb(session, {}, { heldOutFraction: 0.2, privateFraction: 0.5 })
    expect(seeded).toMatchObject({ seededCount: 2, refusals: [], runsSkipped: [] })
    // Newly recorded immutable evidence makes both existing weights stale.
    recovering.callRecord = { resolvedModelId: 'gpt-5' }; f.save()
  }
  return { ...f, committedRoot: join(f.root, 'agent-qa-eval') }
}

async function invoke(configPath: string, flags: string[] = []) {
  const command = createEvalCommand()
  expect(command.commands.find(child => child.name() === 'calibrate'), 'explicit calibration registration').toBeDefined()
  const program = new Command('agent-qa').option('--config <path>').addCommand(command).exitOverride()
  vi.mocked(console.log).mockClear(); vi.mocked(console.error).mockClear(); process.exitCode = 0
  await program.parseAsync(['--config', configPath, 'eval', 'calibrate', ...flags], { from: 'user' })
  return { stdout: vi.mocked(console.log).mock.calls.map(row => row.join(' ')).join('\n'),
    stderr: vi.mocked(console.error).mock.calls.map(row => row.join(' ')).join('\n'), exit: process.exitCode }
}

describe('420 explicit operator calibration CLI', () => {
  it('bare invocation renders precision and separate SOFT refresh counts without any writes', async () => {
    const f = await fixture(), before = bytes(f.root)
    const output = await invoke(f.configPath)
    expect(output.exit).toBe(0)
    expect(output.stdout).toContain('recorded-verdict: uncalibrated n_gold=0')
    expect(output.stdout).toContain('precision=unavailable (below minimum) interval=unavailable (below minimum)')
    expect(output.stdout).toContain('0/0 rate=unavailable (zero denominator)')
    expect(output.stdout).toContain('0/0 accuracy=unavailable (zero denominator)')
    expect(output.stdout).toContain('SOFT refreshedCount=2')
    expect(output.stdout).toContain('Precision on selected operator marks; not an unbiased estimate for all runtime traffic.')
    expect(output.stdout).toContain('SOFT verdict and capability factors remain provisional evidence discounts')
    expect(output.stdout).toContain('member/producer:app_bug-binary')
    expect(output.stdout).toContain('verifier false-pass')
    expect(output.stdout).toContain('verifier false-fail')
    expect(bytes(f.root)).toEqual(before)
  })
  it('--json returns default provenance and stable complete targets', async () => {
    const f = await fixture(), before = bytes(f.root)
    const output = await invoke(f.configPath, ['--json']), dto = JSON.parse(output.stdout)
    expect(dto).toMatchObject({ kind: 'dry-run', refreshedCount: 2, artifact: { minGold: { value: 20, source: 'default' } } })
    expect(dto.artifact.targetRevisions).toHaveLength(2)
    expect(bytes(f.root)).toEqual(before)
  })
  it('--commit activates both weights and the identical invocation is unchanged with stable bytes', async () => {
    const f = await fixture()
    const first = JSON.parse((await invoke(f.configPath, ['--commit', '--json'])).stdout)
    expect(first).toMatchObject({ kind: 'committed', refreshedCount: 2 })
    const before = bytes(f.committedRoot)
    const second = JSON.parse((await invoke(f.configPath, ['--commit', '--json'])).stdout)
    expect(second).toEqual({ ...first, kind: 'unchanged', refreshedCount: 0 })
    expect(bytes(f.committedRoot)).toEqual(before)
    expect(readLabelCalibration(f.committedRoot).kind).toBe('loaded')
    expect([...readCommittedCorpus(f.committedRoot).snapshot.labelsById.values()].every(row => row.weight?.tierFactor === 1)).toBe(true)
  })
  it('--min-gold records cli provenance and --commit --replace alone permits divergence', async () => {
    const f = await fixture()
    const preview = JSON.parse((await invoke(f.configPath, ['--min-gold', '2', '--json'])).stdout)
    expect(preview.artifact.minGold).toEqual({ value: 2, source: 'cli' })
    await invoke(f.configPath, ['--commit', '--json'])
    const before = bytes(f.committedRoot)
    const conflict = await invoke(f.configPath, ['--commit', '--min-gold', '2', '--json'])
    expect(JSON.parse(conflict.stdout).kind).toBe('write-conflict')
    expect(conflict.exit).toBe(1)
    expect(bytes(f.committedRoot)).toEqual(before)
    const replaced = JSON.parse((await invoke(f.configPath, ['--commit', '--replace', '--min-gold', '2', '--json'])).stdout)
    expect(replaced).toMatchObject({ kind: 'committed', refreshedCount: 0, artifact: { minGold: { value: 2, source: 'cli' } } })
  })
  for (const value of ['1', '2.5', '9007199254740992', 'AKIAIOSFODNN7EXAMPLE', 'NaN']) {
    it(`refuses invalid minimum ${value} safely before mutation`, async () => {
      const f = await fixture(false), before = bytes(f.root)
      const output = await invoke(f.configPath, ['--min-gold', value, '--json'])
      expect(output.exit).toBe(1)
      expect(JSON.parse(output.stdout)).toMatchObject({ kind: 'refused', reason: '--min-gold must be a safe integer of at least 2.' })
      expect(output.stdout + output.stderr).not.toContain(value)
      expect(bytes(f.root)).toEqual(before)
    })
  }
  it('refuses --replace without --commit in text and JSON without leaking config errors', async () => {
    const f = await fixture(false), before = bytes(f.root)
    expect((await invoke(f.configPath, ['--replace'])).stderr).toContain('--replace requires --commit')
    expect(JSON.parse((await invoke(f.configPath, ['--replace', '--json'])).stdout).kind).toBe('refused')
    expect(bytes(f.root)).toEqual(before)
    writeFileSync(f.configPath, 'AKIAIOSFODNN7EXAMPLE: [')
    for (const flags of [[], ['--json']]) {
      const output = await invoke(f.configPath, flags)
      expect(output.exit).toBe(1)
      expect(output.stdout + output.stderr).not.toContain('AKIAIOSFODNN7EXAMPLE')
      expect(output.stdout + output.stderr).toContain('config')
    }
  })
  it('commits an empty global population with no credentials or preexisting eval root', async () => {
    const f = await fixture(false)
    expect(existsSync(f.committedRoot)).toBe(false)
    const result = JSON.parse((await invoke(f.configPath, ['--commit', '--json'])).stdout)
    expect(result).toMatchObject({ kind: 'committed', refreshedCount: 0 })
    expect(readLabelCalibration(f.committedRoot).kind).toBe('loaded')
  })
})
