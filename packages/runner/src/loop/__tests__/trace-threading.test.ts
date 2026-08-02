/**
 * D-16's LAST HOP: no consumer may drop the trace between the reader port and evidence
 * (Phase 387-04, KREV-02).
 *
 * The structural half of this is a signature — `recordServedBrief` and `recordServedCautions` take
 * the trace as a REQUIRED parameter, so a loop that obtained a composite and discarded its trace
 * cannot compile. That half is enforced by `tsc` and exercised by every runner suite.
 *
 * This file covers what a type cannot see: that the loop actually threads the trace it received
 * rather than manufacturing a fresh empty one at the recorder call. A `trace: emptyTrace()` at the
 * call site would type-check perfectly and would make D-16 vacuous at the exact hop it is meant to
 * protect — so it is scanned for, with a planted violation confirming the scan can reject.
 *
 * `grep` is deliberately unused: it has silently returned nothing for patterns demonstrably
 * present in this tree, and a gate that can fail open is worse than no gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const loopDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function statementsOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

describe('the loop threads the serve-time trace to the evidence seam (387-04)', () => {
  const source = statementsOf(readFileSync(join(loopDir, 'index.ts'), 'utf8'))

  it('hands the recorder the trace it was served, never a fabricated one', () => {
    // The composite is destructured once and its own `trace` is what reaches the recorder.
    expect(occurrences(source, 'trace: served.trace')).toBe(1)
    expect(occurrences(source, 'recorder.recordServedCautions(injected, cautionsForTurn.trace)'))
      .toBe(1)

    // No empty/synthetic trace is constructed anywhere in the loop.
    for (const forbidden of [
      'servedLines: []',
      'truncated: []',
      'schemaVersion: 1',
    ]) {
      expect(occurrences(source, forbidden)).toBe(0)
    }

    // POSITIVE CONTROL: the fabricated-trace shape this scan exists to reject is rejected.
    const planted = `${source}\n  recorder.recordServedBrief({ block, trace: { schemaVersion: 1, servedLines: [], truncated: [] } })\n`
    expect(occurrences(planted, 'servedLines: []')).toBe(1)
    expect(occurrences(planted, 'schemaVersion: 1')).toBe(1)

    // INVERSE CONTROL: the same shape in PROSE must not be flagged, which is the failure mode a
    // naive substring scan hits in this file — it explains the contract it implements.
    expect(occurrences(
      statementsOf('// never write servedLines: [] here\n/* nor schemaVersion: 1 */\nconst x = 1\n'),
      'servedLines: []',
    )).toBe(0)
  })

  it('reads both composite entries exactly once each', () => {
    // Two serving entries cross this seam; a third call would be a serve nobody attributed.
    expect(occurrences(source, '.getRunBrief(')).toBe(1)
    expect(occurrences(source, '.getCautions(')).toBe(1)
    expect(occurrences(`${source}\nports.knowledgeReader?.getRunBrief(s, b)\n`, '.getRunBrief(')).toBe(2)
  })
})
