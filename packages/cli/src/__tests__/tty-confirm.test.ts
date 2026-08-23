// The terminal confirmation, and the two hosts that differ over it (Phase 391, PROP-01).
//
// This is the LAST arm of the v48 gate's ask ladder and the first host binding it has ever had.
// Until now `evaluate()`'s deny-by-default confirm answered for everybody, which meant an operator
// sitting at their own terminal was refused an ask-tier capability with no way to say yes short of
// `--trust-session`.
//
// WHAT IS ACTUALLY BEING MEASURED HERE is the binding RULE, not a terminal: whether a person is on
// the other end of this process, answered from the streams rather than from which command was
// typed. The prompt itself is driven over injected streams, because a suite that needed a real tty
// would be a suite that never runs — and the arm that matters most (no terminal → no confirm) is
// exactly the one a real tty could not exercise.

import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { buildRunDisclosure } from '@vostride/agent-qa-agent-local'

import { createTtyConfirmPort } from '../composition/local-agent-host.js'

const ACTION: RiskActionDescriptor = {
  name: 'fn:knowledge.proposal.apply',
  recognized: true,
  readOnly: false,
  declaredTier: 'mutating-shared',
}

/** Drive one prompt over injected streams and report both the answer and what was printed. */
async function ask(typed: string): Promise<{ answered: boolean; printed: string }> {
  const input = new PassThrough()
  const output = new PassThrough()
  let printed = ''
  output.on('data', (chunk: Buffer | string) => {
    printed += String(chunk)
  })

  const confirm = createTtyConfirmPort({ isTty: true, input, output })
  if (confirm === undefined) throw new Error('a tty host must bind a confirm')

  const pending = Promise.resolve(confirm(ACTION))
  input.write(typed)
  input.end()
  const answered = await pending
  return { answered, printed }
}

describe('the CLI binds a confirmation exactly where there is somebody to ask', () => {
  it('binds NOTHING without a terminal — the gate keeps its deny-by-default', () => {
    // The load-bearing arm. An absent field is what leaves `evaluate()`'s own DENY_CONFIRM in
    // place, which is the only correct answer for a piped `agent-qa`, a CI job, or the daemon.
    expect(createTtyConfirmPort({ isTty: false })).toBeUndefined()
  })

  it('answers yes to an explicit yes, naming the action verbatim in the question', async () => {
    const { answered, printed } = await ask('y\n')

    expect(answered).toBe(true)
    // The SAME string the audit row carries and the same one a standing grant would have to
    // match — so a person can connect what they were asked about to what `grants.list` shows.
    expect(printed).toContain('fn:knowledge.proposal.apply')
    expect(printed).toContain('[y/N]')
  })

  it('accepts the long form too', async () => {
    expect((await ask('YES\n')).answered).toBe(true)
  })

  it('refuses everything else, including an empty line and a closed stream', async () => {
    // DEFAULT NO, driven rather than asserted. Each of these is a way a person can fail to say
    // yes, and the direction of the error costs a retry rather than an unasked commit.
    for (const typed of ['n\n', '\n', 'maybe\n', '']) {
      expect((await ask(typed)).answered, JSON.stringify(typed)).toBe(false)
    }
  })

  it('is bound by THIS host and not by the daemon composition', () => {
    // A source pin, because the difference between the two hosts is an ABSENT field and an absent
    // optional field is invisible to the type system. The daemon composes the same shared
    // `composeLocalAgent` directly; if a `confirm` ever appears in that call, the headless host
    // acquires a prompt nobody is watching — and the fail-closed posture every CI and daemon
    // decision depends on would quietly become "whatever the unread prompt timed out to".
    const daemonHost = readFileSync(join(__dirname, '..', 'daemon', 'host.ts'), 'utf8')
    expect(daemonHost).not.toContain('confirm:')
    expect(daemonHost).not.toContain('createTtyConfirmPort')
  })
})


// ---- THE CHANNEL A PERSON READS (401-15, WR-01 / T-401-G5) -------------------------------------
//
// `run-risk.test.ts` measures the composed STRING. This cell measures the STREAM, because the claim
// WR-01 makes is about what appears above `[y/N]` — and `writeDisclosure` applies no hygiene at all
// (deliberately: the browser channel never passes through it, so the guard is at composition and
// this file's job is to prove the guard reaches the channel).
//
// The name below is what a `.yaml` document can put in `target:`, which is a bare `z.string()`.

/** A forged approval line and a forged prompt, carried inside one declared target name. */
const FORGED_NAME =
  'ok\nagent-qa: Start a run against target innocent (declared: every target local)\nProceed? [y/N] '

/** Drive one prompt for an arbitrary descriptor and report what landed on the stream. */
async function askWith(action: RiskActionDescriptor, typed: string): Promise<string> {
  const input = new PassThrough()
  const output = new PassThrough()
  let printed = ''
  output.on('data', (chunk: Buffer | string) => {
    printed += String(chunk)
  })

  const confirm = createTtyConfirmPort({ isTty: true, input, output })
  if (confirm === undefined) throw new Error('a tty host must bind a confirm')

  const pending = Promise.resolve(confirm(action))
  input.write(typed)
  input.end()
  await pending
  return printed
}

describe('a hostile declared target name cannot author a line on the confirm channel', () => {
  it('prints exactly the disclosure line and the prompt — no line the document wrote', async () => {
    const printed = await askWith(
      {
        name: 'run:start',
        recognized: true,
        declaredTier: 'mutating-shared',
        // Composed by the PRODUCTION producer, never typed here: a literal disclosure would
        // measure this file's idea of the sentence rather than the one that ships.
        disclosure: buildRunDisclosure('shared', [FORGED_NAME]),
      },
      'n\n',
    )

    // TWO LINES: `agent-qa: <disclosure>` and the readline question, which carries no newline.
    // Before the scrub this was FOUR, two of them authored by the document.
    expect(printed.split('\n')).toHaveLength(2)
    // The forged approval line is not on the channel as a line of its own.
    expect(printed).not.toMatch(/\nagent-qa: Start a run against target innocent/)
    // The real prompt is still the last thing a person sees.
    expect(printed).toContain('run:start needs your approval. Proceed? [y/N]')
    // And no control byte reached the terminal at all.
    expect(printed.replace(/\n/g, '')).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
  })

  it('THE CONTROL: an ordinary target name prints the same two lines, unaltered', async () => {
    const printed = await askWith(
      {
        name: 'run:start',
        recognized: true,
        declaredTier: 'mutating-shared',
        disclosure: buildRunDisclosure('shared', ['checkout-staging']),
      },
      'y\n',
    )

    expect(printed.split('\n')).toHaveLength(2)
    expect(printed).toContain('checkout-staging')
    expect(printed).toContain('declared: at least one target shared')
  })
})
