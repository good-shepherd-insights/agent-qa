import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializePolicy, PolicyTextRefusedError, policyShelfPath } from '../materialize.js'
import { acquireWriterLease, releaseLease, WriterAuthorityLostError } from '../../lease/writer-lease.js'

describe('materializePolicy sovereign authored shelf', () => {
  let root: string
  let writerAuthority: { leaseId: string; epoch: number }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'policy-materialize-'))
    const lease = acquireWriterLease(root)
    if (lease.kind !== 'acquired') throw new Error('lease unavailable')
    writerAuthority = lease
  })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })
  function input(ruleText = 'Dismiss the cookie banner first') {
    return { knowledgeRoot: root, recordId: 'policy-fixture', scope: 'shop', ruleText,
      auditBaseDir: join(root, 'runtime'), writerAuthority }
  }
  it.each([
    '<!-- agent-qa:policy policy-fixture -->\nunfinished',
    '<!-- /agent-qa:policy policy-fixture -->',
    '<!-- agent-qa:policy policy-fixture -->\n<!-- /agent-qa:policy other -->',
    '<!-- agent-qa:policy policy-fixture -->\n<!-- /agent-qa:policy policy-fixture -->\n<!-- agent-qa:policy policy-fixture -->\n<!-- /agent-qa:policy policy-fixture -->',
  ])('refuses incomplete or ambiguous sections without changing human bytes: %s', text => {
    mkdirSync(join(root, 'policies'))
    writeFileSync(policyShelfPath(root, 'shop'), text)
    expect(() => materializePolicy(input())).toThrow(PolicyTextRefusedError)
    expect(readFileSync(policyShelfPath(root, 'shop'), 'utf8')).toBe(text)
  })
  it.each(['stale', 'released'])('refuses %s authority before creating or changing shelf bytes', state => {
    if (state === 'released') releaseLease({ knowledgeRoot: root, leaseId: writerAuthority.leaseId })
    else writerAuthority = { ...writerAuthority, epoch: writerAuthority.epoch + 1 }
    expect(() => materializePolicy(input())).toThrow(WriterAuthorityLostError)
    expect(existsSync(join(root, 'policies'))).toBe(false)
    mkdirSync(join(root, 'policies'))
    writeFileSync(policyShelfPath(root, 'shop'), 'Human text\r\n')
    expect(() => materializePolicy(input())).toThrow(WriterAuthorityLostError)
    expect(readFileSync(policyShelfPath(root, 'shop'), 'utf8')).toBe('Human text\r\n')
  })
  it('holds the current authority transaction throughout the actual read/check/write', () => {
    let attempted = false
    const auditSink = { appendExecutionAudit() {}, appendGuardrailAudit() {
      attempted = true
      // A second process with the exact current credentials cannot release the lease
      // between the egress check and publication: it must contend on the same transaction.
      const child = spawnSync(process.execPath, ['--input-type=module', '-e',
        'import { releaseLease } from "./dist/index.js"; releaseLease(JSON.parse(process.argv[1]))',
        JSON.stringify({ knowledgeRoot: root, leaseId: writerAuthority.leaseId })],
      { cwd: new URL('../../..', import.meta.url), encoding: 'utf8', timeout: 5000 })
      expect(child.status).not.toBe(0)
      expect(child.stderr).toContain('MutationLockBusyError')
    } }
    expect(materializePolicy({ ...input('Contact owner@example.com'), auditSink }).kind).toBe('written')
    expect(attempted).toBe(true)
    expect(readFileSync(policyShelfPath(root, 'shop'), 'utf8')).toContain('Contact owner@example.com')
    expect(releaseLease({ knowledgeRoot: root, leaseId: writerAuthority.leaseId }).kind).toBe('released')
  })
  it('creates the shelf with a heading and an idempotent fenced section', () => {
    expect(materializePolicy(input()).kind).toBe('written')
    const path = policyShelfPath(root, 'shop')
    const bytes = readFileSync(path, 'utf8')
    expect(bytes).toBe('# Policies — shop\n\n<!-- agent-qa:policy policy-fixture -->\nDismiss the cookie banner first\n<!-- /agent-qa:policy policy-fixture -->\n')
    expect(materializePolicy(input()).kind).toBe('unchanged')
    expect(materializePolicy(input('Automation must never replace this body')).kind).toBe('unchanged')
    expect(readFileSync(path, 'utf8')).toBe(bytes)
  })
  it('preserves every pre-existing human byte', () => {
    mkdirSync(join(root, 'policies'))
    const human = 'Human text\r\n  preserve these spaces  '
    writeFileSync(policyShelfPath(root, 'shop'), human)
    materializePolicy(input())
    expect(readFileSync(policyShelfPath(root, 'shop'), 'utf8').startsWith(human + '\n')).toBe(true)
  })
  it.each(['<!--', '-->'])('refuses delimiter %s before a file changes', delimiter => {
    expect(() => materializePolicy(input(`A rule ${delimiter} hidden`))).toThrow(PolicyTextRefusedError)
    expect(existsSync(join(root, 'policies'))).toBe(false)
    expect(() => materializePolicy({ ...input(), title: delimiter })).toThrow(PolicyTextRefusedError)
    expect(() => materializePolicy({ ...input(), recordId: delimiter })).toThrow(PolicyTextRefusedError)
  })
  it('overrides REDACT once with user-origin audit and refuses BLOCK before a write', () => {
    const rows: GuardrailAuditRow[] = []
    const auditSink = { appendExecutionAudit() {}, appendGuardrailAudit(row: GuardrailAuditRow) { rows.push(row) } }
    const text = 'Contact owner@example.com before checkout'
    expect(materializePolicy({ ...input(text), auditSink }).kind).toBe('written')
    expect(readFileSync(policyShelfPath(root, 'shop'), 'utf8')).toContain(text)
    expect(rows).toEqual([expect.objectContaining({ channel: 'policy-materialize:policy:policy-fixture',
      overridden: true, origin: 'user', detector: 'email' })])
    rows.length = 0
    const before = readFileSync(policyShelfPath(root, 'shop'))
    expect(materializePolicy({ ...input('Use card 4111 1111 1111 1111'), recordId: 'policy-blocked', auditSink }))
      .toMatchObject({ kind: 'egress-blocked' })
    expect(readFileSync(policyShelfPath(root, 'shop'))).toEqual(before)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ channel: 'policy-materialize:policy:policy-blocked', action: 'block' })
  })
})
