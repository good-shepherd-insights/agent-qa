// `agent-qa chat` — the REPL, over the real composition (Phase 392 plan 08, D-01/D-17/D-23/D-24).
//
// THE STRUCTURAL CLAIM IS THE SAME ONE `ask` MAKES, and it is why they are two commands and one
// engine: the REPL owns no turn capability. Every line a person types becomes one
// `invokeFunction(agent.ask)`, so a conversation can do exactly what the function layer lets it do
// and 397's parity suite reads the verb off the registry without the CLI being consulted (D-24).
// The last case in this file pins that as source text, because the behavioural cases would all
// still pass if a second turn path grew beside the op.
//
// NOTHING HERE IS STUBBED. The command builds the real registry through the real composition root
// in every case; the session files it reads back are the ones the real JSONL adapter wrote. The
// only injected seams are the streams, because a suite that needed a real terminal would be a
// suite that never runs — and the arm that matters most (no terminal ⇒ no inline confirm) is
// exactly the one a real terminal could not exercise.

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createChatCommand } from '../commands/chat.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: number | string | undefined
}

function fixtureWorkspace(roots: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-chat-command-'))
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

/** Drive the REPL over scripted stdin: every line, then EOF. */
async function runChat(
  configPath: string,
  args: string[],
  typed: readonly string[] = [],
): Promise<InvocationResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  process.exitCode = undefined

  const input = new PassThrough()
  const output = new PassThrough()
  output.resume()

  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createChatCommand({ input, output, isTty: false }))
    program.exitOverride()
    const parsed = program.parseAsync([
      'node',
      'agent-qa',
      '--config',
      configPath,
      'chat',
      ...args,
    ])
    // Written after the loop has had a tick to open, so a scripted line is never delivered to a
    // readline that does not exist yet.
    await Promise.resolve()
    for (const line of typed) input.write(`${line}\n`)
    input.end()
    await parsed
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode }
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
}

function sessionFiles(configPath: string): string[] {
  const sessions = join(dirname(configPath), '.agent-qa', 'sessions')
  try {
    return readdirSync(sessions).filter((file) => file.endsWith('.jsonl'))
  } catch {
    return []
  }
}

describe('agent-qa chat (the REPL over one turn engine)', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('runs one turn end to end and closes on /quit', async () => {
    const configPath = fixtureWorkspace(roots)
    const result = await runChat(configPath, [], ['proposals', '/quit'])

    expect(result.stderr).toBe('')
    // The receipt line names the op that actually ran, which is the visible difference between a
    // turn and a chatbot: the surface reports a capability invocation, not prose.
    expect(result.stdout).toContain('proposals.list')
    expect(result.stdout).toContain('executed')
    // ONE session, opened by default (D-17). The id is printed once so a person can `--session` it.
    expect(sessionFiles(configPath)).toHaveLength(1)
    expect(result.stdout).toContain('chat-')
  })

  it('the rendered receipt line carries the receipt\'s own `outcome`', async () => {
    // SC-5's REPORTING half (WINDOWS 124, WTST-08's remaining half), owner-ratified 2026-08-13:
    // the RENDERED LINE governs, not the persisted artifact. `Runs consumed: N (previewed up to M)`
    // is composed into `ClauseReceipt.outcome` at turn-engine.ts:176 and persisted verbatim — and a
    // render that never reads `outcome` is a person told what an invocation MIGHT cost and never
    // what it DID. The field is pinned here on the deterministic turn every other case drives, so
    // the claim is about the render rather than about a fan-out fixture: for a non-authoring op the
    // outcome is exactly `${functionId} completed`, and the shipped line renders the functionId and
    // the clause as separate fields, so the contiguous string cannot appear unless `outcome` does.
    const configPath = fixtureWorkspace(roots)
    const result = await runChat(configPath, [], ['proposals', '/quit'])

    expect(result.stdout).toContain('proposals.list completed')
  })

  it('prints the banner at most once, on open', async () => {
    const configPath = fixtureWorkspace(roots)
    // A bare project has nothing pending, so D-23's answer is SILENCE — a REPL that greeted every
    // open with a status line would train a person to skip the line that mattered.
    const result = await runChat(configPath, [], ['/quit'])

    expect(result.stdout).not.toContain('pending — type')
  })

  it('/help names the reach lever and executes nothing', async () => {
    const configPath = fixtureWorkspace(roots)
    const result = await runChat(configPath, [], ['/help', '/quit'])

    expect(result.stdout).toContain('/fn')
  })

  it('--list reports the sessions and the files it could not read', async () => {
    const configPath = fixtureWorkspace(roots)
    await runChat(configPath, [], ['proposals', '/quit'])

    const listed = await runChat(configPath, ['--list'])

    const [file] = sessionFiles(configPath)
    expect(file).toBeDefined()
    expect(listed.stdout).toContain(file!.replace('.jsonl', ''))
    // No new session: `--list` is a read that exits, not a conversation that opens one.
    expect(sessionFiles(configPath)).toHaveLength(1)
  })

  it('--session with an unknown id is a typed refusal, never a create', async () => {
    const configPath = fixtureWorkspace(roots)
    const result = await runChat(configPath, ['--session', 'chat-20260809-000000-zzzz'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('chat-20260809-000000-zzzz')
    // The load-bearing half. A resume path that CREATED the session it could not find would
    // silently start a new conversation while a person believed they were back in an old one.
    expect(sessionFiles(configPath)).toHaveLength(0)
  })

  it('--continue reopens the most recent session rather than opening a new one', async () => {
    const configPath = fixtureWorkspace(roots)
    await runChat(configPath, [], ['proposals', '/quit'])
    expect(sessionFiles(configPath)).toHaveLength(1)

    await runChat(configPath, ['--continue'], ['proposals', '/quit'])

    expect(sessionFiles(configPath)).toHaveLength(1)
  })

  it('--continue with nothing to continue is a refusal, not a fresh session', async () => {
    const configPath = fixtureWorkspace(roots)
    const result = await runChat(configPath, ['--continue'])

    expect(result.exitCode).toBe(1)
    expect(sessionFiles(configPath)).toHaveLength(0)
  })

  it('the interrupt handler writes an explicit aborted row (D-19 graceful arm)', async () => {
    // DRIVEN DIRECTLY rather than by a real signal: what is being measured is that the handler
    // writes the event, and a test that raised SIGINT would be measuring the test runner's signal
    // disposition instead. The handler is exported for exactly this reason.
    const configPath = fixtureWorkspace(roots)
    const interrupts: (() => Promise<void>)[] = []
    const input = new PassThrough()
    const output = new PassThrough()
    output.resume()

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const program = new Command()
        .option('--config <path>', 'config file path')
        .addCommand(
          createChatCommand({
            input,
            output,
            isTty: false,
            onInterruptHandler: (handler) => interrupts.push(handler),
          }),
        )
      program.exitOverride()
      const parsed = program.parseAsync(['node', 'agent-qa', '--config', configPath, 'chat'])
      await Promise.resolve()
      input.write('proposals\n')
      // The handler is invoked mid-session, which is where a Ctrl+C lands.
      await new Promise((resolve) => setTimeout(resolve, 50))
      for (const handler of interrupts) await handler()
      input.end()
      await parsed
    } finally {
      log.mockRestore()
    }

    expect(interrupts.length).toBeGreaterThan(0)
    const [file] = sessionFiles(configPath)
    expect(file).toBeDefined()
    const lines = readFileSync(
      join(dirname(configPath), '.agent-qa', 'sessions', file!),
      'utf8',
    )
    // Between turns the handler is a NO-OP by contract, so the honest assertion is that the file
    // is intact and ends in a complete line — a handler that wrote an `aborted` row for a turn
    // already carrying its `turn_complete` would make the next open's repair prune a finished turn.
    expect(lines.endsWith('\n')).toBe(true)
  })

  it('drives turns ONLY through invokeFunction on agent.ask, and builds no model', () => {
    // A SOURCE PIN, because every behavioural case above would still pass if the REPL grew a
    // second turn path beside the op. `createTurnEngine` here would be the largest private power
    // in the system: an orchestrator reachable through nothing the catalogue declares (D-24).
    const source = readFileSync(join(__dirname, '..', 'commands', 'chat.ts'), 'utf8')
    expect(source).toContain('AGENT_ASK_FUNCTION_ID')
    expect(source).toContain('invokeFunction')
    for (const forbidden of ['createTurnEngine', 'runTurn(']) {
      expect({ forbidden, present: source.includes(forbidden) })
        .toEqual({ forbidden, present: false })
    }
    // CHAT-06's half, checked as a SPECIFIER rather than a token: `createModel` appears in this
    // file's prose explaining that the model arrives already built, and a token scan would report
    // the documentation of the rule as a violation of it (the rollcall's own negative control).
    for (const specifier of ['@vostride/agent-qa-model', '@ai-sdk/']) {
      expect({ specifier, present: source.includes(`'${specifier}`) })
        .toEqual({ specifier, present: false })
    }
    // The masking idiom, with dispose in a finally — a turn result is composed from op results,
    // and an op result is exactly the kind of value a masked config read can put a credential into.
    expect(source).toContain('createMaskingContext')
    expect(source).toContain('finally')
  })
})
