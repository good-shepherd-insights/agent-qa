import { afterEach, describe, expect, it } from 'vitest'

import type { RiskActionDescriptor } from '@vostride/agent-qa-schema'

import {
  getActiveAuditSink,
  setActiveAuditSinkResolver,
} from '../../policy/audit-sink-resolver'
import type { ProviderRequestParams } from '../interfaces'

// House style: real engine end-to-end, no mocks (349 POLICY-05 precedent).
//
// 2026-10-01 (432-19, D-15): the registrar no longer attaches the execution policy gate at the
// async tool_call point. The cells that drove `evaluate()` through it (an unrecognized action
// denied, trust forwarded, the ci fail-closed default) are re-spelled as the deletion's claim and
// the retained one: nothing is registered at the tool-call point, and masking still runs BEFORE
// the guardrail on every provider request, both writing guardrail rows (C432-RETAINED-SAFETY).
import { GuardrailConfigError } from '../../guardrail/policy-loader'
import { createMaskingContext } from '../../masking/context'
import { setActiveMaskingContextResolver } from '../../masking/resolver'
import type { AuditSink, GuardrailAuditRow } from '../../ports/audit-sink'
import { FIRST_PARTY, FirstPartyHookError } from '../capability'
import { registerFirstPartySafetyHooks } from '../first-party'
import type { AsyncToolCallHook } from '../interfaces'
import { HookRegistry } from '../registry'
import * as barrel from '../../index'

class InMemoryAuditSink implements AuditSink {
  readonly guardrailRows: GuardrailAuditRow[] = []

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
  // RE-SPELLED 2026-10-01 (432-19) from 'denies an unrecognized action via the real engine and
  // writes exactly one audit row'. No gate is attached, so the tool-call point allows the action and
  // the registrar writes nothing for it.
  it('C432-RETAINED-SAFETY: attaches nothing at the tool-call point — an unrecognized action passes with no audit row', async () => {
    const auditSink = new InMemoryAuditSink()
    const { registry } = registerFirstPartySafetyHooks({ auditSink })

    const action: RiskActionDescriptor = { name: 'unknown_action', recognized: false }
    const result = await registry.runToolCallAsync(action)

    expect(result).toEqual({ action: 'allow', call: action })
    expect(auditSink.guardrailRows).toHaveLength(0)
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
    setActiveMaskingContextResolver(() => undefined)
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

  // RE-SPELLED 2026-10-01 (432-19) from 'forwards trust to the gate — session trust mode satisfies
  // an ask in ci' and 'keeps the default fail-closed posture when no trust is forwarded in ci'. There
  // is no gate to forward trust to and no ask to fail closed: an ask-tier action allows in ci with or
  // without the retired trust input, and the two answers are identical.
  it('C432-RETAINED-SAFETY: an ask-tier action allows in ci with or without the retired trust input', async () => {
    const trusted = registerFirstPartySafetyHooks({
      auditSink: new InMemoryAuditSink(),
      trust: { trustMode: true },
      resolveExecutionContext: () => 'ci',
    } as never)
    const untrusted = registerFirstPartySafetyHooks({ auditSink: new InMemoryAuditSink() })

    const withTrust = await trusted.registry.runToolCallAsync(mutatingSharedAction)
    const withoutTrust = await untrusted.registry.runToolCallAsync(mutatingSharedAction)

    expect(withTrust).toEqual({ action: 'allow', call: mutatingSharedAction })
    expect(withoutTrust).toEqual(withTrust)
  })

  it('C432-RETAINED-SAFETY: masking runs BEFORE the guardrail — a registered secret reaches the guardrail already masked', () => {
    const auditSink = new InMemoryAuditSink()
    const ctx = createMaskingContext()
    ctx.register('abcdefghijklmno12345')
    setActiveMaskingContextResolver(() => ctx)
    const { registry } = registerFirstPartySafetyHooks({ auditSink })

    const out = registry.runProviderRequest(bearerParams())
    const text = JSON.stringify(out)

    // Masking replaced the value with its placeholder, so the guardrail had nothing to redact.
    expect(text).toContain('<SECRET_0>')
    expect(text).not.toContain('abcdefghijklmno12345')
    expect(auditSink.guardrailRows).toEqual([])

    // The control: with no masking context the SAME request trips the guardrail and lands its row,
    // so the empty list above is the ordering, not a guardrail that stopped looking.
    setActiveMaskingContextResolver(() => undefined)
    const unmasked = JSON.stringify(registry.runProviderRequest(bearerParams()))
    expect(unmasked).not.toContain('abcdefghijklmno12345')
    expect(auditSink.guardrailRows).toHaveLength(1)
    expect(auditSink.guardrailRows[0]).toMatchObject({ action: 'redact', detector: 'bearer' })
  })

  // 432-19, task 2: the retry edge. The same request sent twice through the run's registrar is
  // masked identically both times (one placeholder, minted once) and trips the guardrail neither
  // time, so a retried provider call cannot leak on its second attempt or double-count a row.
  it('C432-RETAINED-SAFETY: a retried request is masked identically and writes no guardrail row on either attempt', () => {
    const auditSink = new InMemoryAuditSink()
    const ctx = createMaskingContext()
    ctx.register('abcdefghijklmno12345')
    setActiveMaskingContextResolver(() => ctx)
    const { registry } = registerFirstPartySafetyHooks({ auditSink })

    const first = JSON.stringify(registry.runProviderRequest(bearerParams()))
    const second = JSON.stringify(registry.runProviderRequest(bearerParams()))

    expect(second).toBe(first)
    expect(first).toContain('<SECRET_0>')
    expect(first).not.toContain('<SECRET_1>')
    expect(auditSink.guardrailRows).toEqual([])
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
