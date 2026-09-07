import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asRecordId } from '@vostride/agent-qa-schema'
import * as host from '../replay-gate-host.js'
import * as session from '../../eval-session-composition.js'

afterEach(() => vi.restoreAllMocks())

describe('417 production replay gate binding', () => {
  it.each([
    'composition/local-agent-host.ts',
    'daemon/host.ts',
    'commands/doctor-knowledge-checks.ts',
  ])('binds exactly once in %s', (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    expect(source.match(/createReplayGatePortForHost\(/g)).toHaveLength(1)
  })

  it('keeps the post-run job slot unbound and the tail independent of the bridge', () => {
    function files(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.name === '__tests__'
          ? []
          : entry.isDirectory()
            ? files(join(dir, entry.name))
            : entry.name.endsWith('.ts')
              ? [join(dir, entry.name)]
              : [],
      )
    }
    const roots = ['../../', '../../../../agent-local/src/'].map((path) =>
      fileURLToPath(new URL(path, import.meta.url)),
    )
    expect(
      roots.flatMap(files).filter((file) => /runReplayGate:/.test(readFileSync(file, 'utf8'))),
    ).toEqual([])
    expect(
      readFileSync(new URL('../../curation/post-run-tail.ts', import.meta.url), 'utf8'),
    ).not.toContain('replay-gate-host')
  })

  it('constructs without session IO, then lazily resolves a key-only session and preserves the host runtime root', async () => {
    const resolved = {} as session.EvalSession
    const resolveSession = vi.spyOn(session, 'resolveEvalSession').mockResolvedValue(resolved)
    const run = vi.spyOn(session, 'runReplayGateVerb').mockResolvedValue({
      kind: 'refused',
      refusal: { path: '/fixture', reason: 'no-floor' },
      notices: [],
      exit: 2,
      maxScreens: 64,
      maxScreensSource: 'default',
      k: 3,
      kSource: 'default',
    })
    expect(host).toHaveProperty('createReplayGatePortForHost')
    const factory = Reflect.get(host, 'createReplayGatePortForHost')
    const port = factory({ configPath: '/fixture/config.yaml', agentQaRoot: '/runtime/custom' })
    expect(resolveSession).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    await expect(port.runReplayGate(asRecordId('candidate'))).rejects.toThrow('no-floor')
    expect(resolveSession).toHaveBeenCalledWith({
      configPath: '/fixture/config.yaml',
      keyOnly: true,
    })
    expect(run).toHaveBeenCalledWith(resolved, 'candidate', {
      agentQaRoot: '/runtime/custom',
      onProgress: expect.any(Function),
    })
    const receipt = { gate: 1 }
    run.mockResolvedValueOnce({ kind: 'receipt', receipt } as session.ReplayGateVerbResult)
    expect(await port.runReplayGate(asRecordId('candidate'))).toBe(receipt)
  })
})
