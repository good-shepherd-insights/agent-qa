// `agent-qa ask "<message>"` — the one-shot chat verb, over the real composition (392 D-01/D-24).
//
// The claim under test is a STRUCTURAL one, and it is the reason D-24 exists: the CLI owns no turn
// capability of its own. It resolves a root, composes the local host, and calls `invokeFunction`
// with `agent.ask` exactly as `fn` does with any other op — so everything a turn can do, it can do
// because the function layer let it, and 397's parity suite picks the verb up from the registry
// without the CLI being consulted.
//
// Nothing here is stubbed. The command builds the real registry through the real composition root
// in both cases below; the failure case is driven by a real refusal from the real dispatch pipeline
// rather than by a thrown fixture, which is what makes the error-reporting assertion mean anything.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAskCommand } from '../commands/ask.js'

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: number | string | undefined
}

function fixtureWorkspace(roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-ask-command-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
    })}\n`,
    'utf8',
  )
  return configPath
}

async function runAsk(configPath: string, args: string[]): Promise<InvocationResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  process.exitCode = undefined

  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createAskCommand())
    program.exitOverride()
    await program.parseAsync(['node', 'agent-qa', '--config', configPath, 'ask', ...args])
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode }
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
}

describe('agent-qa ask (the one-shot chat verb)', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('D-24: routes a deterministic utterance through agent.ask and renders the receipt', async () => {
    const configPath = fixtureWorkspace(roots)
    const result = await runAsk(configPath, ['proposals'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    // The receipt line names the op that actually ran, which is the whole visible difference
    // between a turn and a chatbot: the surface reports a capability invocation, not prose.
    expect(result.stdout).toContain('proposals.list')
    expect(result.stdout).toContain('executed')
  })

  it('the rendered receipt line carries the receipt\'s own `outcome`', async () => {
    // SC-5's REPORTING half (WINDOWS 124, WTST-08's remaining half), owner-ratified 2026-08-13:
    // the RENDERED LINE governs. The scripted surface shares the REPL's receipt wording by design
    // (D-01: one turn, two surfaces), so it shares the omission too — fixing one alone would leave
    // a person's scripted run and their conversation disagreeing about what an invocation cost.
    // `Runs consumed: N (previewed up to M)` rides `ClauseReceipt.outcome`; this pins that the
    // field reaches stdout at all, on the deterministic turn (`${functionId} completed`).
    const configPath = fixtureWorkspace(roots)
    const result = await runAsk(configPath, ['proposals'])

    expect(result.stdout).toContain('proposals.list completed')
  })

  it('D-08: a fail-closed turn reports the clause and exits non-zero', async () => {
    const configPath = fixtureWorkspace(roots)
    const result = await runAsk(configPath, ['write a test for two factor auth'])

    // Non-zero, because a scripted `ask` whose request was not carried out must not look like
    // success to the shell that called it (the fn.ts error idiom).
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('write a test for two factor auth')
  })
})
