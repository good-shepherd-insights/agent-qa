// `clause_result` is MASKED AT REST, measured on the bytes of a real session file (399.1-05).
//
// THE CLAIM AND WHY IT IS BINDING. 399.1's D-05 minted `results[]` — the channel carrying what each
// op actually RETURNED — and left its persistence form to Claude's discretion under one guard: it
// "must not reintroduce cleartext concerns D-10 adjudicates". The phase's own adjudication,
// `.planning/phases/399.1-chat-render-contract/399.1-ADJUDICATION-transcript-cleartext.md`
// § "The load-bearing corollary for D-05", makes that guard concrete: op results can carry
// credentials (that is the entire premise of D-04's mandatory `unmaskForHumanOutput` seam on the
// render path), so persisting an UNMASKED `results[]` entry into `.agent-qa/sessions/chat-*.jsonl`
// would mint a SECOND unadjudicated cleartext sink in the very file the adjudication names — and
// would convert an inherited 392 posture gap into a 399.1 DEFECT.
//
// WHY THIS FILE AND NOT A UNIT TEST NEXT TO THE ENGINE. The claim is about BYTES AT REST. An
// in-memory assertion over the event object cannot see a seam that unmasks on the way to the file,
// nor one that serialises through anything but the object it was handed; only reading the file the
// adapter wrote can. The engine-side count/verbatim cells live in
// `packages/agent/src/chat/__tests__/turn-engine-compound.test.ts`; this file owns the disk.
//
// THE NAMED RED DIRECTION, and it is exactly the defect the adjudication forbids: replace the
// append's `payload` with `unmaskForHumanOutput(ctx, …)` — the seam "helpfully" restoring the
// original for the record — and the absence assertion below reds on the planted credential.
//
// AND THE ANTI-VACUITY CONTROL. Asserting a string is absent from a file proves nothing if the
// string was never in the system. So the placeholder is minted by the REAL masking context over a
// planted credential, the file is asserted to CARRY the placeholder, and unmasking the file's own
// bytes through that context is asserted to RECOVER the credential — which is what makes the
// absence a masking fact rather than a fixture that carried no secret.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CHAT_RESOLVER_TABLE,
  createMaskingContext,
  createTurnEngine,
  deterministicOverrideStrategy,
  splitClauses,
  unmaskForHumanOutput,
} from '@vostride/agent-qa-agent'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHAT_SESSIONS_SUBDIR, createJsonlSessionLog } from '../jsonl-session-log.js'

const NOW = '2026-08-20T00:00:00.000Z'
const PROPOSALS_LIST = 'proposals.list'

/**
 * The credential a person's project holds and an op's result can carry back.
 *
 * A SHAPE THE SCANNER'S OWN CORPUS USES, so nothing about this cell depends on a value chosen to
 * be conveniently unique — the assertion is about where the bytes go, not about what they look
 * like.
 */
const PLANTED_CREDENTIAL = 'sk-live-399105-Wq7zR2mKpX4nT8vB'

const HUMAN: FunctionCaller = { origin: 'human', surface: 'cli' } as unknown as FunctionCaller

describe('clause_result persists the MASKED payload, on the real file (399.1-05)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-qa-clause-result-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('writes the PLACEHOLDER and never the credential — and the placeholder really stands for it',
    async () => {
      // THE MASKING CONTEXT IS THE SHIPPED ONE, and the payload below is what a function layer
      // hands back through this seam: already masked, because `unmaskForHumanOutput` belongs at
      // each SURFACE's emit and nothing between the op and this log may restore an original.
      const ctx = createMaskingContext()
      ctx.register(PLANTED_CREDENTIAL)
      const maskedPayload = JSON.parse(
        ctx.mask(JSON.stringify({ entries: [{ id: 'P-1', token: PLANTED_CREDENTIAL }] })),
      ) as unknown

      // THE MASK ACTUALLY FIRED. Without this line a context that silently declined to register
      // (too short a value, a category rule) would make every assertion below vacuously true.
      expect(JSON.stringify(maskedPayload)).not.toContain(PLANTED_CREDENTIAL)
      expect(JSON.stringify(maskedPayload)).toContain('<SECRET_0>')

      const sessionLog = createJsonlSessionLog({
        root,
        now: () => NOW,
        model: () => 'unbound',
        toolsetHash: () => 'toolset-0001',
        random: () => 0.5,
      })

      const engine = createTurnEngine({
        table: CHAT_RESOLVER_TABLE,
        split: splitClauses,
        reconcile: deterministicOverrideStrategy,
        sessionLog,
        mint: { forStage: (_stage, sessionId) => ({ ...HUMAN, sessionId }) },
        // THE OP ANSWERS WITH THE MASKED PAYLOAD. This is the one fixture fact; everything after it
        // is the shipped engine and the shipped adapter.
        invoke: () => Promise.resolve({
          payload: maskedPayload,
          verdict: { status: 'executed' as const, outcome: 'listed 1 proposal' },
          foldLines: [],
        }),
        now: () => NOW,
        mintTurnId: () => 'turn-1',
      })

      const result = await engine.runTurn({ message: 'proposals' })
      expect(result.status).toBe('completed')
      expect(result.results).toHaveLength(1)

      // THE BYTES, off the file the adapter actually wrote — not the handle, not the event object.
      const sessionId = (result as { sessionId?: string }).sessionId
      expect(sessionId).toBeDefined()
      const file = join(root, CHAT_SESSIONS_SUBDIR, `${String(sessionId)}.jsonl`)
      const bytes = readFileSync(file, 'utf8')

      // THE EVENT IS THERE, addressed to the op, carrying the payload verbatim as it rode
      // `results[]` — a persistence that dropped or summarised it would satisfy the absence
      // assertion below trivially, so the presence half is asserted first.
      const events = bytes.split('\n').filter((line) => line !== '').slice(1)
        .map((line) => JSON.parse(line) as { kind: string; functionId?: string; payload?: unknown })
      const persisted = events.filter((event) => event.kind === 'clause_result')
      expect(persisted).toHaveLength(1)
      expect(persisted[0]?.functionId).toBe(PROPOSALS_LIST)
      expect(persisted[0]?.payload).toEqual(maskedPayload)

      // THE CLAIM. Not one byte of the credential is on this disk — anywhere in the file, not
      // merely on the line under test, because a leak on the receipt line is the same leak.
      expect(bytes).not.toContain(PLANTED_CREDENTIAL)

      // AND THE CONTROL THAT MAKES THE ABSENCE MEAN SOMETHING. The placeholder is on the disk, and
      // unmasking the file's own bytes through the context that minted it recovers the credential
      // — so what was persisted genuinely STANDS FOR the secret rather than never having held one.
      expect(bytes).toContain('<SECRET_0>')
      expect(unmaskForHumanOutput(ctx, bytes)).toContain(PLANTED_CREDENTIAL)
    })

  it('replays: a log carrying clause_result reopens clean, with the event in the history',
    async () => {
      // APPEND-ONLY MEANS THE READER SURVIVES THE WIDENING. `open(sessionId)` runs the adapter's
      // real guard/repair path over every line, so a kind the reader did not know would surface
      // here as a refused line rather than as a green in-memory object.
      const sessionLog = createJsonlSessionLog({
        root,
        now: () => NOW,
        model: () => 'unbound',
        toolsetHash: () => 'toolset-0001',
        random: () => 0.5,
      })
      const engine = createTurnEngine({
        table: CHAT_RESOLVER_TABLE,
        split: splitClauses,
        reconcile: deterministicOverrideStrategy,
        sessionLog,
        mint: { forStage: (_stage, sessionId) => ({ ...HUMAN, sessionId }) },
        invoke: () => Promise.resolve({
          payload: { entries: [] },
          verdict: { status: 'executed' as const, outcome: 'listed 0 proposals' },
          foldLines: [],
        }),
        now: () => NOW,
        mintTurnId: () => 'turn-1',
      })

      const result = await engine.runTurn({ message: 'proposals' })
      const sessionId = String((result as { sessionId?: string }).sessionId)

      const reopened = await sessionLog.open(sessionId)
      try {
        // NOT ONE REFUSED LINE. This is the whole replay-safety claim: the widened vocabulary did
        // not make any byte this build wrote unreadable to the build that reads it.
        expect(reopened.refusedLines).toEqual([])
        const kinds = reopened.events.map((event) => event.kind)
        expect(kinds).toContain('clause_result')
        expect(kinds).toContain('clause_receipt')
        expect(kinds).toContain('turn_complete')
      } finally {
        await reopened.close()
      }
    })
})
