// The enforcement record is read-only in FACT, not just in type (Phase 384, Plan 08 — CR-04).
//
// `registry.list()` hands a surface the record `invokeFunction` enforces against. Before this
// file, the view aliased the module-level singleton specs, so a zero-scope caller could delete
// `config.get`'s scope requirement in one line and then invoke it for real — process-wide, in
// every registry built after the write. These cases assert that escalation dead: the views and
// the registered specs are deeply frozen, the repro write THROWS, and enforcement still refuses.

import type {
  ExecutionContext,
  FunctionCaller,
  FunctionScope,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { FunctionScopeError, invokeFunction } from '../functions/invoke.js'
import { configGetSpec } from '../functions/ops/config-get.js'
import { createFunctionRegistry } from '../functions/registry.js'
import type { FunctionDeclaration, FunctionDeps } from '../functions/spec.js'

const FIXED_CONTEXT: () => ExecutionContext = () => 'local-interactive'

/**
 * Every port resolves, nothing reaches a host API. The scope refusal these cases turn on
 * precedes dispatch, so no port is ever touched — the record exists because `FunctionDeps`
 * is required and non-partial (D-09), not because a case needs it.
 */
function fakeDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
    },
    knowledge: { listBundles: () => Promise.resolve([]) },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
  }
}

/** The sink is a REQUIRED construction field (D-11); nothing here dispatches, so it stays empty. */
function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

function buildRegistry() {
  return createFunctionRegistry({
    deps: fakeDeps(),
    auditSink: noOpSink(),
    resolveExecutionContext: FIXED_CONTEXT,
  })
}

const ZERO_SCOPE_CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [],
  safeMode: false,
}

const FULLY_GRANTED: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
}

function configGet(declarations: readonly FunctionDeclaration[]): FunctionDeclaration {
  const declaration = declarations.find((candidate) => candidate.id === 'config.get')
  if (declaration === undefined) throw new Error('config.get is not registered')
  return declaration
}

describe('declaration views are deeply frozen (CR-04)', () => {
  it('freezes every listed declaration, its requiredScopes, and its risk descriptor', () => {
    const declarations = buildRegistry().list(FULLY_GRANTED)

    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      expect(Object.isFrozen(declaration), declaration.id).toBe(true)
      expect(Object.isFrozen(declaration.requiredScopes), `${declaration.id}.requiredScopes`)
        .toBe(true)
      expect(Object.isFrozen(declaration.risk), `${declaration.id}.risk`).toBe(true)
    }
  })

  it('kills the CR-04 escalation: the repro write throws and the caller is still refused', async () => {
    const registry = buildRegistry()
    const declaration = configGet(registry.list(ZERO_SCOPE_CALLER))

    // The exploit, verbatim: vacate the scope requirement the gate reads. In strict-mode ESM
    // a write to a frozen array THROWS — a silent no-op is not the shipped behaviour.
    expect(() => {
      ;(declaration.requiredScopes as FunctionScope[]).length = 0
    }).toThrow(TypeError)

    // Both halves. The throw alone would not prove enforcement survived the attempt.
    await expect(
      invokeFunction(registry, 'config.get', {}, ZERO_SCOPE_CALLER),
    ).rejects.toBeInstanceOf(FunctionScopeError)
  })

  it('refuses a forged risk name: the gate classification cannot be rewritten through a listing', () => {
    const declaration = configGet(buildRegistry().list(ZERO_SCOPE_CALLER))

    expect(() => {
      ;(declaration.risk as RiskActionDescriptor).name = 'fn:totally.harmless'
    }).toThrow(TypeError)
    expect(declaration.risk.name).toBe('fn:config.get')
  })

  it('freezes the REGISTERED singleton spec, not only the copied view', () => {
    // The copy in `declarationView` already denies the listing route. This case covers the
    // "any other route" clause: after registration the module-level singleton itself is
    // frozen, so code holding the spec directly cannot rewrite what the gate enforces.
    buildRegistry()

    expect(Object.isFrozen(configGetSpec)).toBe(true)
    expect(Object.isFrozen(configGetSpec.requiredScopes)).toBe(true)
    expect(Object.isFrozen(configGetSpec.risk)).toBe(true)
    expect(() => {
      ;(configGetSpec.requiredScopes as FunctionScope[]).length = 0
    }).toThrow(TypeError)
  })

  it('contains the attempt to nothing: a second registry still lists the real requirement', async () => {
    const attacked = buildRegistry()
    const declaration = configGet(attacked.list(ZERO_SCOPE_CALLER))

    expect(() => {
      ;(declaration.requiredScopes as FunctionScope[]).length = 0
    }).toThrow(TypeError)
    expect(() => {
      ;(declaration.requiredScopes as FunctionScope[]).push('read')
    }).toThrow(TypeError)

    // A registry built AFTER the attempt — the singleton specs the exploit reached for.
    const fresh = buildRegistry()
    expect(configGet(fresh.list(ZERO_SCOPE_CALLER)).requiredScopes).toEqual(['read'])
    await expect(
      invokeFunction(fresh, 'config.get', {}, ZERO_SCOPE_CALLER),
    ).rejects.toBeInstanceOf(FunctionScopeError)
  })
})
