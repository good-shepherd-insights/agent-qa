// RE-SPELLED 2026-10-01 (432-19, D-14/D-15; 432-18 deferred #3). This file proved the session-pin
// DENY overlay as a property of the shipped gate (Phase 392, D-21): with the hook present and
// answering true an allow or an ask became an audited `session-pin-denied`, a grant, a credential or
// trust mode could not resurrect it, and with the hook absent (or answering false) the gate was
// byte-identical. 432-18 deleted the chat `/pin` verb and both pin overlay modules; 432-19 deletes
// the gate, its `deny` option, `SessionDenyOverlay` and the `session-pin-denied` outcome. Nothing is
// left to tighten or to widen, so the two arms become absence: no overlay type, no deny dependency,
// no outcome word, and a stale deny input armed by a caller changes nothing.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as safety from '../../index'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function productionText(): string {
  const parts: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(path)
      } else if (entry.name.endsWith('.ts')) {
        parts.push(readFileSync(path, 'utf8'))
      }
    }
  }
  walk(SRC)
  return parts.join('\n')
}

describe('C432-NO-ASK-PORTS: the session deny overlay left with the gate', () => {
  it('C432-NO-ASK-PORTS: no safety source declares the overlay, the deny option or the pin outcome', () => {
    const text = productionText()
    expect(text.length).toBeGreaterThan(10_000)
    for (const needle of ['SessionDenyOverlay', 'session-pin-denied', 'deps.deny', 'deny?: ']) {
      expect(text, needle).not.toContain(needle)
    }
  })

  it('C432-NO-ASK-PORTS: the barrel has no deny-overlay value, and the registrar ignores a stale deny input', async () => {
    expect(Object.keys(safety).filter((key) => /pin|deny/i.test(key))).toEqual([])
    // A caller passing an overlay that would deny EVERYTHING (the old ARM A) arms nothing: the
    // async tool-call point allows, exactly as with no input at all (the old ARM B).
    const denyEverything = () => true
    const withStaleDeny = safety.registerFirstPartySafetyHooks({ deny: denyEverything } as never)
    const without = safety.registerFirstPartySafetyHooks()
    for (const action of [
      { name: 'inspect_state', recognized: true, readOnly: true },
      { name: 'push_to_remote', recognized: true, declaredTier: 'mutating-shared' as const },
      { name: 'delete_record', recognized: true },
    ]) {
      const stale = await withStaleDeny.registry.runToolCallAsync(action)
      const plain = await without.registry.runToolCallAsync(action)
      expect(stale).toEqual({ action: 'allow', call: action })
      expect(stale).toEqual(plain)
    }
  })
})
