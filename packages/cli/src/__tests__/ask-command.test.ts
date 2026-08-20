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

/**
 * Every composition input this command handed the real composition root (395-22 · (A3)).
 *
 * A PASS-THROUGH RECORDER AND NOT A DOUBLE. The mock below delegates to the genuine
 * `composeCliLocalAgent` — every other cell in this file drives the real registry through the real
 * composition and must keep doing so, because "the CLI owns no turn capability" is a structural
 * claim that a stubbed composition would make unmeasurable. What is added is a tap: the ARGUMENT is
 * captured on its way through, which is the only thing (A3) is about.
 */
const compositionInputs = vi.hoisted(() => [] as { chatPresent?: (text: string) => void }[])

vi.mock('../composition/local-agent-host.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../composition/local-agent-host.js')>()
  return {
    ...original,
    composeCliLocalAgent: (input: Parameters<typeof original.composeCliLocalAgent>[0]) => {
      compositionInputs.push(input as { chatPresent?: (text: string) => void })
      return original.composeCliLocalAgent(input)
    },
  }
})

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
    compositionInputs.length = 0
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
    // field reaches stdout at all, on the deterministic turn.
    //
    // 2026-08-20 (399.1-04): THE LINE MOVED AND THE CLAIM DID NOT. `proposals.list` declares a
    // classifier now — `classify` is a REQUIRED member of `FunctionSpec` as of plan 04 — so the
    // engine's `${functionId} completed` fallback is not what this op reports any more. The op's
    // own one-line map is, and the string below is it for an EMPTY inbox, which is what this
    // fixture workspace has. It is still a contiguous string the shipped line renders only by
    // printing `outcome`: the functionId and the clause are separate fields, and neither of them
    // is this sentence.
    const configPath = fixtureWorkspace(roots)
    const result = await runAsk(configPath, ['proposals'])

    expect(result.stdout).toContain('0 proposal(s) in the inbox')
  })

  it('(A3) binds a presentation port on the SAME stream its confirm prompts on', async () => {
    // 395-22 · CR-03 · CFGM-05. `composeCliLocalAgent` supplies `createTtyConfirmPort()` whenever
    // this process has two TTYs, so at a terminal this command DOES ask a person to approve gated
    // work — and until this plan it bound no surface to show them what they were approving. Round
    // 4's verification measured the consequence end to end: the complete set of bytes on the
    // terminal before the decision was the approval prompt itself.
    //
    // THE BINDING IS THE CLAIM, MEASURED AT THE SEAM. `ask.ts` cannot decide what a turn is, and it
    // does not: it hands the composition a writer, exactly as `chat.ts:289` does, and everything
    // downstream is the shared composition's. So the cell asserts the argument, and then asserts
    // what the argument DOES — a binding present but inert would pass the first half alone.
    const configPath = fixtureWorkspace(roots)
    await runAsk(configPath, ['proposals'])

    expect(compositionInputs).toHaveLength(1)
    const chatPresent = compositionInputs[0]?.chatPresent
    expect(typeof chatPresent).toBe('function')

    // AND IT WRITES TO STDOUT, WITH A TRAILING NEWLINE, THROUGH THE MASKER. The stream matters more
    // than the bytes: a render on any other stream is a render the person answering the prompt is
    // not reading, which is the whole content of the 2026-08-14 "reviewable binds at approval time"
    // ruling. `process.stdout.write` is spied rather than `console.log`, because the confirm prompt
    // this must share a stream with writes the same way.
    const written: string[] = []
    const write = vi.spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
        return true
      })
    try {
      chatPresent?.('a summary line\nagent-qa.config.yaml\n--- /dev/null')
    } finally {
      write.mockRestore()
    }
    expect(written.join('')).toBe('a summary line\nagent-qa.config.yaml\n--- /dev/null\n')
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
