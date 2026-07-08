import { afterEach, describe, expect, it } from 'vitest'

import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

import {
  getActiveAuditSink,
  setActiveAuditSinkResolver,
} from '../../policy/audit-sink-resolver'
import type { ProviderRequestParams } from '../interfaces'

// House style: real engine end-to-end, no mocks (349 POLICY-05 precedent). Test 3
// drives the actual evaluate() through the actual classifier lexicon; the
// unrecognized-action restricted-tier deny is Phase 348's fail-safe floor, so no
// classifier stubbing is needed or allowed. Live agent-loop dispatch through
// runToolCallAsync is HOOK-FUT-01 (M1/M4) — this file proves attach/block/audit only.
import { GuardrailConfigError } from '../../guardrail/policy-loader'
import type { AuditSink, ExecutionAuditRow, GuardrailAuditRow } from '../../ports/audit-sink'
import { FIRST_PARTY, FirstPartyHookError } from '../capability'
import { registerFirstPartySafetyHooks } from '../first-party'
import type { AsyncToolCallHook } from '../interfaces'
import { HookRegistry } from '../registry'
import * as barrel from '../../index'

class InMemoryAuditSink implements AuditSink {
  readonly executionRows: ExecutionAuditRow[] = []
  readonly guardrailRows: GuardrailAuditRow[] = []

  appendExecutionAudit(row: ExecutionAuditRow): void {
    this.executionRows.push(row)
  }

  appendGuardrailAudit(row: GuardrailAuditRow): void {
    this.guardrailRows.push(row)
  }
}

const allowHook: AsyncToolCallHook = async (call) => ({ action: 'allow', call })

// The complete registration-rejection proof for phase success criterion 2: every
// register method on the seam hard-rejects a caller that lacks the module-private
// FIRST_PARTY token. Each case invokes one method with a trivial hook of the right
// shape; the matrix runs each against undefined and a forged same-description Symbol.
const registerCases: ReadonlyArray<{
  method: string
  register: (registry: HookRegistry, capability: unknown) => void
}> = [
  {
    method: 'registerToolCall',
    register: (registry, capability) =>
      registry.registerToolCall((call) => ({ action: 'allow', call }), capability),
  },
  {
    method: 'registerToolCallAsync',
    register: (registry, capability) => registry.registerToolCallAsync(allowHook, capability),
  },
  {
    method: 'registerToolResult',
    register: (registry, capability) =>
      registry.registerToolResult((result) => ({ result }), capability),
  },
  {
    method: 'registerContext',
    register: (registry, capability) =>
      registry.registerContext((context) => ({ context }), capability),
  },
  {
    method: 'registerProviderRequest',
    register: (registry, capability) =>
      registry.registerProviderRequest((params) => params, capability),
  },
]

describe('first-party safety hook registration (HOOK-03)', () => {
  for (const { method, register } of registerCases) {
    it(`${method} rejects registration without a capability token (FirstPartyHookError)`, () => {
      const registry = new HookRegistry()
      expect(() => register(registry, undefined)).toThrow(FirstPartyHookError)
    })

    it(`${method} rejects a forged same-description token (identity check, not description)`, () => {
      const registry = new HookRegistry()
      const forged = Symbol('agent-qa-safety-first-party')
      expect(() => register(registry, forged)).toThrow(FirstPartyHookError)
    })
  }
})

describe('registerFirstPartySafetyHooks (HOOK-02 attach/block/audit)', () => {
  it('denies an unrecognized action via the real engine and writes exactly one audit row', async () => {
    const auditSink = new InMemoryAuditSink()
    const { registry } = registerFirstPartySafetyHooks({ auditSink })

    const action: RiskActionDescriptor = { name: 'unknown_action', recognized: false }
    const result = await registry.runToolCallAsync(action)

    expect(result.action).toBe('deny')
    // Load-bearing: exactly one row proves the registry added no second audit
    // write around the gate's own row (349 D-02, single audit author).
    expect(auditSink.executionRows).toHaveLength(1)
    const row = auditSink.executionRows[0]
    expect(row?.verdict).toBe('deny')
    expect(row?.riskTier).toBe('restricted')
    expect(row?.outcome).toBe('blocked')
    expect(row?.action).toBe('unknown_action')
  })

  it('fails closed at composition time on invalid guardrail policy input (SAFE-03(b))', () => {
    expect(() =>
      registerFirstPartySafetyHooks({ guardrailPolicyInput: { detectors: 'garbage' } }),
    ).toThrow(GuardrailConfigError)
  })
})

// A user-text prompt carrying a bearer token deterministically trips the default
// guardrail redact (mirrors guardrail/__tests__/egress-hook.ts). Driving it through
// registry.runProviderRequest exercises the same composed sink the model egress uses.
function bearerParams(): ProviderRequestParams {
  return {
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Authorization: Bearer abcdefghijklmno12345' }],
      },
    ],
  } as unknown as ProviderRequestParams
}

const mutatingSharedAction: RiskActionDescriptor = {
  name: 'push_to_remote',
  recognized: true,
  declaredTier: 'mutating-shared',
}

describe('registerFirstPartySafetyHooks invocation-time sink + trust forwarding (362-01)', () => {
  afterEach(() => {
    setActiveAuditSinkResolver(() => undefined)
  })

  it('resolves the guardrail sink at invocation time — a resolver installed AFTER registration still receives rows (Pitfall 3)', () => {
    // No auditSink at registration; the resolver is installed only afterwards.
    const { registry } = registerFirstPartySafetyHooks()
    const recordingSink = new InMemoryAuditSink()
    setActiveAuditSinkResolver(() => recordingSink)

    registry.runProviderRequest(bearerParams())

    expect(recordingSink.guardrailRows).toHaveLength(1)
    expect(recordingSink.guardrailRows[0]).toMatchObject({ action: 'redact', detector: 'bearer' })
  })

  it('prefers a directly-supplied auditSink and never consults the active resolver (Test 2)', () => {
    const directSink = new InMemoryAuditSink()
    const resolverSink = new InMemoryAuditSink()
    setActiveAuditSinkResolver(() => resolverSink)

    const { registry } = registerFirstPartySafetyHooks({ auditSink: directSink })
    registry.runProviderRequest(bearerParams())

    expect(directSink.guardrailRows).toHaveLength(1)
    expect(resolverSink.guardrailRows).toHaveLength(0)
  })

  it('forwards trust to the gate — session trust mode satisfies an ask in ci (Pitfall 1, Test 3)', async () => {
    const auditSink = new InMemoryAuditSink()
    const { registry } = registerFirstPartySafetyHooks({
      auditSink,
      trust: { trustMode: true },
      resolveExecutionContext: () => 'ci',
    })

    const result = await registry.runToolCallAsync(mutatingSharedAction)

    expect(result.action).toBe('allow')
    expect(auditSink.executionRows).toHaveLength(1)
    expect(auditSink.executionRows[0]).toMatchObject({
      verdict: 'allow',
      outcome: 'proceeded',
      trustSource: 'session-trust-mode',
    })
  })

  it('keeps the default fail-closed posture when no trust is forwarded in ci (Test 4)', async () => {
    const auditSink = new InMemoryAuditSink()
    const { registry } = registerFirstPartySafetyHooks({
      auditSink,
      resolveExecutionContext: () => 'ci',
    })

    const result = await registry.runToolCallAsync(mutatingSharedAction)

    expect(result.action).toBe('deny')
    expect(auditSink.executionRows[0]).toMatchObject({
      verdict: 'deny',
      outcome: 'fail-closed-denied',
    })
  })

  it('keeps getActiveAuditSink undefined once the default resolver is restored', () => {
    expect(getActiveAuditSink()).toBeUndefined()
  })
})

describe('public barrel surface (D-03)', () => {
  it('exposes no value equal to the FIRST_PARTY capability token', () => {
    expect(Object.keys(barrel)).not.toContain('FIRST_PARTY')
    for (const value of Object.values(barrel)) {
      expect(value).not.toBe(FIRST_PARTY)
    }
  })

  it('offers exactly one registration path: the registrar, never raw registry construction', () => {
    const keys = Object.keys(barrel)
    // The only public registration path.
    expect(keys).toContain('registerFirstPartySafetyHooks')
    expect(keys).toContain('FirstPartyHookError')
    // Raw registry construction left the public surface (runtime proof over the
    // actual export object — stronger than a source grep).
    expect(keys).not.toContain('HookRegistry')
    expect(keys).not.toContain('createHookRegistry')
  })
})
