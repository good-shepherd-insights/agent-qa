// The proposals-inbox port, implemented over the durable store (Phase 391, PROP-03).
//
// A THIN ADAPTER and deliberately nothing more. Every rule the inbox turns on — how a name shape
// maps to a lifecycle state, when a pending proposal has expired, when an orphaned claim gets
// restored, what order rows come back in — lives in `proposals-store.ts`, because that is the
// module that owns the bytes. What this file owns is the two HOST FACTS the port contract says an
// implementation owns and a caller may not choose: the wall clock, and the process-liveness model
// the WR-03 reap turns on.
//
// It is a separate file from the store on the `quarantine/operations.ts` precedent: the substrate
// and the port are two different things with two different audiences, and 387's own note is what
// makes the split worth keeping — the store is "the substrate", and a port is a promise to a
// composition root.

import type {
  ProposalInboxEntryDto,
  ProposalsInboxPort,
  ProposalsRejectInput,
  ProposalsRejectOutput,
  ProposalsShowInput,
  ProposalsShowOutput,
} from '@vostride/agent-qa-schema'

import {
  listProposalEnvelopes,
  rejectPendingProposal,
  showProposalEnvelope,
} from './proposals-store.js'
import type { ProposalInboxEntry } from './proposals-store.js'

export interface ProposalsInboxOptions {
  /**
   * Where proposals are durable — `<configDir>/.agent-qa`. A FACTORY, because the CLI resolves
   * its root asynchronously and per call: closing over one resolved once would be a cache of a
   * fact this module does not own.
   */
  readonly resolveAgentQaRoot: () => Promise<string> | string
  /** The host's wall clock. Supplied, never read here — the store reads no clock at all (D-12). */
  readonly now: () => number
}

/**
 * Bind the three inbox verbs over one agent-qa runtime root.
 *
 * Nothing opens here. The first byte is read when a verb is invoked, which is what lets a
 * composition bind this unconditionally without deciding whether a proposals directory exists —
 * an empty inbox and an absent directory are the same answer (edge PROP-03/empty).
 */
export function createProposalsInbox(options: ProposalsInboxOptions): ProposalsInboxPort {
  async function root(): Promise<string> {
    return await options.resolveAgentQaRoot()
  }

  return {
    async list() {
      // EVERY row, unfiltered. The op narrows rows already in hand; a filter pushed down to here
      // would put the status rule in two places, and the second one would be the one that
      // forgets that `expired` is computed rather than stored.
      return listProposalEnvelopes(await root(), { now: options.now() }).map(toDto)
    },
    async show(input: ProposalsShowInput): Promise<ProposalsShowOutput> {
      const entry = showProposalEnvelope(await root(), input.proposalId, { now: options.now() })
      return entry === undefined
        ? { kind: 'not-found', proposalId: input.proposalId }
        : { kind: 'found', entry: toDto(entry) }
    },
    async reject(input: ProposalsRejectInput): Promise<ProposalsRejectOutput> {
      const agentQaRoot = await root()
      const at = options.now()
      const outcome = rejectPendingProposal(agentQaRoot, input.proposalId, {
        at,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (outcome.kind === 'not-found' || outcome.kind === 'apply-in-flight') {
        return { outcome: outcome.kind, proposalId: input.proposalId }
      }
      // THE ANSWER IS RE-READ, not assembled from the outcome's record. The store's arms carry
      // the durable record; what a surface renders is the read-time envelope, whose `status` is
      // computed against the same clock this call used. Building a second envelope here from the
      // record would be a second implementation of the one lifecycle rule — and it is the copy
      // that would keep saying `pending` about a proposal it had just decided.
      const entry = showProposalEnvelope(agentQaRoot, input.proposalId, { now: at })
      if (entry === undefined) {
        // Unreachable through this store: every arm above leaves a durable name on disk before it
        // returns. A throw rather than a fabricated row, because inventing an envelope for a
        // proposal nobody can find is exactly the guess the two-step design exists to refuse.
        throw new Error(
          `proposals.reject resolved ${outcome.kind} for ${input.proposalId} but no durable ` +
            'record is readable under that id',
        )
      }
      return {
        outcome: outcome.kind === 'rejected' ? 'rejected' : outcome.kind,
        entry: toDto(entry),
      }
    },
  }
}

/**
 * The store's entry as the wire DTO.
 *
 * A structural pass-through rather than a field-by-field copy, and it typechecks only because the
 * schema's `ProposalEnvelopeSchema` is pinned exactly equal to the `ProposalEnvelope` DTO the
 * store produces. That pin is what makes this line safe; without it this would be the seam where
 * a dropped field became a silently narrower answer.
 */
function toDto(entry: ProposalInboxEntry): ProposalInboxEntryDto {
  return { envelope: entry.envelope, applyInFlight: entry.applyInFlight }
}
