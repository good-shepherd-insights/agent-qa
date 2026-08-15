// The two predicates the projection is built out of, driven directly (Phase 396 plan 01).
//
// WHY THIS FILE EXISTS BESIDE THE TRACER. `mcp-tracer.test.ts` over in the CLI package proves the
// whole path end to end through a real client against a real composed registry — that is the
// architectural claim, and it is the right shape for it. What an end-to-end cell cannot do is show
// that a REFUSAL happens, because the tracer only ever drives the case that works: a caller granted
// everything, a tool that is 1:1, a masker with nothing to hide. The cells below drive the two pure
// functions across the cases the tracer's own fixture makes unreachable.
//
// Each cell names the mutation it is the bar for. A cell that no plausible wrong implementation
// reds is decoration, and this project has measured that lesson more than once.

import { describe, expect, it } from 'vitest'

import {
  advertisedContracts,
  AGENT_QA_OP_CONTRACTS,
  AGENT_QA_TOOL_PROJECTIONS,
  compositionOf,
} from '../mapping.js'
import type { ToolOpContracts, ToolProjection } from '../mapping.js'
import { McpProjectionError, toRegisterToolConfig } from '../projection.js'
import type { ProjectedOpSpec } from '../projection.js'
import { visibleToCaller } from '../visibility.js'

const READ_PROJECTION: ToolProjection = {
  name: 'agent_qa_list_proposals',
  ops: ['proposals.list'],
  kind: 'read',
}

function spec(overrides: Partial<ProjectedOpSpec> = {}): ProjectedOpSpec {
  return {
    id: 'proposals.list',
    summary: 'List every proposal awaiting, or already carrying, a human decision.',
    requiredScopes: ['read'],
    risk: { name: 'fn:proposals.list', recognized: true, readOnly: true },
    input: AGENT_QA_OP_CONTRACTS['proposals.list']!.input,
    output: AGENT_QA_OP_CONTRACTS['proposals.list']!.output,
    ...overrides,
  }
}

describe('visibleToCaller (D-05)', () => {
  it('admits a caller granted every required scope', () => {
    expect(visibleToCaller(['read'], ['read', 'run'])).toBe(true)
  })

  // THE BAR: an implementation using `some` instead of `every` — the single most natural way to get
  // this wrong — passes the cell above and reds here, because one of the two required scopes is
  // granted. A predicate that only ever saw single-scope ops could not tell the two apart.
  it('refuses a caller missing ONE of several required scopes', () => {
    expect(visibleToCaller(['test-write', 'run'], ['run'])).toBe(false)
  })

  it('refuses a caller granted nothing at all', () => {
    expect(visibleToCaller(['read'], [])).toBe(false)
  })

  // The safe-mode instance of the law, stated as the law rather than as a carve-out: granting only
  // `read` is exactly what the registry's own `SAFE_MODE_SCOPES` filter does, so a config-write op
  // is invisible without either side knowing the phrase "safe mode".
  it('is the safe-mode filter when the only granted scope is read', () => {
    expect(visibleToCaller(['read'], ['read'])).toBe(true)
    expect(visibleToCaller(['config-write'], ['read'])).toBe(false)
  })

  // An op declaring no scopes has said it needs no grant. Asserted because the opposite reading —
  // an implicit floor — is a tempting "safe" default that would silently contradict the op.
  it('admits an op that requires no scope at all', () => {
    expect(visibleToCaller([], [])).toBe(true)
  })
})

/**
 * The contract a 1:1 tool advertises IS its op's, so the fixture reads it back the same way
 * `catalog.ts` does rather than restating it — a helper that hand-picked the schemas would pass
 * over a mapping whose join is broken.
 */
function advertised(projection: ToolProjection): ToolOpContracts {
  const contracts = advertisedContracts(projection)
  if (contracts === undefined) throw new Error(`no advertised contract for ${projection.name}`)
  return contracts
}

describe('toRegisterToolConfig (D-16)', () => {
  const identity = (text: string): string => text

  it('derives the description from the op summary and advertises the op contracts', () => {
    const config = toRegisterToolConfig(READ_PROJECTION, [spec()], advertised(READ_PROJECTION), identity)

    expect(config.title).toBe('agent_qa_list_proposals')
    expect(config.description).toBe(spec().summary)
    // Identity, not equality-by-value: the advertised schema IS the object the op validates with,
    // which is the whole of D-16's drift claim. A cell comparing converted JSON Schemas would pass
    // over two objects that merely agree today.
    expect(config.inputSchema).toBe(AGENT_QA_OP_CONTRACTS['proposals.list']!.input)
    expect(config.outputSchema).toBe(AGENT_QA_OP_CONTRACTS['proposals.list']!.output)
  })

  it('derives readOnlyHint and idempotentHint for a read op', () => {
    const config = toRegisterToolConfig(READ_PROJECTION, [spec()], advertised(READ_PROJECTION), identity)
    expect(config.annotations.readOnlyHint).toBe(true)
    expect(config.annotations.idempotentHint).toBe(true)
    expect(config.annotations.destructiveHint).toBe(false)
  })

  // THE BAR: a derivation hard-coding `readOnlyHint: true` (plausible while the only projected tool
  // is a read) passes every cell above and reds here. The op below declares neither `readOnly` nor
  // a read-only scope set, so both signals must be consulted and both must answer no.
  it('refuses readOnlyHint for an op that writes, and carries its destructive declaration', () => {
    const writing = spec({
      id: 'config.field.set',
      requiredScopes: ['config-write'],
      risk: { name: 'fn:config.field.set', recognized: true, destructive: true },
    })
    const projection: ToolProjection = {
      name: 'agent_qa_set_config_field',
      ops: ['config.field.set'],
      kind: 'workflow',
    }
    const config = toRegisterToolConfig(
      projection,
      [writing],
      AGENT_QA_OP_CONTRACTS['config.field.set']!,
      identity,
    )
    expect(config.annotations.readOnlyHint).toBe(false)
    expect(config.annotations.idempotentHint).toBe(false)
    expect(config.annotations.destructiveHint).toBe(true)
  })

  // The masker is a REQUIRED dep and this is what makes that load-bearing rather than ceremonial.
  // The absence assertion is windowed at 8 characters, because a partial disclosure is a
  // disclosure; it is paired with an integrity assertion, because `not.toContain` over a channel
  // the value never entered passes for the wrong reason.
  it('routes the derived description through the masker', () => {
    const planted = 'sk-live-9f3a1c0b7d2e4f6a'
    const masked = toRegisterToolConfig(
      READ_PROJECTION,
      [spec({ summary: `Lists proposals for ${planted}.` })],
      advertised(READ_PROJECTION),
      (text: string) => text.split(planted).join('[SECRET_0]'),
    )

    for (let at = 0; at + 8 <= planted.length; at += 1) {
      expect(masked.description).not.toContain(planted.slice(at, at + 8))
    }
    // Integrity: the masker demonstrably saw and rewrote these exact bytes, so the absence above
    // is a redaction rather than an empty channel.
    expect(masked.description).toBe('Lists proposals for [SECRET_0].')
  })

  it('refuses a projection with no arms', () => {
    expect(() =>
      toRegisterToolConfig(READ_PROJECTION, [], advertised(READ_PROJECTION), identity),
    ).toThrow(McpProjectionError)
  })

  // Plan 01 REFUSED a fold here rather than approximating it; plan 04 composes one, so the refusal
  // moved to the case that is still dishonest — a tool derived from FEWER arms than it declares.
  // Shipping that would advertise the union of two arms while dispatching over three, and the
  // caller who found the missing arm would be told its valid input was invalid.
  it('refuses a fold derived from a subset of its declared arms', () => {
    const projection: ToolProjection = {
      name: 'agent_qa_propose_config_change',
      ops: ['config.field.set', 'config.hook.add', 'config.auth.set'],
      kind: 'workflow',
      discriminant: 'action',
    }
    expect(() =>
      toRegisterToolConfig(
        projection,
        [spec({ id: 'config.field.set' }), spec({ id: 'config.hook.add' })],
        advertised({ ...projection, name: 'agent_qa_propose_config_change' }),
        identity,
      ),
    ).toThrow(/declares 3 ops but was derived from 2/u)
  })

  // THE BAR for the degradation clause: an implementation that advertised the output regardless
  // would pass every cell above (the read contracts all convert) and red here, because
  // `RunStartAcknowledgementSchema` is built over a branded run id and its output-mode conversion
  // throws. Left unhandled, that throw happens inside `tools/list` and takes the LISTING down.
  it('omits the outputSchema for a declared degradation and says so in the description', () => {
    const projection: ToolProjection = {
      name: 'agent_qa_start_run',
      ops: ['runs.start'],
      kind: 'workflow',
    }
    const config = toRegisterToolConfig(
      projection,
      [spec({ id: 'runs.start', requiredScopes: ['run'], risk: { name: 'fn:runs.start', recognized: true } })],
      advertised(projection),
      identity,
    )
    expect(config.outputSchema).toBeUndefined()
    expect(config.description).toContain('advertises no outputSchema')
    expect(config.description).toContain('RunStartAcknowledgementSchema')
  })

  // The other side of the same two-sided declaration: an entry for a contract that converts fine is
  // a tool withholding a schema it could publish, so it refuses rather than rots.
  it('refuses a degradation entry whose contract converts cleanly', () => {
    const projection: ToolProjection = {
      name: 'agent_qa_start_run',
      ops: ['proposals.list'],
      kind: 'read',
    }
    expect(() =>
      toRegisterToolConfig(
        projection,
        [spec()],
        AGENT_QA_OP_CONTRACTS['proposals.list']!,
        identity,
      ),
    ).toThrow(/converts cleanly in output mode/u)
  })

  // The undeclared case. This is the cell that stands between a new op contract and a dead
  // `tools/list`: the failure is named here, at build time, with the tool and the converter's own
  // message, instead of surfacing as an unattributed exception in a protocol response.
  it('refuses an undeclared unrepresentable output contract, naming the tool', () => {
    const projection: ToolProjection = {
      name: 'agent_qa_list_proposals',
      ops: ['proposals.list'],
      kind: 'read',
    }
    expect(() =>
      toRegisterToolConfig(
        projection,
        [spec()],
        AGENT_QA_OP_CONTRACTS['runs.start']!,
        identity,
      ),
    ).toThrow(/agent_qa_list_proposals advertises an output contract JSON Schema cannot represent/u)
  })
})

describe('compositionOf — derived, never restated', () => {
  it('reads single, union and pipeline off the entry', () => {
    expect(compositionOf({ name: 't', ops: ['a'], kind: 'read' })).toBe('single')
    expect(compositionOf({ name: 't', ops: ['a', 'b'], kind: 'read' })).toBe('pipeline')
    expect(
      compositionOf({ name: 't', ops: ['a', 'b'], kind: 'read', discriminant: 'action' }),
    ).toBe('union')
  })
})

describe('the mapping table', () => {
  // The two tables are separate because they come from different places; this is what stops them
  // drifting. `catalog.ts` throws on the same condition at build time — the cell states it as a
  // property of the shipped data rather than of one code path reaching it.
  it('names no op that is missing from the contract table', () => {
    for (const projection of AGENT_QA_TOOL_PROJECTIONS) {
      for (const opId of projection.ops) {
        expect(AGENT_QA_OP_CONTRACTS[opId], `${projection.name} -> ${opId}`).toBeDefined()
      }
    }
  })

  it('declares no duplicate tool name', () => {
    const names = AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
