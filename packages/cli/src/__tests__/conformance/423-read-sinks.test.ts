/// <reference lib="dom" />
// Real durable rows, registry dispatch, display sidecar and HTTP adapter. No sanitizer mock.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFunctionRegistry, type FunctionDeps } from '@vostride/agent-qa-agent'
import {
  buildRunMaskingContext,
  resolveMaskingHostKey,
  writeMaskingDigests,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  DashboardDatabase,
  createDashboardRunDetailReader,
  serveRunDetailRead,
  startServer,
} from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { AUTH_STATE_REDACTION_MARKER } from '@vostride/agent-qa-core'
import { maskedMarker, type RunDetailProjection } from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'

import { composeDashboardAgentHost } from '../../commands/dashboard.js'
import { createDisplayUnmasker } from '../../composition/display-unmask.js'
import { PACKAGES_ROOT } from './spawned-chat.js'

const AUTH_TOKEN = 'synthetic-423-cookie-token'
const AUTH_STATE = JSON.stringify({
  cookies: [{ name: 'session', value: AUTH_TOKEN, domain: 'app.test', path: '/' }],
  origins: [],
})
const ALLOWED = 'Restored "display" label'

async function startFixture(display?: { name: string; attributes: Record<string, string> }) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-sinks-'))
  const db = new DashboardDatabase({ dbPath: join(root, 'dashboard.db') })
  const runId = generateRunId()
  const values = { AUTH_STATE, ALLOWED }
  const store = {
    forEachSecret(cb: (name: string, value: string) => void) {
      for (const [name, value] of Object.entries(values)) cb(name, value)
    },
  }
  const mask = buildRunMaskingContext({ secretStore: store, env: {} })
  const placeholders = new Map(mask.snapshotRegistered().map(({ value, placeholder }) => [value, placeholder]))
  const authPlaceholder = placeholders.get(AUTH_STATE)!
  const allowedPlaceholder = placeholders.get(ALLOWED)!
  writeMaskingDigests({ root, runId, key: resolveMaskingHostKey(root), entries: mask.snapshotRegistered() })
  mask.dispose()
  db.insertRun({
    id: runId, name: display?.name ?? 'Read sink fixture', status: 'failed', duration: 1,
    ...(display === undefined ? {} : { attributes: display.attributes }),
    startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString(),
  })
  db.upsertRunMember({ runId, testIndex: 0, name: 'Synthetic member', totalSteps: 2, outcome: 'failed' })
  db.insertRunStep({
    runId, testIndex: 0, stepIndex: 0, stepText: allowedPlaceholder,
    cacheStatus: 'miss', verifierVerdict: null, selfHealOccurred: false,
    briefDigest: '', status: 'failed', error: authPlaceholder,
  })
  db.insertRunStep({
    runId, testIndex: 0, stepIndex: 1,
    stepText: 'Normal text [secret] <EMAIL_123> <SECRET_987>',
    cacheStatus: 'miss', verifierVerdict: null, selfHealOccurred: false, briefDigest: '',
  })
  const registry = createFunctionRegistry({
    deps: { runDetail: createDashboardRunDetailReader(db) } as FunctionDeps,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
  })
  const unmask = createDisplayUnmasker({
    agentQaRoot: root, secretStores: () => [store], env: () => ({}), authStatePayloads: () => [],
  })
  const agentHost = composeDashboardAgentHost(
    { registry } as LocalAgentHost,
    { subscribe: () => () => undefined, emit() {} },
    undefined, undefined, unmask,
  )
  const started = await startServer({
    db, port: 0, agentHost,
    ...(display === undefined ? {} : { uiDir: join(PACKAGES_ROOT, 'dashboard-ui', 'dist') }),
  })
  const address = started.server.address()
  if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind')
  const origin = `http://127.0.0.1:${address.port}`
  // The same production adapter's default machine boundary, on a real socket.
  const machine = createServer((req, res) => serveRunDetailRead(req, res, { runId, host: agentHost }))
  await new Promise<void>((resolve) => machine.listen(0, '127.0.0.1', resolve))
  const machineAddress = machine.address()
  if (machineAddress === null || typeof machineAddress === 'string') throw new Error('Machine fixture did not bind')
  return {
    root, db, runId, origin, authPlaceholder, allowedPlaceholder, unmask,
    machineUrl: `http://127.0.0.1:${machineAddress.port}`,
    async close() {
      await started.close()
      await new Promise<void>((resolve, reject) => machine.close((error) => error ? reject(error) : resolve()))
      db.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

describe('423 guarded human read', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>
  beforeAll(async () => { fixture = await startFixture() })
  afterAll(async () => { await fixture?.close() })

  it('C423-HUMAN-DETAIL-SANITIZED: T-405-38 restores then sanitizes durable HTTP output', async () => {
    // Prove the synthetic sidecar restores the auth shape, independently of the response.
    expect(fixture.unmask(fixture.authPlaceholder, { runId: fixture.runId })).toBe(AUTH_STATE)
    const response = await fetch(`${fixture.origin}/api/runs/${fixture.runId}/detail`)
    expect(response.status).toBe(200)
    const raw = await response.text()
    const body = JSON.parse(raw) as RunDetailProjection
    expect.soft(raw, 'restored cookie material must be removed after the seam').not.toContain(AUTH_TOKEN)
    expect.soft(body.steps[0]?.error).toBe(AUTH_STATE_REDACTION_MARKER)
    expect.soft(raw).not.toContain(fixture.authPlaceholder)
    expect.soft(body.steps[0]?.stepText, 'allowed quoted text must survive JSON serialization').toBe(ALLOWED)
    expect.soft(body.steps[1]?.stepText).toBe(`Normal text [secret] ${maskedMarker('email')} ${maskedMarker('secret')}`)
    expect.soft(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('C423-HUMAN-DETAIL-SANITIZED: cross-site reads are refused before restoration', async () => {
    const response = await fetch(`${fixture.origin}/api/runs/${fixture.runId}/detail`, {
      headers: { Origin: 'https://other.test', 'Sec-Fetch-Site': 'cross-site' },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'cross_site_refused' })
  })

  it('C423-HUMAN-DETAIL-SANITIZED: machine HTTP output and durable rows remain masked', async () => {
    const response = await fetch(fixture.machineUrl)
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(raw).toContain(fixture.authPlaceholder)
    expect(raw).toContain(fixture.allowedPlaceholder)
    expect(raw).not.toContain(AUTH_TOKEN)
    expect(raw).not.toContain(ALLOWED)
    const stored = JSON.stringify(fixture.db.readRunDetailRows(fixture.runId))
    expect(stored).toContain(fixture.authPlaceholder)
    expect(stored).not.toContain(AUTH_TOKEN)
  })
})

// Labels are read from their published UI source, independently of the conversion under test.
function publishedLabel(name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui/src/lib/run-detail-view.ts'), 'utf8')
  const match = new RegExp(`export const ${name} = (["'])(.*?)\\1`).exec(source)
  if (!match) throw new Error(`Published label missing: ${name}`)
  return match[2]!
}

const SECRET_LABEL = publishedLabel('MASKED_SECRET_LABEL')
const EMAIL_LABEL = publishedLabel('MASKED_EMAIL_LABEL')
const KEY = `key ${maskedMarker('secret')} <EMAIL_81>`
const VALUE = `normal ${maskedMarker('email')} <SECRET_82> [secret]`
const NESTED = JSON.stringify({ [KEY]: [VALUE, { note: maskedMarker('secret') }] })
const DISPLAY_KEY = `key [${SECRET_LABEL}] [${EMAIL_LABEL}]`
const DISPLAY_VALUE = `normal [${EMAIL_LABEL}] [${SECRET_LABEL}] [secret]`
const DISPLAY_NESTED = JSON.stringify({ [DISPLAY_KEY]: [DISPLAY_VALUE, { note: `[${SECRET_LABEL}]` }] })
const DISPLAY_NAME = `Name [${SECRET_LABEL}] [${EMAIL_LABEL}] [${SECRET_LABEL}]`

describe('423 rendered run-detail sinks', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    fixture = await startFixture({
      name: `Name ${maskedMarker('secret')} ${maskedMarker('email')} <SECRET_99>`,
      attributes: { [KEY]: VALUE, nested: NESTED, normal: 'Readable normal value', auth: AUTH_STATE },
    })
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    // Observe what the actual button writes without depending on desktop clipboard permissions.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text } },
      })
    })
    await page.goto(`${fixture.origin}/runs/${fixture.runId}`)
    await page.waitForSelector('[data-step-id]')
    await page.keyboard.press('i')
    await page.getByRole('button', { name: 'Copy JSON', exact: true }).waitFor()
  }, 30_000)
  afterAll(async () => {
    await browser?.close()
    await fixture?.close()
  })

  it('SINK-CLIPBOARD: values and nested JSON keys use display labels', async () => {
    await page.getByRole('button', { name: 'Copy JSON', exact: true }).click()
    const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied)
    expect.soft(JSON.parse(copied)).toEqual({
      [DISPLAY_KEY]: DISPLAY_VALUE, nested: DISPLAY_NESTED,
      normal: 'Readable normal value', auth: AUTH_STATE_REDACTION_MARKER,
    })
    expect.soft(copied).not.toContain(AUTH_TOKEN)
    expect.soft(copied).not.toMatch(/<SECRET_|<EMAIL_|␟masked:/u)
    const rows = page.getByRole('dialog').locator('tr')
    const normal = rows.filter({ hasText: 'Readable normal value' })
    await normal.getByRole('button').click()
    expect.soft(await page.evaluate(() => (window as unknown as { copied: string }).copied))
      .toBe('Readable normal value')
    const nested = rows.filter({ has: page.locator('th', { hasText: /^nested$/ }) })
    await nested.getByRole('button').click()
    expect.soft(await page.evaluate(() => (window as unknown as { copied: string }).copied))
      .toBe(DISPLAY_NESTED)
  })

  it('SINK-TITLE: document title contains display labels and normal run text', async () => {
    expect(await page.title()).toBe(`Run - ${DISPLAY_NAME} | agent-qa`)
    expect(await page.title()).not.toContain(AUTH_TOKEN)
  })

  it('SINK-DOM: drawer values, keys and accessible attributes never expose markers or credentials', async () => {
    const dialog = page.getByRole('dialog')
    const text = await dialog.innerText()
    expect.soft(text).toContain('Readable normal value')
    expect.soft(text).toContain(SECRET_LABEL)
    expect.soft(text).toContain(EMAIL_LABEL)
    expect.soft(text).toContain('[secret]')
    expect.soft(text).not.toMatch(/<SECRET_|<EMAIL_|␟masked:/u)
    expect.soft(text).not.toContain(AUTH_TOKEN)
    const attrs = await dialog.evaluate((element) => Array.from(element.querySelectorAll('*'))
      .flatMap((node) => Array.from(node.attributes).map((attribute) => attribute.value)).join('\n'))
    expect.soft(attrs).not.toMatch(/<SECRET_|<EMAIL_|␟masked:/u)
    expect.soft(attrs).not.toContain(AUTH_TOKEN)
    expect.soft(await dialog.getByRole('button', { name: `Copy ${DISPLAY_KEY} value`, exact: true }).count()).toBe(1)
  })
})
