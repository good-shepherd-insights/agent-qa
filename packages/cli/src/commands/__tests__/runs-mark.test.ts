import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunsMarkOutcomeSchema } from '@vostride/agent-qa-schema'
import { markFixture } from '../../gates/__tests__/feedback-fixture.js'
import { createRunsCommand } from '../runs.js'
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
})
