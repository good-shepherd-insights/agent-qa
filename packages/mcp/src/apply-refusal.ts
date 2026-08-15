// The refuse-and-teach apply primitive (Phase 396 plan 02, D-11 · MCPS-03).
//
// WHY THIS FILE EXISTS. Propose-then-apply is the ONLY write path this surface has, and this module
// is that path's front door. Every other tool in the catalogue either reads or files a proposal that
// commits nothing; the two apply tools are where a caller's intention becomes a durable change, and
// D-11 says a blind one-shot must be impossible there. So a first call — including a hallucinated
// one, which is the case actually worth designing for — cannot commit. It gets back a REFUSAL that
// is not an error: what the proposal is, and the exact second call that would apply it.
//
// TWO ROUTES IN, AND THE ORDER BETWEEN THEM IS THE DECISION. The deterministic route is
// `confirmed: true` as an ordinary tool argument, and it is PRIMARY. The in-band route is
// SEP-2322's multi-round-trip form — the server returns `input_required`, the client collects the
// answer and retries the same call carrying `inputResponses` — and it is secondary. The ordering is
// not a preference: nothing on day zero speaks the 2026 wire, and a door whose only handle is the
// form is a door most callers cannot open, which is why the instruction to re-call travels in
// ORDINARY CONTENT and the form is an affordance layered on top of it.
//
// THE FORM IS ATTACHED ONLY WHERE IT CAN BE ANSWERED, and that condition is not a nicety — it is
// what makes the paragraph above TRUE rather than merely intended. 396-06 drove this handler at the
// wire and measured that an `inputRequired` result is not a payload an uninterested client ignores:
// the SDK REFUSES to serve one to a connection that cannot answer it, and it does so by REPLACING
// the handler's whole result. On a 2025-era connection the caller received
// `isError: true` with "Cannot request input 'confirm' (elicitation/create): … no client
// capabilities are available on this connection", and on a 2026-07-28 connection whose client did
// not declare `elicitation` the call FAILED with `-32021` (HTTP 400 — a `ProtocolError` thrown at
// the client). In both cases the summary and the deterministic instruction — the whole teach — were
// gone, which made D-11's door a dead end for very nearly every caller that exists. So the form
// rides only on a connection whose declared capabilities can carry it; everyone else gets the teach,
// which is the route that was always primary.
//
// NO SESSION, NO TOKEN, NO SERVER-SIDE STATE. Nothing is minted here and nothing is remembered
// between the two calls. The cross-call handle IS the `proposal_id` — a server-minted identifier
// travelling as an ordinary tool argument, which is exactly the pattern SEP-2567 prescribes once
// protocol sessions were removed. What stops a stale confirmation from committing something the
// caller never saw is not a nonce this module could invent; it is the content-hash freshness
// refusal the apply ops themselves already carry (395), on the far side of the same door.
//
// THIS MODULE COMMITS NOTHING ITSELF. It calls the apply op through the injected `invoke`, which is
// the host's `invokeFunction` closure — the same wall every other tool crosses, with its own scope
// check, origin check and policy gate underneath.
//
// THE HUMAN-ORIGIN ACCEPT VERB OF THE PROPOSALS FAMILY IS NOT NAMED IN THIS FILE, AND THE ABSENCE
// IS GREP-PINNED (T-396-06): the plan's acceptance criterion counts occurrences of its dotted id in
// this file and requires zero, which is why the id is spelled out nowhere above — including in
// prose, since a guard that a comment can defeat is not a guard. That verb declares
// `requiresHumanOrigin`, an MCP caller's origin is `agent` (391 D-06), and routing the apply door
// through it would dead-end every caller this surface has (RESEARCH Pitfall 7).
//
// Protocol grounding: SEP-2322 (multi-round-trip `input_required` results, the 2026 replacement for
// push-style elicitation; a form's `requestedSchema` is a FLAT object of primitive properties),
// SEP-2567 (sessions removed — cross-call state travels as server-minted handles in tool
// arguments), SEP-2575 (the stateless protocol those two follow from).

import {
  CLIENT_CAPABILITIES_META_KEY,
  acceptedContent,
  fromJsonSchema,
  inputRequired,
} from '@modelcontextprotocol/server'
import type {
  CallToolResult,
  InputRequiredResult,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server'
import { ProposalsShowOutputSchema } from '@vostride/agent-qa-schema'

import { maskedToolError, maskedToolResult } from './masked-result.js'

/** The read this module makes to render what a caller is about to authorise. */
export const PROPOSALS_SHOW_OP_ID = 'proposals.show'

/**
 * The key the embedded confirmation request is filed under, and read back by.
 *
 * A constant rather than a literal at two sites: the key the server assigns in `inputRequests` and
 * the key it reads out of the client's `inputResponses` are THE SAME key by protocol, and two
 * spellings of it would fail as a silently-ignored answer — the caller does everything right and
 * the apply never happens.
 */
export const APPLY_CONFIRMATION_REQUEST_KEY = 'confirm'

/**
 * The apply tools' advertised input, as JSON Schema.
 *
 * WHY THIS IS AUTHORED HERE AND NOT DERIVED FROM THE OP, which is the opposite of what every other
 * tool in this package does (D-16). The apply ops take `{ proposalId }` and nothing else — no
 * confirmation field, because at the function layer the confirmation is the policy gate's business
 * and not an argument. The confirmation envelope is MCP WIRE VOCABULARY: it exists because a tool
 * call is a single round trip with no human on the other end of it, which is a fact about this
 * surface and about no other caller of the same op. Deriving it from the op's contract is therefore
 * not possible, and putting it in the schema package would move a fact about MCP into the vocabulary
 * every surface shares.
 *
 * THIS IS NOT THE SECOND CONVERSION RECIPE D-16 FORBIDS. That rule is about op contracts: there
 * must be exactly one route from an op's declared schema to the schema advertised for it, so the
 * advertised contract and the validated contract cannot disagree. Nothing here is an op contract —
 * this object is authored, in one place, and `fromJsonSchema` is the SDK's own entry point for
 * making an authored JSON Schema into something `registerTool` accepts. The op's own contract still
 * validates the call: the handler translates `proposal_id` into `{ proposalId }` and `invokeFunction`
 * parses that against `KnowledgeProposalApplyInputSchema` / the config family's equivalent, which is
 * the second of the two independent parses this architecture keeps everywhere.
 *
 * `additionalProperties: false` is deliberate. A caller that misspells `confirmed` is told so rather
 * than silently receiving the refusal forever, which is the failure mode that looks like a broken
 * server to the person on the other end.
 */
export const APPLY_TOOL_INPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    proposal_id: {
      type: 'string',
      description: 'The id of the proposal to apply, as returned when it was filed.',
    },
    confirmed: {
      type: 'boolean',
      description:
        'Set to true to APPLY the proposal. Omitted or false, this call commits nothing and '
        + 'returns a summary of what would be applied.',
    },
  },
  required: ['proposal_id'],
  additionalProperties: false,
} as const

/**
 * The same schema as a Standard Schema, for `registerTool` (plan 04 registers both apply tools
 * with it).
 *
 * The SDK validates a call against this BEFORE the handler runs, which is the first of the two
 * walls under `confirmed`: a caller sending the STRING `"true"` is refused here, by type, and never
 * reaches the handler's own strict check.
 */
export const APPLY_TOOL_INPUT_SCHEMA: StandardSchemaWithJSON = fromJsonSchema(
  APPLY_TOOL_INPUT_JSON_SCHEMA as unknown as Parameters<typeof fromJsonSchema>[0],
)

/**
 * The confirmation form's `requestedSchema` — one field, and it is the handle the caller already
 * holds.
 *
 * SEP-2322 restricts an elicitation form to a flat object of primitive properties; D-11 narrows
 * that to exactly `proposal_id`. Asking for the id the caller just supplied looks redundant and is
 * not: the answer travelling back through the client is what makes the retry self-describing, and
 * the handler compares it against the call's own id rather than trusting it (below).
 */
export const APPLY_CONFIRMATION_REQUESTED_SCHEMA = {
  type: 'object',
  properties: {
    proposal_id: {
      type: 'string',
      description: 'Confirm the proposal id to apply.',
    },
  },
  required: ['proposal_id'],
} as const

/**
 * The REFUSAL, as a shape a machine reads — the output half of the same exception the input half
 * above already takes (396-06).
 *
 * WHY THIS EXISTS AT ALL, measured rather than reasoned. An apply tool advertises an `outputSchema`
 * — the op's own outcome contract — and the SDK enforces it: a result that is neither `isError` nor
 * an `input_required` result and carries no `structuredContent` is refused with
 * `Output validation error: Tool … has an output schema but no structured content was provided`
 * (`mcp-DXXb3Vv3.mjs:1442`). So the moment the form stops riding on every refusal, the refusal needs
 * a structured shape of its own or it cannot be served at all.
 *
 * AND IT IS THE RIGHT SHAPE INDEPENDENTLY OF THAT. `ConfigApplyOutcome` has two arms, `applied` and
 * `already-applied`, and both mean the change is in; there is no arm that means "nothing happened,
 * here is how to make it happen", because at the FUNCTION layer that state does not exist — it is
 * created by this surface, where a tool call is one round trip with nobody to ask. That is the same
 * argument the input envelope is authored on, and it lands in the same place: the apply doors are
 * the one pair whose advertised contract is not the op's contract, on both sides, for one reason.
 *
 * `applied: false` is a redundant field on purpose. `status` already says it, and a caller reading a
 * union is one missed arm away from treating a refusal as a receipt; a boolean that is false on
 * every refusal and absent from every outcome is the cheapest possible way for that reader to be
 * right by accident.
 */
export const APPLY_REFUSAL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      const: 'confirmation-required',
      description: 'Nothing was applied: this call was not confirmed.',
    },
    applied: {
      type: 'boolean',
      const: false,
      description: 'Always false on this arm. Nothing was committed by the call that returned it.',
    },
    proposal_id: {
      type: 'string',
      description: 'The proposal this refusal is about — the id to re-send with confirmed: true.',
    },
    summary: { type: 'string', description: 'What the proposal would do, if applied.' },
    instruction: { type: 'string', description: 'The exact call that applies it.' },
  },
  required: ['status', 'applied', 'proposal_id', 'summary', 'instruction'],
  additionalProperties: false,
} as const

/** The one value the refusal's discriminant takes. Exported so a caller's test need not retype it. */
export const APPLY_REFUSAL_STATUS = 'confirmation-required'

/**
 * The contract an apply tool ADVERTISES on the output side: the op's outcome, or the refusal.
 *
 * Composed from the op's OWN converted document rather than from a restatement of it, so the arm a
 * receipt validates against is the op's contract and not a copy that could drift. The conversion is
 * done in OUTPUT mode — the mode `tools/list` uses — and the target matches `projection.ts`'s pin.
 *
 * WHEN THE OP'S OWN CONTRACT CANNOT BE CONVERTED this returns it UNCHANGED, deliberately: the
 * two-sided `DEGRADED_OUTPUT_CONTRACTS` probe in `projection.ts` is what names that failure, and a
 * throw here would move it to module-import time where it would take the whole package down with a
 * message naming no tool.
 */
export function composeApplyToolOutput(opOutput: StandardSchemaWithJSON): StandardSchemaWithJSON {
  let converted: Record<string, unknown>
  try {
    converted = opOutput['~standard'].jsonSchema.output({
      target: 'draft-2020-12',
    }) as unknown as Record<string, unknown>
  } catch {
    return opOutput
  }
  // The nested document's own `$schema` is dropped: a dialect declaration belongs at the root of the
  // document that declares it, and both nested arms are in the one dialect the root names.
  const { $schema: _dialect, ...outcome } = converted
  return fromJsonSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    anyOf: [outcome, APPLY_REFUSAL_JSON_SCHEMA],
  } as unknown as Parameters<typeof fromJsonSchema>[0])
}

/** What a caller sends to an apply tool. `confirmed` is `unknown` on purpose — see the handler. */
export interface ApplyToolInput {
  readonly proposal_id: string
  readonly confirmed?: unknown
}

/**
 * The slice of the SDK's `ServerContext` this handler reads.
 *
 * Narrower than `ServerContext` so the handler can be driven directly by a test without assembling
 * a whole protocol context — and, because a narrower parameter accepts a wider argument, the
 * handler still satisfies what `registerTool` asks for.
 */
export interface ApplyToolCallContext {
  readonly mcpReq?: {
    readonly inputResponses?: Record<string, unknown> | undefined
    /**
     * The per-request `_meta` envelope (2026-07-28), carrying the caller's declared capabilities.
     *
     * Read here rather than through the server's `getClientCapabilities()` accessor for two
     * reasons: that accessor is deprecated in favour of exactly this envelope, and it would put an
     * `McpServer` instance into a module whose whole design is that it holds nothing. A 2025-era
     * request carries no envelope at all, and its absence is the correct answer for that era —
     * measured 2026-08-16: per-request legacy serving has NO client capabilities on any connection,
     * so an embedded request can never be answered there.
     */
    readonly envelope?: Record<string, unknown> | undefined
  }
}

/**
 * Can THIS connection answer an embedded input request?
 *
 * The one condition under which the SEP-2322 form is attached. Keyed on the capability the SDK
 * itself checks (`elicitation`) and read through the SDK's own envelope key constant, so the
 * question this asks and the question the SDK asks are one question rather than two spellings that
 * agree today.
 *
 * Measured on 2.0.0, 2026-08-16, all three combinations that exist:
 *   2025-era connection                      -> no envelope            -> false
 *   2026-07-28, client declares nothing      -> `{}`                   -> false
 *   2026-07-28, client declares elicitation  -> `{elicitation: {}}`    -> true
 */
function clientCanAnswerAForm(ctx: ApplyToolCallContext | undefined): boolean {
  const declared = ctx?.mcpReq?.envelope?.[CLIENT_CAPABILITIES_META_KEY]
  if (typeof declared !== 'object' || declared === null) return false
  return (declared as { elicitation?: unknown }).elicitation !== undefined
}

/** The host-bound `(registry, caller)` closure over `invokeFunction`. */
export type ApplyToolInvoke = (opId: string, input: unknown) => Promise<unknown>

export interface ApplyToolHandlerDeps {
  /**
   * The ONE op this handler's confirmed route reaches.
   *
   * Bound per tool at registration, which is why no kind lookup happens at apply time: the
   * knowledge family's tool binds `knowledge.proposal.apply` and the config family's binds
   * `config.proposal.apply`. A single tool over both would have had to read the proposal's kind to
   * choose, and would have carried the UNION of their scopes into its visibility (D-05), hiding the
   * knowledge apply from the default local caller who is deliberately not granted `config-write`
   * (D-07). The split is forced by those two decisions together, not chosen for taste.
   */
  readonly applyOpId: string
  readonly invoke: ApplyToolInvoke
  /** Renders the summary line from what `proposals.show` answered. */
  readonly summarize: (showOutput: unknown, proposalId: string) => string
  /**
   * How text leaving this handler is masked (threat T-396-01 / Pitfall 9).
   *
   * REQUIRED, and the fourth dep the plan did not name, for the reason plan 01 made `maskText`
   * required on `buildAgentQaMcpServer`: the defect class this phase inherits (T-395-R5-10, closed
   * in 395's final round) was a credential reaching an MCP caller verbatim through a serialization
   * nobody had counted as an output channel. This handler composes prose out of PROPOSAL CONTENT and
   * serialises an op's output and its errors, so it is three such channels — and it does not pass
   * through `catalog.ts`'s generic handler, which is where every other tool's masking happens. An
   * optional masker is absent exactly where nobody looked.
   */
  readonly maskText: (text: string) => string
}

/**
 * The refusal a caller reads, and can act on, with no form.
 *
 * Composed as two lines so the degradation is structural rather than remembered: the first is what
 * this proposal IS, the second is the exact call that applies it. A 2025-era caller receiving only
 * `content` still has both.
 */
function teachingParts(
  summary: string,
  proposalId: string,
  mismatch: string | undefined,
): { readonly summary: string; readonly instruction: string; readonly text: string } {
  const instruction =
    `To apply it, call this tool again with proposal_id "${proposalId}" and confirmed: true. `
    + 'Nothing has been changed by this call.'
  const described = mismatch === undefined ? summary : `${summary}\n${mismatch}`
  return { summary: described, instruction, text: `${described}\n${instruction}` }
}

/**
 * Trim a value echoed back from the caller's own request.
 *
 * The mismatch sentence quotes what the confirmation form was answered with, which is caller-
 * controlled data. Quoting it is the point — a caller cannot fix a mismatch it is not shown — but
 * quoting it unbounded would let a caller decide the size of the server's reply.
 */
function clampEcho(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 120)}…`
}

/**
 * Render the summary line a person reads before authorising a commit.
 *
 * PARSED, NOT DUCK-TYPED. The op's own output contract is the reader, so this line describes a
 * value `proposals.show` could actually have answered with; anything else falls through to a
 * value-free sentence rather than becoming a confident claim assembled from an unrecognised object.
 * A wrong summary here is worse than an absent one: it is the sentence on which a human authorises
 * a durable change.
 */
export function summarizeProposalForApply(showOutput: unknown, proposalId: string): string {
  const parsed = ProposalsShowOutputSchema.safeParse(showOutput)
  if (!parsed.success) {
    return `Proposal ${proposalId}: its details could not be read, so nothing is claimed about it here.`
  }
  if (parsed.data.kind === 'not-found') {
    return `There is no proposal ${parsed.data.proposalId} in this project's inbox.`
  }

  const { envelope, applyInFlight } = parsed.data.entry
  const evidence = envelope.evidenceRefs.length
  const inFlight = applyInFlight ? ', an apply is already in flight' : ''
  return (
    `Proposal ${envelope.id}: a ${envelope.kind} proposal, status ${envelope.status}, `
    + `${evidence} evidence reference${evidence === 1 ? '' : 's'}${inFlight}.`
  )
}

/**
 * Build the apply handler for one family's apply op.
 *
 * ONE PRIMITIVE, TWO TOOLS. Both apply doors are this function bound to a different `applyOpId`;
 * there is no second refusal shape to keep in step and no family-specific branch anywhere below.
 *
 * The precedence is strict and is the whole security claim of the module:
 *   1. `confirmed === true`, by identity, with no coercion  -> apply
 *   2. the in-band form answered with THIS call's proposal id -> apply
 *   3. anything else — absent, false, truthy-but-not-true, an answer naming another proposal,
 *      a declined form -> refuse and teach, having invoked the apply op zero times.
 */
export function createApplyToolHandler(deps: ApplyToolHandlerDeps) {
  const { applyOpId, invoke, summarize, maskText } = deps

  async function apply(proposalId: string): Promise<CallToolResult> {
    try {
      // The op's OWN contract name. `proposal_id` is wire vocabulary and stops here; what crosses
      // the function-layer wall is the object `invokeFunction` will parse and refuse on its own.
      // BOTH channels from ONE masked serialization (396-06): the receipt a machine reads and the
      // text a person reads are the same bytes, so a value hidden from one cannot survive in the
      // other. See `masked-result.ts` for the measurement that forced this.
      return maskedToolResult(await invoke(applyOpId, { proposalId }), maskText)
    } catch (err) {
      // A refusal from the gate, the scope check or the store is a RESULT the caller can read, not
      // a transport failure — and the message is masked because an error string is precisely the
      // channel 395's credential disclosure travelled down.
      return maskedToolError(err, maskText)
    }
  }

  async function refuse(
    proposalId: string,
    mismatch: string | undefined,
    withForm: boolean,
  ): Promise<CallToolResult | (CallToolResult & InputRequiredResult)> {
    // Read through the SAME invoke every other tool uses. Never a store, never a second data path:
    // a handler that could read the proposals directory would be the private power this whole
    // re-derivation exists to abolish.
    let summary: string
    try {
      summary = summarize(await invoke(PROPOSALS_SHOW_OP_ID, { proposalId }), proposalId)
    } catch {
      // The teach must be ALWAYS AVAILABLE. A caller who cannot read the inbox — a narrower grant,
      // an unavailable store — must still be told the call that applies, or the refusal is a dead
      // end rather than a door. What is lost is the description, so nothing is claimed instead.
      summary = `Proposal ${proposalId}: its details could not be read, so nothing is claimed about it here.`
    }

    const parts = teachingParts(summary, proposalId, mismatch)
    const text = maskText(parts.text)
    // NOT `isError`, on either branch. Refusing to commit unasked is this tool working, and an
    // error result would teach a host to surface it as a fault and an agent to retry it as one.
    //
    // `structuredContent` is the same refusal as DATA, on the arm of the advertised union authored
    // for it. Every field it carries is masked, for the reason the whole handler is: the summary is
    // composed out of proposal content, which is the channel 395's disclosure travelled down.
    const teach: CallToolResult = {
      content: [{ type: 'text' as const, text }],
      structuredContent: {
        status: APPLY_REFUSAL_STATUS,
        applied: false,
        // MASKED LIKE EVERY OTHER FIELD, including the id the caller itself sent. 396-06's
        // credential differential found this field carrying a planted credential to the wire while
        // the prose beside it was masked — a caller can put anything in `proposal_id`, and what a
        // caller sends is exactly what an echoing channel returns. The prose already renders the id
        // masked, so an unmasked copy of it here would have been the same disclosure in the
        // channel a machine reads.
        proposal_id: maskText(proposalId),
        summary: maskText(parts.summary),
        instruction: maskText(parts.instruction),
      },
    }
    if (!withForm) return teach

    return {
      ...teach,
      ...inputRequired({
        inputRequests: {
          [APPLY_CONFIRMATION_REQUEST_KEY]: inputRequired.elicit({
            message: text,
            requestedSchema: APPLY_CONFIRMATION_REQUESTED_SCHEMA as unknown as Parameters<
              typeof inputRequired.elicit
            >[0]['requestedSchema'],
          }),
        },
      }),
    }
  }

  return async function applyToolHandler(
    args: ApplyToolInput,
    ctx?: ApplyToolCallContext,
  ): Promise<CallToolResult | InputRequiredResult> {
    const proposalId = args.proposal_id

    // IDENTITY, not truthiness, and not `Boolean(...)`. The distance between `=== true` and a
    // truthy test is the distance between a caller that decided to apply and a caller whose client
    // put the string "true" in a field — and the second one commits a change nobody authorised.
    if (args.confirmed === true) return apply(proposalId)

    const answer = acceptedContent<{ proposal_id?: unknown }>(
      ctx?.mcpReq?.inputResponses,
      APPLY_CONFIRMATION_REQUEST_KEY,
    )
    const answered = answer?.proposal_id

    if (typeof answered === 'string' && answered === proposalId) return apply(proposalId)

    // An answer that names a DIFFERENT proposal is the one case that gets its own sentence. It is
    // not a caller being clumsy: it is the shape of a confirmation being replayed against another
    // proposal, and answering it with the plain refusal would leave the caller re-sending the same
    // wrong pairing forever with no way to see why.
    const mismatch =
      typeof answered === 'string' && answered !== proposalId
        ? `The confirmation was answered with proposal_id "${clampEcho(answered)}", which does not `
          + `name the proposal this call is about ("${proposalId}"), so nothing was applied.`
        : undefined

    return refuse(proposalId, mismatch, clientCanAnswerAForm(ctx))
  }
}
