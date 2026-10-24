// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { RunEvidenceRead } from '@/lib/api'
import type { EvidenceKind } from '@vostride/agent-qa-schema'

const { fetchRecords } = vi.hoisted(() => ({ fetchRecords: vi.fn() }))
vi.mock('@/lib/api', () => ({ fetchRunEvidence: fetchRecords }))
const modules = import.meta.glob('../use-evidence-records.ts')
const key = { runId: 'run_test', testIndex: 0, stepIndex: 0, kind: 'a11y' as const }
type Key = Omit<typeof key, 'kind'> & { kind: EvidenceKind; subActionIndex?: number }
type Hook = (key: Key | null, enabled: boolean) => { read: 'idle' | 'loading' | RunEvidenceRead; retry: () => void }
let container: HTMLDivElement
let root: Root
let useRecords: Hook
let current: ReturnType<Hook>
function Probe({ address, enabled }: { address: Key | null; enabled: boolean }) {
  current = useRecords(address, enabled)
  return <span>{JSON.stringify(current.read)}</span>
}
async function load() {
  const loader = modules['../use-evidence-records.ts']
  expect(loader, 'the keyed evidence hook must exist').toBeTypeOf('function')
  const module = await loader() as { useEvidenceRecords: Hook; EVIDENCE_FETCH_DEBOUNCE_MS: number }
  expect(module.EVIDENCE_FETCH_DEBOUNCE_MS).toBe(250)
  useRecords = module.useEvidenceRecords
}
async function render(address: Key | null = key, enabled = true) {
  await act(async () => { root.render(<Probe address={address} enabled={enabled} />) })
}
async function tick(ms = 250) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
beforeEach(() => {
  vi.useFakeTimers()
  fetchRecords.mockReset().mockResolvedValue({ kind: 'failed', error: 'offline' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('RECORDS-DEBOUNCED waits 250 ms trailing and ignores equivalent key objects', async () => {
  await load()
  await render()
  expect(current.read).toBe('loading')
  await tick(249)
  expect(fetchRecords).not.toHaveBeenCalled()
  await render({ ...key, stepIndex: 1 })
  await tick(249)
  expect(fetchRecords).not.toHaveBeenCalled()
  await render({ ...key, stepIndex: 1 })
  await tick(1)
  expect(fetchRecords).toHaveBeenCalledExactlyOnceWith({ ...key, stepIndex: 1 })
  await render(null)
  expect(current.read).toBe('idle')
  await render(key, false)
  await tick()
  expect(fetchRecords).toHaveBeenCalledTimes(1)
})

it('RECORDS-STALE-DISCARDED rejects an old address response and clears it during debounce', async () => {
  await load()
  let resolveOld!: (read: RunEvidenceRead) => void
  fetchRecords.mockImplementationOnce(() => new Promise<RunEvidenceRead>(resolve => { resolveOld = resolve }))
  await render()
  await tick()
  await render({ ...key, stepIndex: 1 })
  await act(async () => { resolveOld({ kind: 'failed', error: 'old response' }) })
  expect(current.read).toBe('loading')
  await tick()
  expect(current.read).toEqual({ kind: 'failed', error: 'offline' })
  await render({ ...key, runId: 'run_other' })
  expect(current.read).toBe('loading')
  await render({ ...key, stepIndex: 1 })
  expect(current.read).toBe('loading')
})

it('RECORDS-RETRY reissues the current key after a rejected client read', async () => {
  await load()
  fetchRecords.mockRejectedValueOnce(new Error('client broke'))
  await render()
  await tick()
  expect(current.read).toEqual({ kind: 'failed', error: 'client broke' })
  await act(async () => { current.retry() })
  expect(current.read).toBe('loading')
  await tick()
  expect(fetchRecords).toHaveBeenCalledTimes(2)
  expect(fetchRecords).toHaveBeenLastCalledWith(key)
  expect(current.read).toEqual({ kind: 'failed', error: 'offline' })
})

it('RECORDS-KEY covers member, kind and sub-action changes and disable/re-enable', async () => {
  await load()
  for (const address of [key, { ...key, testIndex: 1 }, { ...key, kind: 'aria' as const, subActionIndex: 0 },
    { ...key, kind: 'aria' as const, subActionIndex: 1 }]) {
    await render(address)
    expect(current.read).toBe('loading')
    await tick()
    expect(fetchRecords).toHaveBeenLastCalledWith(address)
  }
  await render(key, false)
  expect(current.read).toBe('idle')
  await render(key)
  expect(current.read).toBe('loading')
  await tick()
  expect(fetchRecords).toHaveBeenCalledTimes(5)
})
