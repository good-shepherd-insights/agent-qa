// The post-run chain's identity, pinned where it is derived (JOBK-03, D-02/D-03).
//
// Two claims: the derivation hands back exactly two keys, and the terminal list is not a second
// opinion about membership — it IS the kind set the derivation asks the id source for, so a chain
// that grows an id without extending the list, or extends the list without deriving the id, reds
// here by name rather than reporting a terminal one job early.
//
// 2026-09-01 (Phase 409): the third chain id left with the Issue-slot cleanup — see
// DELETION-INVENTORY.md.

import { asJobId } from '@vostride/agent-qa-schema'
import type { JobKind } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { chainJobIdsForRun, POST_RUN_CHAIN_TERMINAL_KINDS } from '../chain-identity.js'
import type { JobIdSource } from '../engine.js'

const RUN_ID = 'run-1'

/**
 * An id source that records what it was asked for.
 *
 * The derivation calls `jobIdFor` exactly once per id, so the recorded kinds ARE the kind set
 * the chain addresses — read off the CALL rather than off the returned object's keys, because
 * the equivalence below has to compare the derivation against a hand-authored list and a key
 * set could agree with itself.
 */
function recordingIdSource(): {
  asked: { kind: JobKind; key: string }[]
  idSource: JobIdSource
} {
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

describe('the post-run chain ids (JOBK-03, D-02/D-03)', () => {
  it('derives exactly two chain ids, keyed analyzeRun and curateMemory', () => {
    const { idSource } = recordingIdSource()

    // Sorted against a literal rather than counted, so a third key names itself in the diff.
    expect(Object.keys(chainJobIdsForRun(RUN_ID, idSource)).sort()).toEqual([
      'analyzeRun',
      'curateMemory',
    ])
  })

  it('lets every derived chain kind land the terminal — the terminal list equals the derived kind set', () => {
    const { asked, idSource } = recordingIdSource()
    chainJobIdsForRun(RUN_ID, idSource)

    // Declaration order: the terminal list is an authored array, so its order is part of what
    // this pins, exactly as the literal-list rule asks (D-01).
    expect([...POST_RUN_CHAIN_TERMINAL_KINDS]).toEqual(['analyze-run', 'curate-memory'])
    // …and the coupling, which is the point of the cell. Either half moving without the other
    // reds this line, and the diff says which kind arrived or went missing.
    expect(asked.map((call) => call.kind).sort()).toEqual([...POST_RUN_CHAIN_TERMINAL_KINDS].sort())
  })

  it('derives two distinct ids whose successor key is built from the head id', () => {
    const { asked, idSource } = recordingIdSource()
    const ids = chainJobIdsForRun(RUN_ID, idSource)

    // Adjacency: the second id is not an independent hash of the run, it is addressed FROM the
    // first. Two ids that collided would collapse the chain onto one row; a successor key that
    // forgot the head would address a row the engine's own `successorsOf` never mints.
    expect(ids.analyzeRun).not.toBe(ids.curateMemory)
    expect(asked.map((call) => call.key)).toEqual([
      RUN_ID,
      `${String(ids.analyzeRun)}->curate-memory`,
    ])
  })
})
