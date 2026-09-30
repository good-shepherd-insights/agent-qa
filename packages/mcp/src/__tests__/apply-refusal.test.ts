// The refuse-and-teach apply primitive, driven directly (Phase 396 plan 02, D-11 / MCPS-03).
//
// WHY THIS FILE EXISTS. `apply-refusal.ts` is the front door of the only write path this surface
// has, and the whole of its claim is a NEGATIVE one: a first call does not commit. A negative claim
// is exactly the kind a passing test proves nothing about — a handler that never applies at all
// passes every cell below except two. So each cell names the MUTATION it is the bar for, and every
// leg named in the header was applied to the subject and observed red before this file was allowed
// to stand as evidence.
//
// WHAT IS DELIBERATELY NOT HERE. The `confirmed: 'true'` string variant is refused twice, and only
// one of the two walls is measurable from here: the SDK validates the call against the advertised
// `inputSchema` BEFORE the handler runs, so at the wire a string never reaches this code at all.
// That wall is driven in plan 06's `mcp-apply-differential.test.ts`. What the cell below measures is
// the SECOND wall — this handler's own strict `=== true` — which is the one that still has to hold
// when a caller arrives through some path where the first wall was not applied.
//
// STATED PLAINLY BECAUSE IT MATTERS: every cell below passed on its first run. None of them was
// ever red against a wrong implementation by accident, so the five legs below are the whole of
// their evidentiary weight. Each leg was applied to `packages/mcp/src/apply-refusal.ts`, the suite
// re-run, and the subject restored byte-identically afterwards (sha256
// 7fb21e043c9a0a1730296607d59de89b1b1d51290f83716fe295dd3d060c1f25, verified after every leg).
//
// OBSERVED REDS — measured 2026-08-16, messages quoted verbatim from vitest:
//
//   M1  strict `confirmed === true` widened to truthiness (`if (args.confirmed)`)
//       1 failed | 19 passed
//       > FAIL  doctored one-shots (T-396-04) > refuses a truthy NON-boolean confirmation (the second wall)
//       > AssertionError: expected undefined to be 'input_required' // Object.is equality
//       The `confirmed: false` cell stayed GREEN under this leg, which is exactly why both exist:
//       falsiness agrees with strict inequality, so a false-only corpus cannot tell a boolean gate
//       from a truthiness gate. Only a truthy non-boolean can.
//
//   M2  the refusal branch deleted — the first call applies (`return apply(proposalId)`)
//       10 failed | 10 passed
//       > FAIL  refuses a first call and invokes the apply op zero times
//       > AssertionError: expected undefined to be 'input_required' // Object.is equality
//       > FAIL  reads the summary through the SAME invoke — never a store of its own
//       > AssertionError: expected [ { …(2) } ] to deeply equal [ { opId: 'proposals.show', …(1) } ]
//       > FAIL  carries the proposal summary and the deterministic instruction in its content
//       > AssertionError: expected '{"outcome":"applied","proposalId":"pr…' to contain 'knowledge'
//       …and six more, including both doctored one-shots and the era-degradation cell.
//       WORTH NAMING: the determinism cell stayed GREEN under M2 — two unconditional applies are
//       perfectly deterministic. That is what M5 is for.
//
//   M3  a second property (`reason`) hard-coded into the elicitation `requestedSchema`
//       1 failed | 19 passed
//       > FAIL  asks for exactly one field, and it is the proposal id
//       > AssertionError: expected [ 'proposal_id', 'reason' ] to deeply equal [ 'proposal_id' ]
//
//   M4  the deterministic instruction moved OUT of `content` into the elicitation `message` only
//       (the plausible "the form already says it" simplification)
//       4 failed | 16 passed
//       > FAIL  teaches the deterministic route in content a 2025-era caller can still read
//       > AssertionError: expected 'Proposal prop_alpha-bravo-charlie: a …' to contain 'confirmed'
//       > FAIL  carries the proposal summary and the deterministic instruction in its content
//       > FAIL  still teaches when the summary read fails — the route is always available
//       > FAIL  refuses an in-band answer that names a DIFFERENT proposal, and says so
//       > AssertionError: expected 'Proposal prop_alpha-bravo-charlie: a …' to contain 'prop_delta-echo-foxtrot'
//       The era-degradation cell SHARES this bar with three others rather than owning it alone —
//       said here rather than claimed otherwise. What that cell adds on its own is the degraded
//       PROJECTION (the form and its discriminator removed before reading) and the single-line
//       actionability regex; the wire-level two-era drive is plan 06's.
//
//   M5  a per-instance counter minted into the refusal's `requestState`
//       (`let refusalCount = 0` in the factory closure — the SDK offers `requestState` for exactly
//       this, so minting one is the plausible wrong implementation, and it is the server-side state
//       SEP-2567/MCPS-07 name as a non-goal)
//       1 failed | 19 passed
//       > FAIL  answers the same first call with the same payload twice
//       > AssertionError: expected { content: [ { …(2) } ], …(3) } to deeply equal { content: [ { …(2) } ], …(3) }
//       This leg is why that cell drives one handler TWICE as well as two handlers once: the
//       two-instance form alone passed M5, because each instance's counter reads 1.

import { existsSync } from 'node:fs'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CLIENT_CAPABILITIES_META_KEY, createMcpHandler } from '@modelcontextprotocol/server'
import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { CreateFunctionRegistryOptions, FunctionDeps } from '@vostride/agent-qa-agent'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { buildAgentQaMcpServer } from '../catalog.js'
import { ProposalsShowOutputSchema } from '@vostride/agent-qa-schema'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import { FunctionDeniedError } from '@vostride/agent-qa-agent'
import { maskedToolError } from '../masked-result.js'

import {
  APPLY_CONFIRMATION_REQUEST_KEY,
  APPLY_REFUSAL_STATUS,
  APPLY_TOOL_INPUT_JSON_SCHEMA,
  APPLY_TOOL_INPUT_SCHEMA,
  PROPOSALS_SHOW_OP_ID,
  createApplyToolHandler,
  createMarkToolHandler,
  summarizeProposalForApply,
} from '../apply-refusal.js'

const APPLY_OP_ID = 'knowledge.proposal.apply'
const PROPOSAL_ID = 'prop_alpha-bravo-charlie'
const OTHER_PROPOSAL_ID = 'prop_delta-echo-foxtrot'

describe('419 sovereign mark credential refusal', () => {
  const caller = { surface: 'mcp', grantedScopes: ['knowledge-write'], safeMode: false, origin: 'agent' } as const
  it('refuses before invoking and renders only the MCP remedy without echoing input', async () => {
    const calls: unknown[] = []
    const handler = createMarkToolHandler({ caller, invoke: async (...args) => { calls.push(args) }, maskText: text => text })
    const result = await handler({ note: 'untrusted-input' })
    expect(calls).toEqual([])
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toEqual({
      status: 'credential-required', applied: false,
      instruction: 'agent_qa_mark_run requires a declared bearer; present a bearer whose scopes include `knowledge-write`',
    })
    expect(JSON.stringify(result)).not.toContain('untrusted-input')
    expect(JSON.stringify(result)).not.toContain('--trust-session')
  })
  it('passes the mark input unchanged through the sole invoke and masks both result channels', async () => {
    const calls: unknown[] = []
    const args = { kind: 'confirmed-bug', correctedExpectation: 'Use the corrected control',
      correctedAction: { type: 'click', ref: 'e-correct' } }
    const handler = createMarkToolHandler({
      caller: { ...caller, credential: { scope: STANDING_APPROVAL_SCOPE } },
      invoke: async (...input) => { calls.push(input); return { note: 'planted-secret' } },
      maskText: text => text.replaceAll('planted-secret', '<SECRET>'),
    })
    const result = await handler(args)
    expect(calls).toEqual([['runs.mark', args]])
    expect(result.structuredContent).toEqual({ note: '<SECRET>' })
    expect(JSON.stringify(result)).not.toContain('planted-secret')
  })
  it('renders typed gate denials with neutral prose and only actionable MCP affordances', () => {
    const result = maskedToolError(new FunctionDeniedError('runs.mark', 'use --trust-session', [
      { kind: 'answer-confirm' }, { kind: 'trust-session-flag' },
      { kind: 'present-bearer-scope', params: { scope: 'knowledge-write' } },
    ], 'confirmation required'), text => text)
    expect(result.content).toEqual([{ type: 'text', text: 'Denied runs.mark: confirmation required; present a bearer whose scopes include `knowledge-write`' }])
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('--trust-session')
  })
})

/**
 * The `proposals.show` answer the double returns, PRODUCED through the op's own output contract
 * rather than typed as a literal.
 *
 * This project has measured the cost of the alternative: a fixture built as a type literal can pin
 * an input the real producer could never emit, and every cell over it then measures a shape nothing
 * in the system has. `.parse()` here means the summary line below is rendered from a value the
 * proposals inbox could actually answer with.
 */
const SHOW_FOUND = ProposalsShowOutputSchema.parse({
  kind: 'found',
  entry: {
    envelope: {
      id: PROPOSAL_ID,
      kind: 'knowledge',
      status: 'pending',
      evidenceRefs: [],
      payload: {
        schemaVersion: 1,
        proposalId: PROPOSAL_ID,
        verb: 'accept',
        targetRef: { grain: 'record', recordId: 'rec-alpha' },
        deltas: [],
        proposedAt: 1_760_000_000_000,
        status: 'pending',
      },
    },
    applyInFlight: false,
  },
})

const APPLY_RECEIPT = {
  outcome: 'applied',
  proposalId: PROPOSAL_ID,
  committed: { recordIds: ['rec-alpha'] },
}

interface InvokeCall {
  readonly opId: string
  readonly input: unknown
}

/**
 * A RECORDING invoke double.
 *
 * The whole evidentiary weight of this file rests on counting calls to the apply op, so the double
 * records every call rather than answering questions about the last one: "was the apply invoked"
 * and "was it invoked exactly once with exactly this input" are different claims, and a spy that
 * only remembers the most recent call cannot tell a handler that applied twice from one that
 * applied once.
 */
function recordingInvoke(overrides: { readonly show?: unknown } = {}) {
  const calls: InvokeCall[] = []
  const invoke = async (opId: string, input: unknown): Promise<unknown> => {
    calls.push({ opId, input })
    if (opId === PROPOSALS_SHOW_OP_ID) return overrides.show ?? SHOW_FOUND
    if (opId === APPLY_OP_ID) return APPLY_RECEIPT
    throw new Error(`the double was asked for an op it does not answer: ${opId}`)
  }
  return {
    invoke,
    calls,
    applyCalls: () => calls.filter((call) => call.opId === APPLY_OP_ID),
  }
}

function handlerUnderTest(overrides: { readonly show?: unknown } = {}) {
  const double = recordingInvoke(overrides)
  const handler = createApplyToolHandler({
    applyOpId: APPLY_OP_ID,
    invoke: double.invoke,
    summarize: summarizeProposalForApply,
    maskText: (text) => text,
  })
  return { ...double, handler }
}

/** The elicitation form embedded in a refusal, or `undefined` if there is none. */
function confirmForm(result: Record<string, unknown>): Record<string, unknown> | undefined {
  const requests = result['inputRequests'] as Record<string, unknown> | undefined
  const request = requests?.[APPLY_CONFIRMATION_REQUEST_KEY] as
    | { params?: Record<string, unknown> }
    | undefined
  return request?.params
}

/**
 * A context whose caller CAN answer an embedded input request (396-06).
 *
 * The form is attached only to such a connection, because the SDK refuses to serve an
 * `input_required` result to one that cannot answer it — and refuses by REPLACING the whole result,
 * teach included. So every cell below whose subject is the FORM drives a capable caller, and the
 * cells whose subject is the teach drive both. `CLIENT_CAPABILITIES_META_KEY` is the SDK's own
 * envelope key rather than a string typed here, so this fixture and the handler read one name.
 */
const CAPABLE_CTX = {
  mcpReq: {
    envelope: { [CLIENT_CAPABILITIES_META_KEY]: { elicitation: {} } },
  },
} as const

/** The same, with an in-band answer carried on the retry. */
function capableWithResponses(responses: Record<string, unknown>) {
  return { mcpReq: { ...CAPABLE_CTX.mcpReq, inputResponses: responses } }
}

/** The plain text a caller reads, joined — the surface a person actually sees. */
function contentText(result: Record<string, unknown>): string {
  const content = (result['content'] ?? []) as readonly { type: string, text?: string }[]
  return content.map((block) => block.text ?? '').join('\n')
}

describe('createApplyToolHandler — the first call (D-11 refuse-and-teach)', () => {
  // THE BAR: M2. A handler with the refusal branch deleted applies on the first call and reds both
  // halves of this cell at once — the returned shape and the recorded apply.
  it('refuses a first call and invokes the apply op zero times', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler({ proposal_id: PROPOSAL_ID }, CAPABLE_CTX)

    expect(result['isError']).toBeFalsy()
    expect(result['resultType']).toBe('input_required')
    expect(applyCalls()).toEqual([])
  })

  it('reads the summary through the SAME invoke — never a store of its own', async () => {
    const { handler, calls } = handlerUnderTest()

    await handler({ proposal_id: PROPOSAL_ID }, {})

    expect(calls).toEqual([{ opId: PROPOSALS_SHOW_OP_ID, input: { proposalId: PROPOSAL_ID } }])
  })

  it('carries the proposal summary and the deterministic instruction in its content', async () => {
    const { handler } = handlerUnderTest()

    const text = contentText(await handler({ proposal_id: PROPOSAL_ID }, {}))

    expect(text).toContain(PROPOSAL_ID)
    expect(text).toContain('knowledge')
    expect(text).toContain('pending')
    expect(text).toContain('confirmed')
    expect(text).toContain('true')
  })

  // THE BAR: M3. The wire rule (SEP-2322) is that an elicitation `requestedSchema` is a FLAT object
  // of primitive properties, and D-11 narrows that further to exactly one field. An exact key
  // comparison and not a `toContain`: the claim is that the form asks for nothing else, and a
  // containment check is green for a form that also asks for a password.
  it('asks for exactly one field, and it is the proposal id', async () => {
    const { handler } = handlerUnderTest()

    const form = confirmForm(await handler({ proposal_id: PROPOSAL_ID }, CAPABLE_CTX))
    const schema = form?.['requestedSchema'] as {
      type?: string
      properties?: Record<string, unknown>
      required?: readonly string[]
    }

    expect(schema.type).toBe('object')
    expect(Object.keys(schema.properties ?? {})).toEqual(['proposal_id'])
    expect(schema.required).toEqual(['proposal_id'])
    // Flat and primitive: the property is a bare string type with no nested object anywhere.
    expect((schema.properties?.['proposal_id'] as { type?: string }).type).toBe('string')
  })

  // THE BAR: M2 again, from the other side. Determinism is what makes `proposal_id` a sufficient
  // cross-call handle (SEP-2567): if the refusal carried a counter, a nonce, or anything read off a
  // session, the handle would not be the whole of the state and this surface would have grown the
  // server-side state MCPS-07 names as a non-goal.
  it('answers the same first call with the same payload twice', async () => {
    // BOTH axes, and the second one was added because the first has no bar. Two separate handler
    // instances cannot tell a stateless handler from one holding a per-instance counter — each
    // instance's counter would read 1 — so the cell as first written passed a mutation that minted
    // a nonce in the factory closure. Driving the SAME handler twice is what makes the claim
    // measurable, and driving two instances is what pins that nothing is shared between them.
    const { handler } = handlerUnderTest()
    const firstCall = await handler({ proposal_id: PROPOSAL_ID }, {})
    const secondCall = await handler({ proposal_id: PROPOSAL_ID }, {})
    expect(firstCall).toEqual(secondCall)

    const otherInstance = await handlerUnderTest().handler({ proposal_id: PROPOSAL_ID }, {})
    expect(otherInstance).toEqual(firstCall)
  })

  it('still teaches when the summary read fails — the route is always available', async () => {
    const calls: InvokeCall[] = []
    const handler = createApplyToolHandler({
      applyOpId: APPLY_OP_ID,
      invoke: async (opId, input) => {
        calls.push({ opId, input })
        if (opId === PROPOSALS_SHOW_OP_ID) throw new Error('the inbox is unavailable')
        return APPLY_RECEIPT
      },
      summarize: summarizeProposalForApply,
      maskText: (text) => text,
    })

    const result = await handler({ proposal_id: PROPOSAL_ID }, CAPABLE_CTX)

    expect(result['resultType']).toBe('input_required')
    expect(contentText(result)).toContain('confirmed')
    expect(calls.filter((call) => call.opId === APPLY_OP_ID)).toEqual([])
  })
})

describe('createApplyToolHandler — the primary route (confirmed: true)', () => {
  it('invokes the mapped apply op exactly once, with the id under its own contract name', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler({ proposal_id: PROPOSAL_ID, confirmed: true }, {})

    expect(applyCalls()).toEqual([{ opId: APPLY_OP_ID, input: { proposalId: PROPOSAL_ID } }])
    expect(result['structuredContent']).toEqual(APPLY_RECEIPT)
    expect(result['resultType']).toBeUndefined()
  })

  it('does not read the summary on the confirmed route', async () => {
    const { handler, calls } = handlerUnderTest()

    await handler({ proposal_id: PROPOSAL_ID, confirmed: true }, {})

    expect(calls.map((call) => call.opId)).toEqual([APPLY_OP_ID])
  })

  it('answers a refusal from the op as a masked tool error rather than a throw', async () => {
    const seen: string[] = []
    const handler = createApplyToolHandler({
      applyOpId: APPLY_OP_ID,
      invoke: async () => {
        throw new Error('missing scopes: knowledge-write')
      },
      summarize: summarizeProposalForApply,
      maskText: (text) => {
        seen.push(text)
        return text.replace('knowledge-write', '***')
      },
    })

    const result = await handler({ proposal_id: PROPOSAL_ID, confirmed: true }, {})

    expect(result['isError']).toBe(true)
    expect(contentText(result)).toBe('missing scopes: ***')
    expect(seen).toContain('missing scopes: knowledge-write')
  })
})

describe('createApplyToolHandler — the in-band route (SEP-2322 inputResponses)', () => {
  it('applies when the confirmation form is answered with the same proposal id', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler(
      { proposal_id: PROPOSAL_ID },
      {
        mcpReq: {
          inputResponses: {
            [APPLY_CONFIRMATION_REQUEST_KEY]: {
              action: 'accept',
              content: { proposal_id: PROPOSAL_ID },
            },
          },
        },
      },
    )

    expect(applyCalls()).toEqual([{ opId: APPLY_OP_ID, input: { proposalId: PROPOSAL_ID } }])
    expect(result['structuredContent']).toEqual(APPLY_RECEIPT)
  })

  it('does not apply when the form was declined', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler(
      { proposal_id: PROPOSAL_ID },
      capableWithResponses({ [APPLY_CONFIRMATION_REQUEST_KEY]: { action: 'decline' } }),
    )

    expect(result['resultType']).toBe('input_required')
    expect(applyCalls()).toEqual([])
  })
})

describe('createApplyToolHandler — doctored one-shots (T-396-04)', () => {
  it('refuses confirmed: false', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler({ proposal_id: PROPOSAL_ID, confirmed: false }, CAPABLE_CTX)

    expect(result['resultType']).toBe('input_required')
    expect(applyCalls()).toEqual([])
  })

  // THE BAR: M1, and this cell is the ONLY one that reds under it. A truthiness gate
  // (`if (args.confirmed)`) passes the `confirmed: false` cell above — falsiness agrees with strict
  // inequality — and applies here. At the wire the SDK's `inputSchema` validation refuses a string
  // in a boolean field before this code runs; that first wall is driven in plan 06. This is the
  // second wall, which is the one that matters for any caller that reaches the handler another way.
  it('refuses a truthy NON-boolean confirmation (the second wall)', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler({ proposal_id: PROPOSAL_ID, confirmed: 'true' }, CAPABLE_CTX)

    expect(result['resultType']).toBe('input_required')
    expect(applyCalls()).toEqual([])
  })

  it('refuses an in-band answer that names a DIFFERENT proposal, and says so', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const result = await handler(
      { proposal_id: PROPOSAL_ID },
      capableWithResponses({
        [APPLY_CONFIRMATION_REQUEST_KEY]: {
          action: 'accept',
          content: { proposal_id: OTHER_PROPOSAL_ID },
        },
      }),
    )

    expect(result['resultType']).toBe('input_required')
    expect(applyCalls()).toEqual([])
    const text = contentText(result)
    expect(text).toContain(OTHER_PROPOSAL_ID)
    expect(text).toContain(PROPOSAL_ID)
    expect(text.toLowerCase()).toContain('does not name')
  })
})

// Plan 02 Task 2 — the era-degradation cell.
//
// WHY THE PRIMARY ROUTE IS PRIMARY, as a measured property instead of a paragraph. On a stateless
// legacy (2025-era) connection there is no return path for a server-to-client request at all. If
// the instruction to re-call with `confirmed: true` lived only inside the form's message, such a
// caller would receive a refusal it has no way to act on — stranded on day zero, which per RESEARCH
// Pitfall 4 is every shipping client.
//
// 396-06 MEASURED WHAT THAT DEGRADATION ACTUALLY IS, and it was worse than "the form is dropped":
// the SDK REPLACES the whole result with a capability error (2025 era) or fails the call with
// `-32021` (2026 era, undeclared `elicitation`), so the teach went with it. The handler therefore
// attaches the form only to a caller whose declared capabilities can carry it, and the group below
// this one is that gate's hermetic bar. The wire-level three-way drive is plan 06's
// `packages/cli/src/__tests__/mcp-apply-differential.test.ts`, group 6.
describe('createApplyToolHandler — the refusal teaches without the form (C3/C-MCP-1)', () => {
  // THE BAR: M4 — the instruction moved into the elicitation message only. Every other cell in this
  // file stays green under that mutation.
  it('teaches the deterministic route in content a 2025-era caller can still read', async () => {
    const { handler } = handlerUnderTest()

    const refusal = await handler({ proposal_id: PROPOSAL_ID }, {})

    // 396-06 UPDATE: this cell used to PROJECT the form away to model what a 2025-era connection
    // would receive. It no longer has to — the handler does not attach a form to a caller that
    // cannot answer one, and `handlerUnderTest()` with a bare ctx IS that caller. The projection is
    // kept as an assertion that there was nothing to project.
    const { inputRequests: _requests, resultType: _type, ...degraded } = refusal
    expect(refusal['inputRequests']).toBeUndefined()
    expect(refusal['resultType']).toBeUndefined()
    expect(degraded['inputRequests']).toBeUndefined()

    const text = contentText(degraded)
    expect(text).toContain(PROPOSAL_ID)
    expect(text).toContain('confirmed')
    expect(text).toContain('true')
    // Actionable, not merely present: the caller is told which tool argument to set and to what.
    expect(text).toMatch(/confirmed[^\n]*true/u)
  })
})

// 396-06 — the capability gate, hermetically.
//
// THE BAR: leg A3, the check inverted so the form is attached unconditionally. That is the shipped
// behaviour this group replaces, and every cell here reds under it except the capable one — which is
// exactly the discrimination the group claims, since a gate that always says yes is not a gate.
//
// The teach is identical on all three, and that is asserted rather than assumed: a fix that served
// the plain arm a DIFFERENT sentence would have made D-11's door two doors.
describe('createApplyToolHandler — the form rides only where it can be answered (396-06)', () => {
  const NO_ENVELOPE = {}
  const ENVELOPE_WITHOUT_ELICITATION = {
    mcpReq: { envelope: { [CLIENT_CAPABILITIES_META_KEY]: {} } },
  }

  it('attaches no form to a caller that declared no capabilities at all (the 2025 era)', async () => {
    const { handler, applyCalls } = handlerUnderTest()

    const refusal = await handler({ proposal_id: PROPOSAL_ID }, NO_ENVELOPE)

    expect(refusal['resultType']).toBeUndefined()
    expect(refusal['inputRequests']).toBeUndefined()
    expect(refusal['isError']).toBeFalsy()
    expect(contentText(refusal)).toContain('confirmed')
    expect(applyCalls()).toEqual([])
  })

  it('attaches no form to a 2026 caller whose declared capabilities do not include elicitation',
    async () => {
      const { handler } = handlerUnderTest()

      const refusal = await handler({ proposal_id: PROPOSAL_ID }, ENVELOPE_WITHOUT_ELICITATION)

      expect(refusal['resultType']).toBeUndefined()
      expect(refusal['inputRequests']).toBeUndefined()
      expect(contentText(refusal)).toContain('confirmed')
    })

  it('attaches the form to a caller that declared elicitation, and teaches the SAME sentence',
    async () => {
      const { handler } = handlerUnderTest()

      const plain = await handler({ proposal_id: PROPOSAL_ID }, NO_ENVELOPE)
      const capable = await handler({ proposal_id: PROPOSAL_ID }, CAPABLE_CTX)

      expect(capable['resultType']).toBe('input_required')
      expect(confirmForm(capable)).toBeDefined()
      // ONE teach, two envelopes. The content and the structured refusal are byte-equal across the
      // pair; only the form differs.
      expect(contentText(capable)).toBe(contentText(plain))
      expect(capable['structuredContent']).toEqual(plain['structuredContent'])
    })

  // The output half of the same change, and the reason it was forced: an apply tool advertises an
  // `outputSchema`, and the SDK refuses a non-error, non-`input_required` result that carries no
  // `structuredContent`. A refusal with no structured arm could not be served at all.
  it('carries the refusal as DATA on the arm authored for it', async () => {
    const { handler } = handlerUnderTest()

    const refusal = await handler({ proposal_id: PROPOSAL_ID }, {})
    const structured = refusal['structuredContent'] as Record<string, unknown>

    expect(structured['status']).toBe(APPLY_REFUSAL_STATUS)
    expect(structured['applied']).toBe(false)
    expect(structured['proposal_id']).toBe(PROPOSAL_ID)
    expect(String(structured['instruction'])).toContain('confirmed: true')
    // The keys are exactly the arm's, so a field added here without being advertised fails.
    expect(Object.keys(structured).sort()).toEqual(
      ['applied', 'instruction', 'proposal_id', 'status', 'summary'],
    )
  })
})

describe('the apply tools\' declared input schema', () => {
  it('declares proposal_id required and confirmed optional, and nothing else', () => {
    expect(Object.keys(APPLY_TOOL_INPUT_JSON_SCHEMA.properties)).toEqual([
      'proposal_id',
      'confirmed',
    ])
    expect(APPLY_TOOL_INPUT_JSON_SCHEMA.required).toEqual(['proposal_id'])
    expect(APPLY_TOOL_INPUT_JSON_SCHEMA.additionalProperties).toBe(false)
  })

  // The FIRST wall, measured where it lives: the SDK's own validator over the advertised schema.
  // Plan 06 drives the same refusal through a real `tools/call`; this cell proves the schema handed
  // to `registerTool` is the one that does the refusing, so the two are not two different claims.
  it('refuses a string in the boolean confirmation field', async () => {
    const ok = await APPLY_TOOL_INPUT_SCHEMA['~standard'].validate({
      proposal_id: PROPOSAL_ID,
      confirmed: true,
    })
    expect('issues' in ok && ok.issues).toBeFalsy()

    const bad = await APPLY_TOOL_INPUT_SCHEMA['~standard'].validate({
      proposal_id: PROPOSAL_ID,
      confirmed: 'true',
    })
    expect('issues' in bad && bad.issues).toBeTruthy()
  })
})

describe('summarizeProposalForApply', () => {
  it('renders the envelope facts a reviewer needs to decide', () => {
    const line = summarizeProposalForApply(SHOW_FOUND, PROPOSAL_ID)

    expect(line).toContain(PROPOSAL_ID)
    expect(line).toContain('knowledge')
    expect(line).toContain('pending')
  })

  it('names an absent proposal as an absence rather than inventing one', () => {
    const notFound = ProposalsShowOutputSchema.parse({
      kind: 'not-found',
      proposalId: OTHER_PROPOSAL_ID,
    })

    expect(summarizeProposalForApply(notFound, OTHER_PROPOSAL_ID)).toContain('no proposal')
  })

  // A shape this module does not recognise must not become a rendered claim about a proposal: the
  // summary is what a human reads before authorising a commit, and a confident line composed from
  // an unrecognised object is the one failure mode that costs more than saying nothing.
  it('says nothing it cannot read', () => {
    const line = summarizeProposalForApply({ unexpected: 'shape' }, PROPOSAL_ID)

    expect(line).toContain(PROPOSAL_ID)
    expect(line).toContain('could not be read')
  })
})

// ---- 432-12 (D-05/D-13/D-14): a direct receipt through the real catalogue, and no confirm round --

/** The anonymous MCP caller: no credential, the default local grant. */
const TOKENLESS: FunctionCaller = {
  surface: 'mcp', grantedScopes: ['read', 'knowledge-write'], safeMode: false, origin: 'agent',
}

const PLANTED = 'sk-live-432-planted-secret'

interface DirectPort {
  readonly calls: unknown[]
  readonly deps: FunctionDeps
}

/** A registry whose review port answers direct changes, recording each call it receives. */
function directDeps(answer: (request: { verb: string, input: Record<string, unknown> }) => unknown): DirectPort {
  const calls: unknown[] = []
  const deps = {
    runs: {
      list: () => Promise.resolve([]), get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]), inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }: { recordId: string }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }),
    },
    knowledgeReview: {
      propose: () => Promise.reject(new Error('a direct change never proposes')),
      apply: () => Promise.reject(new Error('a direct change never applies a proposal')),
      change: async (request: { verb: string, input: Record<string, unknown> }) => {
        calls.push(request)
        return answer(request)
      },
    },
  } as unknown as FunctionDeps
  return { calls, deps }
}

const directSink = {
  appendExecutionAudit() {}, appendGuardrailAudit() {},
} as unknown as CreateFunctionRegistryOptions['auditSink']

const directClients: Client[] = []
afterEach(async () => {
  for (const client of directClients.splice(0)) await client.close().catch(() => {})
})

interface Wire {
  readonly client: Client
  readonly frames: string[]
  readonly elicited: unknown[]
}

/** A real client over the shipped factory; `modern` pins the 2026 wire and declares elicitation. */
async function wire(deps: FunctionDeps, modern = false): Promise<Wire> {
  const registry = createFunctionRegistry({ deps, auditSink: directSink })
  const handler = createMcpHandler(() => buildAgentQaMcpServer({
    registry, caller: TOKENLESS, maskText: (text: string) => text.replaceAll(PLANTED, '<SECRET>'),
  }))
  const frames: string[] = []
  const elicited: unknown[] = []
  const client = new Client({ name: 'agent-qa-432-12-direct', version: '0.0.0' }, {
    ...(modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } }, capabilities: { elicitation: {} } } : {}),
  } as never)
  if (modern) {
    client.setRequestHandler('elicitation/create' as never, ((request: unknown) => {
      elicited.push(request)
      return { action: 'accept', content: {} }
    }) as never)
  }
  directClients.push(client)
  await client.connect(new StreamableHTTPClientTransport(new URL('http://direct.local/mcp'), {
    fetch: (async (url: URL | string, init?: RequestInit) => {
      const response = await handler.fetch(new Request(url, init))
      frames.push(await response.clone().text())
      return response
    }) as typeof fetch,
  }))
  return { client, frames, elicited }
}

type WireResult = {
  readonly content?: readonly { readonly type: string, readonly text?: string }[]
  readonly structuredContent?: Record<string, unknown>
  readonly isError?: boolean
  readonly resultType?: string
}

async function callSettled(session: Wire, name: string, args: Record<string, unknown>) {
  try {
    return { result: (await session.client.callTool({ name, arguments: args })) as WireResult }
  } catch (error) {
    return { error }
  }
}

const RECORD_TARGET = { grain: 'record', recordId: 'rec-alpha' } as const

describe('C432-MCP-DIRECT-RECEIPT: a knowledge change answers its receipt on the first call', () => {
  it('C432-MCP-DIRECT-RECEIPT: the change tool applies once and masks both result channels from one serialization', async () => {
    const port = directDeps((request) => ({
      outcome: 'applied', verb: request.verb, operationId: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
      recordIds: ['rec-alpha', `rec-${PLANTED}`],
    }))
    const session = await wire(port.deps)
    const outcome = await callSettled(session, 'agent_qa_change_knowledge', {
      action: 'knowledge.accept', target: RECORD_TARGET,
    })

    expect(outcome.error, 'the change tool must be listed and callable').toBeUndefined()
    expect(port.calls).toEqual([{ verb: 'accept', input: { target: RECORD_TARGET } }])
    expect(outcome.result?.isError ?? false).toBe(false)
    expect(outcome.result?.structuredContent).toMatchObject({
      outcome: 'applied', verb: 'accept', recordIds: ['rec-alpha', 'rec-<SECRET>'],
    })
    const text = (outcome.result?.content ?? []).map((block) => block.text ?? '').join('\n')
    expect(JSON.parse(text)).toEqual(outcome.result?.structuredContent)
    expect(session.frames.join('\n')).not.toContain(PLANTED)
  })

  it('C432-MCP-DIRECT-RECEIPT: a typed absence is data and a writer refusal is a masked error, both after one call', async () => {
    const absent = directDeps((request) => ({
      outcome: 'target-not-found', verb: request.verb,
      operationId: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d', target: request.input['target'],
    }))
    const notFound = await callSettled(await wire(absent.deps), 'agent_qa_change_knowledge', {
      action: 'knowledge.forget', target: RECORD_TARGET,
    })
    expect(notFound.result?.isError ?? false).toBe(false)
    expect(notFound.result?.structuredContent).toMatchObject({ outcome: 'target-not-found', target: RECORD_TARGET })
    expect(absent.calls).toHaveLength(1)

    const refusing = directDeps(() => {
      const error = new Error(`bundle egress refused: ${PLANTED} would leave the machine`)
      error.name = 'BundleEgressRefusedError'
      throw error
    })
    const session = await wire(refusing.deps)
    const refused = await callSettled(session, 'agent_qa_change_knowledge', {
      action: 'knowledge.reject', target: RECORD_TARGET, reason: 'stale',
    })
    expect(refused.result?.isError).toBe(true)
    expect(refusing.calls).toHaveLength(1)
    expect(session.frames.join('\n')).not.toContain(PLANTED)
    expect(session.frames.join('\n')).toContain('egress refused')
  })
})

describe('C432-MCP-NO-ELICITATION: no confirmation input, no elicitation, no apply round', () => {
  it('C432-MCP-NO-ELICITATION: a client that can answer a form is never asked, and the change lands on its one call', async () => {
    const port = directDeps((request) => ({
      outcome: 'applied', verb: request.verb, operationId: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
      recordIds: ['rec-alpha'],
    }))
    const session = await wire(port.deps, true)
    const outcome = await callSettled(session, 'agent_qa_change_knowledge', {
      action: 'knowledge.forget', target: RECORD_TARGET,
    })

    expect(outcome.error).toBeUndefined()
    expect(outcome.result?.structuredContent).toMatchObject({ outcome: 'applied', verb: 'forget' })
    expect(outcome.result?.resultType ?? 'complete').not.toBe('input_required')
    expect(session.elicited).toEqual([])
    expect(port.calls).toHaveLength(1)
    expect(session.frames.join('\n')).not.toContain('input_required')
  })

  it('C432-MCP-NO-ELICITATION: no listed tool takes a confirmation or a proposal id, and confirmed is refused at the schema wall', async () => {
    const port = directDeps(() => ({ outcome: 'applied' }))
    const session = await wire(port.deps)
    const tools = (await session.client.listTools()).tools
    for (const tool of tools) {
      const properties = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})
      const armProperties = ((tool.inputSchema as { oneOf?: readonly { properties?: Record<string, unknown> }[] }).oneOf ?? [])
        .flatMap((arm) => Object.keys(arm.properties ?? {}))
      expect([...properties, ...armProperties], tool.name).not.toContain('confirmed')
      expect([...properties, ...armProperties], tool.name).not.toContain('proposal_id')
    }
    expect(tools.map((tool) => tool.name)).not.toContain('agent_qa_apply_proposal')
    expect(tools.map((tool) => tool.name)).not.toContain('agent_qa_apply_config_proposal')

    const doctored = await callSettled(session, 'agent_qa_change_knowledge', {
      action: 'knowledge.accept', target: RECORD_TARGET, confirmed: true,
    })
    expect(doctored.error ?? doctored.result?.isError, 'a confirmed key is not an input').toBeTruthy()
    expect(port.calls).toEqual([])
  })

  it('C432-MCP-NO-ELICITATION: the refuse-and-teach module is gone, and the op layer takes no confirmation', async () => {
    expect(existsSync(new URL('../apply-refusal.ts', import.meta.url))).toBe(false)
    const port = directDeps(() => ({ outcome: 'applied' }))
    const registry = createFunctionRegistry({ deps: port.deps, auditSink: directSink })
    const refusal = await invokeFunction(registry, 'knowledge.accept', {
      target: RECORD_TARGET, confirmed: true,
    }, TOKENLESS).then(() => undefined, (error: unknown) => error)
    expect((refusal as Error | undefined)?.name).toBe('FunctionInputError')
    expect(port.calls).toEqual([])
  })
})
