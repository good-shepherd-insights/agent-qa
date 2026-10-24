import { describe, expect, it } from 'vitest'

import {
  getActiveExecutionContext,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from '../execution-context'

describe('resolveExecutionContext', () => {
  it.each([
    [{ isTty: false, ciMarkers: true }, 'ci'],
    [{ isTty: true, ciMarkers: true }, 'ci'],
    [{ isTty: true, ciMarkers: false }, 'local-interactive'],
    [{ isTty: false, ciMarkers: false }, 'local-headless'],
  ] as const)('resolves %o to %s', (signals, expected) => {
    expect(resolveExecutionContext(signals)).toBe(expected)
  })

  it.each([
    [{ isTty: true, ciMarkers: true }, 'cloud', 'cloud'],
    [{ isTty: false, ciMarkers: false }, 'local-interactive', 'local-interactive'],
  ] as const)('lets override %s win over %o', (signals, override, expected) => {
    expect(resolveExecutionContext(signals, override)).toBe(expected)
  })

  it('does not resolve cloud without an explicit override', () => {
    const contexts = [
      resolveExecutionContext({ isTty: false, ciMarkers: true }),
      resolveExecutionContext({ isTty: true, ciMarkers: true }),
      resolveExecutionContext({ isTty: true, ciMarkers: false }),
      resolveExecutionContext({ isTty: false, ciMarkers: false }),
    ]

    expect(contexts).not.toContain('cloud')
  })
})

describe('active execution context resolver', () => {
  it('defaults to local-headless before an adapter installs a resolver', () => {
    expect(getActiveExecutionContext()).toBe('local-headless')
  })

  it('uses the installed resolver', () => {
    setActiveExecutionContextResolver(() => 'ci')

    expect(getActiveExecutionContext()).toBe('ci')

    setActiveExecutionContextResolver(() => 'local-headless')
  })
})
