// The one funnel every config apply passes through, and what it does with a blocked record
// (Phase 395-02, D-10 · T-395-04).
//
// WHAT MAKES THESE CELLS RED: `applyablePayload` widened back to a pass-through — either by
// returning the union, by casting, or by adding a `default` arm that let a blocked record past. Any
// of the three compiles fine and is exactly the widening 395-01 wrote this function to prevent, and
// each one fails the first cell below.
//
// AND WHY THE SECOND CELL EXISTS: an applyable payload must still travel. A refusal that refused
// everything would pass a "blocked is refused" assertion just as happily as a correct one, so the
// positive half is measured beside it rather than assumed.

import { describe, expect, it } from 'vitest'

import { CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { ConfigProposalV1 } from '@vostride/agent-qa-schema'

import { BlockedConfigProposalError, applyablePayload } from '../construct.js'

const blocked: ConfigProposalV1 = {
  schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  payloadKind: 'blocked',
  action: 'config.field.set',
  summaryLine: 'set registry.providers.farm.accessKey',
  blockedReason: 'guardrail-hit',
  paths: ['agent-qa.config.yaml'],
  scanFindings: [{
    path: 'agent-qa.config.yaml',
    field: 'registry.providers.farm.accessKey',
    detector: 'generic-secret-shape',
    redactedFingerprint: 'sha256:9f86…0a08',
  }],
}

const applyable: ConfigProposalV1 = {
  schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  payloadKind: 'applyable',
  action: 'config.field.set',
  summaryLine: 'set use.parallel to true',
  files: [{
    path: 'agent-qa.config.yaml',
    changeKind: 'modify',
    baseDigest: 'abc',
    newContentBase64: 'dXNlOgo=',
  }],
  shownDiffBase64: 'eA==',
  shownDiffDigest: 'def',
  crossBoundary: false,
  crossBoundaryReasons: [],
}

describe('applyablePayload — the funnel every config apply passes through', () => {
  it('refuses a blocked record BY NAME, and names the reason', () => {
    expect(() => applyablePayload(blocked)).toThrow(BlockedConfigProposalError)
    expect(() => applyablePayload(blocked)).toThrow(/guardrail-hit/)
  })

  it('the refusal message quotes nothing the scan found', () => {
    let message = ''
    try {
      applyablePayload(blocked)
    } catch (error) {
      message = (error as Error).message
    }
    // The channel CAN carry a fingerprint — it is in the payload this call was handed — so the
    // absence below is a fact about the message rather than about a channel that never had one.
    expect(blocked.payloadKind === 'blocked' && blocked.scanFindings?.[0]?.redactedFingerprint)
      .toBe('sha256:9f86…0a08')
    expect(message).not.toContain('9f86')
    expect(message).not.toContain('accessKey')
  })

  it('still passes an applyable payload straight through, unchanged', () => {
    expect(applyablePayload(applyable)).toBe(applyable)
  })
})
