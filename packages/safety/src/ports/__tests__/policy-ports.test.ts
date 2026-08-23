import { describe, expect, it } from 'vitest'

import type { RiskActionDescriptor, TrustScope } from '@vostride/agent-qa-schema'
import { DENY_CONFIRM, NO_STANDING_APPROVALS } from '../policy-ports'

const action: RiskActionDescriptor = {
  name: 'delete_record',
  recognized: true,
}

const actionScope: TrustScope = {
  project: 'A',
}

describe('policy ports', () => {
  it('denies confirmation by default, and declares no surface to approve from', async () => {
    await expect(Promise.resolve(DENY_CONFIRM.ask(action))).resolves.toBe(false)
    // G-401-17: the null-object's honest declaration. It never approves anything, so there is no
    // surface for the gate to attribute an approval to — and the gate refuses to mint one.
    expect(DENY_CONFIRM.surface).toBeNull()
  })

  it('returns no standing approval grants by default', () => {
    expect(NO_STANDING_APPROVALS.grantsFor(action, actionScope)).toEqual([])
  })
})
