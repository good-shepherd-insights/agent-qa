import { expect, it } from 'vitest'
import type {
  StandingApprovalGrant,
  TrustCredential,
  TrustScope,
} from '@vostride/agent-qa-schema'

const projectScope: TrustScope = { project: 'project-a' }
const orgScope: TrustScope = { org: 'org-x' }

const credential: TrustCredential = {
  scope: projectScope,
}

const grant: StandingApprovalGrant = {
  scope: orgScope,
  actionClass: 'file_issue',
}

void credential
void grant

it('exports the trust DTOs', () => {
  expect(true).toBe(true)
})
