/**
 * 422-22-T2 — the RUNTIME half of the post-run chain's closed-set oracle.
 *
 * WHAT THIS ADDS TO WHAT 422-07 ALREADY PINNED. `chain-identity.test.ts` proves the derivation
 * hands back three ids and that each successor key is built from its own predecessor. Those are
 * claims about the FUNCTION. This file's claims are about the VOCABULARY: that the key set, the
 * terminal kind list, the successor topology, the five job kinds and the three proposal-inbox
 * kinds are each exactly what a human wrote down, and that a fourth member of any of them REDs a
 * cell that names it.
 *
 * EVERY EXPECTATION IS HAND-SPELLED, AND NEVER BUILT FROM THE THING IT MEASURES. Not one cell
 * maps, spreads or iterates the production constant to produce its own expectation — a cell that
 * did would agree with that constant however both of them change. Where a cell compares two
 * production values to each other (the derived kind set against the terminal list), it ALSO
 * compares both against the literal, so "they agree with each other" cannot be the whole claim.
 *
 * DECLARED EQUALS PRODUCED IS MEASURED, NOT ASSERTED. The successor cells invoke a real handler
 * from the shipped registry and read the successors it actually returns, rather than comparing
 * the declaration array against a copy of itself.
 *
 * The compile-time half lives in `422-chain-closed-sets.test-d.ts` and shares no fixture with
 * this file. Two oracles reading one fixture are one oracle.
 */
import { asJobId, isJobKind, PROPOSAL_KINDS } from '@vostride/agent-qa-schema'
import type { Job, JobKind } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  CHAIN_JOB_ID_KEYS,
  chainJobIdsForRun,
  POST_RUN_CHAIN_TERMINAL_KINDS,
} from '../chain-identity.js'
import type { JobIdSource } from '../engine.js'
import type { JobHandlerContext } from '../kind-registry.js'
import { createRealJobKindRegistry, REAL_JOB_KIND_DECLARATIONS } from '../kinds.js'

const RUN_ID = 'run-422-22'

// ---------------------------------------------------------------------------------------
// The independent spellings. Typed out from the D-13 decision, never copied from the
// production constants below them. `readonly string[]` rather than `as const`, so TypeScript
// cannot relate these to the production unions and the comparison stays a run-time one
// between two independently authored lists of plain strings.
// ---------------------------------------------------------------------------------------

const EXPECTED_CHAIN_ID_KEYS: readonly string[] = [
  'analyzeRun',
  'curateMemory',
  'proposeImprovements',
]

const EXPECTED_TERMINAL_KINDS: readonly string[] = [
  'analyze-run',
  'curate-memory',
  'propose-improvements',
]

const EXPECTED_JOB_KINDS: readonly string[] = [
  'chat',
  'analyze-run',
  'curate-memory',
  'consolidate',
  'propose-improvements',
]

const EXPECTED_PROPOSAL_KINDS: readonly string[] = ['knowledge', 'test-draft', 'config']

/** The successor topology, hand-drawn: every kind, and exactly what it may chain to. */
const EXPECTED_SUCCESSORS: readonly (readonly [string, readonly string[]])[] = [
  ['chat', []],
  ['analyze-run', ['curate-memory']],
  ['curate-memory', ['propose-improvements']],
  ['consolidate', []],
  ['propose-improvements', []],
]

function declarationFor(kind: string): (typeof REAL_JOB_KIND_DECLARATIONS)[number] {
  const found = REAL_JOB_KIND_DECLARATIONS.find(entry => entry.kind === kind)
  if (found === undefined) throw new Error(`${kind} is not declared`)
  return found
}

/** An id source that records what it was ASKED for, so the kind set is read off the calls. */
function recordingIdSource(): { asked: { kind: JobKind; key: string }[]; idSource: JobIdSource } {
  const asked: { kind: JobKind; key: string }[] = []
  return {
    asked,
    idSource: {
      jobIdFor: (kind, key) => {
        asked.push({ kind, key })
        return asJobId(`${kind}:${key}`)
      },
    },
  }
}

/** A minimal handler context. Nothing here reaches a model, a file or a clock. */
function contextFor(kind: string, jobId: string, payload: unknown): JobHandlerContext {
  return {
    job: {
      id: asJobId(jobId),
      kind,
      status: 'queued',
      summary: 'fixture',
      attempts: 1,
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    } as unknown as Job,
    payload,
    publishCheckpoint: async () => {},
    recordLlmAuthorship: (async () => undefined) as unknown as
      JobHandlerContext['recordLlmAuthorship'],
  }
}

describe('422-22 the three chain id keys', () => {
  it('is exactly the three keys the derivation addresses, in declaration order', () => {
    expect([...CHAIN_JOB_ID_KEYS]).toEqual([...EXPECTED_CHAIN_ID_KEYS])
    expect([...CHAIN_JOB_ID_KEYS].sort()).toEqual([...EXPECTED_CHAIN_ID_KEYS].sort())
    expect(CHAIN_JOB_ID_KEYS.length).toBe(3)
  })

  it('names exactly the keys the derivation PRODUCES, not a parallel list', () => {
    // Both halves are checked against the literal as well as against each other. A cell that
    // only compared the constant to the returned object would pass on a chain that grew a
    // fourth id AND a fourth list entry in the same edit — which is the edit this exists for.
    const produced = Object.keys(chainJobIdsForRun(RUN_ID, recordingIdSource().idSource))
    expect([...produced].sort()).toEqual([...EXPECTED_CHAIN_ID_KEYS].sort())
    expect([...CHAIN_JOB_ID_KEYS].sort()).toEqual([...produced].sort())
  })

  it('keys the third id from the SECOND, and never from a candidate', () => {
    // Identity is transitive so a head that moved moves all three together. A candidate-derived
    // key would be one nothing can predict before the fold that discovers the candidates has
    // run — which is the whole reason `chainJobIdsForRun` takes a run id and nothing else.
    const { asked, idSource } = recordingIdSource()
    const ids = chainJobIdsForRun(RUN_ID, idSource)
    expect(asked.map(call => call.key)).toEqual([
      RUN_ID,
      `${String(ids.analyzeRun)}->curate-memory`,
      `${String(ids.curateMemory)}->propose-improvements`,
    ])
    for (const call of asked) expect(call.key).not.toContain('cand')
    expect(new Set([ids.analyzeRun, ids.curateMemory, ids.proposeImprovements]).size).toBe(3)
  })
})

describe('422-22 the terminal kind list', () => {
  it('is exactly the three kinds whose finish can land the chain terminal', () => {
    expect([...POST_RUN_CHAIN_TERMINAL_KINDS]).toEqual([...EXPECTED_TERMINAL_KINDS])
    expect([...POST_RUN_CHAIN_TERMINAL_KINDS].sort()).toEqual([...EXPECTED_TERMINAL_KINDS].sort())
  })

  it('is the same kind set the derivation asks the id source for', () => {
    const { asked, idSource } = recordingIdSource()
    chainJobIdsForRun(RUN_ID, idSource)
    expect(asked.map(call => call.kind).sort()).toEqual([...EXPECTED_TERMINAL_KINDS].sort())
  })

  it('names only kinds this build actually declares', () => {
    for (const kind of POST_RUN_CHAIN_TERMINAL_KINDS) {
      expect(isJobKind(kind)).toBe(true)
      expect(EXPECTED_JOB_KINDS).toContain(kind)
    }
    // `chat` and `consolidate` are declared kinds that are NOT on the post-run chain at all —
    // stated so the list cannot quietly become "every kind".
    expect([...POST_RUN_CHAIN_TERMINAL_KINDS]).not.toContain('chat')
    expect([...POST_RUN_CHAIN_TERMINAL_KINDS]).not.toContain('consolidate')
  })
})

describe('422-22 the successor topology', () => {
  it('declares exactly the hand-drawn edges and no others', () => {
    for (const [kind, successors] of EXPECTED_SUCCESSORS) {
      expect([...declarationFor(kind).allowedSuccessors]).toEqual([...successors])
    }
    // The whole topology is two edges. A third declared edge anywhere REDs the count.
    const edges = REAL_JOB_KIND_DECLARATIONS.flatMap(entry => [...entry.allowedSuccessors])
    expect(edges.length).toBe(2)
  })

  it('ends the chain at the proposal stage — a fourth stage is declared nowhere', () => {
    expect([...declarationFor('propose-improvements').allowedSuccessors]).toEqual([])
    expect(declarationFor('propose-improvements').onPermanentFailure).toBe('halt-chain')
    // A fold that gave up permanently committed no bundle, so it must not hand a proposal job a
    // curation that never happened.
    expect(declarationFor('curate-memory').onPermanentFailure).toBe('halt-chain')
  })

  it('PRODUCES the declared curate-memory successor, measured through a real handler', async () => {
    // Declared equals produced, read off the registry rather than compared against a copy of
    // the declaration array. The no-capability registry is a shipped production path, and its
    // successor emission reads the same constant the declaration does.
    const outcome = await createRealJobKindRegistry()
      .require('curate-memory')
      .handler(contextFor('curate-memory', 'job_curate_422_22', { chain: true }))
    if (outcome.status !== 'complete') throw new Error(`expected complete, got ${outcome.status}`)
    expect(outcome.next.map(request => request.kind)).toEqual(['propose-improvements'])
    expect(outcome.next[0]?.idempotencyKey).toBe('job_curate_422_22->propose-improvements')
  })

  it('PRODUCES nothing after the proposal stage', async () => {
    const outcome = await createRealJobKindRegistry()
      .require('propose-improvements')
      .handler(contextFor('propose-improvements', 'job_propose_422_22', { chain: true }))
    if (outcome.status !== 'complete') throw new Error(`expected complete, got ${outcome.status}`)
    expect(outcome.next.map(request => request.kind)).toEqual([])
  })
})

describe('422-22 the vocabularies the chain widening did NOT move', () => {
  it('keeps exactly five job kinds, declared in the vocabulary order', () => {
    // D-13 added an EDGE and an ID, never a KIND. `propose-improvements` has been declared
    // since 385; what 422 gave it is a predecessor.
    expect(REAL_JOB_KIND_DECLARATIONS.map(entry => entry.kind)).toEqual([...EXPECTED_JOB_KINDS])
    expect(REAL_JOB_KIND_DECLARATIONS.length).toBe(5)
  })

  it('refuses a sixth kind at the public predicate', () => {
    for (const kind of EXPECTED_JOB_KINDS) expect(isJobKind(kind)).toBe(true)
    // The near-misses a later plan would reach for: a fourth chain stage named after what it
    // would do, and the retired spelling of a kind this milestone deleted.
    expect(isJobKind('stage-adversarial')).toBe(false)
    expect(isJobKind('propose_improvements')).toBe(false)
    expect(isJobKind('')).toBe(false)
    expect(isJobKind(undefined)).toBe(false)
  })

  it('keeps exactly three proposal-inbox kinds', () => {
    expect([...PROPOSAL_KINDS]).toEqual([...EXPECTED_PROPOSAL_KINDS])
    expect([...PROPOSAL_KINDS].sort()).toEqual([...EXPECTED_PROPOSAL_KINDS].sort())
    // The proposal STAGE and the proposal INBOX are different vocabularies that share a word.
    // Neither may name a member of the other.
    for (const kind of PROPOSAL_KINDS) expect(EXPECTED_JOB_KINDS).not.toContain(kind)
  })

  it('keeps the proposal stage terminal checkpoint last, behind its allowance charge', () => {
    // The ORDER is the contract rather than a listing convention: the charge is what a resumed
    // attempt reads to learn what a previous one may already have spent, so it has to be
    // durable before any call is made and therefore before the checkpoint reporting the result.
    const schedule = [...declarationFor('propose-improvements').checkpointSchedule]
    expect(schedule.length).toBe(2)
    expect(schedule[schedule.length - 1]).toBe('proposals-authored')
    expect([...declarationFor('curate-memory').checkpointSchedule]).toEqual([
      'candidates-authored',
      'bundle-committed',
    ])
    expect([...declarationFor('analyze-run').checkpointSchedule]).toEqual(['verdicts-authored'])
  })
})
