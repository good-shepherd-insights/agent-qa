// RE-SPELLED 2026-10-01 (432-19, D-14/D-15/D-17). This file measured the execution policy gate: the
// `baseVerdict` tier table, `evaluate`'s allow/ask/deny ladder over trust mode, a credential, a
// standing approval and an injected confirm, the D-16 remediation sentences, the execution-audit row
// builder and G-401-17's answering-surface attribution. The gate, its ladder, its confirm and
// standing-approval ports and its audit-row builder are deleted, so those claims become ABSENCE:
// the modules are gone, the barrel publishes none of their values, no safety source spells the
// ladder's code, and no execution-audit row has a writer.
//
// What survives the deletion is measured where it lives: the tier a descriptor classifies to
// (`risk-classifier.test.ts`, C432-EVAL-RISK-PARITY), masking before guardrail and the guardrail
// audit (`hooks/__tests__/first-party.test.ts`, C432-RETAINED-SAFETY) and the execution context
// (`requires-fail-closed.test.ts`, C432-EXECUTION-CONTEXT-RETAINED).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as safety from '../../index'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const RETIRED_MODULES = [
  'policy/gate.ts',
  'policy/gate-hook.ts',
  'policy/scope.ts',
  'ports/policy-ports.ts',
] as const

// Every VALUE the gate's modules published. A runtime barrel key with any of these names would be
// the ladder (or one of its ports) back.
const RETIRED_VALUES = [
  'evaluate',
  'resolveAsk',
  'baseVerdict',
  'buildExecutionAuditRow',
  'createPolicyGateToolCallHook',
  'requiresFailClosed',
  'scopeMatches',
  'grantCovers',
  'NO_STANDING_APPROVALS',
  'DENY_CONFIRM',
] as const

/** Production sources under `safety/src`, tests excluded, with their text minus comments. */
function productionSources(): { file: string; code: string }[] {
  const found: { file: string; code: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(path)
        continue
      }
      if (!entry.name.endsWith('.ts')) continue
      const raw = readFileSync(path, 'utf8')
      found.push({
        file: relative(SRC, path),
        code: raw.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, kept?: string) => kept ?? ''),
      })
    }
  }
  walk(SRC)
  return found
}

describe('C432-NO-EVALUATE: the execution ask ladder and its evaluator are gone', () => {
  it('C432-NO-EVALUATE: the gate, its hook and the scope policy are physically absent', () => {
    for (const module of RETIRED_MODULES) {
      expect(existsSync(join(SRC, module)), module).toBe(false)
    }
    // Non-vacuity: the directory the gate lived in still holds the retained policy modules.
    expect(existsSync(join(SRC, 'policy/risk-classifier.ts'))).toBe(true)
    expect(existsSync(join(SRC, 'policy/execution-context.ts'))).toBe(true)
  })

  it('C432-NO-EVALUATE: the barrel publishes no evaluator, ladder, port or audit-row builder at runtime', () => {
    const keys = Object.keys(safety)
    for (const retired of RETIRED_VALUES) {
      expect(keys, retired).not.toContain(retired)
    }
    // Non-vacuity: the namespace is the real barrel, with the retained classifier and registrar.
    expect(typeof safety.classifyRisk).toBe('function')
    expect(typeof safety.registerFirstPartySafetyHooks).toBe('function')
    expect(safety.TIER_ORDER).toEqual([
      'read-only',
      'mutating-local',
      'mutating-shared',
      'destructive',
      'restricted',
    ])
  })

  it('C432-NO-EVALUATE: no safety production source spells the ladder, its outcomes or the execution-audit append', () => {
    const sources = productionSources()
    expect(sources.length).toBeGreaterThan(20)
    const needles = [
      /\bevaluate\s*\(/,
      /\bresolveAsk\b/,
      /\bbaseVerdict\b/,
      /\bGateTrust\b/,
      /\bSessionDenyOverlay\b/,
      /\bExecutionAuditRow\b/,
      /\bappendExecutionAudit\b/,
      /'prompted-approved'|'fail-closed-denied'|'session-pin-denied'/,
      /execution_audit\.jsonl/,
    ]
    const hits = sources.flatMap(({ file, code }) =>
      needles.filter((needle) => needle.test(code)).map((needle) => `${file} ${String(needle)}`),
    )
    expect(hits).toEqual([])
    // Non-vacuity: the stripped code is real code, so the scan can see an identifier at all.
    expect(sources.some(({ code }) => /\bclassifyRisk\b/.test(code))).toBe(true)
  })
})

describe('C432-NO-ASK-PORTS: no confirm, standing-approval, trust or deny input reaches safety', () => {
  it('C432-NO-ASK-PORTS: the registrar deps name only the audit sink and the guardrail policy', () => {
    const registrar = readFileSync(join(SRC, 'hooks/first-party.ts'), 'utf8')
    const deps = /export interface FirstPartySafetyDeps \{([\s\S]*?)\n\}/.exec(registrar)?.[1] ?? ''
    const members = [...deps.matchAll(/^\s+(\w+)\??:/gm)].map((match) => match[1])
    expect(members).toEqual(['auditSink', 'guardrailPolicyInput'])
  })

  it('C432-NO-ASK-PORTS: no safety production source names a confirm or standing-approval port', () => {
    const hits = productionSources().flatMap(({ file, code }) =>
      [/\bConfirmPort\b/, /\bConfirmAsk\b/, /\bStandingApprovalReader\b/, /\bConfirmAnsweringSurface\b/]
        .filter((needle) => needle.test(code))
        .map((needle) => `${file} ${String(needle)}`),
    )
    expect(hits).toEqual([])
  })

  it('C432-NO-ASK-PORTS: an extra confirm, reader, trust or deny dep does not register anything new', () => {
    // A caller that still passed the retired inputs (a stale composition, a cast) is handed the same
    // two provider-request hooks and no tool-call hook: the inputs are not read, so they cannot arm
    // a gate. The async tool-call point allows a restricted-tier descriptor untouched.
    const stale = {
      confirm: { surface: 'tty-prompt', ask: () => false },
      reader: { grantsFor: () => [] },
      trust: { trustMode: false },
      deny: () => true,
    }
    const { registry } = safety.registerFirstPartySafetyHooks(stale as never)
    const restricted = { name: 'sudo_reboot', recognized: true }
    return registry.runToolCallAsync(restricted).then((result) => {
      expect(result).toEqual({ action: 'allow', call: restricted })
      expect(safety.classifyRisk(restricted).riskTier).toBe('restricted')
    })
  })
})
