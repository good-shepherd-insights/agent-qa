// What a refused caller can actually DO about it, typed (Phase 400, D-15).
//
// THE DEFECT THIS TYPE EXISTS TO CLOSE. The gate composes one prose reason per decision arm, and
// the fail-closed arm's sentence ends "re-run locally to confirm interactively or opt in with
// --trust-session". Phase 399's rehearsals chased both halves from the surface that issued it —
// an MCP client — and measured that `--trust-session` is declared on exactly one command (`run`),
// so there is no flag to pass, and that the confirm port the other half points at is reachable
// only through a passthrough the sentence never names. A refusal that offers no way forward the
// reader can FIND is worse than one offering none, because it spends their time while looking
// helpful (`399-friction-refusal-remedies-unreachable`).
//
// A SENTENCE IS ONE STRING AND THERE ARE FOUR DOORS. That is the whole argument for structure
// rather than a better sentence: the gate cannot write prose that is simultaneously right for a
// terminal, a chat transcript, an MCP client and a browser, and every attempt produces the same
// failure — one surface's instructions rendered to a reader on another. So the decision carries
// DATA, each surface applies {@link remediesRenderableBy}, and a surface with nothing it can take
// renders nothing. Honest absence is a supported answer here, never a gap to fill with guidance.
//
// THE PROSE REASON IS UNTOUCHED AND STAYS CANONICAL. It is the audit/log text — it lands in the
// execution-audit row, and `demo/acceptance/399/` publishes it verbatim as measured evidence. This
// vocabulary rides BESIDE it; nothing here edits a byte of it (T-400-07).
//
// EVERY MEMBER IS A MEASURED AFFORDANCE, WHICH IS THE MEMBERSHIP RULE. A kind may be added only
// when some shipped surface can actually take it. `standing-grant` was a candidate in the phase
// research and is deliberately ABSENT: standing approvals are minted through the `accept --always`
// escalation on a filed proposal, so telling the caller of an arbitrary denied op to "record a
// standing approval" would be exactly the unreachable-remedy defect above, re-minted with a type
// on it. The vocabulary is small because it is honest, not because it is unfinished.
//
// SCHEMA-PACKAGE HOME, on the `session-events` precedent: safety mints these, cli/agent/dashboard
// render them, and a type four packages read belongs to the package they all already depend on.
// Pure types and pure functions only — no host APIs.

/**
 * The closed remedy vocabulary.
 *
 * ORDER IS RENDER ORDER. Projections preserve it, so a surface showing two remedies shows them in
 * the order the gate minted them rather than in whatever order a filter happened to produce.
 */
export const GATE_REMEDY_KINDS = [
  'answer-confirm',
  'trust-session-flag',
  'session-pin-final',
] as const

export type GateRemedyKind = (typeof GATE_REMEDY_KINDS)[number]

/**
 * The doors a remedy can be offered on — the four surfaces this product ships.
 *
 * `cli` is the one-shot and REPL terminal doors, `chat` the interactive conversation, `mcp` a
 * protocol client with no human at a prompt, `dashboard` the browser.
 */
export const GATE_REMEDY_SURFACES = ['cli', 'chat', 'mcp', 'dashboard'] as const

export type GateRemedySurface = (typeof GATE_REMEDY_SURFACES)[number]

/**
 * One thing the caller could do, and the structural identifiers a surface needs to say it.
 *
 * `params` CARRIES IDENTIFIERS, NEVER PAYLOAD (T-400-08). Flag names, command names, action
 * classes — facts the gate itself minted about the shipped surface. Nothing that passed through a
 * masker belongs here, because a remedy travels to every surface's render including a browser's.
 */
export interface GateRemedy {
  readonly kind: GateRemedyKind
  readonly params?: Readonly<Record<string, string>>
}

/**
 * WHICH SURFACES CAN TAKE WHICH REMEDY — the single authority, spelled once.
 *
 * TOTAL OVER THE VOCABULARY BY `satisfies`, on `receipt-line.ts`'s STATUS_STYLE idiom: a fifth
 * kind added above without an entry here is a compile error at this line rather than a remedy that
 * silently reaches nobody. The alternative — a lookup with a default arm — answers "no surface"
 * for a kind somebody forgot, which is indistinguishable from a kind deliberately offered nowhere.
 *
 * THE MEMBERSHIPS ARE READ OFF THE SHIPPED SURFACES, not chosen for symmetry:
 *
 *   `answer-confirm` — needs a human at a port that can answer. The terminal doors have one, chat
 *   has one, the browser gets one. An MCP client does not, which is the precise fact rehearsal 2
 *   measured and the precise reason this table exists.
 *
 *   `trust-session-flag` — `--trust-session` is declared on ONE command, `agent-qa run`, and
 *   `399-runbook-gate.sh --chain` refuses if a second command ever declares it. It is therefore a
 *   CLI affordance and nothing else. Offering it to a browser or an MCP client is the todo.
 *
 *   `session-pin-final` — a session pin has no revoke verb by design (392 D-21); the only way out
 *   is ending the session, so only the surfaces that HAVE a session can render it.
 */
export const GATE_REMEDY_SURFACES_BY_KIND = {
  'answer-confirm': ['cli', 'chat', 'dashboard'],
  'trust-session-flag': ['cli'],
  'session-pin-final': ['chat', 'dashboard'],
} as const satisfies Record<GateRemedyKind, readonly GateRemedySurface[]>

/**
 * The kinds one surface can take, DERIVED from the table above rather than restated.
 *
 * This is what makes a per-surface render map compile-time total: `Record<RemedyKindFor<'cli'>, …>`
 * at a CLI render site gains a required arm the moment a new kind lists `cli`, and loses one the
 * moment a kind stops listing it. A hand-written kind list at each render site would be a second
 * copy of this table, free to drift from it — the second-copy defect class this codebase's
 * expensive bugs all belong to.
 */
export type RemedyKindFor<S extends GateRemedySurface> = {
  [K in GateRemedyKind]: S extends (typeof GATE_REMEDY_SURFACES_BY_KIND)[K][number]
    ? K
    : never
}[GateRemedyKind]

/**
 * The remedies THIS surface can offer, in mint order.
 *
 * THE ONE PROJECTION (T-400-06). Every surface's render runs through this function; none of them
 * filters for itself and none of them renders another surface's prose. An empty answer is a
 * complete answer — the caller is told the refusal and nothing else, which is what a surface with
 * no affordance honestly has to say.
 */
export function remediesRenderableBy(
  surface: GateRemedySurface,
  remedies: readonly GateRemedy[],
): readonly GateRemedy[] {
  return remedies.filter((remedy) =>
    (GATE_REMEDY_SURFACES_BY_KIND[remedy.kind] as readonly GateRemedySurface[]).includes(
      surface,
    ),
  )
}
