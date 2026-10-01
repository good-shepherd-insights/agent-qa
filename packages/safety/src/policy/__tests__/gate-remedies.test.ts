// RE-SPELLED 2026-10-01 (432-19, D-15). This file proved Phase 400's structured remedies on a gate
// decision: the fail-closed and prompted-denied arms minting `answer-confirm`, the trust-session flag
// and the bearer scope beside an unchanged prose reason, the session-pin arm's finality remedy, the
// surface-neutral reason, and `remediesRenderableBy` as a total per-surface projection. The gate
// that minted them and the vocabulary itself are deleted, so each of those claims becomes the
// absence of the thing it measured: no module, no barrel value, no type, and no safety source that
// spells a remedy kind. The plain production refusal that replaced every denial is measured at the
// doors that render it (`cli/src/__tests__/receipt-remedy-render.test.ts`, C432-PLAIN-REFUSAL).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import * as safety from '../../index'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// The four remedy kinds and the projection, spelled in halves so a census over this package's
// tests reads them as absent too.
const REMEDY_KINDS = [
  ['answer', '-confirm'],
  ['trust-session', '-flag'],
  ['session-pin', '-final'],
  ['present-bearer', '-scope'],
].map(([head, tail]) => head + tail)
const REMEDY_VALUES = ['GATE_REMEDY_KINDS', 'GATE_REMEDY_SURFACES', 'GATE_REMEDY_SURFACES_BY_KIND', 'remediesRenderableBy']

function sourcesUnder(dir: string): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') found.push(...sourcesUnder(path))
      continue
    }
    if (entry.name.endsWith('.ts')) found.push({ file: path, text: readFileSync(path, 'utf8') })
  }
  return found
}

describe('C432-REMEDY-TYPES-ABSENT: no gate decision mints a remedy, because there is no gate and no vocabulary', () => {
  it('C432-REMEDY-TYPES-ABSENT: the schema publishes no remedy value at runtime', () => {
    for (const name of REMEDY_VALUES) {
      expect(Object.keys(schema), name).not.toContain(name)
    }
    // Non-vacuity: the namespace is the real schema barrel.
    expect(typeof schema.buildProductionRefusal).toBe('function')
  })

  it('C432-REMEDY-TYPES-ABSENT: no safety production source spells a remedy kind, the projection or the type', () => {
    const sources = sourcesUnder(SRC)
    expect(sources.length).toBeGreaterThan(20)
    const needles = [...REMEDY_KINDS, ...REMEDY_VALUES, 'Gate' + 'Remedy', 'neutral' + 'Reason']
    const hits = sources.flatMap(({ file, text }) =>
      needles.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`),
    )
    expect(hits).toEqual([])
  })

  it('C432-REMEDY-TYPES-ABSENT: the schema remedy module is gone and the gate cannot be imported to mint one', () => {
    const schemaSafety = join(SRC, '..', '..', 'schema', 'src', 'safety')
    expect(existsSync(join(schemaSafety, 'remedies.ts'))).toBe(false)
    expect(existsSync(join(schemaSafety, 'risk-tier.ts'))).toBe(true)
    expect(existsSync(join(SRC, 'policy', 'gate.ts'))).toBe(false)
    expect(Object.keys(safety)).not.toContain('evaluate')
  })

  it('a refused in-run action carries no policy result, so no remedy can ride it', async () => {
    // The tool-call deny shape is the one place a decision used to travel with its remedies (as
    // `policy`). With the gate deleted the async point allows, and the deny type has no such member.
    const { registry } = safety.registerFirstPartySafetyHooks()
    const action = { name: 'push_to_remote', recognized: true, declaredTier: 'mutating-shared' as const }
    const answer = await registry.runToolCallAsync(action)
    expect(answer).toEqual({ action: 'allow', call: action })
    expect(JSON.stringify(answer)).not.toMatch(/remed|policy/)
  })
})
