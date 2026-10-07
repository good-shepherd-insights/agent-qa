// C436-DOWNLOAD-CAPTURE (436 D-19, D-20): real headless Chromium downloads served from a local
// fixture, captured on the action that started them.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Download } from 'playwright-core'
import type { ActionResult } from '@vostride/agent-qa-runner'
import { screenIdentityHash } from '@vostride/agent-qa-schema'
import type { DownloadEvidence, Ref } from '@vostride/agent-qa-schema'
import { WebPlatformAdapter } from '../adapter.js'
import { DOWNLOAD_START_GRACE_MS } from '../operation-capture.js'

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
    res.end(PAGE)
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

async function open(stepTimeoutMs?: number): Promise<WebPlatformAdapter> {
  const created = new WebPlatformAdapter()
  try {
    await created.setup({
      platform: 'web',
      browser: { name: 'chromium', headless: true },
      ...(stepTimeoutMs !== undefined ? { timeouts: { step: stepTimeoutMs } } : {}),
    })
  } catch (error) {
    throw new Error('Real Chromium required: run `pnpm exec playwright install chromium`', { cause: error })
  }
  adapter = created
  await created.getPage()!.goto(baseUrl)
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
