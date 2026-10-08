// C436-DOWNLOAD-CAPTURE (436 D-19, D-20) and C436-CLIPBOARD-CAPTURE (436 D-21): real headless
// Chromium downloads and app clipboard writes served from a local fixture, captured on the action
// that produced them.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromium, firefox, webkit } from 'playwright-core'
import type { Download } from 'playwright-core'
import type { ActionResult, RecordingCapability } from '@vostride/agent-qa-runner'
import { screenIdentityHash } from '@vostride/agent-qa-schema'
import type { DownloadEvidence, Ref } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import { CLIPBOARD_BINDING, DOWNLOAD_START_GRACE_MS } from '../operation-capture.js'
import type { CapturedClipboardWrite, OperationCapture } from '../operation-capture.js'

const BLOB_BYTES = 'name,qty\nwidget,3\n'
const DISPOSITION_BYTES = JSON.stringify({ order: 42, lines: ['a', 'b'] })
const POPUP_BYTES = 'second file from the popup\n'

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>download fixture</title></head>
<body>
  <h1>Downloads</h1>
  <button id="blob" onclick="blobDownload('report.csv')">Export CSV</button>
  <a id="cd" href="/files/data">Get data</a>
  <button id="two" onclick="blobDownload('first.csv'); document.getElementById('popup').click()">Export both</button>
  <a id="popup" href="/files/popup" target="_blank" style="display:none">popup</a>
  <a id="slow" href="/files/slow">Get slow file</a>
  <button id="nothing">Do nothing</button>
  <script>
    function blobDownload(name) {
      const blob = new Blob([${JSON.stringify(BLOB_BYTES)}], { type: 'text/csv' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  </script>
</body>
</html>
`

const CLIPBOARD_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>clipboard fixture</title></head>
<body>
  <h1>Order ORDER-4471</h1>
  <button id="write-text" onclick="navigator.clipboard.writeText('ORDER-4471')">Copy order number</button>
  <button id="nothing">Do nothing</button>
  <button id="exec-copy" onclick="copyThroughHandler('INV-2026-0042', false)">Copy invoice number</button>
  <button id="stopped-copy" onclick="copyThroughHandler('TRACK-77-ZZ', true)">Copy tracking code</button>
  <button id="select-copy" onclick="copyBySelection('https://shop.test/orders/42')">Copy order link</button>
  <label>Coupon <input id="coupon"></label>
  <script>
    function copyThroughHandler(text, stop) {
      document.addEventListener('copy', (event) => {
        event.clipboardData.setData('text/plain', text)
        event.preventDefault()
        if (stop) event.stopPropagation()
      }, { once: true })
      document.execCommand('copy')
    }
    function copyBySelection(text) {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.left = '-9999px'
      document.body.append(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
  </script>
</body>
</html>
`

// The proof-clip.mjs shape (CR-01): a page claims a write it never made and polls the clipboard.
const READBACK_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>read-back fixture</title></head>
<body>
  <h1>Read-back</h1>
  <button id="forge" onclick="forge()">Forge claim</button>
  <button id="override" onclick="overrideAndForge()">Forge with override</button>
  <button id="watch" onclick="watchAndWrite()">Copy and watch</button>
  <button id="rejected" onclick="rejectedWrite()">Write rejected item</button>
  <button id="order" onclick="copyOrder()">Copy order number</button>
  <button id="twice" onclick="writeTwice()">Copy twice</button>
  <label>Note <input id="note"></label>
  <button id="focus-watch" onclick="watchFocusAndWrite()">Copy and watch focus</button>
  <button id="second" onclick="navigator.clipboard.writeText('ORDER-4472')">Copy second order</button>
  <script>
    window.reads = []
    window.states = []
    window.pollDone = false
    window.reports = 0
    const binding = ${JSON.stringify(CLIPBOARD_BINDING)}
    const claim = (text) => window[binding]({ via: 'writeText', text })
    function countReports() {
      const send = window[binding]
      window[binding] = function () { window.reports += 1; return send.apply(this, arguments) }
    }
    function rejectedWrite() {
      const item = new ClipboardItem({
        'text/plain': new Blob(['REJECTED-1'], { type: 'text/plain' }),
        'application/x-agent-qa-unsupported': new Blob(['x'], { type: 'application/x-agent-qa-unsupported' }),
      })
      navigator.clipboard.write([item]).then(() => { window.writeOutcome = 'resolved' }, () => { window.writeOutcome = 'rejected' })
    }
    function copyOrder() {
      countReports()
      navigator.clipboard.writeText('ORDER-4471')
      window.reportedInline = window.reports
    }
    function writeTwice() {
      navigator.clipboard.writeText('A')
      navigator.clipboard.writeText('B')
    }
    window.focusEvents = []
    function watchFocusAndWrite() {
      for (const [name, target] of [['window', window], ['document', document]]) {
        for (const type of ['blur', 'focus', 'focusout', 'visibilitychange']) {
          target.addEventListener(type, () => { window.focusEvents.push(name + ':' + type) }, true)
        }
      }
      navigator.clipboard.writeText('ORDER-4471')
    }
    function forge() {
      claim('forged')
      const end = Date.now() + 1000
      const timer = setInterval(() => {
        if (Date.now() > end) { clearInterval(timer); window.pollDone = true; return }
        navigator.clipboard.readText().then((text) => { window.reads.push(text) }, () => {})
      }, 5)
    }
    function overrideAndForge() {
      Clipboard.prototype.readText = function () { return Promise.resolve('forged') }
      claim('forged')
    }
    function watchAndWrite() {
      const end = Date.now() + 1500
      const timer = setInterval(() => {
        if (Date.now() > end) { clearInterval(timer); window.pollDone = true; return }
        navigator.permissions.query({ name: 'clipboard-read' }).then((s) => { window.states.push(s.state) }, () => {})
      }, 10)
      navigator.clipboard.writeText('ORDER-4471')
    }
  </script>
</body>
</html>
`

const INSECURE_ORIGIN = 'http://fixture.test'

let server: Server
let baseUrl: string
const openSlowResponses = new Set<import('node:http').ServerResponse>()

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/files/data') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="order-42.json"',
        'Content-Length': Buffer.byteLength(DISPOSITION_BYTES),
      })
      res.end(DISPOSITION_BYTES)
      return
    }
    if (url === '/files/popup') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="second.txt"',
        'Content-Length': Buffer.byteLength(POPUP_BYTES),
      })
      res.end(POPUP_BYTES)
      return
    }
    if (url === '/files/slow') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="never-ends.bin"',
      })
      res.write(Buffer.alloc(1024, 1))
      openSlowResponses.add(res)
      res.on('close', () => openSlowResponses.delete(res))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(url === '/clipboard' ? CLIPBOARD_PAGE : url === '/readback' ? READBACK_PAGE : PAGE)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  baseUrl = `http://localhost:${String((server.address() as AddressInfo).port)}/`
})

afterAll(async () => {
  for (const res of openSlowResponses) res.destroy()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

let adapter: WebPlatformAdapter | undefined

afterEach(async () => {
  await adapter?.cleanup()
  adapter = undefined
  for (const res of openSlowResponses) res.destroy()
}, 60_000)

async function open(stepTimeoutMs?: number, videoDir?: string, path = ''): Promise<WebPlatformAdapter> {
  const created = new WebPlatformAdapter()
  try {
    await created.setup({
      platform: 'web',
      browser: { name: 'chromium', headless: true },
      ...(stepTimeoutMs !== undefined ? { timeouts: { step: stepTimeoutMs } } : {}),
      ...(videoDir !== undefined ? { recording: { enabled: true, videoDir } } : {}),
    })
  } catch (error) {
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', { cause: error })
  }
  adapter = created
  await created.getPage()!.goto(baseUrl + path)
  return created
}

async function refFor(target: WebPlatformAdapter, role: string, name: string): Promise<Ref> {
  const element = (await target.observe()).elements.find((e) => e.role === role && e.name === name)
  expect(element, `${role} "${name}" is on the fixture page`).toBeDefined()
  return element!.ref
}

function downloadsOf(result: ActionResult): DownloadEvidence[] | undefined {
  return result.metadata?.['download'] as DownloadEvidence[] | undefined
}

describe('C436-DOWNLOAD-CAPTURE', () => {
  it('a blob download is recorded on the click that started it', async () => {
    const web = await open()
    const ref = await refFor(web, 'button', 'Export CSV')
    const before = screenIdentityHash(await web.observe())
    const result = await web.execute({ type: 'click', ref })
    const after = screenIdentityHash(await web.observe())

    expect(result.success).toBe(true)
    expect(downloadsOf(result)).toEqual([
      {
        suggestedFilename: 'report.csv',
        extension: '.csv',
        size: Buffer.byteLength(BLOB_BYTES),
        sha256: sha256(BLOB_BYTES),
        state: 'completed',
      },
    ])
    expect(after).toBe(before)
  }, 60_000)

  it('a Content-Disposition download is recorded the same way', async () => {
    const web = await open()
    const ref = await refFor(web, 'link', 'Get data')
    const result = await web.execute({ type: 'click', ref })

    expect(result.success).toBe(true)
    expect(downloadsOf(result)).toEqual([
      {
        suggestedFilename: 'order-42.json',
        extension: '.json',
        size: Buffer.byteLength(DISPOSITION_BYTES),
        sha256: sha256(DISPOSITION_BYTES),
        state: 'completed',
      },
    ])
  }, 60_000)

  it('two downloads from one click are recorded in start order', async () => {
    const web = await open()
    const ref = await refFor(web, 'button', 'Export both')
    const result = await web.execute({ type: 'click', ref })

    const downloads = downloadsOf(result)
    expect(downloads?.map((d) => [d.suggestedFilename, d.state])).toEqual([
      ['first.csv', 'completed'],
      ['second.txt', 'completed'],
    ])
    expect(downloads?.[0]?.sha256).toBe(sha256(BLOB_BYTES))
    expect(downloads?.[1]?.sha256).toBe(sha256(POPUP_BYTES))
    expect(downloads?.[1]?.size).toBe(Buffer.byteLength(POPUP_BYTES))
  }, 60_000)

  it('a canceled download is recorded canceled and has no digest', async () => {
    const web = await open()
    const ref = await refFor(web, 'link', 'Get slow file')
    web.getPage()!.on('download', (download) => { void download.cancel() })
    const result = await web.execute({ type: 'click', ref })

    const [download] = downloadsOf(result) ?? []
    expect(download).toMatchObject({
      suggestedFilename: 'never-ends.bin',
      extension: '.bin',
      state: 'canceled',
    })
    expect(download).not.toHaveProperty('sha256')
    expect(download).not.toHaveProperty('size')
  }, 60_000)

  it('a download that never finishes is recorded unfinished within the step timeout', async () => {
    const web = await open(1_500)
    const ref = await refFor(web, 'link', 'Get slow file')
    const started = Date.now()
    const result = await web.execute({ type: 'click', ref })

    expect(Date.now() - started).toBeLessThan(10_000)
    expect(downloadsOf(result)).toEqual([
      { suggestedFilename: 'never-ends.bin', extension: '.bin', state: 'unfinished' },
    ])
  }, 60_000)

  it('the downloaded file no longer exists after capture', async () => {
    const web = await open()
    const ref = await refFor(web, 'button', 'Export CSV')
    const seen: Promise<string>[] = []
    web.getPage()!.on('download', (download: Download) => { seen.push(download.path()) })
    const result = await web.execute({ type: 'click', ref })

    expect(seen).toHaveLength(1)
    const path = await seen[0]!
    expect(path.length).toBeGreaterThan(0)
    expect(existsSync(path)).toBe(false)
    const [download] = downloadsOf(result) ?? []
    expect(Object.keys(download ?? {}).sort()).toEqual(['extension', 'sha256', 'size', 'state', 'suggestedFilename'])
    expect(JSON.stringify(result.metadata)).not.toContain(path)
    expect(JSON.stringify(result.metadata)).not.toContain('widget')
  }, 60_000)

  it('an action that starts no download carries no download metadata', async () => {
    const web = await open()
    const ref = await refFor(web, 'button', 'Do nothing')
    const started = performance.now()
    const result = await web.execute({ type: 'click', ref })
    const elapsed = performance.now() - started

    expect(result.success).toBe(true)
    expect(result.metadata?.['download']).toBeUndefined()
    expect(elapsed).toBeGreaterThanOrEqual(DOWNLOAD_START_GRACE_MS - 5)
    console.info(`[C436-DOWNLOAD-CAPTURE] click with no download took ${elapsed.toFixed(0)} ms (grace ${String(DOWNLOAD_START_GRACE_MS)} ms)`)
  }, 60_000)

  it('a non-activation action does not wait for a download', async () => {
    const web = await open()
    const started = performance.now()
    const result = await web.execute({ type: 'delay', ms: 0 })
    expect(result.success).toBe(true)
    expect(performance.now() - started).toBeLessThan(DOWNLOAD_START_GRACE_MS)
    expect(result.metadata?.['download']).toBeUndefined()
  }, 60_000)
})

// The recording witness is the action's execution interval (424). The download-start grace
// follows the action (436-10), so it must not stretch the interval the player paints and seeks.
describe('C436-DOWNLOAD-CAPTURE recording witness', () => {
  let videoDir: string | undefined

  afterEach(async () => {
    await adapter?.cleanup()
    adapter = undefined
    if (videoDir) await rm(videoDir, { recursive: true, force: true })
    videoDir = undefined
  }, 60_000)

  async function recorded(): Promise<{ web: WebPlatformAdapter; recording: RecordingCapability }> {
    videoDir = await mkdtemp(join(tmpdir(), 'agent-qa-436-witness-'))
    const web = await open(undefined, videoDir)
    const recording = web.recording
    expect(recording, 'a recording-enabled Chromium adapter exposes recording').toBeDefined()
    await recording!.start()
    await web.getPage()!.waitForTimeout(350)
    return { web, recording: recording! }
  }

  it('a click that starts no download is recorded for the click, not the grace after it', async () => {
    const { web, recording } = await recorded()
    const ref = await refFor(web, 'button', 'Do nothing')
    const finish = recording.beginAnnotation?.()
    expect(finish).toBeTypeOf('function')
    const started = performance.now()
    const result = await web.execute({ type: 'click', ref })
    const elapsed = performance.now() - started
    const witness = finish!()

    expect(result.success).toBe(true)
    expect(elapsed).toBeGreaterThanOrEqual(DOWNLOAD_START_GRACE_MS - 5)
    expect(witness).toMatchObject({ scene: 'recorded-page', transform: 'identity' })
    expect(witness!.endMs - witness!.startMs).toBeLessThan(elapsed - DOWNLOAD_START_GRACE_MS + 25)
  }, 60_000)

  it('an earlier action ending never ends a later interval', async () => {
    const { web, recording } = await recorded()
    const ref = await refFor(web, 'button', 'Do nothing')
    const first = recording.beginAnnotation?.()
    await web.execute({ type: 'click', ref })
    expect(first?.()).toBeDefined()
    const second = recording.beginAnnotation?.()
    await web.getPage()!.waitForTimeout(120)
    const witness = second?.()

    expect(witness).toBeDefined()
    expect(witness!.endMs - witness!.startMs).toBeGreaterThanOrEqual(100)
  }, 60_000)

  it('a click that starts a download keeps both its evidence and its recorded interval', async () => {
    const { web, recording } = await recorded()
    const ref = await refFor(web, 'button', 'Export CSV')
    const finish = recording.beginAnnotation?.()
    const result = await web.execute({ type: 'click', ref })
    const witness = finish?.()

    expect(downloadsOf(result)?.map((download) => download.state)).toEqual(['completed'])
    expect(witness).toMatchObject({ scene: 'recorded-page', transform: 'identity' })
    expect(witness!.endMs).toBeGreaterThan(witness!.startMs)
  }, 60_000)
})

function clipboardOf(result: ActionResult): CapturedClipboardWrite[] | undefined {
  return result.metadata?.['clipboard'] as CapturedClipboardWrite[] | undefined
}

function captureOf(web: WebPlatformAdapter): OperationCapture {
  return (web as unknown as { operationCapture: OperationCapture }).operationCapture
}

async function permission(web: WebPlatformAdapter, name: string): Promise<string> {
  return web.getPage()!.evaluate(`navigator.permissions.query({ name: ${JSON.stringify(name)} }).then((status) => status.state)`)
}

describe('C436-CLIPBOARD-CAPTURE', () => {
  it('an app writeText during a click is captured and read back', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const ref = await refFor(web, 'button', 'Copy order number')
    const before = screenIdentityHash(await web.observe())
    const result = await web.execute({ type: 'click', ref })
    const after = screenIdentityHash(await web.observe())

    expect(result.success).toBe(true)
    expect(clipboardOf(result)).toEqual([{ source: 'writeText', text: 'ORDER-4471', readBack: 'matched' }])
    expect(result.metadata?.['download']).toBeUndefined()
    expect(after).toBe(before)
  }, 60_000)

  it('a click that writes nothing reads nothing', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const ref = await refFor(web, 'button', 'Do nothing')
    const readPath = vi.spyOn(captureOf(web) as unknown as { readClipboard: () => Promise<unknown> }, 'readClipboard')
    const grants = vi.spyOn(web.getPage()!.context(), 'grantPermissions')
    const result = await web.execute({ type: 'click', ref })

    expect(result.success).toBe(true)
    expect(result.metadata?.['clipboard']).toBeUndefined()
    expect(readPath).not.toHaveBeenCalled()
    expect(grants).not.toHaveBeenCalled()
  }, 60_000)

  it('clipboard-read is not granted after the read-back', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const ref = await refFor(web, 'button', 'Copy order number')
    const readPath = vi.spyOn(captureOf(web) as unknown as { readClipboard: () => Promise<unknown> }, 'readClipboard')
    expect(await permission(web, 'clipboard-read')).not.toBe('granted')
    const result = await web.execute({ type: 'click', ref })

    expect(readPath).toHaveBeenCalledTimes(1)
    expect(clipboardOf(result)?.[0]?.readBack).toBe('matched')
    expect(await permission(web, 'clipboard-read')).not.toBe('granted')
    expect(await permission(web, 'clipboard-write')).toBe('granted')
  }, 60_000)
})

describe('C436-CLIPBOARD-CAPTURE copy events and exclusions', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('an execCommand copy is captured from the copy event', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy invoice number') })

    expect(clipboardOf(result)).toEqual([{ source: 'copy-event', text: 'INV-2026-0042', readBack: 'matched' }])
  }, 60_000)

  it('a copy handler that stops propagation is still captured', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy tracking code') })

    expect(clipboardOf(result)?.[0]?.text).toBe('TRACK-77-ZZ')
    expect(clipboardOf(result)).toEqual([{ source: 'copy-event', text: 'TRACK-77-ZZ', readBack: 'matched' }])
  }, 60_000)

  it('a select-and-execCommand copy is captured from the selection', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy order link') })

    expect(clipboardOf(result)?.[0]?.text).toBe('https://shop.test/orders/42')
    expect(clipboardOf(result)).toEqual([
      { source: 'copy-event', text: 'https://shop.test/orders/42', readBack: 'matched' },
    ])
  }, 60_000)

  it("agent-qa's own copy action records no app clipboard evidence", async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const ref = await refFor(web, 'heading', 'Order ORDER-4471')
    const seen = vi.spyOn(captureOf(web) as unknown as { onClipboardWrite: () => void }, 'onClipboardWrite')
    const result = await web.execute({ type: 'copy', ref })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ copied: 'Order ORDER-4471' })
    expect(seen).toHaveBeenCalled()
    expect(result.metadata?.['clipboard']).toBeUndefined()
  }, 60_000)

  it("agent-qa's own paste action records none", async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const result = await web.execute({ type: 'paste', ref: await refFor(web, 'textbox', 'Coupon'), value: 'SAVE10' })

    expect(result.success).toBe(true)
    expect(result.metadata?.['clipboard']).toBeUndefined()
  }, 60_000)

  it('a non-secure page records readBack unavailable', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    const page = web.getPage()!
    await page.route(`${INSECURE_ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html', body: CLIPBOARD_PAGE }))
    await page.goto(`${INSECURE_ORIGIN}/clipboard`)
    expect(await page.evaluate('window.isSecureContext')).toBe(false)
    const grants = vi.spyOn(page.context(), 'grantPermissions')

    const copied = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy order link') })
    expect(clipboardOf(copied)?.[0]?.readBack).toBe('unavailable')
    expect(clipboardOf(copied)).toEqual([
      { source: 'copy-event', text: 'https://shop.test/orders/42', readBack: 'unavailable' },
    ])

    const thrown = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy order number') })
    expect(thrown.metadata?.['clipboard']).toBeUndefined()
    expect(grants).not.toHaveBeenCalled()
  }, 60_000)

  it('the localhost and 127.0.0.1 fixture origins are secure contexts', async () => {
    const web = await open(undefined, undefined, 'clipboard')
    expect(await web.getPage()!.evaluate('window.isSecureContext')).toBe(true)
    await web.getPage()!.goto(baseUrl.replace('localhost', '127.0.0.1') + 'clipboard')
    expect(await web.getPage()!.evaluate('window.isSecureContext && typeof navigator.clipboard')).toBe('object')
  }, 60_000)

  it.each([['firefox', firefox], ['webkit', webkit]] as const)('%s sets up no clipboard hook', async (name, browserType) => {
    vi.spyOn(browserType, 'launch').mockImplementation((options) => chromium.launch(options))
    const created = new WebPlatformAdapter()
    await created.setup({ platform: 'web', browser: { name, headless: true } })
    adapter = created
    await created.getPage()!.goto(baseUrl + 'clipboard')

    expect(created.operationCaptureSupport).toEqual({ download: false, clipboard: false, reason: name })
    expect(captureOf(created)).toBeNull()
    expect(await created.getPage()!.evaluate(`typeof window[${JSON.stringify('__agentQaAppClipboardWrite')}]`)).toBe('undefined')
    const result = await created.execute({ type: 'click', ref: await refFor(created, 'button', 'Copy invoice number') })
    expect(result.metadata?.['clipboard']).toBeUndefined()
  }, 60_000)
})

// 2026-10-08 (436-14): the read-back runs in an agent-qa-owned probe context (CR-01, IN-08).
describe('C436-CLIPBOARD-READBACK', () => {
  afterEach(() => { vi.restoreAllMocks() })

  async function withTesterSecret(): Promise<WebPlatformAdapter> {
    const web = await open(undefined, undefined, 'readback')
    await web.getPage()!.evaluate("navigator.clipboard.writeText('TESTER-SECRET')")
    return web
  }

  async function pollWindow(web: WebPlatformAdapter): Promise<void> {
    await web.getPage()!.waitForFunction('window.pollDone === true', undefined, { timeout: 10_000 })
  }

  it('a forged write report never lets the page read the clipboard', async () => {
    const web = await withTesterSecret()
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Forge claim') })
    await pollWindow(web)

    expect(await web.getPage()!.evaluate('window.reads')).toEqual([])
    expect(clipboardOf(result)).toEqual([{ source: 'writeText', text: 'forged', readBack: 'mismatched' }])
  }, 60_000)

  it('no origin in the app context is granted clipboard-read during a read-back', async () => {
    const web = await open(undefined, undefined, 'readback')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy and watch') })
    await pollWindow(web)

    expect(clipboardOf(result)).toEqual([{ source: 'writeText', text: 'ORDER-4471', readBack: 'matched' }])
    const states = await web.getPage()!.evaluate('window.states') as string[]
    expect(states.length).toBeGreaterThan(0)
    expect(states).not.toContain('granted')
    expect(await permission(web, 'clipboard-read')).not.toBe('granted')
  }, 60_000)

  it('the clipboard text never reaches the action result', async () => {
    const web = await withTesterSecret()
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Forge claim') })
    await pollWindow(web)

    expect(clipboardOf(result)?.[0]?.readBack).toBe('mismatched')
    expect(JSON.stringify(result)).not.toContain('TESTER-SECRET')
  }, 60_000)

  it('a page that overrides readText cannot forge a matched read-back', async () => {
    const web = await withTesterSecret()
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Forge with override') })

    expect(await web.getPage()!.evaluate('navigator.clipboard.readText()')).toBe('forged')
    expect(clipboardOf(result)).toEqual([{ source: 'writeText', text: 'forged', readBack: 'mismatched' }])
  }, 60_000)

  it('the probe context is closed by cleanup', async () => {
    const web = await open(undefined, undefined, 'readback')
    const app = web.getPage()!.context()
    const browser = app.browser()!
    expect(browser.contexts()).toEqual([app])
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy and watch') })
    expect(clipboardOf(result)?.[0]?.readBack).toBe('matched')

    const probes = browser.contexts().filter((context) => context !== app)
    expect(probes).toHaveLength(1)
    const probe = probes[0]!
    const probePage = probe.pages()[0]!
    expect(probePage.url()).toBe('https://agent-qa-readback.invalid/')
    const closed = vi.spyOn(probe, 'close')
    await web.cleanup()
    adapter = undefined

    expect(closed).toHaveBeenCalled()
    expect(probePage.isClosed()).toBe(true)
  }, 60_000)

  it('a write the browser rejects is not reported and reads nothing back', async () => {
    const web = await withTesterSecret()
    const readPath = vi.spyOn(captureOf(web) as unknown as { readClipboard: () => Promise<unknown> }, 'readClipboard')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Write rejected item') })

    expect(await web.getPage()!.evaluate('window.writeOutcome')).toBe('rejected')
    expect(JSON.stringify(result.metadata?.['clipboard'] ?? null)).toBe('null')
    expect(readPath).not.toHaveBeenCalled()
  }, 60_000)

  it('a writeText is reported after it resolves', async () => {
    const web = await open(undefined, undefined, 'readback')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy order number') })

    expect(await web.getPage()!.evaluate('window.reportedInline')).toBe(0)
    expect(await web.getPage()!.evaluate('window.reports')).toBe(1)
    expect(clipboardOf(result)).toEqual([{ source: 'writeText', text: 'ORDER-4471', readBack: 'matched' }])
  }, 60_000)

  it('two writes in one click read back once', async () => {
    const web = await open(undefined, undefined, 'readback')
    const readPath = vi.spyOn(captureOf(web) as unknown as { readClipboard: () => Promise<unknown> }, 'readClipboard')
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy twice') })

    expect(readPath).toHaveBeenCalledTimes(1)
    expect(clipboardOf(result)).toEqual([
      { source: 'writeText', text: 'A', readBack: 'unavailable' },
      { source: 'writeText', text: 'B', readBack: 'matched' },
    ])
  }, 60_000)

  it('the read-back never moves focus off the app page', async () => {
    const web = await open(undefined, undefined, 'readback')
    const page = web.getPage()!
    const result = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy and watch focus') })
    await page.waitForTimeout(100)

    expect(page.context().browser()!.contexts()).toHaveLength(2)
    expect(await page.evaluate('document.hasFocus()')).toBe(true)
    expect(await page.evaluate('document.activeElement && document.activeElement.id')).toBe('focus-watch')
    expect(await page.evaluate('window.focusEvents')).toEqual([])
    expect(clipboardOf(result)).toEqual([{ source: 'writeText', text: 'ORDER-4471', readBack: 'matched' }])
  }, 60_000)

  it('an unreadable probe records unavailable, never mismatched', async () => {
    const web = await open(undefined, undefined, 'readback')
    const app = web.getPage()!.context()
    const first = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy order number') })
    expect(clipboardOf(first)?.[0]?.readBack).toBe('matched')

    const probes = app.browser()!.contexts().filter((context) => context !== app)
    expect(probes).toHaveLength(1)
    await probes[0]!.clearPermissions()
    const second = await web.execute({ type: 'click', ref: await refFor(web, 'button', 'Copy second order') })

    expect(clipboardOf(second)).toEqual([{ source: 'writeText', text: 'ORDER-4472', readBack: 'unavailable' }])
  }, 60_000)
})
