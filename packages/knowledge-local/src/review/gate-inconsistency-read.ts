// 2026-09-08, 418 D-20: a claimed proposal is undecided until a durable decision exists.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { GATE_INCONSISTENCY_SHAPES, ProposalIdSchema } from '@vostride/agent-qa-schema'
import type { GateInconsistency } from '@vostride/agent-qa-schema'
import {
  APPLIED_SUFFIX, CLAIM_INFIX, REJECTED_SUFFIX, AppliedProposalRecordSchema,
  DecidedProposalRecordSchema, RejectedProposalRecordSchema, appliedPath,
  extractStoredProposal, pendingPath, proposalsDir, readJsonIfPresent, rejectedPath,
  type StoredProposal,
} from './proposals-data.js'

export const GATE_INCONSISTENCY_REASON_PREFIX = 'gate-inconsistent:'
export interface PendingGateInconsistency extends GateInconsistency { proposalId: string }

export function gateInconsistencyDetails(stored: StoredProposal): PendingGateInconsistency | undefined {
  if (stored.kind !== 'knowledge' || stored.payload.verb !== 'accept'
    || stored.payload.targetRef.grain !== 'record') return undefined
  const delta = stored.payload.deltas[0]
  if (delta?.kind !== 'Deprecate' || delta.targetId !== stored.payload.targetRef.recordId
    || typeof delta.reason !== 'string' || !delta.reason.startsWith(GATE_INCONSISTENCY_REASON_PREFIX)) return undefined
  const [shape, gate1Digest, gate2Digest, extra] = delta.reason.slice(GATE_INCONSISTENCY_REASON_PREFIX.length).split(':')
  if (!GATE_INCONSISTENCY_SHAPES.some(value => value === shape)
    || !/^[a-f0-9]{64}$/.test(gate1Digest ?? '') || !/^[a-f0-9]{64}$/.test(gate2Digest ?? '')
    || extra !== undefined) throw new TypeError('Malformed gate-inconsistent proposal evidence')
  return { proposalId: ProposalIdSchema.parse(stored.id),
    shape: shape as GateInconsistency['shape'], gate1Digest: gate1Digest!, gate2Digest: gate2Digest! }
}

function namesFor(root: string): string[] {
  try { return readdirSync(proposalsDir(root)).sort() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function idFor(name: string): string | undefined {
  const raw = name.endsWith(APPLIED_SUFFIX) ? name.slice(0, -APPLIED_SUFFIX.length)
    : name.endsWith(REJECTED_SUFFIX) ? name.slice(0, -REJECTED_SUFFIX.length)
    : /^.+\.json\.claimed\.[1-9][0-9]*$/.test(name) ? name.slice(0, name.indexOf(CLAIM_INFIX))
    : name.endsWith('.json') ? name.slice(0, -5) : undefined
  if (raw === undefined) return undefined
  return ProposalIdSchema.parse(raw)
}

type ProposalState = { state: 'pending' | 'claimed' | 'applied' | 'rejected'; stored: StoredProposal }

function decided(root: string, id: string): ProposalState | undefined {
  const checked = (state: 'applied' | 'rejected', stored: StoredProposal): ProposalState => {
    if (stored.id !== id) throw new TypeError('Proposal path and payload id disagree')
    return { state, stored }
  }
  for (const state of ['applied', 'rejected'] as const) {
    const raw = readJsonIfPresent(state === 'applied' ? appliedPath(root, id) : rejectedPath(root, id))
    if (raw === undefined) continue
    if (typeof raw === 'object' && raw !== null && 'record' in raw) {
      const parsed = DecidedProposalRecordSchema.parse(raw)
      if (parsed.decision.decision !== state) throw new TypeError('Proposal path and decision disagree')
      return checked(state, extractStoredProposal(parsed.record))
    }
    const parsed = state === 'applied' ? AppliedProposalRecordSchema.parse(raw) : RejectedProposalRecordSchema.parse(raw)
    if (parsed.decision !== undefined && parsed.decision.decision !== state) {
      throw new TypeError('Proposal path and decision disagree')
    }
    return checked(state, extractStoredProposal(parsed.proposal))
  }
  return undefined
}

/** Read-only, bounded re-read across claim/restore/publish; never reaps a human's claim. */
export function gateInconsistencyProposalState(root: string, proposalId: string): ProposalState | undefined {
  const id = ProposalIdSchema.parse(proposalId)
  let observed = false
  for (let pass = 0; pass < 2; pass += 1) {
    const final = decided(root, id)
    if (final !== undefined) return final
    const names = namesFor(root).filter(name => idFor(name) === id)
    observed ||= names.length > 0
    const pending = readJsonIfPresent(pendingPath(root, id))
    let result: ProposalState | undefined = pending === undefined ? undefined
      : { state: 'pending', stored: extractStoredProposal(pending) }
    for (const name of names.filter(name => name.includes(CLAIM_INFIX))) {
      const raw = readJsonIfPresent(join(proposalsDir(root), name))
      if (raw !== undefined) result = { state: 'claimed', stored: extractStoredProposal(raw) }
    }
    // Publication precedes claim retirement. A durable decision always wins.
    const published = decided(root, id)
    if (published !== undefined) return published
    if (result !== undefined) {
      if (result.stored.id !== id) throw new TypeError('Proposal path and payload id disagree')
      return result
    }
  }
  // An observed name cannot disappear legitimately: decisions are retained forever.
  // Fail closed under repeated ownership changes instead of clearing a hold or re-minting.
  if (observed) throw new Error(`Proposal ${id} changed ownership during its read; retry`)
  return undefined
}

export function pendingGateInconsistencyFor(input: {
  agentQaRoot: string; candidateId: string
}): PendingGateInconsistency | undefined {
  const ids = new Set(namesFor(input.agentQaRoot).flatMap(name => {
    const id = idFor(name)
    return id === undefined ? [] : [id]
  }))
  for (const id of ids) {
    const result = gateInconsistencyProposalState(input.agentQaRoot, id)
    if (result === undefined) throw new Error(`Proposal ${id} changed ownership during its read; retry`)
    if (result.state === 'applied' || result.state === 'rejected') continue
    const stored = result.stored
    if (stored.kind !== 'knowledge' || stored.payload.targetRef.grain !== 'record'
      || stored.payload.targetRef.recordId !== input.candidateId) continue
    const details = gateInconsistencyDetails(stored)
    if (details !== undefined) return details
  }
  return undefined
}
