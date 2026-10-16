import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config.js', () => ({
  resolveConfig: vi.fn().mockResolvedValue({}),
}))

import { createQueueCommand } from '../queue.js'

const RUN_ID = 'run-442-05'
const REFUSAL = 'This run belongs to another agent-qa process (pid 4242). Stop it there with Ctrl+C.'
const ORPHAN = 'The process running this run (pid 4242) ended before it finished.'

let answer: { status: number; body: unknown }
let asked: string[]
let server: Server
let origin: string

beforeEach(async () => {
  asked = []
  server = createServer((req, res) => {
    asked.push(`${req.method ?? ''} ${req.url ?? ''}`)
    res.writeHead(answer.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(answer.body))
  })
  await new Promise<void>((settle) => { server.listen(0, '127.0.0.1', settle) })
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  vi.restoreAllMocks()
  await new Promise<void>((settle) => { server.close(() => { settle() }) })
})

interface CancelResult {
  readonly exits: Array<number | string | null | undefined>
  readonly printed: string
}

async function cancelWith(status: number, body: unknown): Promise<CancelResult> {
  answer = { status, body }
  const exits: CancelResult['exits'] = []
  vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
    exits.push(code)
  }) as never)
  const lines: string[] = []
  const record = (...args: unknown[]): void => { lines.push(args.map(String).join(' ')) }
  vi.spyOn(console, 'log').mockImplementation(record)
  vi.spyOn(console, 'error').mockImplementation(record)
  const program = new Command('agent-qa').exitOverride()
  program.addCommand(createQueueCommand())
  await program.parseAsync(['node', 'agent-qa', 'queue', 'cancel', RUN_ID, '--server', origin])
  vi.restoreAllMocks()
  expect(asked).toEqual([`POST /api/runs/${RUN_ID}/cancel`])
  return { exits, printed: lines.join('\n') }
}

describe('C442-CANCEL-SENTENCE', () => {
  it('queue cancel prints a refusal and exits non-zero', async () => {
    const refused = await cancelWith(409, {
      error: REFUSAL,
      reason: 'owned-by-live-process',
      ownerPid: 4242,
    })
    expect(refused.printed).toContain(REFUSAL)
    expect(refused.printed).not.toContain('Cancelled job')
    expect(refused.exits).toEqual([1])

    asked = []
    const missing = await cancelWith(404, { error: 'Run not found or not cancellable' })
    expect(missing.printed).toContain(`Job not found: ${RUN_ID}`)
    expect(missing.exits).toEqual([1])

    asked = []
    const unavailable = await cancelWith(503, { error: 'Queue not available' })
    expect(unavailable.printed).toContain('Queue not available')
    expect(unavailable.exits).toEqual([1])
  })

  it('queue cancel exits zero when the run was cancelled or finalized as an orphan', async () => {
    const cancelled = await cancelWith(200, { cancelled: true })
    expect(cancelled.printed).toContain(`Cancelled job ${RUN_ID}`)
    expect(cancelled.exits).toEqual([])

    asked = []
    const orphan = await cancelWith(200, { cancelled: false, message: ORPHAN })
    expect(orphan.printed).toContain(ORPHAN)
    expect(orphan.printed).not.toContain('Failed to cancel')
    expect(orphan.exits).toEqual([])
  })
})

interface StreamsResult {
  readonly exits: Array<number | string | null | undefined>
  readonly stdout: string
  readonly stderr: string
  readonly asked: string[]
}

async function cancelApart(runId: string, status: number, body: unknown): Promise<StreamsResult> {
  answer = { status, body }
  asked = []
  const exits: StreamsResult['exits'] = []
  vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
    exits.push(code)
  }) as never)
  const out: string[] = []
  const err: string[] = []
  const into = (lines: string[]) => (...args: unknown[]): void => {
    lines.push(args.map(String).join(' '))
  }
  vi.spyOn(console, 'log').mockImplementation(into(out))
  vi.spyOn(console, 'error').mockImplementation(into(err))
  const program = new Command('agent-qa').exitOverride()
  program.addCommand(createQueueCommand())
  await program.parseAsync(['node', 'agent-qa', 'queue', 'cancel', runId, '--server', origin])
  vi.restoreAllMocks()
  return { exits, stdout: out.join('\n'), stderr: err.join('\n'), asked: [...asked] }
}

describe('C442-QUEUE-CANCEL-OUTPUT', () => {
  it('queue cancel prints a refusal to stderr and exits 1, and an orphan answer to stdout with exit 0', async () => {
    const refused = await cancelApart(RUN_ID, 409, {
      error: REFUSAL,
      reason: 'owned-by-live-process',
      ownerPid: 4242,
    })
    expect(refused.stderr).toContain(REFUSAL)
    expect(refused.stdout).toBe('')
    expect(refused.exits).toEqual([1])

    const missing = await cancelApart(RUN_ID, 404, { error: 'Run not found or not cancellable' })
    expect(missing.stderr).toContain(`Job not found: ${RUN_ID}`)
    expect(missing.stdout).toBe('')
    expect(missing.exits).toEqual([1])

    const orphan = await cancelApart(RUN_ID, 200, { cancelled: false, message: ORPHAN })
    expect(orphan.stdout).toBe(ORPHAN)
    expect(orphan.stderr).toBe('')
    expect(orphan.exits).toEqual([])
  })

  it('queue cancel encodes the run id in the URL', async () => {
    const odd = 'run a/b?c'
    const result = await cancelApart(odd, 200, { cancelled: true })
    expect(result.asked).toEqual(['POST /api/runs/run%20a%2Fb%3Fc/cancel'])
    expect(result.stdout).toContain(`Cancelled job ${odd}`)
    expect(result.exits).toEqual([])
  })
})
