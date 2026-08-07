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
