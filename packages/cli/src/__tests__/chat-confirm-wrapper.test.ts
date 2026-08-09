// Chat's three-way inline confirm, and the one thing it may never do (Phase 392 plan 08, D-03/D-22).
//
// THE SURFACE IS 391'S TWO FORMS AND NOTHING ELSE. `y` accepts once, `a` accepts and records a
// standing approval, anything else refuses. There is no third decision form and no progressive
// offer — D-22 keeps that OUT, and this suite is where "nothing beyond the two forms exists" stops
// being a claim in a plan and becomes an assertion over the shipped prompt.
//
// THE `a` ARM IS THE DANGEROUS ONE, and the danger is not the prompt. A standing approval widens
// autonomy permanently, so the ONLY acceptable way to record one is the machinery
// `proposals.accept --always` mints through: the composition-owned `StandingGrantsPort`, whose
// implementation owns the protected-class refusal, the already-granted fold, the lease and the
// committed ledger. A chat-side ledger write would be a second mint with none of those, and it
// would be invisible in review because the file it wrote would look exactly right (T-392-26). So
// the mint is a SPY AT THE PORT SEAM here, and what is asserted is that the wrapper reached it
// with the class the GATE produced rather than one the wrapper spelled.

import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { GrantRecordOutcome, RiskActionDescriptor } from '@vostride/agent-qa-schema'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  createChatConfirmPort,
  createTtyConfirmPort,
} from '../composition/local-agent-host.js'
import type { ChatApprovalDecisionRecord } from '../composition/local-agent-host.js'

const ACTION: RiskActionDescriptor = {
  name: 'fn:knowledge.proposal.apply',
  recognized: true,
  readOnly: false,
  declaredTier: 'mutating-shared',
}

const RECORDED: GrantRecordOutcome = {
  kind: 'recorded',
  grant: {
    grantId: 'grant-1',
    actionClass: ACTION.name,
    scope: STANDING_APPROVAL_SCOPE,
    grantedAt: '2026-08-09T00:00:00.000Z',
  },
}

interface Driven {
  readonly answered: boolean
  readonly printed: string
  readonly minted: { actionClass: string }[]
  readonly decisions: ChatApprovalDecisionRecord[]
}

/**
 * Drive one prompt over injected streams.
 *
 * `typed: undefined` ENDS THE STREAM WITHOUT A LINE — the EOF arm. Every case here settles from
 * the close handler or from an answered line, so no case waits on a timeout; the analog's own
 * comment records the 30s hang that taught this port to carry one.
 */
async function drive(
  typed: string | undefined,
  mint: (actionClass: string) => Promise<GrantRecordOutcome> = async () => RECORDED,
): Promise<Driven> {
  const input = new PassThrough()
  const output = new PassThrough()
  let printed = ''
  output.on('data', (chunk: Buffer | string) => {
    printed += String(chunk)
  })

  const minted: { actionClass: string }[] = []
  const decisions: ChatApprovalDecisionRecord[] = []

  const confirm = createChatConfirmPort({
    isTty: true,
    input,
    output,
    recordStandingApproval: async (actionClass) => {
      minted.push({ actionClass })
      return mint(actionClass)
    },
    onDecision: (decision) => {
      decisions.push(decision)
    },
  })
  if (confirm === undefined) throw new Error('a tty host must bind a chat confirm')

  const pending = Promise.resolve(confirm(ACTION))
  if (typed !== undefined) input.write(typed)
  input.end()
  const answered = await pending
  return { answered, printed, minted, decisions }
}

describe('the chat confirm renders 391 two forms and mints through nothing of its own', () => {
  it('binds NOTHING without a terminal — the gate keeps its deny-by-default', () => {
    // Same load-bearing arm as the one-form port: an ABSENT field is what leaves `evaluate()`'s
    // own DENY_CONFIRM in place, so a scripted `ask` and a CI job stay on the v48 fail-closed arm
    // (D-03's "non-TTY unchanged"). Both streams decide it, not the command that was typed.
    const bindings = {
      recordStandingApproval: async () => RECORDED,
      onDecision: () => {},
    }
    expect(createChatConfirmPort({ isTty: false, ...bindings })).toBeUndefined()
  })

  it('offers exactly the two forms, naming the action verbatim', async () => {
    const { printed } = await drive('y\n')

    // The ACTION NAME verbatim, for `createTtyConfirmPort`'s stated reason: it is the string the
    // audit row carries and the one a standing grant has to match, so a person can connect the
    // question to what `grants.list` later shows them.
    expect(printed).toContain('fn:knowledge.proposal.apply')
    expect(printed).toContain('[y/a/N]')
  })

  it('accepts once on y, minting nothing at all', async () => {
    const { answered, minted, decisions } = await drive('y\n')

    expect(answered).toBe(true)
    // The plain form reaches NO mint — not a mint that declines, no call. The same property
    // `proposals.accept` states for its own plain arm, asserted the same way.
    expect(minted).toEqual([])
    expect(decisions).toEqual([{ actionClass: ACTION.name, decision: 'accept' }])
  })

  it('accepts and mints on a, through the port and with the gate-produced class', async () => {
    const { answered, minted, decisions } = await drive('a\n')

    expect(answered).toBe(true)
    // PRODUCED, NEVER TYPED (D-04): the class is the descriptor the gate handed over, so a rename
    // on the op moves this and a hand-spelled literal would keep matching a name nothing carries.
    expect(minted).toEqual([{ actionClass: ACTION.name }])
    expect(decisions).toEqual([{ actionClass: ACTION.name, decision: 'accept-always' }])
  })

  it('accepts the long forms of both', async () => {
    expect((await drive('YES\n')).answered).toBe(true)
    expect((await drive('Always\n')).minted).toEqual([{ actionClass: ACTION.name }])
  })

  it('refuses on N, on an empty line, on nonsense, on EOF and on a closed stream', async () => {
    for (const typed of ['n\n', '\n', 'maybe\n', '', undefined]) {
      const { answered, minted, decisions } = await drive(typed)
      expect(answered, JSON.stringify(typed)).toBe(false)
      expect(minted, JSON.stringify(typed)).toEqual([])
      expect(decisions, JSON.stringify(typed)).toEqual([
        { actionClass: ACTION.name, decision: 'deny' },
      ])
    }
  })

  it('keeps the one-time accept when the standing half is refused, and says so', async () => {
    // D-05's mint half: a protected class never acquires a standing approval. The person still
    // said yes to THIS call, so the call proceeds — and the ledgered decision is `accept`, because
    // the log records the EFFECT and no standing approval exists to record (392-05's law).
    const { answered, decisions, printed } = await drive('a\n', async (actionClass) => ({
      kind: 'protected-class',
      actionClass,
    }))

    expect(answered).toBe(true)
    expect(decisions).toEqual([{ actionClass: ACTION.name, decision: 'accept' }])
    expect(printed).toContain('protected')
  })

  it('keeps the one-time accept when the mint THROWS, rather than failing the call', async () => {
    // The grant ledger raises rather than answers when the committed file carries a line it cannot
    // read. Uncaught here, that throw would leave the gate with an exception where a boolean
    // belongs — turning a refusal to DECIDE about the standing half into a failure of the call the
    // person already approved.
    const { answered, decisions } = await drive('a\n', () => {
      throw new Error('GrantLedgerDamagedError')
    })

    expect(answered).toBe(true)
    expect(decisions).toEqual([{ actionClass: ACTION.name, decision: 'accept' }])
  })

  it('answers even when the decision sink throws — a log is not a veto', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const confirm = createChatConfirmPort({
      isTty: true,
      input,
      output,
      recordStandingApproval: async () => RECORDED,
      onDecision: () => {
        throw new Error('the session log is gone')
      },
    })
    if (confirm === undefined) throw new Error('a tty host must bind a chat confirm')

    const pending = Promise.resolve(confirm(ACTION))
    input.write('y\n')
    input.end()
    expect(await pending).toBe(true)
  })

  it('leaves the shipped one-form port exactly as it was', () => {
    // The wrapper EXTENDS rather than forks (RESEARCH Pitfall 7). If `createTtyConfirmPort` had
    // been reshaped into the three-way prompt, every non-chat CLI decision would silently acquire
    // an `always` form nobody reviewed for it.
    const port = createTtyConfirmPort({ isTty: false })
    expect(port).toBeUndefined()

    const source = readFileSync(
      join(__dirname, '..', 'composition', 'local-agent-host.ts'),
      'utf8',
    )
    expect(source).toContain('[y/N]')
    expect(source).toContain('[y/a/N]')
  })
})
