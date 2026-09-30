import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asRunId, RunsMarkOutcomeSchema } from '@vostride/agent-qa-schema'
import { markFixture } from '../../gates/__tests__/feedback-fixture.js'
import { createRunsCommand, renderMarkOutcome } from '../runs.js'
import * as host from '../../composition/local-agent-host.js'

describe('runs mark thin client', () => {
  let root: string | undefined
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; if (root) rmSync(root, { recursive: true, force: true }) })
  const program = () => {
    const runs = createRunsCommand().exitOverride().configureOutput({ writeErr: () => {} })
    for (const sub of runs.commands) sub.exitOverride().configureOutput({ writeErr: () => {} })
    return new Command().exitOverride().option('--config <path>').addCommand(runs)
  }

  it('tracer: confirmed-bug goes through the real function gate and accepted terminal confirmation', async () => {
    const f = markFixture(); root = f.root
    const input = new PassThrough()
    let prompt = ''
    const terminal = new Writable({ write(chunk, _encoding, done) {
      prompt += String(chunk)
      if (String(chunk).includes('[y/N]')) queueMicrotask(() => input.write('y\n'))
      done()
    } })
    const compose = host.composeCliLocalAgent
    vi.spyOn(host, 'composeCliLocalAgent').mockImplementation(options => compose({ ...options,
      confirm: host.createTtyConfirmPort({ isTty: true, input, output: terminal }),
      resolveExecutionContext: () => 'local-interactive',
    }))
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const correctedAction = f.handoff.tests[0]!.steps[0]!.subActions[0]!.plannedAction
    await program().parseAsync(['--config', f.configPath, 'runs', 'mark', f.handoff.runId, '--kind', 'confirmed-bug',
      '--corrected-action', JSON.stringify(correctedAction), '--json'], { from: 'user' })
    expect(errors.mock.calls).toEqual([])
    expect(prompt).toContain('fn:runs.mark')
    const result = RunsMarkOutcomeSchema.parse(JSON.parse(String(output.mock.calls.at(-1)?.[0])))
    expect(result).toMatchObject({ kind: 'marked', receipt: { ordinal: 1, origin: 'user', correctedAction, disposition: { kind: 'confirmed-bug' } } })
    expect(readFileSync(join(f.runDir, 'marks.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('denies no-TTY marks even under configured trustMode without a credential or confirmation', async () => {
    const f = markFixture(); root = f.root
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await program().parseAsync(['--config', f.configPath, 'runs', 'mark', f.handoff.runId, '--kind', 'confirmed-bug'], { from: 'user' })
    expect(String(errors.mock.calls[0]?.[0])).toContain('Denied runs.mark')
    expect(process.exitCode).toBe(1)
  })

  it('refuses confirmed-pass with the three supported kinds before any op runs', async () => {
    const cmd = program().configureOutput({ writeErr: () => {} })
    await expect(cmd.parseAsync(['runs', 'mark', 'unused', '--kind', 'confirmed-pass'], { from: 'user' }))
      .rejects.toThrow(/false-fail.*false-pass.*confirmed-bug/)
  })

  // 432-09 (D-04/D-22): the terminal receipt names what the fix changed; a pre-432 drafted receipt
  // read back from a ledger says it was drafted and names no proposal to act on.
  it('renders an applied receipt with the records or file it changed, and a historical draft without a proposal id', () => {
    const base = { schemaVersion: 1 as const, markId: 'mark_0123456789ab', runId: asRunId('run-render'), runSlug: 'run-render',
      testIndex: 0, kind: 'false-fail' as const, origin: 'user' as const, ordinal: 2, markedAt: 0, gold: [],
      evidence: { confirmed: 1, overturned: 0 } }
    expect(renderMarkOutcome({ kind: 'marked', receipt: { ...base, disposition: { kind: 'applied', fix: 'fact',
      change: { kind: 'knowledge', changeId: 'prop_0123456789ab', recordIds: ['mem_a', 'mem_b'] } } } }))
      .toBe('marked false-fail on run-render test 0 · applied fact: changed mem_a, mem_b · receipt mark_0123456789ab #2')
    expect(renderMarkOutcome({ kind: 'marked', receipt: { ...base, stepIndex: 3, disposition: { kind: 'applied', fix: 'test-edit',
      change: { kind: 'test-file', filePath: 'tests/checkout.yaml', contentDigest: 'abc' } } } }))
      .toBe('marked false-fail on run-render test 0 step 3 · applied test-edit: wrote tests/checkout.yaml · receipt mark_0123456789ab #2')
    const historical = renderMarkOutcome({ kind: 'marked', receipt: { ...base, disposition: { kind: 'drafted', fix: 'fact',
      proposalId: 'prop_0123456789ab', proposalKind: 'knowledge' } } })
    expect(historical).toContain('drafted: fact (recorded before fixes applied directly)')
    expect(historical).not.toContain('prop_')
  })
})
