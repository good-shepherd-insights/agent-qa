import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as surface from '../index'
import { AGENT_QA_SAFETY_LOCAL_ALLOWED_RESPONSIBILITIES } from '../ownership-contract'

// RE-SPELLED 2026-10-01 (432-19, D-14). This file drove `createReadlineConfirm`, the in-test
// terminal confirm: the `[y/N]` question, deny on empty input, deny on EOF, deny when either stream
// contradicted the declared `tty-prompt` surface, and no stream read when it would refuse anyway.
// D-14 deletes every y/n prompt, and the confirm port this adapter implemented is deleted with the
// gate, so the adapter goes too. What these cells pin now is that it cannot come back unnoticed.
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function productionSources(): string[] {
  return readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => readFileSync(join(SRC, entry.name), 'utf8'))
}

describe('C432-NO-READLINE-CONFIRM: the in-test readline confirm is gone', () => {
  it('C432-NO-READLINE-CONFIRM: the module is deleted and the barrel does not publish it', () => {
    expect(existsSync(join(SRC, 'readline-confirm.ts'))).toBe(false)
    expect(Object.keys(surface)).not.toContain('createReadlineConfirm')
  })

  it('C432-NO-READLINE-CONFIRM: no safety-local source opens a readline interface or asks a y/N question', () => {
    const sources = productionSources()
    expect(sources.length).toBeGreaterThanOrEqual(6)
    for (const needle of ['node:readline', 'createInterface', '[y/N]', 'tty-prompt', 'ConfirmPort']) {
      expect(sources.filter((text) => text.includes(needle)), needle).toEqual([])
    }
  })

  it('C432-NO-READLINE-CONFIRM: the ownership contract no longer allows a confirm adapter', () => {
    expect(AGENT_QA_SAFETY_LOCAL_ALLOWED_RESPONSIBILITIES.filter((entry) => /confirm/i.test(entry))).toEqual([])
    // Non-vacuity: the contract still names what this package does own.
    expect(AGENT_QA_SAFETY_LOCAL_ALLOWED_RESPONSIBILITIES.some((entry) => /guardrail audit writer/.test(entry))).toBe(true)
  })
})
