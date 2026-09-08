// Structured, surface-aware remedies on a gate decision (Phase 400, D-15, plan 02).
//
// WHAT THIS FILE PROVES, and why the prose reason is pinned rather than rewritten.
//
// `399-friction-refusal-remedies-unreachable` measured the fail-closed denial naming two ways
// forward and neither being takeable from the surface that issued it: `--trust-session` is declared
// on exactly one command (`run`), so an MCP client reading that sentence has no flag to pass, and
// "re-run locally to confirm interactively" points at a confirm port the denial never names. The
// repair is NOT a better sentence — a sentence is one string and there are four doors. It is
// structured remedy data beside the sentence, and a projection each surface applies to it.
//
// THE PROSE REASON'S BYTES ARE A CONTRACT (T-400-07). It is the audit/log text: it lands in the
// execution-audit row, `demo/acceptance/399/` quotes it verbatim as the previous phase's published
// evidence, and `399-runbook-gate.sh --chain` derives the runbook's quote from the template that
// assembles it. So this file pins the reason BY READING THE SHIPPED TEMPLATE OUT OF `gate.ts` at
// test time and interpolating it — never against a copy transcribed into a test, which would pin
// the transcription and drift the day somebody edited the source instead. It also asserts the
// template appears EXACTLY ONCE, which is the same invariant the acceptance harness refuses on:
// two templates and the runbook's quote is checked against one of two.
//
// EMPTY IS AN ANSWER. The restricted-tier arm mints NO remedies, because a restricted action is
// never executable and no grant, credential or flag changes that — and a vocabulary that could
// only ever produce a non-empty list would be one that fabricates guidance to avoid looking blank.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  GATE_REMEDY_KINDS,
  GATE_REMEDY_SURFACES,
  remediesRenderableBy,
  type ExecutionContext,
  type GateRemedy,
  type GateRemedyKind,
  type RiskActionDescriptor,
} from '@vostride/agent-qa-schema'

import { evaluate } from '../gate'
import { classifyRisk } from '../risk-classifier'

const GATE_SOURCE = readFileSync(new URL('../gate.ts', import.meta.url), 'utf8')

/** The fail-closed template, read off the shipped producer rather than copied into this file. */
const FAIL_CLOSED_TEMPLATE = (() => {
  const declarations = GATE_SOURCE.split('\n').filter((line) =>
    line.includes('return `fail-closed: ask in '),
  )
  // The same refusal `399-runbook-gate.sh` makes: a second template and the pin below would be
  // checking the reason against one of two.
  expect(declarations).toHaveLength(1)
  const raw = declarations[0].replace(/^[^`]*`/, '').replace(/`\s*$/, '')
  expect(raw.length).toBeGreaterThan(0)
  return raw
})()

function shippedFailClosedReason(
  ctx: ExecutionContext,
  classificationReason: string,
): string {
  return FAIL_CLOSED_TEMPLATE
    .replace('${ctx}', ctx)
    .replace('${classificationReason}', classificationReason)
}

const mutatingSharedAction: RiskActionDescriptor = {
  name: 'push_to_remote',
  recognized: true,
  declaredTier: 'mutating-shared',
}

const restrictedAction: RiskActionDescriptor = {
  name: 'run_shell',
  recognized: true,
  command: 'rm -rf /',
}

function kindsOf(remedies: readonly GateRemedy[]): readonly GateRemedyKind[] {
  return remedies.map((remedy) => remedy.kind)
}

describe('the fail-closed arm mints remedies beside an unchanged prose reason', () => {
  it('carries the trust-session flag and the confirm port as typed remedies', async () => {
    const result = await evaluate(mutatingSharedAction, 'local-headless')

    expect(result.verdict).toBe('deny')
    expect(kindsOf(result.remedies)).toContain('trust-session-flag')
    expect(kindsOf(result.remedies)).toContain('answer-confirm')
  })

  it('leaves the canonical prose reason byte-identical to the shipped template', async () => {
    const classificationReason = classifyRisk(mutatingSharedAction).reason
    const result = await evaluate(mutatingSharedAction, 'local-headless')

    expect(result.reason).toBe(
      shippedFailClosedReason('local-headless', classificationReason),
    )
  })

  it('keeps the remedies OUT of the execution-audit row — the trail carries the prose', async () => {
    const rows: { reason: string }[] = []
    const result = await evaluate(mutatingSharedAction, 'ci', {}, {
      auditSink: {
        appendExecutionAudit: (row) => {
          rows.push({ reason: row.reason })
        },
        appendGuardrailAudit: () => {
          throw new Error('gate writes execution audit only')
        },
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe(result.reason)
    expect(rows[0]).not.toHaveProperty('remedies')
  })
})

describe('an arm with no actionable remedy mints an empty list', () => {
  it('offers nothing on a restricted-tier block — never executable, so never remediable', async () => {
    const result = await evaluate(restrictedAction, 'local-interactive')

    expect(result.verdict).toBe('deny')
    expect(result.remedies).toEqual([])
  })

  it('offers nothing on an allow', async () => {
    const result = await evaluate(
      { name: 'inspect_state', recognized: true, readOnly: true },
      'ci',
    )

    expect(result.verdict).toBe('allow')
    expect(result.remedies).toEqual([])
  })
})

describe('remediesRenderableBy is a total projection over the vocabulary', () => {
  it('419 D-20 pins the four kinds in render order', () => {
    expect(GATE_REMEDY_KINDS).toEqual([
      'answer-confirm', 'trust-session-flag', 'session-pin-final', 'present-bearer-scope',
    ])
  })
  it('excludes the CLI flag from MCP and includes it on the CLI', async () => {
    const { remedies } = await evaluate(mutatingSharedAction, 'ci')

    expect(kindsOf(remediesRenderableBy('mcp', remedies))).not.toContain(
      'trust-session-flag',
    )
    expect(kindsOf(remediesRenderableBy('cli', remedies))).toContain(
      'trust-session-flag',
    )
  })

  it('419 D-20 projects the declared-bearer remedy on MCP only', async () => {
    const { remedies } = await evaluate(mutatingSharedAction, 'ci')

    expect(remediesRenderableBy('mcp', remedies)).toEqual([
      { kind: 'present-bearer-scope', params: { scope: 'knowledge-write' } },
    ])
    expect(kindsOf(remedies)).toEqual([
      'answer-confirm', 'trust-session-flag', 'present-bearer-scope',
    ])
    for (const surface of ['cli', 'dashboard', 'chat', 'run-service'] as const) {
      expect(kindsOf(remediesRenderableBy(surface, remedies))).not.toContain('present-bearer-scope')
    }
    const bearerRemedy = remedies.find(remedy => remedy.kind === 'present-bearer-scope')!
    expect(Object.keys(bearerRemedy.params!)).toEqual(['scope'])
    expect(bearerRemedy.params).toEqual({ scope: 'knowledge-write' })
    expect(remedies.length).toBeGreaterThan(0)
  })

  it('answers for every kind on every surface, and orphans no kind', () => {
    for (const kind of GATE_REMEDY_KINDS) {
      const takers = GATE_REMEDY_SURFACES.filter(
        (surface) => remediesRenderableBy(surface, [{ kind }]).length === 1,
      )
      // Total: every (kind, surface) pair answers, and the answer is the remedy or nothing.
      for (const surface of GATE_REMEDY_SURFACES) {
        const projected = remediesRenderableBy(surface, [{ kind }])
        expect([0, 1]).toContain(projected.length)
        if (projected.length === 1) expect(projected[0].kind).toBe(kind)
      }
      // A kind no surface can take is not a remedy — it is prose with a type on it.
      expect(takers.length).toBeGreaterThan(0)
    }
  })

  it('preserves order and drops nothing it can render', () => {
    const remedies: readonly GateRemedy[] = GATE_REMEDY_KINDS.map((kind) => ({ kind }))
    for (const surface of GATE_REMEDY_SURFACES) {
      const projected = remediesRenderableBy(surface, remedies)
      expect(kindsOf(projected)).toEqual(
        GATE_REMEDY_KINDS.filter(
          (kind) => remediesRenderableBy(surface, [{ kind }]).length === 1,
        ),
      )
    }
  })
})

describe('the session-pin arm names the only way out it has', () => {
  it('mints the session-finality remedy, and no CLI flag', async () => {
    const result = await evaluate(
      mutatingSharedAction,
      'local-interactive',
      {},
      { deny: () => true },
    )

    expect(result.verdict).toBe('deny')
    expect(kindsOf(result.remedies)).toEqual(['session-pin-final'])
    expect(remediesRenderableBy('cli', result.remedies)).toEqual([])
    expect(remediesRenderableBy('mcp', result.remedies)).toEqual([])
  })
})

// The PROSE half of the same finding (Phase 400 gap round 1, plan 11, D-15 / WINDOWS #191).
//
// 400-02 closed the structured half and said so: the canonical sentence still names
// `--trust-session`, and the dashboard rendered that sentence verbatim to a browser reader who has
// no flag to pass. THE REPAIR IS NOT A REWRITE. The canonical bytes are published evidence — the
// audit row, `demo/acceptance/399/`'s runbook quote, and the `--chain` grep that derives it — so a
// THIRD sibling switch mints a surface-neutral reason BESIDE them, and the browser renders that.
//
// THE TWO CHANNELS ARE ASSERTED IN THE SAME CELL, deliberately. A cell that only asserted the
// neutral string would stay green the day somebody "fixed" the flag out of the canonical prose,
// which is exactly the pin trip 399's harness exists to catch; asserting both means the two cannot
// be conflated and neither can drift alone.

describe('a surface-neutral reason rides beside the canonical prose (D-15 prose half)', () => {
  it('names no affordance on the fail-closed arm, while the canonical bytes are unchanged', async () => {
    const classificationReason = classifyRisk(mutatingSharedAction).reason
    const result = await evaluate(mutatingSharedAction, 'local-headless')

    expect(result.verdict).toBe('deny')
    // The neutral half: what a browser reader is shown. No flag, no command, no re-run instruction.
    expect(result.neutralReason).not.toContain('--trust-session')
    expect(result.neutralReason).not.toContain('re-run')
    expect(result.neutralReason).not.toContain('opt in')
    // It still says WHAT was refused and in WHICH posture — a reason that named neither would be
    // honest absence of information rather than a surface-neutral answer.
    expect(result.neutralReason).toContain(classificationReason)
    expect(result.neutralReason).toContain('local-headless')
    // The sibling canonical channel, byte-identical to the shipped template.
    expect(result.reason).toBe(
      shippedFailClosedReason('local-headless', classificationReason),
    )
    expect(result.reason).toContain('--trust-session')
  })

  it('leaves the canonical fail-closed template the SINGLE greppable producer', () => {
    // The invariant `399-runbook-gate.sh` refuses on. The neutral arm must spell its opening
    // differently or the runbook's derived quote is checked against one of two templates.
    const declarations = GATE_SOURCE.split('\n').filter((line) =>
      line.includes('return `fail-closed: ask in '),
    )
    expect(declarations).toHaveLength(1)
  })

  it('carries the declined prompt and nothing after it on the prompted-denied arm', async () => {
    const classificationReason = classifyRisk(mutatingSharedAction).reason
    const result = await evaluate(mutatingSharedAction, 'local-interactive', {}, {
      confirm: { surface: 'tty-prompt', ask: () => Promise.resolve(false) },
    })

    expect(result.verdict).toBe('deny')
    expect(result.neutralReason).not.toContain('--trust-session')
    expect(result.neutralReason).not.toContain('re-run')
    expect(result.neutralReason).toContain(classificationReason)
    expect(result.neutralReason).toContain('the interactive prompt was declined')
    // Beside it, the canonical sentence still names both ways forward, unedited.
    expect(result.reason).toContain('--trust-session')
    expect(result.reason).toContain('re-run and approve')
    expect(remediesRenderableBy('mcp', result.remedies)).toEqual([
      { kind: 'present-bearer-scope', params: { scope: 'knowledge-write' } },
    ])
  })

  it('mints a neutral reason on the session-pin arm too — the three switches stay parallel', async () => {
    const result = await evaluate(mutatingSharedAction, 'local-interactive', {}, {
      deny: () => true,
    })

    expect(result.verdict).toBe('deny')
    expect(result.neutralReason).toContain('session-pin-denied')
    expect(result.neutralReason).not.toContain('--trust-session')
  })

  it('mints one on the arms nothing refused, because the member is required and always answered', async () => {
    const allowed = await evaluate(
      { name: 'inspect_state', recognized: true, readOnly: true },
      'ci',
    )
    expect(allowed.verdict).toBe('allow')
    expect(allowed.neutralReason).toBe(allowed.reason)

    const blocked = await evaluate(restrictedAction, 'local-interactive')
    expect(blocked.verdict).toBe('deny')
    // §2.4 finality names no affordance, so the neutral form IS the canonical form here — through
    // the neutral builder, not by falling through to the prose one.
    expect(blocked.neutralReason).toBe(blocked.reason)
  })

  it('keeps the NEUTRAL reason off the execution-audit row — the trail carries the canonical prose', async () => {
    const rows: { reason: string }[] = []
    const result = await evaluate(mutatingSharedAction, 'ci', {}, {
      auditSink: {
        appendExecutionAudit: (row) => {
          rows.push({ reason: row.reason })
        },
        appendGuardrailAudit: () => {
          throw new Error('gate writes execution audit only')
        },
      },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe(result.reason)
    expect(rows[0].reason).not.toBe(result.neutralReason)
    expect(rows[0]).not.toHaveProperty('neutralReason')
  })
})
