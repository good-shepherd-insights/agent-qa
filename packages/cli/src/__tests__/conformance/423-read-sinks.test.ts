/// <reference lib="dom" />
// Real durable rows, registry dispatch, display sidecar and HTTP adapter. No sanitizer mock.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFunctionRegistry, type FunctionDeps } from '@vostride/agent-qa-agent'
import {
  buildRunMaskingContext,
  createEvidenceBlobReader,
  resolveMaskingHostKey,
  writeMaskingDigests,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import {
  DashboardDatabase,
  createDashboardRunDetailReader,
  createRunServiceRoutes,
  type RunServicePorts,
  serveRunDetailRead,
  startServer,
} from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { AUTH_STATE_REDACTION_MARKER } from '@vostride/agent-qa-core'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MarkReceiptSchema,
  ProposalsListInputSchema,
  ProposalsShowInputSchema,
  maskedMarker,
  type CompletedRunHandoff,
  type MarkReceipt,
  type RunDetailProjection,
} from '@vostride/agent-qa-schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright-core'

import { composeDashboardAgentHost } from '../../commands/dashboard.js'
import { createProposalsCommand } from '../../commands/proposals.js'
import { createDisplayUnmasker } from '../../composition/display-unmask.js'
import { matchServiceBearer } from '../../composition/run-service-token-resolution.js'
import { PACKAGES_ROOT } from './spawned-chat.js'

const AUTH_TOKEN = 'synthetic-423-cookie-token'
const AUTH_STATE = JSON.stringify({
  cookies: [{ name: 'session', value: AUTH_TOKEN, domain: 'app.test', path: '/' }],
  origins: [],
})
const ALLOWED = 'Restored "display" label'

async function startFixture(
  display?: { name: string; attributes: Record<string, string> },
  extraDeps?: (runId: string) => Partial<FunctionDeps>,
) {
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
  setActiveMaskingContextResolver(() => mask)
  const evidenceDocument = { schemaVersion: 1 as const, kind: 'console' as const, records: [
    { level: 'log', text: allowedPlaceholder, timestamp: 1 },
    { level: 'log', text: authPlaceholder, timestamp: 2 },
  ] }
  const evidenceRef = new FsEvidenceArtifactStore({ root, runId }).persistEvidenceDocument(evidenceDocument)
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
    evidence: {
      console: { kind: 'console', state: 'present', ref: evidenceRef as never, counts: { total: 2, errors: 0, warnings: 0 } },
      network: { kind: 'network', state: 'absent', reason: 'empty' },
      a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
      variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    },
  })
  db.insertRunStep({
    runId, testIndex: 0, stepIndex: 1,
    stepText: 'Normal text [secret] <EMAIL_123> <SECRET_987>',
    cacheStatus: 'miss', verifierVerdict: null, selfHealOccurred: false, briefDigest: '',
  })
  const registry = createFunctionRegistry({
    deps: {
      runDetail: createDashboardRunDetailReader(db), evidenceBlobs: createEvidenceBlobReader({ agentQaRoot: root }),
      ...extraDeps?.(runId),
    } as FunctionDeps,
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
  const remote = createServer(createRunServiceRoutes({ agentHost,
    verifyBearer: header => matchServiceBearer(header, [{ name: 'test', tokenEnvVar: 'AGENT_QA_TEST_TOKEN',
      value: 'synthetic-evidence-client', trustScope: { project: 'test' } }]),
  } as RunServicePorts))
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve))
  const remoteAddress = remote.address()
  if (remoteAddress === null || typeof remoteAddress === 'string') throw new Error('Remote fixture did not bind')
  return {
    root, db, runId, origin, authPlaceholder, allowedPlaceholder, unmask, evidenceRef, evidenceDocument,
    machineUrl: `http://127.0.0.1:${machineAddress.port}`,
    remoteUrl: `http://127.0.0.1:${remoteAddress.port}/run/${runId}/evidence?kind=console&testIndex=0&stepIndex=0`,
    async close() {
      await started.close()
      await new Promise<void>((resolve, reject) => machine.close((error) => error ? reject(error) : resolve()))
      await new Promise<void>((resolve, reject) => remote.close((error) => error ? reject(error) : resolve()))
      db.close()
      setActiveMaskingContextResolver(() => undefined)
      mask.dispose()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

describe('423 guarded human read', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>
  beforeAll(async () => { fixture = await startFixture() })
  afterAll(async () => { await fixture?.close() })

  it('HTTP-EVIDENCE-HUMAN restores allowed evidence then sanitizes auth state while raw SHA bytes stay masked', async () => {
    const url = `${fixture.origin}/api/runs/${fixture.runId}`
    const response = await fetch(`${url}/evidence?kind=console&testIndex=0&stepIndex=0`)
    expect(response.status).toBe(200)
    const raw = await response.text()
    const body = JSON.parse(raw)
    expect(body).toMatchObject({ outcome: 'ready', document: { records: [
      { text: ALLOWED }, { text: AUTH_STATE_REDACTION_MARKER },
    ] } })
    expect(raw).not.toContain(AUTH_TOKEN)
    expect(raw).not.toContain(fixture.authPlaceholder)
    const artifact = await fetch(`${url}/artifacts/${fixture.evidenceRef.sha}`)
    expect(await artifact.text()).toBe(JSON.stringify(fixture.evidenceDocument))
    expect(artifact.headers.get('etag')).toBe(`"${fixture.evidenceRef.sha}"`)
  })

  it('HTTP-EVIDENCE-MACHINE real authenticated router retains placeholders and durable masked bytes', async () => {
    expect((await fetch(fixture.remoteUrl)).status).toBe(401)
    const response = await fetch(fixture.remoteUrl, { headers: { Authorization: 'Bearer synthetic-evidence-client' } })
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(raw).toContain(fixture.authPlaceholder)
    expect(raw).toContain(fixture.allowedPlaceholder)
    expect(raw).not.toContain(AUTH_TOKEN)
    expect(raw).not.toContain(ALLOWED)
    expect(JSON.stringify(fixture.db.readRunDetailRows(fixture.runId))).not.toContain(AUTH_TOKEN)
  })

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

  it('C423-HUMAN-DETAIL-SANITIZED: empty evidence and missing sidecars retain honest absence', async () => {
    const runId = fixture.db.insertRun({
      name: 'Historical run', status: 'passed', duration: 0,
      startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString(),
    })
    const url = `${fixture.origin}/api/runs/${runId}/detail`
    const empty = await fetch(url)
    expect(empty.status).toBe(200)
    expect(await empty.json()).toMatchObject({ members: [], steps: [], subActions: [] })
    fixture.db.insertRunStep({
      runId, testIndex: 0, stepIndex: 0, stepText: '<SECRET_0> <EMAIL_0> [secret]',
      cacheStatus: 'miss', verifierVerdict: null, selfHealOccurred: false, briefDigest: '',
    })
    const historical = await fetch(url)
    const body = await historical.json() as RunDetailProjection
    expect(body.steps[0]?.stepText).toBe(`${maskedMarker('secret')} ${maskedMarker('email')} [secret]`)
    expect(JSON.stringify(body)).not.toContain(AUTH_TOKEN)
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

// 423 D-19 · SC5: run detail's review controls re-homed off `routes.chat`. The three controls that
// used to navigate to Chat (member mark, step mark, Knowledge proposals CTA) are driven on the
// built bundle over real registry reads, by keyboard, and what they copy is parsed by the shipped
// `agent-qa proposals` command tree. Scoped to the routed page's own `<main>` (inside the sidebar
// inset): the global sidebar's
// Chat entry is 430's removal, not this plan's.
const MEMBER_PROPOSAL = 'prop_member-423-24'
const STEP_PROPOSAL = 'prop_step-423-24'

function draftedReceipt(runId: string, ordinal: number, proposalId: string, stepIndex?: number): MarkReceipt {
  return MarkReceiptSchema.parse({
    schemaVersion: 1, markId: `mark_${String(ordinal).padStart(12, '0')}`, runId, testIndex: 0,
    ...(stepIndex === undefined ? {} : { stepIndex }), runSlug: 'read-sink-review', kind: 'false-fail',
    origin: 'user', ordinal, markedAt: ordinal,
    disposition: { kind: 'drafted', fix: 'fact', proposalId, proposalKind: 'knowledge' },
    gold: [], evidence: { confirmed: 0, overturned: 0 },
  })
}

function reviewDeps(runId: string): Partial<FunctionDeps> {
  return {
    feedback: {
      marksFor: async () => [draftedReceipt(runId, 1, MEMBER_PROPOSAL), draftedReceipt(runId, 2, STEP_PROPOSAL, 0)],
      mark: async () => { throw new Error('read-only review fixture') },
    },
    runs: {
      get: async (id: unknown) => String(id) === runId
        ? { schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION, runId, buildOrdinal: 1, tests: [] } as unknown as CompletedRunHandoff
        : undefined,
    },
    knowledge: { diffSince: async () => [] },
    proposalsInbox: {
      list: async () => [{ envelope: { status: 'pending' } }, { envelope: { status: 'applied' } }],
    },
  } as unknown as Partial<FunctionDeps>
}

/** Parse a copied command with the SHIPPED command tree; only the action bodies are replaced. */
async function parseProposalsCommand(command: string): Promise<{ name: string; args: unknown[] }> {
  const tokens = command.split(' ')
  expect(tokens.slice(0, 2)).toEqual(['agent-qa', 'proposals'])
  const proposals = createProposalsCommand().exitOverride()
  let captured: { name: string; args: unknown[] } | undefined
  for (const sub of proposals.commands) {
    sub.exitOverride()
    sub.action((...args: unknown[]) => { captured = { name: sub.name(), args: args.slice(0, -1) } })
  }
  await proposals.parseAsync(tokens.slice(2), { from: 'user' })
  if (captured === undefined) throw new Error(`no proposals subcommand accepted: ${command}`)
  return captured
}

async function tabTo(page: Page, selector: string): Promise<void> {
  for (let index = 0; index < 400; index++) {
    if (await page.locator(selector).evaluate(element => element === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Keyboard could not reach ${selector}`)
}

async function regionTargets(page: Page): Promise<string[]> {
  return page.locator('main main').evaluate(region => [...region.querySelectorAll('[href],[action],[formaction],[data-href]')]
    .map(element => element.getAttribute('href') ?? element.getAttribute('action')
      ?? element.getAttribute('formaction') ?? element.getAttribute('data-href') ?? ''))
}

describe('423 run-detail review pointers', () => {
  let fixture: Awaited<ReturnType<typeof startFixture>>
  let browser: Browser
  let page: Page
  const navigations: string[] = []

  beforeAll(async () => {
    fixture = await startFixture({ name: 'Review pointer fixture', attributes: {} }, reviewDeps)
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text } },
      })
    })
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()) })
    await page.goto(`${fixture.origin}/runs/${fixture.runId}`)
    await page.waitForSelector('[data-member-mark] [data-mark-triage]', { timeout: 15_000 })
    await page.waitForSelector('[data-step-mark] [data-mark-triage]', { timeout: 15_000 })
  }, 30_000)
  afterAll(async () => {
    await browser?.close()
    await fixture?.close()
  })

  it('NO-CHAT-TARGET: no run-detail target is routes.chat, and all three controls copy a runnable review command by keyboard', async () => {
    const chatPath = '/chat'
    const pathOf = (target: string) => new URL(target, fixture.origin).pathname
    const detailPath = pathOf(page.url())
    const navigatedBefore = navigations.length

    const controls = [
      { selector: '[data-member-mark] [data-mark-review]', expected: `agent-qa proposals show ${MEMBER_PROPOSAL}`, target: MEMBER_PROPOSAL, key: 'Enter' },
      { selector: '[data-step-mark] [data-mark-review]', expected: `agent-qa proposals show ${STEP_PROPOSAL}`, target: STEP_PROPOSAL, key: 'Space' },
    ]
    expect((await regionTargets(page)).map(pathOf)).not.toContain(chatPath)
    expect(await page.locator('[data-member-mark] [data-mark-triage]').textContent()).toContain(MEMBER_PROPOSAL)
    expect(await page.locator('[data-step-mark] [data-mark-triage]').textContent()).toContain(STEP_PROPOSAL)

    await page.keyboard.press('m')
    await page.waitForSelector('[data-review-proposals]')
    expect(await page.locator('[data-pending-proposals]').getAttribute('data-pending-proposals')).toBe('1')
    expect((await regionTargets(page)).map(pathOf)).not.toContain(chatPath)
    controls.push({ selector: '[data-review-proposals]', expected: 'agent-qa proposals list --status pending', target: 'pending', key: 'Enter' })

    for (const control of controls) {
      const element = page.locator(control.selector)
      expect(await element.evaluate(node => node.tagName)).toBe('BUTTON')
      expect(await element.getAttribute('href')).toBeNull()
      expect(await element.getAttribute('data-review-command')).toBe(control.expected)
      expect(await element.getAttribute('aria-label')).toContain(control.expected)
      expect(await element.textContent()).toContain(control.expected)

      await page.evaluate(() => { (window as unknown as { copied?: string }).copied = undefined })
      await tabTo(page, control.selector)
      await page.keyboard.press(control.key)
      await expect.poll(() => page.evaluate(() => (window as unknown as { copied?: string }).copied)).toBe(control.expected)
      expect(await element.evaluate(node => node === document.activeElement)).toBe(true)
      expect(await element.getAttribute('data-copy-status')).toBe('copied')

      const parsed = await parseProposalsCommand(control.expected)
      if (control.target === 'pending') {
        expect(parsed.name).toBe('list')
        const status = (parsed.args[0] as { status?: string }).status
        expect(ProposalsListInputSchema.parse({ status })).toEqual({ status: 'pending' })
      } else {
        expect(parsed.name).toBe('show')
        expect(ProposalsShowInputSchema.parse({ proposalId: parsed.args[0] })).toEqual({ proposalId: control.target })
      }
    }

    // Viewer state (`?tab=knowledge` from the `m` shortcut) may change; the page never leaves run detail.
    expect(pathOf(page.url())).toBe(detailPath)
    expect(navigations.slice(navigatedBefore).map(pathOf).filter(path => path !== detailPath)).toEqual([])
    expect(navigations.map(pathOf)).not.toContain(chatPath)
  })
})
