// `unmaskTreeForDisplay`'s cells (Phase 405 plan 10, D-09 · RESEARCH Pitfall 3).
//
// THE SEAM RUNS PER STRING ON THE TREE, NEVER ON A SERIALIZED BLOB. A restored value can contain a
// quote, a backslash or a newline, so unmasking a JSON string would produce bytes that no longer
// parse — and a route that then re-parsed them would answer a person with a 500 about a run that
// is perfectly fine. These cells pin the walk: every string crosses the host exactly once, numbers
// and booleans and Buffers are handed back untouched, and the caller's object is never mutated.

import { describe, expect, it } from 'vitest'

import type { AgentHost } from '../../chat/host.js'
import { unmaskTreeForDisplay } from '../display-tree.js'

const SCOPE = { runId: 'r_display-tree' }
const MARKER = '␟masked:email␟'

/** A host that restores `<SECRET_0>` to a value and turns `<EMAIL_0>` into a marker. */
function recordingHost(): {
  host: Pick<AgentHost, 'unmaskForDisplay'>
  calls: Array<{ text: string; runId: string | undefined }>
} {
  const calls: Array<{ text: string; runId: string | undefined }> = []
  return {
    calls,
    host: {
      unmaskForDisplay: (text: string, scope?: { runId: string }): string => {
        calls.push({ text, runId: scope?.runId })
        return text.split('<SECRET_0>').join('v').split('<EMAIL_0>').join(MARKER)
      },
    },
  }
}

describe('unmaskTreeForDisplay', () => {
  it('walks every string, leaves scalars and Buffers alone, and never mutates the input', () => {
    const { host, calls } = recordingHost()
    const buffer = Buffer.from('<SECRET_0>')
    const input = {
      a: '<SECRET_0>',
      n: 1,
      b: true,
      nil: null,
      gone: undefined,
      arr: ['<EMAIL_0>', { c: '<SECRET_0>' }],
      buf: buffer,
    }
    const before = JSON.stringify({ ...input, buf: buffer.toString('utf8') })

    const out = unmaskTreeForDisplay(host, input, SCOPE) as typeof input

    expect(out.a).toBe('v')
    expect(out.n).toBe(1)
    expect(out.b).toBe(true)
    expect(out.nil).toBeNull()
    expect(out.arr[0]).toBe(MARKER)
    expect((out.arr[1] as { c: string }).c).toBe('v')
    // THE BUFFER IS THE SAME OBJECT, not a copy and not a decode. Artifact bytes never cross the
    // seam (D-09), and the cheapest way to guarantee that is to hand every Buffer straight back.
    expect(out.buf).toBe(buffer)
    expect(buffer.toString('utf8')).toBe('<SECRET_0>')

    // The caller's tree is untouched — the walk answers with a new one.
    expect(JSON.stringify({ ...input, buf: buffer.toString('utf8') })).toBe(before)
    expect(input.a).toBe('<SECRET_0>')

    // Every string crossed the host exactly once, with this run's scope.
    expect(calls.map((call) => call.text).sort()).toEqual(['<EMAIL_0>', '<SECRET_0>', '<SECRET_0>'])
    for (const call of calls) expect(call.runId).toBe(SCOPE.runId)
  })

  it('passes null, undefined and a bare string through the same walk', () => {
    const { host } = recordingHost()
    expect(unmaskTreeForDisplay(host, null, SCOPE)).toBeNull()
    expect(unmaskTreeForDisplay(host, undefined, SCOPE)).toBeUndefined()
    expect(unmaskTreeForDisplay(host, '<SECRET_0>', SCOPE)).toBe('v')
    expect(unmaskTreeForDisplay(host, 7, SCOPE)).toBe(7)
  })
})
