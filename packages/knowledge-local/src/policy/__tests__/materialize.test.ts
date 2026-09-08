import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GuardrailAuditRow } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { materializePolicy, PolicyTextRefusedError, policyShelfPath } from '../materialize.js'

describe('materializePolicy sovereign authored shelf', () => {
  let root: string
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'policy-materialize-')) })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })
  function input(ruleText = 'Dismiss the cookie banner first') {
    return { knowledgeRoot: root, recordId: 'policy-fixture', scope: 'shop', ruleText,
      auditBaseDir: join(root, 'runtime') }
  }
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
