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
  it('denies confirmation by default', async () => {
    await expect(Promise.resolve(DENY_CONFIRM(action))).resolves.toBe(false)
  })

  it('returns no standing approval grants by default', () => {
    expect(NO_STANDING_APPROVALS.grantsFor(action, actionScope)).toEqual([])
  })
})
