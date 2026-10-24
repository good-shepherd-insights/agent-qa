import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectExecutionContext, readSignals } from '../execution-context-detector'

const isProcessTty = Boolean(process.stdout?.isTTY) && Boolean(process.stdin?.isTTY)

describe('readSignals', () => {
  it.each([
    [{ CI: 'true' }, true],
    [{ GITHUB_ACTIONS: 'true' }, true],
    [{ CI: 'false' }, false],
    [{ CI: '0' }, false],
    [{ CI: '' }, false],
    [{}, false],
  ] as const)('reads CI markers from %o', (env, expectedCiMarkers) => {
    expect(readSignals(env)).toEqual({
      isTty: isProcessTty,
      ciMarkers: expectedCiMarkers,
    })
  })
})

describe('detectExecutionContext', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('delegates CI signal resolution to the safety resolver', () => {
    vi.stubEnv('CI', 'true')

    expect(detectExecutionContext()).toBe('ci')
  })

  it('lets explicit overrides pass through the safety resolver', () => {
    vi.stubEnv('CI', 'false')

    expect(detectExecutionContext('cloud')).toBe('cloud')
  })
})
