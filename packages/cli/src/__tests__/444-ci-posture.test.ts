// 2026-10-18 (444-14, D-42): the CLI's CI posture, as functions of a plain environment.

import { describe, expect, it } from 'vitest'

type ApplyColorPosture = (env: NodeJS.ProcessEnv, stdoutIsTTY: boolean) => void

// The module applies the posture to this process on load; the worker's own environment is put back.
async function loadColorPosture(): Promise<ApplyColorPosture> {
  const saved = process.env.NO_COLOR
  try {
    return (await import('../color-posture.js')).applyColorPosture
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = saved
  }
}

describe('C444-CI-COLOUR', () => {
  it('the posture turns colour off when stdout is not a terminal', async () => {
    const applyColorPosture = await loadColorPosture()
    const env: NodeJS.ProcessEnv = {}
    applyColorPosture(env, false)
    expect(env).toEqual({ NO_COLOR: '1' })

    const ciEnv: NodeJS.ProcessEnv = { CI: 'true' }
    applyColorPosture(ciEnv, false)
    expect(ciEnv).toEqual({ CI: 'true', NO_COLOR: '1' })
  })

  it('the posture leaves a terminal, FORCE_COLOR and an existing NO_COLOR alone', async () => {
    const applyColorPosture = await loadColorPosture()
    const cases: readonly { env: NodeJS.ProcessEnv; tty: boolean }[] = [
      { env: {}, tty: true },
      { env: { CI: 'true' }, tty: true },
      { env: { FORCE_COLOR: '1' }, tty: false },
      { env: { FORCE_COLOR: '' }, tty: false },
      { env: { NO_COLOR: '' }, tty: false },
      { env: { NO_COLOR: '0' }, tty: false },
      { env: { NO_COLOR: '1', FORCE_COLOR: '1' }, tty: true },
    ]
    for (const { env, tty } of cases) {
      const before = { ...env }
      applyColorPosture(env, tty)
      expect(env, JSON.stringify({ before, tty })).toEqual(before)
    }
  })
})
