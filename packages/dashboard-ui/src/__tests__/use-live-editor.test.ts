// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  syncExternalHooks,
  syncExternalSteps,
  useLiveEditor,
  type EditorStep,
  type LiveHookExecution,
  type UseLiveEditorReturn,
} from '../hooks/use-live-editor'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SETUP_HOOK_ID = 'h_amber-birch-coral-delta-ember-falcon-garden-harbor-island-jungle'
const NEXT_HOOK_ID = 'h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper'

function makeStep(
  id: string,
  instruction: string,
  overrides: Partial<EditorStep> = {},
): EditorStep {
  return {
    id,
    draftId: id,
    instruction,
    status: 'idle',
    phases: [],
    executionHistory: [],
    consoleLogs: [],
    networkLogs: [],
    variableSnapshot: null,
    originalStepName: null,
    liveSubActions: null,
    executionLogs: [],
    executionGeneration: 0,
    ...overrides,
  }
}

function makeHook(
  id: string,
  name: string,
  phase: 'setup' | 'teardown',
  overrides: Partial<LiveHookExecution> = {},
): LiveHookExecution {
  return {
    id,
    name,
    phase,
    status: 'pending',
    stdout: null,
    stderr: null,
    variables: null,
    ...overrides,
  }
}

describe('syncExternalSteps', () => {
  it('preserves step identity and live state across in-place instruction edits', () => {
    const prev = [
      makeStep('step-a', 'Open login page', {
        status: 'passed',
        phases: [{ phase: 'plan', text: 'Use the login route', timestamp: '2026-04-16T00:00:00.000Z' }],
      }),
      makeStep('step-b', 'Enter credentials'),
    ]

    const next = syncExternalSteps(prev, [
      { draftId: 'step-a', instruction: 'Open the login page' },
      { draftId: 'step-b', instruction: 'Enter credentials' },
    ])

    expect(next[0].id).toBe('step-a')
    expect(next[0].draftId).toBe('step-a')
    expect(next[0].instruction).toBe('Open the login page')
    expect(next[0].status).toBe('passed')
    expect(next[0].phases[0]?.text).toBe('Use the login route')
  })

  it('reorders external steps by draft id without dropping step state', () => {
    const prev = [
      makeStep('step-a', 'Open login page', { status: 'passed' }),
      makeStep('step-b', 'Enter credentials', { status: 'failed', error: 'Missing field' }),
    ]

    const next = syncExternalSteps(prev, [
      { draftId: 'step-b', instruction: 'Enter credentials' },
      { draftId: 'step-a', instruction: 'Open login page' },
    ])

    expect(next.map((step) => step.id)).toEqual(['step-b', 'step-a'])
    expect(next[0].status).toBe('failed')
    expect(next[0].error).toBe('Missing field')
    expect(next[1].status).toBe('passed')
  })
})

describe('syncExternalHooks', () => {
  it('preserves hook identity and execution state across hook list refreshes', () => {
    const prev = [
      makeHook(SETUP_HOOK_ID, 'Seed Auth', 'setup', {
        status: 'passed',
        variables: { AUTH_TOKEN: 'hook-token' },
      }),
    ]

    const next = syncExternalHooks(prev, [SETUP_HOOK_ID], 'setup')

    expect(next[0].id).toBe(SETUP_HOOK_ID)
    expect(next[0].name).toBe('Seed Auth')
    expect(next[0].status).toBe('passed')
    expect(next[0].variables?.AUTH_TOKEN).toBe('hook-token')
  })

  it('rebuilds hook rows when the configured hook names change', () => {
    const prev = [
      makeHook(SETUP_HOOK_ID, 'Seed Auth', 'setup', { status: 'passed' }),
    ]

    const next = syncExternalHooks(prev, [NEXT_HOOK_ID], 'setup')

    expect(next).toHaveLength(1)
    expect(next[0].name).toBe(NEXT_HOOK_ID)
    expect(next[0].status).toBe('pending')
    expect(next[0].id).toBe(NEXT_HOOK_ID)
  })
})

// SC1 · D-07: the editor watches through the shared preview, so the hook no longer polls the
// control socket for base64 screenshots. The needles are concatenated so this file cannot match
// itself.
const RETIRED_REQUEST = 'get-' + 'screenshot'
const RETIRED_MEMBERS = ['screen' + 'shot', 'request' + 'Screenshot']
const POLLING_NAMES = ['start' + 'ScreenshotPolling', 'set' + 'Screenshot']

class PollingProbeSocket {
  static instances: PollingProbeSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly sent: Array<Record<string, unknown>> = []
  readyState = 1
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(readonly url: string) {
    PollingProbeSocket.instances.push(this)
  }

  emit(message: Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }

  close(): void {
    this.readyState = 3
    this.onclose?.(new CloseEvent('close'))
  }
}

describe('HOOK-HAS-NO-SCREENSHOT-POLLING', () => {
  let container: HTMLDivElement
  let root: Root
  let originalWebSocket: typeof WebSocket
  const holder: { current: UseLiveEditorReturn | null } = { current: null }

  function Harness() {
    holder.current = useLiveEditor('session-poll', { allowReconnect: false })
    return null
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    originalWebSocket = globalThis.WebSocket
    PollingProbeSocket.instances = []
    globalThis.WebSocket = PollingProbeSocket as unknown as typeof WebSocket
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(createElement(Harness))
    })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    holder.current = null
    globalThis.WebSocket = originalWebSocket
    delete (document as { hidden?: boolean }).hidden
    vi.useRealTimers()
  })

  it('HOOK-HAS-NO-SCREENSHOT-POLLING: a connected session sends no retired request in 10 s', async () => {
    const socket = PollingProbeSocket.instances[0]
    expect(socket).toBeDefined()
    await act(async () => {
      socket.emit({ type: 'session-ready', platform: 'web', interactive: true })
    })
    expect(holder.current?.connectionState).toBe('connected')

    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })

    expect(socket.sent.filter((message) => message.type === RETIRED_REQUEST)).toEqual([])
  })

  it('HOOK-HAS-NO-SCREENSHOT-POLLING: the return has no screenshot and no requestScreenshot', () => {
    const editor = holder.current
    expect(editor).not.toBeNull()
    for (const member of RETIRED_MEMBERS) {
      expect(Object.keys(editor ?? {})).not.toContain(member)
    }
  })

  it("HOOK-HAS-NO-SCREENSHOT-POLLING: the hook's source names no polling function or retired message", () => {
    const source = readFileSync(resolve(process.cwd(), 'src/hooks/use-live-editor.ts'), 'utf8')
    for (const needle of [...POLLING_NAMES, RETIRED_REQUEST]) {
      expect(source).not.toContain(needle)
    }
  })
})
