// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_SCHEMA_LEAVES, configLeafOwner } from '@vostride/agent-qa-schema'

vi.mock('monaco-editor', () => ({
  languages: {
    CompletionItemKind: {
      Module: 0,
      Value: 1,
      Property: 2,
      Enum: 3,
      EnumMember: 4,
    },
    CompletionItemInsertTextRule: {
      None: 0,
    },
    registerCompletionItemProvider: vi.fn(),
  },
}))

import ConfigPage from '@/pages/config'
import { CONFIG_SECTIONS, CONFIG_TABS, LEGACY_CONFIG_PAIRS, type ConfigTab } from '@/lib/config-tabs'
import { DEVICE_TRANSPORT_OPTIONS } from '@/components/config-manager/devices-section'
import { LLM_PROVIDER_OPTIONS, LlmSection } from '@/components/config-manager/llm-section'
import { fetchAuthStatus, saveCredential } from '@/lib/api'
import { LLM_PROVIDER_COMPLETION_VALUES } from '@/lib/yaml-completions'
import {
  ADD_MODEL_LABEL,
  CONFIG_SECTION_LABELS,
  DEFAULT_BADGE,
  PLANNER_FIELD_LABELS,
  VISION_FIELD_LABELS,
} from '@/lib/config-copy'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

const { sampleConfig, fullConfig, page } = vi.hoisted(() => ({
  page: { config: undefined as Record<string, unknown> | undefined },
  // Every record and list holds at least one entry, so each list renders its rows (D-06).
  fullConfig: {
    workspace: {
      testMatch: ['tests/**/*.yaml'],
      suiteMatch: ['tests/**/*.suite.yaml'],
      testPathIgnore: ['**/draft/**'],
      hooksFile: 'tests/hooks.ts',
      envFile: '.env.local',
      secretsFile: '.env.secrets.local',
    },
    knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none', contextBudgetTokens: 4000 },
    services: {
      dashboard: {
        port: 4173,
        host: '127.0.0.1',
        baseUrl: 'http://127.0.0.1:4173',
        dbPath: '.agent-qa/runs.db',
        artifactsDir: '.agent-qa/artifacts',
        workspace: '.',
        runServiceTokens: [
          { name: 'teammate', tokenEnvVar: 'AGENT_QA_RUN_TOKEN', trustScope: { org: 'acme', project: 'acme-web' } },
        ],
      },
      authState: { dir: '.agent-qa/auth' },
      cache: { dir: '.agent-qa/cache', ttl: '7d' },
      logging: { level: 'info' },
      recording: { enabled: true, keepFailuresOnly: false },
      accessibility: {
        enabled: true,
        standard: 'wcag2aa',
        runAfter: 'test-end',
        failOnViolation: false,
        disableRules: ['color-contrast'],
        exclude: ['#cookie-banner'],
      },
      vision: { screenshotSize: '256k', effectiveResolution: 768 },
      mcp: {
        enabled: true,
        transport: 'http',
        host: '127.0.0.1',
        port: 4174,
        path: '/mcp',
        stdio: { grantConfigWrite: false },
        tokens: [{ name: 'ci', tokenEnvVar: 'AGENT_QA_MCP_TOKEN', scopes: ['read'] }],
      },
    },
    registry: {
      llms: [
        {
          name: 'claude-proxy',
          provider: 'anthropic-compatible',
          model: 'claude-remote',
          baseURL: 'https://anthropic-proxy.example/messages',
          vision: true,
          contextWindow: '200k',
          providerHeaders: { 'X-Team': 'qa' },
        },
        { name: 'gemini-fast', provider: 'gemini', model: 'gemini-2.5-flash' },
      ],
      targets: {
        staging: { platform: 'web', url: 'https://example.com', product: 'example', environment: 'staging' },
        shop: {
          platform: 'android',
          appPackage: 'com.example.shop',
          appActivity: '.MainActivity',
          app: { path: 'apps/shop.apk', browserstack: 'bs://shop' },
        },
      },
      devices: { iosLocal: { platform: 'ios', transport: 'local', match: { udid: 'abc' } } },
      providers: { browserstack: { username: 'qa-team' } },
    },
    use: {
      browser: { name: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
      timeout: { step: '30s', test: '10m', navigation: '10s' },
      planner: { maxSubActions: 20, previousStepCount: 5 },
      logCapture: { console: true, network: true },
      mobile: { appState: 'reset' },
      llm: 'claude-proxy',
      parallel: true,
      workers: 2,
      buildTag: 'nightly',
      cache: true,
    },
    analytics: {
      privacy: true,
      passRateScope: { attributes: { 'git.branch': 'master', 'user.email': { regex: '^ci@' } } },
    },
    eval: {
      k: 3,
      seed: 7,
      judges: ['claude-proxy', 'gemini-fast'],
      judgeAllowSameFamily: false,
      gate1: { maxPerJob: 4, maxScreens: 12 },
      gate2: { canaryHorizonBuilds: 3, maxAblations: 2, maxLowerTrustPerScope: 1 },
      adversarial: { maxProbeCalls: 20, maxSeedsPerRefresh: 5 },
      seeding: { silverPerTestCap: 2 },
    },
  },
  sampleConfig: {
  workspace: {
    testMatch: ['tests/**/*.yaml'],
    suiteMatch: ['tests/**/*.suite.yaml'],
    testPathIgnore: ['**/draft/**'],
    hooksFile: 'tests/hooks.ts',
    envFile: '.env.local',
    secretsFile: '.env.secrets.local',
  },
  knowledge: {
    dir: 'agent-qa-knowledge',
    commitArtifacts: 'none',
  },
  services: {
    dashboard: {
      port: 4173,
      dbPath: '.agent-qa/runs.db',
      artifactsDir: '.agent-qa/artifacts',
    },
    cache: { dir: '.agent-qa/cache', ttl: '7d' },
    logging: { level: 'info' },
    recording: { enabled: true },
    accessibility: {
      enabled: true,
      standard: 'wcag2aa',
      runAfter: 'test-end',
      failOnViolation: false,
    },
    vision: {
      screenshotSize: '256k',
      effectiveResolution: 768,
    },
  },
  registry: {
    llms: [
      {
        name: 'anthropic-compatible',
        provider: 'anthropic-compatible',
        model: 'claude-remote',
        baseURL: 'https://anthropic-proxy.example/messages',
        effectiveResolution: 1568,
      },
      {
        name: 'openai-compatible',
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      { name: 'gemini-fast', provider: 'gemini', model: 'gemini-2.5-flash' },
      { name: 'codex', provider: 'openai-subscription', model: 'gpt-5.3-codex' },
      { name: 'claude-subscription', provider: 'anthropic-subscription', model: 'claude-sonnet-4-20250514' },
    ],
    targets: { staging: { platform: 'web', url: 'https://example.com' } },
    devices: { iosLocal: { platform: 'ios', transport: 'local', match: { udid: 'abc' } } },
    providers: { openai: { apiBase: 'https://api.openai.com/v1' } },
  },
  use: {
    browser: { name: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
    timeout: { step: '30s', test: '10m', navigation: '10s' },
    planner: { maxSubActions: 20, previousStepCount: 5 },
    logCapture: { console: true, network: true },
    llm: 'anthropic-compatible',
    device: 'iosLocal',
    parallel: true,
  },
  analytics: {
    passRateScope: {
      attributes: {
        'git.branch': 'master',
        'user.email': { regex: '^ci@' },
      },
    },
  },
  },
}))

const mockFetchAuthStatus = vi.mocked(fetchAuthStatus)
const mockSaveCredential = vi.mocked(saveCredential)

vi.mock('@/lib/api', () => ({
  fetchAppMetadata: vi.fn().mockResolvedValue({ version: '0.1.13' }),
  fetchConfig: vi.fn(async () => ({
    config: page.config ?? sampleConfig,
    provider: null,
    revision: 'rev-1',
    file: { path: '/work/agent-qa.config.yaml', lines: [] },
  })),
  fetchConfigRevision: vi.fn().mockResolvedValue({ revision: 'rev-1' }),
  applyConfigChanges: vi.fn().mockResolvedValue({ revision: 'rev-2' }),
  undoConfigAction: vi.fn().mockResolvedValue({ restored: true, revision: 'rev-3' }),
  revealConfigValue: vi.fn().mockResolvedValue({ value: '' }),
  updateSettings: vi.fn().mockResolvedValue({ updated: true }),
  fetchAuthStates: vi.fn().mockResolvedValue({ authStates: [] }),
  fetchAuthStatus: vi.fn().mockResolvedValue({ credentials: [] }),
  fetchLLMProviders: vi.fn().mockResolvedValue({
    providers: [
      { id: 'openai-compatible', label: 'OpenAI-compatible', auth: { kind: 'api-key', credentialTypes: ['api-key'], optional: true }, needsBaseURL: true, authModes: ['api-key'], baseURLPlaceholder: 'https://openrouter.ai/api/v1' },
      { id: 'anthropic-compatible', label: 'Anthropic-compatible', auth: { kind: 'api-key', credentialTypes: ['api-key', 'bearer-token'], optional: true }, needsBaseURL: true, authModes: ['api-key', 'bearer-token'], baseURLPlaceholder: 'https://anthropic-proxy.example/messages' },
      { id: 'openai-subscription', label: 'OpenAI subscription', auth: { kind: 'oauth-plugin', mode: 'browser-poll', buttonLabel: 'Login with OpenAI subscription' } },
      { id: 'anthropic-subscription', label: 'Anthropic subscription', auth: { kind: 'oauth-plugin', mode: 'manual-code', buttonLabel: 'Login with Anthropic subscription' } },
      { id: 'gemini', label: 'Gemini', auth: { kind: 'api-key', credentialTypes: ['api-key'] }, needsBaseURL: false, authModes: ['api-key'] },
    ],
  }),
  fetchModelCatalog: vi.fn().mockResolvedValue({
    catalog: {
      'openai-compatible': [{ id: 'openrouter/auto', label: 'OpenRouter Auto', vision: true }],
      'anthropic-compatible': [{ id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', vision: true }],
      gemini: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vision: true }],
    },
  }),
  fetchLiveModelCatalog: vi.fn().mockResolvedValue({ models: [] }),
  testLLMConnection: vi.fn(),
  saveCredential: vi.fn().mockResolvedValue({ saved: true }),
  startPluginAuth: vi.fn(),
  pollPluginAuthResult: vi.fn(),
  exchangePluginAuthCode: vi.fn(),
  deleteAuthCredential: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))

const EXPECTED_DESTINATIONS = [
  'workspace:discovery',
  'workspace:files',
  'knowledge:store',
  'services:dashboard',
  'services:cache',
  'services:auth-states',
  'services:logging',
  'services:recording',
  'services:accessibility',
  'services:vision',
  'registry:llms',
  'registry:targets',
  'registry:devices',
  'registry:providers',
  'use:browser',
  'use:timeouts',
  'use:planner',
  'use:log-capture',
  'use:mobile',
  'use:execution-defaults',
  'analytics:pass-rate-scope',
]

const SURFACE_MARKERS: Record<string, { title: string; marker: string }> = {
  'workspace:discovery': { title: 'Test discovery', marker: 'Test files' },
  'workspace:files': { title: 'Hooks, env and secrets files', marker: 'Hooks file' },
  'knowledge:store': { title: 'Knowledge', marker: 'Knowledge folder' },
  'services:dashboard': { title: 'Dashboard', marker: 'Database file' },
  'services:cache': { title: 'Cache', marker: 'Cache folder' },
  'services:auth-states': { title: 'Saved login states', marker: 'No saved login states yet.' },
  'services:logging': { title: 'Logging', marker: 'Log level' },
  'services:recording': { title: 'Recording', marker: 'Record video of each test. Recordings stay on this machine.' },
  'services:accessibility': { title: 'Accessibility', marker: 'Run checks after' },
  'services:vision': { title: 'Screenshot size', marker: VISION_FIELD_LABELS.screenshotSize },
  'registry:llms': { title: 'Models', marker: ADD_MODEL_LABEL },
  'registry:targets': { title: 'Targets', marker: 'Add target' },
  'registry:devices': { title: 'Devices', marker: 'Add device' },
  'registry:providers': { title: 'Device farms', marker: 'Add device farm' },
  'use:browser': { title: 'Browser', marker: 'Viewport width' },
  'use:timeouts': { title: 'Timeouts', marker: 'Step timeout' },
  'use:planner': { title: 'Planner limits', marker: PLANNER_FIELD_LABELS.maxSubActions },
  'use:log-capture': { title: 'Log capture', marker: 'Capture network logs' },
  'use:mobile': { title: 'Mobile', marker: 'App state' },
  'use:execution-defaults': { title: 'Models', marker: DEFAULT_BADGE },
  'analytics:pass-rate-scope': { title: 'Pass-rate scope', marker: 'Add attribute' },
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flushRender() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderAt(url: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/config/:tab" element={<ConfigPage />} />
        </Routes>
      </MemoryRouter>,
    )
  })

  await flushRender()
  return container
}

async function openEditModalForConfig(view: HTMLDivElement, name: string) {
  const row = Array.from(view.querySelectorAll('tr')).find((item) => item.textContent?.includes(name))
  expect(row, `row for ${name}`).toBeDefined()
  const button = row!.querySelector('button[title="Edit configuration"]') as HTMLButtonElement | null
  expect(button, `edit button for ${name}`).not.toBeNull()

  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flushRender()
}

// The Models tab lists each model as a row that opens in place (429-23); the modal's per-model
// fields and credential controls move into the row and the add row in Plans 24-26, so until then
// these cells render the shipped modal directly. Plan 30 deletes it.
async function renderShippedModal() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<LlmSection config={sampleConfig} onConfigChange={vi.fn()} />)
  })
  await flushRender()
  return container
}

async function renderLlmEditorForConfig(name: string) {
  const view = await renderShippedModal()
  await openEditModalForConfig(view, name)
  return view
}

async function openAddLlmModal(view: HTMLDivElement) {
  const button = Array.from(view.querySelectorAll('button')).find((item) => item.textContent?.includes('Add Configuration'))
  expect(button).toBeDefined()

  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await flushRender()
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function cleanupRender() {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) {
    container.remove()
  }
  container = null
}

async function assertConfigSectionShells(destinations: string[]) {
  for (const destination of destinations) {
    const [bucket, item] = destination.split(':')
    const contract = SURFACE_MARKERS[destination]
    const view = await renderAt(`/config?bucket=${bucket}&item=${item}`)

    expect(view.textContent).toContain(contract.title)
    expect(view.textContent).toContain(contract.marker)
    expect(view.textContent).not.toContain('Missing config surface')
    // A section rebuilt on ConfigField or as a record list has field rows in place of the shipped shell.
    expect(view.querySelector('[data-config-section-shell], [data-config-field], [data-field-list]')).not.toBeNull()
    expect(view.querySelector('[data-config-section-shell] [data-slot="card"]')).toBeNull()

    cleanupRender()
  }
}

// plugins.* is a file edit by decision and safety.* is deleted by Phase 432; every other leaf of
// the published schema has a field on the page (D-06).
const PAGE_LEAVES = CONFIG_SCHEMA_LEAVES.filter(
  (pattern) => !pattern.startsWith('plugins.') && !pattern.startsWith('safety.'),
)

interface FieldMark {
  kind: 'path' | 'list'
  value: string
  where: string
}

function fieldMarks(tab: ConfigTab): FieldMark[] {
  const panel = container!.querySelector(`[data-config-panel="${tab}"]`)!
  return (Array.from(panel.querySelectorAll('[data-field-path], [data-field-list]')) as HTMLElement[]).flatMap((element) => {
    const where = `${tab}/${element.closest('[data-config-section]')?.getAttribute('data-config-section') ?? '?'}`
    const path = element.getAttribute('data-field-path')
    const list = element.getAttribute('data-field-list')
    return [
      ...(path === null ? [] : [{ kind: 'path' as const, value: path, where }]),
      ...(list === null ? [] : [{ kind: 'list' as const, value: list, where }]),
    ]
  })
}

async function activateTab(tab: ConfigTab) {
  const trigger = container!.querySelector(`[role="tab"][data-config-tab="${tab}"]`)
  expect(trigger, tab).not.toBeNull()
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  })
  await flushRender()
}

/** Every field mark on every tab, with each row of each list opened in turn (Radix unmounts inactive panels). */
async function collectFieldMarks(): Promise<FieldMark[]> {
  const marks: FieldMark[] = []
  for (const tab of CONFIG_TABS) {
    await activateTab(tab)
    marks.push(...fieldMarks(tab))
    const panel = container!.querySelector(`[data-config-panel="${tab}"]`)!
    const headers = Array.from(panel.querySelectorAll('[data-model-row-toggle], [data-row-header]')) as HTMLElement[]
    for (const header of headers) {
      await act(async () => {
        header.click()
      })
      await flushRender()
      marks.push(...fieldMarks(tab))
    }
  }
  return marks
}

/**
 * The marks that can stand for a leaf: a field whose path is the pattern, a list whose owner is
 * the pattern's owner, or, for a list of plain values (`a.b[]`), the one field that edits the
 * whole list at its owner path.
 */
function coversLeaf(mark: FieldMark, pattern: string): boolean {
  const owner = configLeafOwner(pattern)
  if (mark.kind === 'list') return mark.value === owner
  return mark.value === pattern || (pattern === `${owner}[]` && mark.value === owner)
}

afterEach(() => {
  cleanupRender()
  page.config = undefined
  vi.clearAllMocks()
})

describe('ConfigPage schema coverage', () => {
  it('SCHEMA-COVERAGE-EVERY-LEAF: every schema leaf but plugins and safety has a field or list owner on some tab', async () => {
    page.config = fullConfig
    await renderAt('/config/models')

    expect(PAGE_LEAVES.length, 'the witness: the schema walk found the leaves').toBeGreaterThanOrEqual(95)
    const marks = await collectFieldMarks()
    const uncovered = PAGE_LEAVES.filter((pattern) => !marks.some((mark) => coversLeaf(mark, pattern)))
    expect(uncovered, `schema leaves with no field on the page: ${uncovered.join(', ')}`).toEqual([])
    for (const pattern of ['use.workers', 'use.buildTag', 'eval.gate2.canaryHorizonBuilds']) {
      expect(marks.some((mark) => mark.kind === 'path' && mark.value === pattern), pattern).toBe(true)
    }
  })

  it('SCHEMA-COVERAGE-EXACTLY-ONCE: each leaf is owned by exactly one section, and no field or list renders in two sections', async () => {
    page.config = fullConfig
    await renderAt('/config/models')

    const marks = await collectFieldMarks()
    const twice = PAGE_LEAVES.flatMap((pattern) => {
      const sections = new Set(marks.filter((mark) => coversLeaf(mark, pattern)).map((mark) => mark.where))
      return sections.size > 1 ? [`${pattern} (${[...sections].join(', ')})`] : []
    })
    expect(twice, `schema leaves rendered by more than one section: ${twice.join('; ')}`).toEqual([])

    const sectionsByMark = new Map<string, Set<string>>()
    for (const mark of marks) {
      const key = `${mark.kind}=${mark.value}`
      sectionsByMark.set(key, (sectionsByMark.get(key) ?? new Set()).add(mark.where))
    }
    const shared = [...sectionsByMark].filter(([, sections]) => sections.size > 1).map(([key, sections]) => `${key} (${[...sections].join(', ')})`)
    expect(shared, `fields rendered by more than one section: ${shared.join('; ')}`).toEqual([])
  })

  it('EVERY-SECTION-RENDERS-EMPTY: with an empty config all five tabs and every section heading render, unset leaves show defaults only as placeholders, and Models shows its empty state', async () => {
    page.config = {}
    const view = await renderAt('/config/models')

    const tabs = Array.from(view.querySelectorAll('[role="tab"]')) as HTMLElement[]
    expect(tabs.map((tab) => tab.getAttribute('data-config-tab'))).toEqual([...CONFIG_TABS])
    for (const tab of tabs) {
      expect(tab.hasAttribute('disabled'), tab.getAttribute('data-config-tab')!).toBe(false)
      expect(tab.getAttribute('aria-disabled'), tab.getAttribute('data-config-tab')!).not.toBe('true')
      expect(tab.hidden, tab.getAttribute('data-config-tab')!).toBe(false)
    }
    expect(view.querySelector('[data-config-section="models"] [data-models-empty]')).not.toBeNull()

    for (const tab of CONFIG_TABS) {
      await activateTab(tab)
      const panel = view.querySelector(`[data-config-panel="${tab}"]`) as HTMLElement
      expect(panel, tab).not.toBeNull()
      for (const id of CONFIG_SECTIONS[tab]) {
        const heading = panel.querySelector(`[data-config-section="${id}"] > h2`)
        expect(heading?.textContent, `${tab}/${id}`).toBe(CONFIG_SECTION_LABELS[id])
      }
      const filled = (
        Array.from(panel.querySelectorAll('[data-config-field] input, [data-config-field] textarea')) as (
          | HTMLInputElement
          | HTMLTextAreaElement
        )[]
      )
        .filter((control) => !['checkbox', 'radio', 'hidden'].includes(control.getAttribute('type') ?? ''))
        .filter((control) => control.value !== '')
        .map((control) => control.closest('[data-field-path]')?.getAttribute('data-field-path'))
      expect(filled, `${tab}: unset leaves showing a value instead of a placeholder`).toEqual([])
    }
  })

  it('matches the final UI-SPEC inventory exactly', () => {
    expect([...LEGACY_CONFIG_PAIRS]).toEqual(EXPECTED_DESTINATIONS)
  })

  it('exposes only the current LLM provider contract in UI fixtures', () => {
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).toEqual([
      'openai-compatible',
      'anthropic-compatible',
      'gemini',
    ])
    expect([...LLM_PROVIDER_COMPLETION_VALUES]).toEqual([
      'openai-compatible',
      'anthropic-compatible',
      'openai-subscription',
      'anthropic-subscription',
      'gemini',
    ])
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.label)).toEqual([
      'OpenAI-compatible',
      'Anthropic-compatible',
      'Gemini',
    ])
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('anthropic')
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('openai')
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('google')
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('authMethod')
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('ollama')
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('lmstudio')
    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).not.toContain('custom')
  })

  it('renders provider header rows only for anthropic-compatible', async () => {
    await renderLlmEditorForConfig('anthropic-compatible')
    expect(document.body.textContent).toContain('Provider Headers')
    expect(document.body.querySelector('input[placeholder="header-name"]')).not.toBeNull()
    expect(document.body.querySelector('input[placeholder="header-value"]')).not.toBeNull()
    cleanupRender()

    for (const name of ['openai-compatible', 'gemini-fast', 'codex', 'claude-subscription']) {
      await renderLlmEditorForConfig(name)
      expect(document.body.textContent).not.toContain('Provider Headers')
      expect(document.body.querySelector('input[placeholder="header-name"]')).toBeNull()
      expect(document.body.querySelector('input[placeholder="header-value"]')).toBeNull()
      cleanupRender()
    }
  })

  it('allows bearer-token credential selection for anthropic-compatible', async () => {
    await renderLlmEditorForConfig('anthropic-compatible')

    expect(document.body.textContent).toContain('API key')
    expect(document.body.textContent).toContain('Bearer token')
    expect(document.body.textContent).toContain('Save Credential')
  })

  it('saves anthropic-compatible bearer tokens through the typed credential API', async () => {
    await renderLlmEditorForConfig('anthropic-compatible')

    const secretInput = document.body.querySelector('input[type="password"][placeholder="secret-value"]') as HTMLInputElement | null
    expect(secretInput).not.toBeNull()
    await act(async () => {
      setInputValue(secretInput!, 'bearer-secret')
    })

    const saveButton = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save Credential'),
    ) as HTMLButtonElement | undefined
    expect(saveButton).toBeDefined()
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushRender()

    expect(mockSaveCredential).toHaveBeenCalledWith(
      'anthropic-compatible',
      'anthropic-compatible',
      'bearer-token',
      'bearer-secret',
    )
  })

  it('confirms credential deletion before deleting', async () => {
    mockFetchAuthStatus.mockResolvedValueOnce({
      credentials: [{
        configName: 'anthropic-compatible',
        provider: 'anthropic-compatible',
        type: 'bearer',
        expires: null,
        source: 'auth-store',
      }],
    })
    await renderLlmEditorForConfig('anthropic-compatible')

    const deleteButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Delete' || button.getAttribute('aria-label') === 'Delete credential',
    ) as HTMLButtonElement | undefined
    expect(deleteButton).toBeDefined()

    await act(async () => {
      deleteButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flushRender()

    expect(document.body.textContent).toContain(
      'Delete saved credential for anthropic-compatible? Tests using this config may fail until a new credential is saved.',
    )
    expect(document.body.textContent).toContain('Keep Credential')
    expect(document.body.textContent).toContain('Delete Credential')
  })

  it('uses a free text model input with datalist suggestions', async () => {
    await renderLlmEditorForConfig('openai-compatible')

    const input = document.body.querySelector('input[placeholder="model-name"]') as HTMLInputElement | null
    expect(input).not.toBeNull()
    expect(input?.getAttribute('list')).toBe('config-model-options-openai-compatible')
    const datalist = document.body.querySelector('#config-model-options-openai-compatible')
    expect(datalist).not.toBeNull()
  })

  it('renders maintained model suggestions without replacing free text entry', async () => {
    const view = await renderShippedModal()
    await openAddLlmModal(view)

    expect(document.body.innerHTML).toContain('<datalist')
    expect(document.body.querySelector('input[placeholder="model-name"]')?.getAttribute('list')).toBe('config-model-options-openai-compatible')
    expect(document.body.querySelector('option[value="openrouter/auto"]')).not.toBeNull()
    expect(document.body.textContent).not.toContain('PROVIDER_MODELS')
    expect(document.body.textContent).not.toContain('SUBSCRIPTION_MODELS')
    expect(document.body.textContent).not.toContain('Gemini 2.0 Flash')
    expect(document.body.textContent).not.toContain('GPT-4o')
    expect(document.body.textContent).not.toContain('Claude Sonnet 4')
  })

  it('exposes only supported device transports in UI fixtures', () => {
    expect(DEVICE_TRANSPORT_OPTIONS.map((option) => option.value)).toEqual(['local', 'browserstack'])
    expect(DEVICE_TRANSPORT_OPTIONS.map((option) => option.label)).toEqual(['Local', 'BrowserStack'])
  })

  it('renders a real editor surface for every schema-backed destination', async () => {
    for (const destination of EXPECTED_DESTINATIONS) {
      const [bucket, item] = destination.split(':')
      const contract = SURFACE_MARKERS[destination]
      const view = await renderAt(`/config?bucket=${bucket}&item=${item}`)

      expect(view.textContent).toContain(contract.title)
      expect(view.textContent).toContain(contract.marker)
      expect(view.textContent).not.toContain('Missing config surface')

      cleanupRender()
    }
  })

  it('Config section shells: all 21 legacy destinations', async () => {
    const destinations: string[] = [...LEGACY_CONFIG_PAIRS]

    expect(destinations).toEqual(EXPECTED_DESTINATIONS)
    await assertConfigSectionShells(destinations)
  })

  it('Config section shells: Workspace sections', async () => {
    await assertConfigSectionShells([
      'workspace:discovery',
      'workspace:files',
    ])
  })

  it('Config section shells: Services sections', async () => {
    await assertConfigSectionShells([
      'services:dashboard',
      'services:cache',
      'services:auth-states',
      'services:logging',
      'services:recording',
      'services:accessibility',
    ])
  })

  it('Config section shells: Use runtime sections', async () => {
    await assertConfigSectionShells([
      'use:browser',
      'use:timeouts',
      'use:planner',
      'use:log-capture',
    ])
  })

  it('Config section shells: Execution defaults sections', async () => {
    await assertConfigSectionShells([
      'use:execution-defaults',
    ])
  })

  it('Config section shells: Analytics sections', async () => {
    await assertConfigSectionShells([
      'analytics:pass-rate-scope',
    ])
  })

  it('Config section shells: Knowledge section', async () => {
    await assertConfigSectionShells([
      'knowledge:store',
    ])
  })

  it('Config section shells: Targets Devices Providers sections', async () => {
    await assertConfigSectionShells([
      'registry:targets',
      'registry:devices',
      'registry:providers',
    ])
  })

  it('Config section shells: LLM section', async () => {
    await assertConfigSectionShells([
      'registry:llms',
    ])
  })
})
