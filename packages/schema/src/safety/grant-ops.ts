// The standing-grant verbs' wire contract, and the port the ops dispatch through
// (Phase 391, D-03/D-04/D-05).
//
// MINTED IN SCHEMA, on the measured placement precedent rather than by analogy to it. Two packages
// consume this port and neither may import the other: `agent` names it as an optional `FunctionDeps`
// member and declares `grants.list` / `grants.revoke` plus the accept escalation's mint against it,
// and `knowledge-local` implements it over the committed grant ledger. 391-02 measured where such a
// port belongs — `QuarantineOperationsPort` at `quarantine/quarantine-ops.ts`, NOT the v47 legacy
// `packages/agent/src/ports/` directory, which holds no 384-era dep port at all — and 391-03
// followed it for the inbox. This is the third member of that family and the last of them.
//
// THERE IS NO `grants.record` OP, and that absence is D-01 expressed as a missing capability rather
// than as a rule somebody has to remember. A standing approval arises ONLY from the deliberate
// accept-with-always form of `proposals.accept`; a verb that minted one directly would be a second
// door into the same power, reachable without ever deciding a proposal. So `record` lives on the
// PORT — where the accept op's dispatch can reach it — and on no registry entry.
//
// FOUR THINGS ARE DELIBERATE HERE:
//
//  1. THE VOCABULARIES ARE IMPORTED (388 C13). The grant DTO is pinned EXACTLY EQUAL to the ledger
//     fold's own {@link ActiveStandingGrant}, and the scope schema to {@link TrustScope}. There is
//     no second spelling of either in this file, so a field added to the fold cannot arrive with
//     the wire contract still describing the old shape.
//  2. REFUSALS THAT ARE ORDINARY STATES ARE RESULT ARMS, NEVER THROWS. A revoke naming nothing
//     answers `no-grant`; a mint for an already-covered class answers `already-granted`; a mint for
//     a PROTECTED class answers `protected-class`. All three are things a person can be told about
//     and act on. What is NOT an arm is a write the lease or the egress checkpoint refused — those
//     surface as typed throws from the implementation, on the quarantine port's stated reasoning,
//     because answering `recorded` while the ledger recorded nothing tells somebody an approval
//     exists.
//  3. THE CALLER NEVER NAMES A GRANT ID. `record` takes the class, the scope and the provenance;
//     the identity is the implementation's to mint. A caller-supplied id is a caller-supplied
//     collision with an existing approval — and the revoke verb addresses ids, so forging one is
//     forging a revoke target.
//  4. NO CLOCK CROSSES THIS CONTRACT. Every event instant is stamped by the implementation from the
//     host clock it was composed with, exactly as the sibling ports do. A caller-supplied `at`
//     would let a caller backdate the record of when autonomy was widened.

import { z } from 'zod'

import type { ActiveStandingGrant } from './grant-ledger'
import type { TrustScope } from './trust-credential'

/** True only when the two types are mutually assignable — a real equality, not a subtype check. */
type ExactlyEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * The WIRE projection of {@link TrustScope}.
 *
 * `trust-credential.ts` declares the scope as a browser-safe DTO interface and deliberately not as
 * a schema; the function layer requires a live validator plus an inert JSON-Schema projection for
 * every declared contract (384 D-14), so the projection is minted here, at the boundary that needs
 * one, and never in the module that owns the type.
 *
 * Both members are `.min(1)` even though the DTO says only `string`, and that is the gate's own
 * rule made structural rather than a widening: `scopeMatches` treats a scope with zero POPULATED
 * keys as matching nothing on either side, so an empty-string member is a key that reads as present
 * and matches as absent.
 */
export const TrustScopeSchema = z.object({
  project: z.string().min(1).optional(),
  org: z.string().min(1).optional(),
}).strict()

const _trustScopeProjectionMatchesDto: ExactlyEqual<z.infer<typeof TrustScopeSchema>, TrustScope> =
  true
void _trustScopeProjectionMatchesDto

/**
 * The WIRE projection of one folded standing approval — pinned EXACTLY EQUAL to the fold's DTO.
 *
 * The pin is the reason this schema is allowed to exist beside {@link ActiveStandingGrant}. A
 * projection that quietly dropped `proposalId` would still parse every grant the fold produces,
 * and would strip the provenance link out of every surface — which is the one field that answers
 * "which decision widened this?" for a reviewer reading a pull request.
 */
export const StandingGrantSchema = z.object({
  grantId: z.string().min(1),
  actionClass: z.string().min(1),
  scope: TrustScopeSchema,
  grantedAt: z.string().min(1),
  proposalId: z.string().min(1).optional(),
}).strict()

export type StandingGrantDto = z.infer<typeof StandingGrantSchema>

const _standingGrantProjectionMatchesDto: ExactlyEqual<StandingGrantDto, ActiveStandingGrant> = true
void _standingGrantProjectionMatchesDto

/**
 * `grants.list`'s input: nothing.
 *
 * NO FILTER, and here the quarantine precedent transfers rather than departing (the inbox's did
 * not). Its argument was about a bounded ledger whose entries expire and are released; the grant
 * ledger's fold is exactly that — only ACTIVE approvals come back, revoked ones having left the
 * fold — so the full picture is small by construction and the caller who most needs it is the one
 * asking what the agent may currently do without asking.
 */
export const GrantsListInputSchema = z.object({}).strict()

export type GrantsListInput = z.infer<typeof GrantsListInputSchema>

export const GrantsListOutputSchema = z.object({
  grants: z.array(StandingGrantSchema),
}).strict()

export type GrantsListOutput = z.infer<typeof GrantsListOutputSchema>

/** `grants.revoke`'s input: the durable id, and nothing else (the ledger's own addressing rule). */
export const GrantsRevokeInputSchema = z.object({
  grantId: z.string().min(1),
}).strict()

export type GrantsRevokeInput = z.infer<typeof GrantsRevokeInputSchema>

/**
 * What a revoke did — two arms, neither of them a throw.
 *
 * `no-grant` is an ordinary answer rather than a refusal: an id pasted out of a stale listing, a
 * second click, a grant somebody else already withdrew. Reporting it as a failure would make the
 * most common concurrent case indistinguishable from a typo, which is the same call the inbox's
 * reject arms make.
 */
export const GrantsRevokeOutputSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('revoked'), grant: StandingGrantSchema }).strict(),
  z.object({ outcome: z.literal('no-grant'), grantId: z.string().min(1) }).strict(),
])

export type GrantsRevokeOutput = z.infer<typeof GrantsRevokeOutputSchema>

/**
 * What the accept escalation hands the mint.
 *
 * `actionClass` is the gate-seen action name and the caller is expected to have PRODUCED it from
 * the target op's own risk descriptor rather than typed it (D-04; the grant ledger's module head
 * states what a hand-typed bare id costs). This contract cannot enforce that — a string is a
 * string — so the accept op is where the production happens and where it is pinned.
 */
export const GrantRecordInputSchema = z.object({
  actionClass: z.string().min(1),
  scope: TrustScopeSchema,
  /** The proposal whose accept-with-always form is minting this. */
  proposalId: z.string().min(1).optional(),
}).strict()

export type GrantRecordInput = z.infer<typeof GrantRecordInputSchema>

/**
 * What a mint did — three arms, and each is a different thing to tell a person.
 *
 * `protected-class` is the MINT HALF of D-05, and it is DATA rather than a throw for a reason the
 * accept op depends on: an accept-with-always whose apply succeeded and whose mint was refused must
 * be able to report both, and an exception would discard the half that committed. The READ half of
 * the same rule lives in the standing-approval reader, so a line that reached the ledger by some
 * route this mint never saw still authorizes nothing.
 *
 * `already-granted` keeps grants from accreting: a second accept-with-always on a class already
 * covered records nothing, because two lines would need two revokes to undo one approval.
 */
export const GrantRecordOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('recorded'), grant: StandingGrantSchema }).strict(),
  z.object({ kind: z.literal('already-granted'), grant: StandingGrantSchema }).strict(),
  z.object({ kind: z.literal('protected-class'), actionClass: z.string().min(1) }).strict(),
])

export type GrantRecordOutcome = z.infer<typeof GrantRecordOutcomeSchema>

/**
 * The injected capability the grant verbs and the accept escalation dispatch through.
 *
 * ONE port rather than a reader/writer split, on the quarantine and inbox ports' stated reasoning:
 * the read/write asymmetry is already declared where it is ENFORCED — `grants.list` takes a read
 * scope and a read-only descriptor while `grants.revoke` takes `approval-write`, `readOnly: false`,
 * a raised tier and a human-origin requirement — so a second port would restate at the composition
 * root a distinction the gate makes at every call.
 *
 * `record` is on the port and on no op (see the module head). `list` answers ACTIVE grants only,
 * unfiltered — including any whose class is protected, because a protected line that reached the
 * committed file is precisely the one a reviewer has to be able to see and revoke. Refusing to
 * LIST it would leave the revoke verb unable to name it while it went on sitting in the diff.
 *
 * Implementations own three things this contract deliberately does not: the wall clock every event
 * is stamped with, the grant identity, and the serialization the committed append rides. All three
 * are host facts, and a port that took them as arguments would let a caller decide them.
 */
export interface StandingGrantsPort {
  list(): Promise<readonly ActiveStandingGrant[]>
  record(input: GrantRecordInput): Promise<GrantRecordOutcome>
  revoke(input: GrantsRevokeInput): Promise<GrantsRevokeOutput>
}
