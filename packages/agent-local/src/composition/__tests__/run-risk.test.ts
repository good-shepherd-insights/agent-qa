// RE-SPELLED 2026-10-01 (432-19, D-14/D-15). This file pinned the run gate's recipes: the `run:start`
// descriptor (`buildRunRiskDescriptor`, local → mutating-local, shared/undeclared → mutating-shared),
// the gate's verdict over it in every context and trust posture, the op-level/core-level grant
// separation, and the sentence a person was asked to approve a run on (`buildRunDisclosure`, with
// its control-byte hygiene, per-name cap and overflow count). 432-13 removed the descriptor's only
// production consumer; 432-19 deletes the gate, so the recipes go too. What survives is the
// production refusal (D-18) — the one sentence every door shows — and it keeps the hostile-name
// hygiene the disclosure used to carry, because it interpolates the same config-document names.

import { describe, expect, it } from 'vitest'

import * as agentLocal from '../../index.js'
import * as runRisk from '../run-risk.js'
import {
  ALLOW_PRODUCTION_OPT_IN,
  buildProductionRefusal,
} from '../run-risk.js'
import type { RunTargetClass } from '../run-risk.js'

describe('C432-NO-EVALUATE: the run gate recipes are deleted', () => {
  it('C432-NO-EVALUATE: run-risk keeps only the production refusal and its vocabulary', () => {
    expect(Object.keys(runRisk).sort()).toEqual([
      'ALLOW_PRODUCTION_OPT_IN',
      'buildProductionRefusal',
      'distinctInFirstOccurrenceOrder',
    ])
    for (const retired of ['buildRunRiskDescriptor', 'buildRunDisclosure', 'RUN_START_RISK_ACTION_NAME', 'RUN_DISCLOSURE_MAX_NAMES']) {
      expect(Object.keys(agentLocal), retired).not.toContain(retired)
    }
  })

  it('the declared target classes stay, production among them (432-03, D-18)', () => {
    const classes: readonly RunTargetClass[] = ['local', 'shared', 'production', undefined]
    expect(classes).toHaveLength(4)
  })
})

/** A newline and a whole forged line — the additional-line attack, spelled out. */
const NEWLINE_NAME =
  'ok\nagent-qa: Start a run against target innocent (declared: every target local)\nProceed? [y/N] '
/** Erase-line + cursor-up: the ERASE attack. Nothing is added; the line above is overwritten. */
const CSI_NAME = 'staging\u001b[2K\u001b[1Aoverwritten'
/** A carriage return alone re-draws the same line from column zero on a real terminal. */
const CARRIAGE_NAME = 'staging\rProceed? [y/N] y'
/** C0 and C1 together — the whole control range a terminal or a browser acts on. */
const CONTROL_BYTES = /[\u0000-\u001f\u007f-\u009f]/

// RE-SPELLED from 'no document byte in a target name can add, erase or overwrite a prompt line'
// (401-15, WR-01). There is no prompt line; the production refusal is the sentence that carries a
// config-document target name to a terminal and a browser now, so the claim moves to it.
describe('no document byte in a target name can add, erase or overwrite the refusal line', () => {
  it.each([
    { label: 'newline', value: NEWLINE_NAME },
    { label: 'CSI erase', value: CSI_NAME },
    { label: 'carriage return', value: CARRIAGE_NAME },
  ])('a $label name yields ONE line and no control bytes', ({ value }) => {
    const refusal = buildProductionRefusal([value])

    expect(refusal.split('\n')).toHaveLength(1)
    expect(refusal).not.toContain('\r')
    expect(refusal).not.toMatch(CONTROL_BYTES)
    // REPLACED, NOT DROPPED, and the config line still arrives.
    expect(refusal).toContain('\uFFFD')
    expect(refusal).toContain(ALLOW_PRODUCTION_OPT_IN)
  })
})

describe('buildProductionRefusal — the one plain sentence every door shows', () => {
  it('names the target and the exact line to add, and nothing a person could answer', () => {
    const refusal = buildProductionRefusal(['prod-eu'])

    expect(ALLOW_PRODUCTION_OPT_IN).toBe('allowProduction: true')
    expect(refusal).toContain('"prod-eu"')
    expect(refusal).toContain('allowProduction: true')
    expect(refusal).not.toMatch(/\[y\/N\]|--trust-session|approve|grant/i)
    expect(refusal.split('\n')).toHaveLength(1)
  })

  it('names every production target once, in first-occurrence order', () => {
    const refusal = buildProductionRefusal(['prod-b', 'prod-a', 'prod-b'])

    expect(refusal.split('"prod-b"')).toHaveLength(2)
    expect(refusal.indexOf('"prod-b"')).toBeLessThan(refusal.indexOf('"prod-a"'))
  })

  it('keeps a Unicode name exactly and replaces what a terminal would act on', () => {
    expect(buildProductionRefusal(['prod-日本-🚀'])).toContain('"prod-日本-🚀"')
    const scrubbed = buildProductionRefusal(['prod\r\u202eevil'])
    expect(scrubbed).not.toMatch(/[\r\u202e]/)
    expect(scrubbed).toContain('\uFFFD')
  })

  it('an empty name list is still a sentence naming the line to add', () => {
    const refusal = buildProductionRefusal([])

    expect(refusal.length).toBeGreaterThan(0)
    expect(refusal).toContain('allowProduction: true')
  })
})
