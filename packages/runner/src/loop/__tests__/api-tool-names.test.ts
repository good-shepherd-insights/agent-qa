import { describe, expect, it } from 'vitest'

import {
  API_TOOL_NAME_MAX_LENGTH,
  API_TOOL_NAME_PATTERN,
  bindApiToolNames,
  type LogicalToolNameInput,
} from '../api-tool-names.js'

function project(
  bindings: ReturnType<typeof bindApiToolNames<string>>,
): Record<string, string> {
  return Object.fromEntries(
    bindings.map(({ kind, logicalName, apiName }) => [`${kind}:${logicalName}`, apiName]),
  )
}

describe('bindApiToolNames', () => {
  it('preserves safe action ids and aliases dotted production memory ids', () => {
    const bindings = bindApiToolNames([
      { kind: 'action', logicalName: 'web_click', value: 'click' },
      { kind: 'non-action', logicalName: 'memory.search', value: 'search' },
      { kind: 'non-action', logicalName: 'memory.read', value: 'read' },
    ])

    expect(bindings[0]?.apiName).toBe('web_click')
    expect(bindings[1]?.apiName).not.toBe('memory.search')
    expect(bindings[2]?.apiName).not.toBe('memory.read')
    for (const { apiName } of bindings) {
      expect(apiName).toMatch(API_TOOL_NAME_PATTERN)
      expect(apiName.length).toBeLessThanOrEqual(API_TOOL_NAME_MAX_LENGTH)
    }
  })

  it('deterministically separates sanitized, action-name, exact-name, and length collisions', () => {
    const longName = `memory.${'segment.'.repeat(16)}read`
    const inputs: LogicalToolNameInput<string>[] = [
      { kind: 'action', logicalName: 'memory_search', value: 'action' },
      { kind: 'non-action', logicalName: 'memory.search', value: 'dot' },
      { kind: 'non-action', logicalName: 'memory/search', value: 'slash' },
      { kind: 'non-action', logicalName: 'memory_search', value: 'exact' },
      { kind: 'non-action', logicalName: longName, value: 'long' },
    ]

    const forward = bindApiToolNames(inputs)
    const reverse = bindApiToolNames([...inputs].reverse())
    const apiNames = forward.map(({ apiName }) => apiName)

    expect(project(forward)).toEqual(project(reverse))
    expect(forward[0]?.apiName).toBe('memory_search')
    expect(new Set(apiNames).size).toBe(apiNames.length)
    for (const apiName of apiNames) {
      expect(apiName).toMatch(API_TOOL_NAME_PATTERN)
      expect(apiName.length).toBeLessThanOrEqual(API_TOOL_NAME_MAX_LENGTH)
    }
  })
})
