// The CLI's half of D-15 — RE-SPELLED 2026-10-01 (432-19, D-14/D-15).
//
// This file proved that the CLI rendered the remedies IT could take (the trust-session flag named
// with the command it is declared on, the confirm answer) under a gate denial, and nothing when the
// projection was empty. The execution gate that minted remedies is deleted and the vocabulary with
// it, so the renderer (`denialDetailLines`) is deleted too. What survives is the harder half the
// file always called the point: HONEST ABSENCE. A refusal is a plain reason, and the CLI appends
// nothing a reader could try — no flag, no confirm, no approval or trust command.
//
// The one refusal left at this door is a production run without the config opt-in (D-18). Its
// sentence is built by the shared producer and printed as `Run denied: <reason>`, which these cells
// read off the shipped sources and the shipped producer rather than off a copy.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildProductionRefusal, type ClauseReceipt } from '@vostride/agent-qa-schema'

import * as receiptLineModule from '../commands/receipt-line.js'
import { receiptLine } from '../commands/receipt-line.js'

const COMMANDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands')

/** Anything a reader could take as an instruction to approve, trust, answer or opt in. */
const SUGGESTED_ACTION = /--trust-session|\[y\/N\]|\bapprove\b|\bgrant\b|answer the confirm|opt in for this session|agent-qa \w+ --/i

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, (_m, kept?: string) => kept ?? '')
}

describe('C432-REMEDY-TYPES-ABSENT: the CLI has no remedy renderer', () => {
  it('C432-REMEDY-TYPES-ABSENT: receipt-line exports the receipt render and nothing that renders a remedy', () => {
    expect(Object.keys(receiptLineModule).sort()).toEqual(['receiptLine'])
  })

  it('C432-REMEDY-TYPES-ABSENT: no command source spells the remedy vocabulary or its renderer', () => {
    for (const file of ['receipt-line.ts', 'run.ts', 'fn.ts']) {
      const code = stripComments(readFileSync(join(COMMANDS, file), 'utf8'))
      for (const needle of ['denialDetailLines', 'remediesRenderable' + 'By', 'Gate' + 'Remedy', 'FunctionDenied' + 'Error', '.remedies']) {
        expect(code.includes(needle), `${file}: ${needle}`).toBe(false)
      }
    }
  })
})

describe('C432-PLAIN-REFUSAL: a refused run prints a plain reason and suggests nothing', () => {
  it('C432-PLAIN-REFUSAL: the run door prints exactly `Run denied: <reason>` for a run denial', () => {
    const code = stripComments(readFileSync(join(COMMANDS, 'run.ts'), 'utf8'))
    const branch = code.slice(code.indexOf('if (err instanceof RunDeniedError) {'))
    expect(branch.length).toBeGreaterThan(0)
    const body = branch.slice(0, branch.indexOf('process.exit(2)'))
    expect(body).toContain('console.error(pc.red(`Run denied: ${err.reason}`))')
    // One print, of the reason alone.
    expect(body.match(/console\.error/g) ?? []).toHaveLength(1)
  })

  it('C432-PLAIN-REFUSAL: the refusal names the target and the config line, and no approval or trust command', () => {
    for (const names of [['prod-eu'], ['prod-eu', 'prod-us'], []]) {
      const printed = `Run denied: ${buildProductionRefusal(names)}`
      for (const name of names) expect(printed).toContain(`"${name}"`)
      expect(printed).toContain('allowProduction: true')
      expect(printed).not.toMatch(SUGGESTED_ACTION)
      expect(printed.split('\n')).toHaveLength(1)
    }
  })

  it('C432-PLAIN-REFUSAL: a refused or failed receipt renders its own outcome and appends no suggested command', () => {
    const base: Omit<ClauseReceipt, 'status' | 'outcome'> = {
      clause: 'start a run on prod',
      functionId: 'runs.start',
      origin: 'human',
    }
    for (const receipt of [
      { ...base, status: 'refused', outcome: buildProductionRefusal(['prod-eu']) },
      { ...base, status: 'failed', outcome: 'FunctionInputError' },
    ] satisfies ClauseReceipt[]) {
      const line = receiptLine(receipt)
      expect(line.split('\n')).toHaveLength(2)
      expect(line).toContain(receipt.outcome)
      expect(line).not.toMatch(SUGGESTED_ACTION)
    }
  })
})
