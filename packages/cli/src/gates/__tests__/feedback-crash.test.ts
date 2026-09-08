import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createFeedbackPortForHost } from '../feedback-host.js'
import { markFixture, files } from './feedback-fixture.js'

it('recovers a killed real host after freeze with stable gold and exactly one receipt', async () => {
  const f = markFixture()
  const ready = join(f.root, 'child-ready.json')
  const child = spawn(process.execPath, ['--experimental-transform-types',
    fileURLToPath(new URL('./fixtures/mark-crash-child.mjs', import.meta.url)),
    JSON.stringify({ configPath: f.configPath, agentQaRoot: f.agentQaRoot, runId: f.handoff.runId, ready })],
  { stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', bytes => { output += String(bytes) })
  child.stderr.on('data', bytes => { output += String(bytes) })
  const closed = new Promise<void>(resolve => child.on('close', () => resolve()))
  const hashes = () => files(join(f.root, 'agent-qa-eval')).map(path => [path,
    createHash('sha256').update(readFileSync(path)).digest('hex')])
  try {
    const deadline = Date.now() + 15_000
    while (!existsSync(ready) && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
    expect(existsSync(ready), output).toBe(true)
    const before = hashes()
    expect(before.length).toBeGreaterThan(0)
    child.kill('SIGKILL'); await closed
    const result = await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'false-fail' })
    expect(result).toMatchObject({ kind: 'marked', receipt: { ordinal: 1, evidence: { confirmed: 1 } } })
    expect(hashes()).toEqual(before)
    expect(readFileSync(join(f.runDir, 'marks.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId, kind: 'false-fail' }))
      .toMatchObject({ kind: 'already-marked' })
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
    rmSync(f.root, { recursive: true, force: true })
  }
}, 30_000)
