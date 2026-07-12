import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_BUNDLE_EGRESS_CHANNEL,
  checkpointCommittedParts,
} from '../bundle-egress.js'

// AKIA + 16 uppercase alphanumerics is the exact detector-shaped AWS key used by the
// committed-root proof. An arbitrary random string would not exercise the refusal path.
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

describe('checkpointCommittedParts', () => {
  let auditBaseDir: string

  beforeEach(async () => {
    auditBaseDir = await mkdtemp(join(tmpdir(), 'knowledge-bundle-egress-'))
  })

  afterEach(async () => {
    await rm(auditBaseDir, { recursive: true, force: true })
  })

  it('returns a typed refusal and audits the labeled detector hit', () => {
    const outcome = checkpointCommittedParts(
      [
        { label: 'record.md', text: '# Safe heading\n' },
        { label: 'evidence/observations.jsonl', text: `{"credential":"${AWS_KEY}"}\n` },
      ],
      { auditBaseDir },
    )

    expect(outcome.kind).toBe('egress-blocked')
    if (outcome.kind !== 'egress-blocked') throw new Error('expected egress refusal')
    expect(outcome.detections).toContainEqual({
      label: 'evidence/observations.jsonl',
      detector: 'awsKey',
    })

    const auditPath = join(auditBaseDir, 'guardrail_audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, 'utf8')).toContain(KNOWLEDGE_BUNDLE_EGRESS_CHANNEL)
  })

  it('accepts a secret-free unit without writing an audit row', () => {
    const outcome = checkpointCommittedParts(
      [
        { label: 'record.md', text: '# Sign-in guidance\n' },
        { label: 'relations.json', text: '{"relations":[]}\n' },
      ],
      { auditBaseDir },
    )

    expect(outcome).toEqual({ kind: 'ok' })
    expect(existsSync(join(auditBaseDir, 'guardrail_audit.jsonl'))).toBe(false)
  })
})
