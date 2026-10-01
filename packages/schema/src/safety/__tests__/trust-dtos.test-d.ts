import { expect, it } from 'vitest'
import type {
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'

// 2026-10-01 (432-19, D-15): the standing-approval grant DTO is deleted with the safety ports that
// read it (C432-NO-GRANT-CONTRACTS). The credential and scope DTOs stay for their own consumers.
const projectScope: TrustScope = { project: 'project-a' }

const credential: TrustCredential = {
  scope: projectScope,
}

// @ts-expect-error C432-NO-GRANT-CONTRACTS: the standing-approval grant is deleted
export type RetiredStandingApprovalGrant = import('@vostride/agent-qa-schema').StandingApprovalGrant

void credential

it('exports the trust DTOs', () => {
  expect(true).toBe(true)
})
