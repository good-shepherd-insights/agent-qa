import { describe, expect, it } from 'vitest'

import type { GuardrailAuditRow } from '../../index'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '../policy-loader'
import {
  assertCommittedEgressSafe,
  CommittedEgressBlockedError,
} from '../committed-egress'

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'
const BEARER = 'Bearer abcdefghijklmno12345'
const API_KEY = 'sk-abc123abc123abc123'
const EMAIL = 'owner@example.com'
const PEM_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----'
const CREDIT_CARD = '4111 1111 1111 1111'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

class FakeAuditSink {
  readonly guardrailRows: GuardrailAuditRow[] = []

  appendExecutionAudit(): void {
    throw new Error('execution audit should not be written by committed egress')
  }

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.guardrailRows.push(row)
  }
}

describe('assertCommittedEgressSafe', () => {
  it('block-tier blocks the write', () => {
    const sink = new FakeAuditSink()

    let thrown: unknown
    try {
      assertCommittedEgressSafe([{ label: 'secrets.env', text: `access ${AWS_KEY}` }], {
        policy,
        auditSink: sink,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CommittedEgressBlockedError)
    expect((thrown as CommittedEgressBlockedError).detector).toBe('awsKey')
    expect((thrown as CommittedEgressBlockedError).label).toBe('secrets.env')
    expect(() =>
      assertCommittedEgressSafe([{ label: 'private.pem', text: PEM_PRIVATE_KEY }], { policy }),
    ).toThrow(CommittedEgressBlockedError)
    expect(() =>
      assertCommittedEgressSafe([{ label: 'card.txt', text: CREDIT_CARD }], { policy }),
    ).toThrow(CommittedEgressBlockedError)
  })

  it('clean part returns unchanged with zero rows', () => {
    const sink = new FakeAuditSink()
    const input = 'ordinary prose with no secret shape'

    const output = assertCommittedEgressSafe(input, { policy, auditSink: sink })

    expect(output).toBe(input)
    expect(sink.guardrailRows).toEqual([])
  })

  it('non-user redact-tier blocks', () => {
    const sink = new FakeAuditSink()

    expect(() =>
      assertCommittedEgressSafe(
        [{ label: 'issue.md', text: `Authorization: ${BEARER} for ${EMAIL}` }],
        { policy, auditSink: sink },
      ),
    ).toThrow(CommittedEgressBlockedError)
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'redact:bearer',
      'redact:email',
    ])
  })

  it('atomic multi-part block audits all fired rows before throw', () => {
    const sink = new FakeAuditSink()

    let thrown: unknown
    try {
      assertCommittedEgressSafe(
        [
          { label: 'issue.md', text: `contact ${EMAIL}` },
          { label: 'bundle.env', text: `access ${AWS_KEY}` },
        ],
        { policy, auditSink: sink },
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(CommittedEgressBlockedError)
    expect((thrown as CommittedEgressBlockedError).label).toBe('issue.md')
    expect(sink.guardrailRows.map((row) => `${row.action}:${row.detector}`)).toEqual([
      'redact:email',
      'block:awsKey',
    ])
  })

  it('user-authored redact overridden', () => {
    const sink = new FakeAuditSink()
    const input = [{ text: `Authorization: ${BEARER}`, origin: 'user' as const }]

    const output = assertCommittedEgressSafe(input, { policy, auditSink: sink })

    expect(output).toEqual([input[0].text])
    expect(output[0]).toBe(input[0].text)
  })

  it('user-authored block still blocks', () => {
    expect(() =>
      assertCommittedEgressSafe(
        [{ label: 'user-fixture.md', text: `access ${AWS_KEY}`, origin: 'user' }],
        { policy },
      ),
    ).toThrow(CommittedEgressBlockedError)
  })

  it('override audit row is secret-free', () => {
    const sink = new FakeAuditSink()

    assertCommittedEgressSafe(
      [{ label: 'user-note.md', text: `Authorization: ${BEARER}`, origin: 'user' }],
      { policy, auditSink: sink },
    )

    expect(sink.guardrailRows).toEqual([
      {
        channel: 'committed-egress:user-note.md',
        action: 'redact',
        detector: 'bearer',
        redactedFingerprint: expect.any(String),
        overridden: true,
        origin: 'user',
        reason: expect.any(String),
      },
    ])
    expect(JSON.stringify(sink.guardrailRows)).not.toContain(BEARER)
  })

  it('block+redact in one user part blocks and redact row not overridden', () => {
    const sink = new FakeAuditSink()

    expect(() =>
      assertCommittedEgressSafe(
        [
          {
            label: 'mixed.md',
            text: `Authorization: ${BEARER} and access ${AWS_KEY}`,
            origin: 'user',
          },
        ],
        { policy, auditSink: sink },
      ),
    ).toThrow(CommittedEgressBlockedError)

    const bearerRow = sink.guardrailRows.find((row) => row.detector === 'bearer')
    expect(bearerRow).toMatchObject({
      channel: 'committed-egress:mixed.md',
      action: 'redact',
      detector: 'bearer',
      origin: 'user',
    })
    expect(bearerRow).not.toHaveProperty('overridden')
  })

  it('undeclared origin never overrides', () => {
    expect(() =>
      assertCommittedEgressSafe([{ label: 'unknown.md', text: `Authorization: ${BEARER}` }], {
        policy,
      }),
    ).toThrow(CommittedEgressBlockedError)
  })
})
