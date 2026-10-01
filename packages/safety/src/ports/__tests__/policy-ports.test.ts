import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as safety from '../../index'

// RE-SPELLED 2026-10-01 (432-19, D-14/D-15). This file pinned the two null objects of the policy
// ports: `DENY_CONFIRM` (never approves, declares no surface) and `NO_STANDING_APPROVALS` (no grants).
// The confirm port, the standing-approval reader and both null objects are deleted with the gate, so
// nothing can ask a person or read an approval through safety.
const PORTS = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('policy ports', () => {
  it('C432-NO-ASK-PORTS: the policy-ports module is gone and only the audit port remains', () => {
    expect(existsSync(join(PORTS, 'policy-ports.ts'))).toBe(false)
    expect(existsSync(join(PORTS, 'audit-sink.ts'))).toBe(true)
  })

  it('C432-NO-ASK-PORTS: neither null object is published at runtime', () => {
    expect(Object.keys(safety)).not.toContain('DENY_CONFIRM')
    expect(Object.keys(safety)).not.toContain('NO_STANDING_APPROVALS')
  })
})
