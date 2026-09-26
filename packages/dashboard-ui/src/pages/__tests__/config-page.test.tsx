// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPROVED_SAAS_PLACEHOLDER_SLUGS } from '@vostride/agent-qa-ids'

import {
  exchangePluginAuthCode,
  fetchAppMetadata,
  fetchAuthStates,
  fetchAuthStatus,
  fetchConfig,
  fetchLLMProviders,
  pollPluginAuthResult,
  saveCredential,
  startPluginAuth,
  testLLMConnection,
  updateSettings,
} from '@/lib/api'
import { LLM_PROVIDER_OPTIONS } from '@/components/config-manager/llm-section'
import {
  CONFIG_LOAD_FAILED_TITLE,
  CONFIG_PAGE_TITLE,
  CONFIG_SECTION_LABELS,
  CONFIG_TAB_LABELS,
  CONFIG_TABS_ARIA_LABEL,
  LEGACY_LINK_NOT_FOUND_TEXT,
  RELOAD_CONFIG_LABEL,
  configLoadFailedBody,
} from '@/lib/config-copy'
import {
  CONFIG_SECTIONS,
  CONFIG_TABS,
  LEGACY_CONFIG_LINKS,
  LEGACY_CONFIG_PAIRS,
  type ConfigSectionId,
  type ConfigTab,
} from '@/lib/config-tabs'
import { routes } from '@/lib/routes'
import ConfigPage from '@/pages/config'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { sampleConfig } = vi.hoisted(() => ({
  sampleConfig: {
  workspace: {
    testMatch: ['tests/**/*.yaml'],
    suiteMatch: ['tests/**/*.suite.yaml'],
    testPathIgnore: ['**/draft/**'],
    hooksFile: 'tests/hooks.ts',
    envFile: '.env.local',
    secretsFile: '.secrets.local',
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
  },
  registry: {
    llms: [{
      name: 'primary',
      provider: 'openai-compatible',
      model: 'gpt-4.1',
      baseURL: 'https://api.openai.com/v1',
      vision: true,
      contextWindow: '128k',
    }],
    targets: { staging: { platform: 'web', url: 'https://example.com' } },
    devices: { iosLocal: { platform: 'ios', transport: 'local', match: { udid: 'abc' } } },
    providers: { openai: { apiBase: 'https://api.openai.com/v1' } },
  },
  use: {
    browser: { name: 'chromium', headless: true, viewport: { width: 1280, height: 720 } },
    timeout: { step: '30s', test: '10m', navigation: '10s' },
    planner: { maxSubActions: 20, previousStepCount: 5 },
    logCapture: { console: true, network: true },
    mobile: { appState: 'reset' },
    llm: 'primary',
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

vi.mock('@/lib/api', () => ({
  fetchAppMetadata: vi.fn().mockResolvedValue({
    version: '0.1.13',
  }),
  fetchConfig: vi.fn().mockResolvedValue({
    config: sampleConfig,
  }),
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
  testLLMConnection: vi.fn().mockResolvedValue({ success: true }),
  saveCredential: vi.fn().mockResolvedValue({ saved: true }),
  startPluginAuth: vi.fn().mockResolvedValue({ authorizeUrl: 'https://auth.example/start', sessionId: 'session-1', mode: 'manual-code' }),
  pollPluginAuthResult: vi.fn().mockResolvedValue({ status: 'pending' }),
  exchangePluginAuthCode: vi.fn().mockResolvedValue({ status: 'completed', saved: true }),
  deleteAuthCredential: vi.fn(),
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/hooks/use-page-title', () => ({ usePageTitle: () => {} }))
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function LocationProbe() {
  const location = useLocation()
  return (
    <div
      data-testid="location"
      data-pathname={location.pathname}
      data-search={location.search}
    />
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null
let scrollIntoViewSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollIntoViewSpy = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as Element['scrollIntoView']
})

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

  const page = (
    <>
      <LocationProbe />
      <ConfigPage />
    </>
  )

  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/config" element={page} />
          <Route path="/config/:tab" element={page} />
        </Routes>
      </MemoryRouter>,
    )
  })

  await flushRender()
  return container
}

function currentLocation() {
  const probe = container?.querySelector('[data-testid="location"]')
  return {
    pathname: probe?.getAttribute('data-pathname') ?? null,
    search: probe?.getAttribute('data-search') ?? null,
  }
}

function tabTriggers() {
  return Array.from(container?.querySelectorAll('[role="tab"]') ?? []) as HTMLButtonElement[]
}

function tabTrigger(tab: ConfigTab) {
  return container?.querySelector(`[role="tab"][data-config-tab="${tab}"]`) as HTMLButtonElement | null
}

async function activateTab(tab: ConfigTab) {
  const trigger = tabTrigger(tab)
  expect(trigger, tab).not.toBeNull()
  await act(async () => {
    trigger!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
  })
  await flushRender()
}

async function pressKey(target: Element, key: string) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await flushRender()
}

function section(id: ConfigSectionId) {
  return container?.querySelector(`[data-config-section="${id}"]`) as HTMLElement | null
}

function sectionButton(id: ConfigSectionId, label: string) {
  const buttons = Array.from(section(id)?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent?.trim() === label) ?? null
}

function dialogButton(label: string) {
  const dialog = document.body.querySelector('[role="dialog"]')
  const buttons = Array.from(dialog?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent?.trim() === label) ?? null
}

function findButton(label: string) {
  const buttons = Array.from(container?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent?.trim() === label) ?? null
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

// The page chrome with every section body stripped: what a reader sees besides the section
// headings and the shipped editors each section still mounts until its own plan rebuilds it.
function shellChrome(view: HTMLElement) {
  const page = view.querySelector('[data-config-page]')!.cloneNode(true) as HTMLElement
  for (const node of Array.from(page.querySelectorAll('[data-config-section] > :not(h2)'))) {
    node.remove()
  }
  return page
}

const BUCKET_LABELS = /\b(?:Workspace|Services|Registry|Use|Analytics)\b/
const DOTTED_CONFIG_PATH = /\b(?:workspace|services|registry|use|knowledge|analytics)\.[A-Za-z]/

function configWithLlm(llm: Record<string, unknown>) {
  const name = String(llm.name ?? '')
  return {
    ...sampleConfig,
    registry: {
      ...sampleConfig.registry,
      llms: [llm],
    },
    use: {
      ...sampleConfig.use,
      llm: name,
    },
  }
}

function configWithTargets(targets: Record<string, unknown>) {
  return {
    ...sampleConfig,
    registry: {
      ...sampleConfig.registry,
      targets,
    },
  }
}

async function openFirstLlmEditor() {
  await act(async () => {
    ;(document.body.querySelector('button[title="Edit configuration"]') as HTMLButtonElement).click()
  })
  await flushRender()
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) {
    container.remove()
  }
  container = null
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  vi.clearAllMocks()
})

describe('ConfigPage task tabs shell', () => {
  it('SHELL-LOADING: a pending read shows only the Config-shaped FormSkeleton and no tab strip', async () => {
    vi.mocked(fetchConfig).mockReturnValueOnce(new Promise(() => {}))

    const view = await renderAt('/config/models')

    expect(view.querySelector('[data-config-page]')?.getAttribute('data-config-state')).toBe('loading')
    expect(view.querySelector('[data-skeleton="config"]')).not.toBeNull()
    expect(view.querySelector('[role="tab"]')).toBeNull()
    expect(view.querySelector('[data-config-tabbar]')).toBeNull()
    expect(view.querySelector('[data-config-panel]')).toBeNull()
  })

  it('SHELL-LOADING: switching tabs renders from the loaded config and fetches nothing', async () => {
    const view = await renderAt('/config/models')
    expect(view.querySelector('[data-config-page]')?.getAttribute('data-config-state')).toBe('ready')
    expect(fetchConfig).toHaveBeenCalledTimes(1)

    await activateTab('execution')
    await activateTab('project')

    expect(currentLocation().pathname).toBe('/config/project')
    expect(section('files')).not.toBeNull()
    expect(fetchConfig).toHaveBeenCalledTimes(1)
  })

  it('LOAD-ERROR-RELOADS-WITHOUT-PAGE-RELOAD: a failed read offers Reload config, which re-reads in place', async () => {
    vi.mocked(fetchConfig).mockRejectedValueOnce(new Error('agent-qa.config.yaml is not valid YAML.'))

    const view = await renderAt('/config/models')

    const error = view.querySelector('[data-config-load-error]')
    expect(view.querySelector('[data-config-page]')?.getAttribute('data-config-state')).toBe('error')
    expect(error).not.toBeNull()
    expect(error?.textContent).toContain(CONFIG_LOAD_FAILED_TITLE)
    expect(error?.textContent).toContain(configLoadFailedBody('agent-qa.config.yaml is not valid YAML'))
    expect(view.querySelector('[role="tab"]')).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()

    const reload = findButton(RELOAD_CONFIG_LABEL)
    expect(reload).not.toBeNull()
    await act(async () => {
      reload!.click()
    })
    await flushRender()

    expect(fetchConfig).toHaveBeenCalledTimes(2)
    expect(view.querySelector('[data-config-load-error]')).toBeNull()
    expect(tabTriggers()).toHaveLength(CONFIG_TABS.length)
    expect(currentLocation().pathname).toBe('/config/models')
  })

  it('TABS-FIVE-IN-ORDER: exactly five tabs in the order Models, Targets, Execution, Project, Advanced', async () => {
    const view = await renderAt('/config/models')

    const triggers = tabTriggers()
    expect(triggers).toHaveLength(5)
    expect(triggers.map((trigger) => trigger.textContent?.trim())).toEqual(
      CONFIG_TABS.map((tab) => CONFIG_TAB_LABELS[tab]),
    )
    expect(triggers.map((trigger) => trigger.getAttribute('data-config-tab'))).toEqual([...CONFIG_TABS])
    expect(view.querySelectorAll('[role="tablist"]')).toHaveLength(1)
    expect(view.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(CONFIG_TABS_ARIA_LABEL)
    expect(view.querySelector('[role="tablist"]')?.getAttribute('data-tour-id')).toBe('tour-config-nav')
    expect(view.querySelector('[data-config-tabs-scroll] [role="tablist"]')).not.toBeNull()
    expect(view.querySelector('[data-config-tabbar] > [data-config-status-slot]')).not.toBeNull()
    expect(view.querySelector('[data-config-tabs-scroll] [data-config-status-slot]')).toBeNull()
    expect(view.querySelector('h1')?.textContent).toBe(CONFIG_PAGE_TITLE)
  })

  it('BARE-CONFIG-LANDS-ON-MODELS: bare /config is replaced by /config/models with the Models panel active', async () => {
    const view = await renderAt('/config')

    expect(currentLocation()).toEqual({ pathname: '/config/models', search: '' })
    expect(tabTrigger('models')?.getAttribute('aria-selected')).toBe('true')
    expect(view.querySelector('[data-config-panel="models"]')).not.toBeNull()
    expect(view.querySelector('[data-config-panel="models"]')?.getAttribute('data-tour-id')).toBe('tour-config-section')
    expect(view.querySelector('[data-config-invalid-notice]')).toBeNull()
    expect(fetchConfig).toHaveBeenCalledTimes(1)
  })

  it.each(LEGACY_CONFIG_PAIRS)(
    'LEGACY-PAIR-LANDS-AND-FOCUSES: %s lands on its tab with its heading focused and no ?section left',
    async (pair) => {
      const [bucket, item] = pair.split(':')
      const { tab, section: sectionId } = LEGACY_CONFIG_LINKS[pair]

      const view = await renderAt(`/config?bucket=${bucket}&item=${item}`)

      expect(currentLocation()).toEqual({ pathname: `/config/${tab}`, search: '' })
      expect(tabTrigger(tab)?.getAttribute('aria-selected')).toBe('true')
      const heading = section(sectionId)?.querySelector('h2')
      expect(heading?.textContent).toBe(CONFIG_SECTION_LABELS[sectionId])
      expect(document.activeElement).toBe(heading)
      expect(scrollIntoViewSpy.mock.contexts).toContain(heading)
      expect(view.querySelector('[data-config-invalid-notice]')).toBeNull()
      expect(routes.configItem(bucket, item)).toBe(`/config/${tab}?section=${sectionId}`)
    },
  )

  it('LEGACY-PAIR-LANDS-AND-FOCUSES: the table covers all 21 live legacy pairs', () => {
    expect(LEGACY_CONFIG_PAIRS).toHaveLength(21)
    expect(Object.keys(LEGACY_CONFIG_LINKS).sort()).toEqual([...LEGACY_CONFIG_PAIRS].sort())
  })

  it('SECTION-DEEP-LINK-FOCUSES: ?section scrolls its heading into view, focuses it, then leaves the URL', async () => {
    const view = await renderAt('/config/execution?section=timeouts')

    const heading = section('timeouts')?.querySelector('h2')
    expect(heading).not.toBeNull()
    expect(heading?.getAttribute('tabindex')).toBe('-1')
    expect(section('timeouts')?.getAttribute('aria-labelledby')).toBe(heading?.id)
    expect(document.activeElement).toBe(heading)
    const call = scrollIntoViewSpy.mock.calls[scrollIntoViewSpy.mock.contexts.indexOf(heading)]
    expect(call?.[0]).toMatchObject({ block: 'start' })
    expect(currentLocation()).toEqual({ pathname: '/config/execution', search: '' })
    expect(view.querySelector('[data-config-invalid-notice]')).toBeNull()
  })

  it('UNKNOWN-LINK-NOTICE-ONCE: an unknown legacy link lands on Models with the notice until the next tab change', async () => {
    const view = await renderAt('/config?bucket=workspace&item=unknown')

    expect(currentLocation()).toEqual({ pathname: '/config/models', search: '' })
    const notice = view.querySelector('[data-config-invalid-notice]')
    expect(notice?.textContent).toBe(LEGACY_LINK_NOT_FOUND_TEXT)
    expect(notice?.hasAttribute('data-config-line-notice')).toBe(true)
    expect(notice?.textContent).not.toContain('bucket')
    expect(notice?.textContent).not.toContain('unknown')
    expect(notice?.querySelector('[data-slot="badge"]')).toBeNull()
    expect(view.querySelectorAll('[data-config-invalid-notice]')).toHaveLength(1)

    await activateTab('targets')
    expect(view.querySelector('[data-config-invalid-notice]')).toBeNull()

    await activateTab('models')
    expect(view.querySelector('[data-config-invalid-notice]')).toBeNull()
  })

  it('UNKNOWN-LINK-NOTICE-ONCE: an unknown tab or a section from another tab lands on Models with the notice', async () => {
    let view = await renderAt('/config/storage')

    expect(currentLocation()).toEqual({ pathname: '/config/models', search: '' })
    expect(view.querySelector('[data-config-invalid-notice]')?.textContent).toBe(LEGACY_LINK_NOT_FOUND_TEXT)
    expect(view.textContent).not.toContain('storage')

    cleanupAfterDialog()
    view = await renderAt('/config/models?section=browser')

    expect(currentLocation()).toEqual({ pathname: '/config/models', search: '' })
    expect(view.querySelector('[data-config-invalid-notice]')?.textContent).toBe(LEGACY_LINK_NOT_FOUND_TEXT)
  })

  it('NO-RAIL: the desktop rail and its main column never render', async () => {
    for (const tab of CONFIG_TABS) {
      const view = await renderAt(`/config/${tab}`)

      expect(view.querySelector('[data-config-rail]')).toBeNull()
      expect(view.querySelector('[data-config-main]')).toBeNull()
      expect(view.querySelector('[data-config-page-root]')).toBeNull()
      expect(view.querySelector('aside')).toBeNull()
      expect(view.querySelector('[data-config-page] > [data-slot="card"]')).toBeNull()
      expect(view.querySelector('[data-config-page]')?.className).toContain('max-w-4xl')

      cleanupAfterDialog()
    }
  })

  it('NO-NAV-SELECT: no select or combobox navigates Config, at desktop or ~400px', async () => {
    const originalWidth = window.innerWidth
    try {
      for (const width of [1280, 400]) {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
        window.dispatchEvent(new Event('resize'))

        const view = await renderAt('/config/models')
        const chrome = shellChrome(view)

        expect(view.querySelector('[data-config-mobile-selector]')).toBeNull()
        expect(chrome.querySelector('select, [role="combobox"], [role="listbox"]')).toBeNull()
        expect(chrome.textContent).not.toContain('Select Setting')
        expect(view.querySelector('[aria-label="Select config setting"]')).toBeNull()
        expect(view.querySelectorAll('[role="tablist"]')).toHaveLength(1)
        expect(tabTriggers()).toHaveLength(5)

        cleanupAfterDialog()
      }
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('NO-PATH-BADGES: no bucket name, item id, dotted config path or badge renders in the page chrome', async () => {
    for (const tab of CONFIG_TABS) {
      const view = await renderAt(`/config/${tab}`)
      const chrome = shellChrome(view)
      const text = chrome.textContent ?? ''

      expect(chrome.querySelector('[data-slot="badge"]')).toBeNull()
      expect(text).not.toMatch(DOTTED_CONFIG_PATH)
      expect(text).not.toMatch(BUCKET_LABELS)
      for (const pair of LEGACY_CONFIG_PAIRS) {
        const [bucket, item] = pair.split(':')
        expect(text).not.toContain(pair)
        expect(text).not.toContain(`${bucket}/${item}`)
        if (item.includes('-')) expect(text).not.toContain(item)
      }
      expect(text).not.toContain('Manage workspace, services, registry, and runtime defaults.')
      expect(text).not.toContain('Missing config surface')

      const headings = Array.from(view.querySelectorAll('[data-config-section] > h2')).map((h) => h.textContent)
      const sectionIds = Array.from(view.querySelectorAll('[data-config-section]')).map((node) =>
        node.getAttribute('data-config-section') as ConfigSectionId,
      )
      expect(headings).toEqual(sectionIds.map((id) => CONFIG_SECTION_LABELS[id]))
      expect(sectionIds.every((id) => (CONFIG_SECTIONS[tab] as readonly string[]).includes(id))).toBe(true)

      cleanupAfterDialog()
    }
  })

  it('TAB-ARROW-KEYS: Right moves to and activates Targets with focus kept on its tab, End activates Advanced', async () => {
    await renderAt('/config/models')

    const models = tabTrigger('models')!
    await act(async () => {
      models.focus()
    })
    expect(document.activeElement).toBe(models)

    await pressKey(models, 'ArrowRight')

    const targets = tabTrigger('targets')!
    expect(targets.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(targets)
    expect(currentLocation().pathname).toBe('/config/targets')
    expect(scrollIntoViewSpy.mock.contexts).toContain(targets)
    const targetsCall = scrollIntoViewSpy.mock.calls[scrollIntoViewSpy.mock.contexts.lastIndexOf(targets)]
    expect(targetsCall?.[0]).toMatchObject({ inline: 'nearest', block: 'nearest' })

    await pressKey(targets, 'End')

    const advanced = tabTrigger('advanced')!
    expect(advanced.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(advanced)
    expect(currentLocation().pathname).toBe('/config/advanced')

    await pressKey(advanced, 'Home')

    expect(tabTrigger('models')?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabTrigger('models'))
    expect(currentLocation().pathname).toBe('/config/models')

    await pressKey(tabTrigger('models')!, 'ArrowLeft')

    expect(tabTrigger('advanced')?.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabTrigger('advanced'))
  })

  it('renders the app version as subtle footer metadata below the tabs', async () => {
    const view = await renderAt('/config/project')

    const footer = view.querySelector('[data-config-app-version]')
    const page = view.querySelector('[data-config-page]')
    const tabbar = view.querySelector('[data-config-tabbar]')

    expect(fetchAppMetadata).toHaveBeenCalledTimes(1)
    expect(footer).not.toBeNull()
    expect(footer?.textContent).toBe('agent-qa v0.1.13')
    expect(page?.contains(footer)).toBe(true)
    expect(tabbar?.textContent).not.toContain('0.1.13')
    expect(footer?.className).toContain('text-[11px]')
    expect(footer?.className).toContain('font-mono')
    expect(footer?.className).toContain('text-muted-foreground/70')
    expect(footer?.className).toContain('border-t')
    expect(footer?.querySelector('a,button')).toBeNull()
  })

  it('renders version fallback when metadata returns an empty version', async () => {
    vi.mocked(fetchAppMetadata).mockResolvedValueOnce({ version: '   ' })

    const view = await renderAt('/config/project')
    const footer = view.querySelector('[data-config-app-version]')

    expect(footer?.textContent).toBe('agent-qa version unavailable')
    expect(section('test-discovery')?.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS['test-discovery'])
    expect(view.querySelector('#test-match')).not.toBeNull()
  })

  it('keeps config content available and quiet when metadata loading fails', async () => {
    vi.mocked(fetchAppMetadata).mockRejectedValueOnce(new Error('metadata unavailable'))

    const view = await renderAt('/config/project')
    const footer = view.querySelector('[data-config-app-version]')

    expect(footer?.textContent).toBe('agent-qa version unavailable')
    expect(section('test-discovery')).not.toBeNull()
    expect(view.querySelector('#test-match')).not.toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('updates the URL and the panel when a tab is chosen', async () => {
    const view = await renderAt('/config')

    await activateTab('project')

    expect(currentLocation()).toEqual({ pathname: '/config/project', search: '' })
    expect(tabTrigger('project')?.getAttribute('aria-selected')).toBe('true')
    expect(view.querySelector('[data-config-panel="models"]')?.getAttribute('data-state')).toBe('inactive')
    expect(view.querySelector('[data-config-panel="models"] [data-config-section]')).toBeNull()
    expect(view.querySelectorAll('[data-tour-id="tour-config-section"]')).toHaveLength(1)
    expect(view.querySelector('[data-tour-id="tour-config-section"]')?.getAttribute('data-config-panel')).toBe('project')
    expect(section('files')).not.toBeNull()
    expect(view.textContent).toContain('Secrets File')
    expect((document.body.querySelector('#workspace-secrets-file') as HTMLInputElement | null)?.value).toBe('.secrets.local')
    expect(view.textContent).toContain('Required dotenv-style file for runtime-only secrets.')
    expect(view.textContent).toContain('Required dotenv file loaded before runs start.')
  })

  it('saves workspace file paths with a required secrets file', async () => {
    await renderAt('/config/project?section=files')

    const hooksInput = document.body.querySelector('#workspace-hooks-file') as HTMLInputElement | null
    const envInput = document.body.querySelector('#workspace-env-file') as HTMLInputElement | null
    const secretsInput = document.body.querySelector('#workspace-secrets-file') as HTMLInputElement | null
    expect(hooksInput).not.toBeNull()
    expect(envInput).not.toBeNull()
    expect(secretsInput).not.toBeNull()

    await act(async () => {
      setInputValue(hooksInput!, 'tests/runtime-hooks.ts')
      setInputValue(envInput!, '.env.ci')
      setInputValue(secretsInput!, '.secrets.ci')
    })

    await act(async () => {
      sectionButton('files', 'Save Changes')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'workspace.hooksFile': 'tests/runtime-hooks.ts',
      'workspace.envFile': '.env.ci',
      'workspace.secretsFile': '.secrets.ci',
    })
  })

  it('blocks saving workspace files when required file paths are empty', async () => {
    await renderAt('/config/project?section=files')

    const hooksInput = document.body.querySelector('#workspace-hooks-file') as HTMLInputElement | null
    const envInput = document.body.querySelector('#workspace-env-file') as HTMLInputElement | null
    const secretsInput = document.body.querySelector('#workspace-secrets-file') as HTMLInputElement | null
    expect(hooksInput).not.toBeNull()
    expect(envInput).not.toBeNull()
    expect(secretsInput).not.toBeNull()

    await act(async () => {
      setInputValue(hooksInput!, '')
      setInputValue(envInput!, '')
      setInputValue(secretsInput!, '')
    })

    await act(async () => {
      sectionButton('files', 'Save Changes')!.click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('Hooks file is required.')
    expect(document.body.textContent).toContain('Environment file is required.')
    expect(document.body.textContent).toContain('Secrets file is required.')
    expect(hooksInput?.getAttribute('aria-invalid')).toBe('true')
    expect(envInput?.getAttribute('aria-invalid')).toBe('true')
    expect(secretsInput?.getAttribute('aria-invalid')).toBe('true')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('blocks saving empty workspace discovery match arrays', async () => {
    await renderAt('/config/project?section=test-discovery')

    const testMatchInput = document.body.querySelector('#test-match') as HTMLTextAreaElement | null
    const suiteMatchInput = document.body.querySelector('#suite-match') as HTMLTextAreaElement | null
    expect(testMatchInput).not.toBeNull()
    expect(suiteMatchInput).not.toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(testMatchInput!, '')
      testMatchInput!.dispatchEvent(new Event('input', { bubbles: true }))
      setter?.call(suiteMatchInput!, '')
      suiteMatchInput!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      sectionButton('test-discovery', 'Save Changes')!.click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('workspace.testMatch must contain at least one pattern.')
    expect(document.body.textContent).toContain('workspace.suiteMatch must contain at least one pattern.')
    expect(updateSettings).not.toHaveBeenCalled()
  })

  it('keeps Logging on Project and Log capture on Execution, each deep-linkable', async () => {
    await renderAt('/config/project?section=logging')

    expect(currentLocation()).toEqual({ pathname: '/config/project', search: '' })
    expect(document.activeElement).toBe(section('logging')?.querySelector('h2'))
    expect(section('log-capture')).toBeNull()

    cleanupAfterDialog()
    await renderAt('/config/execution?section=log-capture')

    expect(currentLocation()).toEqual({ pathname: '/config/execution', search: '' })
    expect(document.activeElement).toBe(section('log-capture')?.querySelector('h2'))
    expect(section('logging')).toBeNull()
  })

  it('renders the model list, the default model, screenshot size and planner limits in one place under Models', async () => {
    const view = await renderAt('/config/models')

    const panel = view.querySelector('[data-config-panel="models"]')
    expect(panel).not.toBeNull()
    expect(Array.from(panel!.querySelectorAll('[data-config-section]')).map((node) => node.getAttribute('data-config-section'))).toEqual([
      'models',
      'screenshot-size',
      'planner-limits',
    ])
    expect(section('models')?.textContent).toContain('primary')
    expect(section('models')?.querySelector('#use-parallel')).not.toBeNull()
    expect(section('models')?.textContent).toContain('Allow eligible web runs and suite parent jobs to share available queue slots by default.')
    expect(section('screenshot-size')?.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS['screenshot-size'])
    expect(section('planner-limits')?.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS['planner-limits'])
    expect(findButton('Execution Defaults')).toBeNull()
  })

  it('renders and saves mobile app-state defaults from the Mobile app state section', async () => {
    await renderAt('/config/targets?section=mobile-app-state')

    const mobile = section('mobile-app-state')
    expect(mobile?.textContent).toContain('App state')
    expect(mobile?.textContent).toContain('Reset app data')

    await act(async () => {
      sectionButton('mobile-app-state', 'Save Mobile Defaults')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'use.mobile.appState': 'reset',
    })
  })

  it('keeps browser headless out of the Models tab defaults', async () => {
    await renderAt('/config/models')

    const models = section('models')!
    expect(models.textContent).toContain('Allow eligible web runs and suite parent jobs to share available queue slots by default.')
    expect(models.textContent).not.toContain('Global Headless')
    expect(document.body.querySelector('#use-global-headless')).toBeNull()
    expect(document.body.querySelector('#browser-headless')).toBeNull()
    expect(models.textContent).not.toContain('use.browser.headless')
    expect(models.textContent).not.toContain('use.headless')

    const parallelSwitch = models.querySelector('#use-parallel') as HTMLButtonElement | null
    expect(parallelSwitch).not.toBeNull()

    await act(async () => {
      parallelSwitch!.click()
    })
    await flushRender()

    await act(async () => {
      sectionButton('models', 'Save Runtime Defaults')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'use.parallel': false,
      'use.llm': 'primary',
    })
    expect(models.textContent).not.toContain('Default Device')
    expect(models.textContent).not.toContain('use.device')
  })

  it('saves browser headless from the Browser section only', async () => {
    await renderAt('/config/execution?section=browser')

    const browser = section('browser')!
    expect(browser.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS.browser)
    expect(browser.textContent).toContain('Run web browsers without a visible window.')

    const headlessSwitch = browser.querySelector('#browser-headless') as HTMLButtonElement | null
    expect(headlessSwitch).not.toBeNull()

    await act(async () => {
      headlessSwitch!.click()
    })
    await flushRender()

    await act(async () => {
      sectionButton('browser', 'Save Changes')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'use.browser': {
        name: 'chromium',
        headless: false,
        viewport: { width: 1280, height: 720 },
      },
    })
  })

  it('shows consolidated runtime path placeholders for dashboard and cache', async () => {
    const view = await renderAt('/config/project?section=dashboard')

    const dbPathInput = document.body.querySelector('#dashboard-db-path') as HTMLInputElement | null
    expect(dbPathInput).not.toBeNull()
    expect(dbPathInput?.placeholder).toBe('.agent-qa/runs.db')
    expect(view.textContent).not.toContain('Tests Directory')
    expect(document.body.querySelector('#dashboard-tests-dir')).toBeNull()

    await activateTab('execution')

    expect(currentLocation()).toEqual({ pathname: '/config/execution', search: '' })
    const cacheDirInput = section('cache')?.querySelector('#cache-dir') as HTMLInputElement | null
    expect(cacheDirInput).not.toBeNull()
    expect(cacheDirInput?.placeholder).toBe('.agent-qa/cache')
  })

  it('renders Saved login states as a list-only Targets section without secret details', async () => {
    vi.mocked(fetchAuthStates).mockResolvedValueOnce({
      authStates: [
        {
          version: 1,
          kind: 'web',
          target: 'staging-web',
          name: 'admin',
          capturedAt: '2026-05-17T10:00:00.000Z',
          storageStatePath: '.agent-qa/auth-states/staging-web/admin/storage-state.json',
          payload: { cookies: [{ name: 'sid', value: 'secret-session' }] },
          localStorage: 'unsafe-storage-value',
          indexedDB: 'unsafe-indexed-db',
          counts: { cookies: 1 },
          ttl: '7d',
          expiry: '2026-05-24T10:00:00.000Z',
          source: 'live-mode',
          createdAt: '2026-05-17T09:00:00.000Z',
          updatedAt: '2026-05-17T10:01:00.000Z',
        } as never,
      ],
    })

    await renderAt('/config/targets?section=login-states')

    const loginStates = section('login-states')!
    expect(currentLocation()).toEqual({ pathname: '/config/targets', search: '' })
    expect(loginStates.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS['login-states'])
    expect(loginStates.textContent).not.toContain('services.authState')
    expect(loginStates.textContent).toContain('Target')
    expect(loginStates.textContent).toContain('Name')
    expect(loginStates.textContent).toContain('Captured')
    expect(loginStates.textContent).toContain('Kind')
    expect(loginStates.textContent).toContain('staging-web')
    expect(loginStates.textContent).toContain('admin')
    expect(loginStates.textContent).toContain('web')
    expect(loginStates.querySelector('time[datetime="2026-05-17T10:00:00.000Z"]')).not.toBeNull()
    expect(fetchAuthStates).toHaveBeenCalledTimes(1)

    const forbiddenCopy = [
      'Delete',
      'Export',
      'Import',
      'Rename',
      'Reveal path',
      'View payload',
      '.agent-qa/auth-states',
      'storage-state.json',
      'secret-session',
      'unsafe-storage-value',
      'unsafe-indexed-db',
      'counts',
      '7d',
      '2026-05-24T10:00:00.000Z',
      'live-mode',
      '2026-05-17T09:00:00.000Z',
      '2026-05-17T10:01:00.000Z',
    ]
    for (const text of forbiddenCopy) {
      expect(loginStates.textContent).not.toContain(text)
    }
  })

  it('renders the Saved login states empty state copy', async () => {
    vi.mocked(fetchAuthStates).mockResolvedValueOnce({ authStates: [] })

    await renderAt('/config/targets?section=login-states')

    expect(section('login-states')?.textContent).toContain('No auth states saved')
    expect(section('login-states')?.textContent).toContain('Save auth state from a connected web Live Mode session.')
  })

  it('renders a safe Saved login states load failure message', async () => {
    vi.mocked(fetchAuthStates).mockRejectedValueOnce(new Error('metadata path leaked'))

    const view = await renderAt('/config/targets?section=login-states')

    expect(section('login-states')?.textContent).toContain('Could not load saved auth states.')
    expect(view.textContent).not.toContain('metadata path leaked')
  })

  it('exposes and saves the knowledge directory with the knowledge settings block', async () => {
    await renderAt('/config/project?section=knowledge')

    const knowledgeDirInput = document.body.querySelector('#knowledge-dir') as HTMLInputElement | null
    expect(knowledgeDirInput).not.toBeNull()
    expect(knowledgeDirInput?.placeholder).toBe('agent-qa-knowledge')
    expect(knowledgeDirInput?.value).toBe('agent-qa-knowledge')

    await act(async () => {
      setInputValue(knowledgeDirInput!, 'docs/agent-qa-knowledge')
    })
    await flushRender()

    await act(async () => {
      sectionButton('knowledge', 'Save Changes')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'knowledge': {
        dir: 'docs/agent-qa-knowledge',
        commitArtifacts: 'none',
      },
    })
  })

  it('edits analytics pass rate scope attributes', async () => {
    await renderAt('/config/project?section=pass-rate-scope')

    const scope = section('pass-rate-scope')!
    expect(currentLocation()).toEqual({ pathname: '/config/project', search: '' })
    expect(scope.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS['pass-rate-scope'])
    expect(scope.textContent).not.toContain('analytics.passRateScope.attributes')
    expect(scope.textContent).toContain('Regex')

    const branchValue = document.body.querySelector('#analytics-scope-value-existing-0') as HTMLInputElement | null
    expect(branchValue?.value).toBe('master')

    await act(async () => {
      setInputValue(branchValue!, 'main')
    })

    await act(async () => {
      sectionButton('pass-rate-scope', 'Save Changes')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'analytics.passRateScope': {
        attributes: {
          'git.branch': 'main',
          'user.email': { regex: '^ci@' },
        },
      },
    })
  })

  it('exposes vision and context window in the LLM configuration modal', async () => {
    await renderAt('/config/models')

    await openFirstLlmEditor()

    const visionSwitch = document.body.querySelector('#config-vision') as HTMLButtonElement | null
    const contextWindowInput = document.body.querySelector('#config-context-window') as HTMLInputElement | null

    expect(visionSwitch?.getAttribute('role')).toBe('switch')
    expect(visionSwitch?.getAttribute('aria-checked')).toBe('true')
    expect(document.body.textContent).toContain('Vision (optional)')
    expect(document.body.textContent).toContain('Context Window (optional)')
    expect(contextWindowInput?.value).toBe('128k')
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.querySelector('#config-effective-resolution')).toBeNull()
    expect(dialog?.textContent).not.toContain('Effective Resolution')
  })

  it('formats OpenAI-Compatible configs and keeps static provider fallback built-in only', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })

    const view = await renderAt('/config/models')

    expect(LLM_PROVIDER_OPTIONS.map((option) => option.value)).toEqual([
      'openai-compatible',
      'anthropic-compatible',
      'gemini',
    ])
    expect(view.textContent).toContain('OpenAI-compatible')
    expect(view.textContent).not.toContain('Ollama')
    expect(view.textContent).not.toContain('LM Studio')
    expect(view.textContent).not.toContain('Custom')
  })

  it('does not mark provider-mismatched same-name credentials connected', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'anthropic-subscription',
        model: 'claude-sonnet-4-20250514',
      }),
    })
    vi.mocked(fetchAuthStatus).mockResolvedValueOnce({
      credentials: [{
        configName: 'planner',
        provider: 'openai-subscription',
        type: 'oauth',
        expires: Date.now() + 3600000,
        source: 'auth',
      }],
    })

    const view = await renderAt('/config/models')

    expect(view.textContent).toContain('Missing credential')
    expect(view.textContent).not.toContain('OAuth connected')
  })

  it('renders the OpenAI-Compatible modal with free-form model and Base URL tooltip', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
        vision: true,
        contextWindow: '256k',
      }),
    })

    await renderAt('/config/models')
    await openFirstLlmEditor()

    const modelInput = Array.from(document.body.querySelectorAll('input'))
      .find((input) => input.value === 'openrouter/auto') as HTMLInputElement | undefined
    const baseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement | null
    const contextWindowInput = document.body.querySelector('#config-context-window') as HTMLInputElement | null
    const endpointHelp = document.body.querySelector('button[aria-label="Compatible endpoint help"]')

    expect(document.body.textContent).toContain('Base URL')
    expect(document.body.textContent).toContain('Enter the exact endpoint base URL. agent-qa will not append paths.')
    expect(endpointHelp).not.toBeNull()
    expect(baseUrlInput?.placeholder).toBe('https://openrouter.ai/api/v1')
    expect(baseUrlInput?.value).toBe('https://openrouter.ai/api/v1')
    expect(contextWindowInput?.value).toBe('256k')
    expect(modelInput?.getAttribute('list')).toBe('config-model-options-openai-compatible')
    expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain('Subscription')
  })

  it('requires Base URL before saving OpenAI-Compatible configs', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-compatible',
        model: 'openrouter/auto',
      }),
    })

    await renderAt('/config/models')
    await openFirstLlmEditor()

    await act(async () => {
      dialogButton('Save Changes')!.click()
    })
    await flushRender()

    const baseUrlInput = document.body.querySelector('#config-base-url') as HTMLInputElement | null
    expect(document.body.textContent).toContain('Base URL is required for compatible providers.')
    expect(baseUrlInput?.getAttribute('aria-describedby')).toBe('base-url-error')
  })

  it('saves and tests OpenAI-Compatible credentials with the named config key', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })
    vi.mocked(testLLMConnection).mockResolvedValueOnce({
      success: true,
      provider: 'openai-compatible',
      model: 'openrouter/auto',
      unauthenticated: false,
    })

    await renderAt('/config/models')
    await openFirstLlmEditor()

    const keyInput = document.body.querySelector('input[type="password"][placeholder="secret-value"]') as HTMLInputElement
    await act(async () => {
      setInputValue(keyInput, 'sk-router')
    })
    await flushRender()

    await act(async () => {
      dialogButton('Save Credential')!.click()
    })
    await flushRender()

    expect(saveCredential).toHaveBeenCalledWith('planner', 'openai-compatible', 'api-key', 'sk-router')

    await act(async () => {
      dialogButton('Test Connection')!.click()
    })
    await flushRender()

    expect(testLLMConnection).toHaveBeenCalledWith({
      provider: 'openai-compatible',
      model: 'openrouter/auto',
      baseURL: 'https://openrouter.ai/api/v1',
      configName: 'planner',
    })
    expect(document.body.textContent).toContain('Connection successful')
  })

  it('does not render blocking no-api-key copy for compatible no-key tests', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-compatible',
        model: 'openrouter/auto',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    })
    vi.mocked(testLLMConnection).mockResolvedValueOnce({
      success: false,
      error: 'no_api_key',
      unauthenticated: true,
      message: 'Testing without a saved API key.',
    })

    await renderAt('/config/models')
    await openFirstLlmEditor()

    await act(async () => {
      dialogButton('Test Connection')!.click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('Testing without a saved API key.')
    expect(document.body.textContent).not.toContain('No API key or subscription configured')
  })

  it('keeps first-party subscription auth UI available', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-subscription',
        model: 'gpt-5.4',
      }),
    })

    await renderAt('/config/models')
    await openFirstLlmEditor()

    expect(document.body.textContent).toContain('Login with OpenAI subscription')
    expect(document.body.textContent).not.toContain('Save Credential')
  })

  it('exchanges Anthropic subscription codes with the product provider identifier', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'anthropic-subscription',
        model: 'claude-sonnet-4-20250514',
      }),
    })

    try {
      await renderAt('/config/models')
      await openFirstLlmEditor()

      await act(async () => {
        dialogButton('Login with Anthropic subscription')!.click()
      })
      await flushRender()

      const codeInput = document.body.querySelector('input[placeholder="authorization-code"]') as HTMLInputElement
      await act(async () => {
        setInputValue(codeInput, 'anthropic-code')
      })
      await flushRender()

      await act(async () => {
        dialogButton('Connect')!.click()
      })
      await flushRender()

      expect(startPluginAuth).toHaveBeenCalledWith('anthropic-subscription', 'planner')
      expect(openSpy).toHaveBeenCalledWith('https://auth.example/start', '_blank')
      expect(exchangePluginAuthCode).toHaveBeenCalledWith(
        'anthropic-subscription',
        'session-1',
        'anthropic-code',
      )
    } finally {
      openSpy.mockRestore()
    }
  })

  it('polls OpenAI subscription OAuth and relies on server-owned credential persistence', async () => {
    vi.useFakeTimers()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.mocked(startPluginAuth).mockResolvedValueOnce({
      authorizeUrl: 'https://auth.example/openai',
      sessionId: 'session-1',
      mode: 'browser-poll',
    })
    vi.mocked(pollPluginAuthResult).mockResolvedValueOnce({ status: 'completed', saved: true })
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithLlm({
        name: 'planner',
        provider: 'openai-subscription',
        model: 'gpt-5.4',
      }),
    })

    try {
      await renderAt('/config/models')
      await openFirstLlmEditor()

      await act(async () => {
        dialogButton('Login with OpenAI subscription')!.click()
      })
      await flushRender()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      await flushRender()

      expect(startPluginAuth).toHaveBeenCalledWith('openai-subscription', 'planner')
      expect(openSpy).toHaveBeenCalledWith('https://auth.example/openai', '_blank')
      expect(pollPluginAuthResult).toHaveBeenCalledWith('openai-subscription', 'session-1')
      expect(saveCredential).not.toHaveBeenCalled()
      expect(exchangePluginAuthCode).not.toHaveBeenCalled()
    } finally {
      openSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('uses focused modal edit flows for Targets and Devices', async () => {
    await renderAt('/config/targets?section=targets')

    await act(async () => {
      sectionButton('targets', 'Edit')!.click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('Edit staging')
    expect(document.body.textContent).toContain('Apply Target Changes')

    cleanupAfterDialog()

    await renderAt('/config/targets?section=devices')

    await act(async () => {
      sectionButton('devices', 'Edit')!.click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('Edit iosLocal')
    expect(document.body.textContent).toContain('Apply Device Changes')
  })

  it('uses an approved SaaS slug for the target product placeholder', async () => {
    await renderAt('/config/targets')

    await act(async () => {
      sectionButton('targets', 'Add Target')!.click()
    })
    await flushRender()

    const productInput = document.body.querySelector('#target-product') as HTMLInputElement | null
    expect(productInput).not.toBeNull()

    const firstPlaceholder = productInput!.placeholder
    expect([...APPROVED_SAAS_PLACEHOLDER_SLUGS]).toContain(firstPlaceholder)

    await flushRender()
    expect((document.body.querySelector('#target-product') as HTMLInputElement | null)?.placeholder).toBe(firstPlaceholder)
  })

  it('saves mobile target app install fields from the target editor', async () => {
    vi.mocked(fetchConfig).mockResolvedValueOnce({
      config: configWithTargets({
        releaseAndroid: {
          platform: 'android',
          appPackage: 'org.wikipedia.alpha',
          appActivity: 'org.wikipedia.main.MainActivity',
        },
      }),
    })

    await renderAt('/config/targets')

    await act(async () => {
      sectionButton('targets', 'Edit')!.click()
    })
    await flushRender()

    const appPathInput = document.body.querySelector('#target-app-path') as HTMLInputElement | null
    const browserstackInput = document.body.querySelector('#target-browserstack-app') as HTMLInputElement | null
    expect(appPathInput).not.toBeNull()
    expect(browserstackInput).not.toBeNull()

    await act(async () => {
      setInputValue(appPathInput!, 'apps/wikipedia-alpha.apk')
      setInputValue(browserstackInput!, 'bs://uploaded-app')
    })
    await flushRender()

    await act(async () => {
      dialogButton('Apply Target Changes')!.click()
    })
    await flushRender()

    expect(section('targets')?.textContent).toContain('App: apps/wikipedia-alpha.apk / bs://uploaded-app')

    await act(async () => {
      sectionButton('targets', 'Save Changes')!.click()
    })
    await flushRender()

    expect(updateSettings).toHaveBeenCalledWith({
      'registry.targets': {
        releaseAndroid: {
          platform: 'android',
          appPackage: 'org.wikipedia.alpha',
          appActivity: 'org.wikipedia.main.MainActivity',
          app: {
            path: 'apps/wikipedia-alpha.apk',
            browserstack: 'bs://uploaded-app',
          },
        },
      },
    })
  })

  it('explains device farm usage clearly and edits them in a modal', async () => {
    await renderAt('/config/targets?section=device-farms')

    const farms = section('device-farms')!
    expect(farms.querySelector('h2')?.textContent).toBe(CONFIG_SECTION_LABELS['device-farms'])
    expect(farms.textContent).toContain('BrowserStack')
    expect(farms.textContent).toContain('provider-specific JSON keyed by provider name')

    await act(async () => {
      sectionButton('device-farms', 'Edit')!.click()
    })
    await flushRender()

    expect(document.body.textContent).toContain('Edit openai')
    expect(document.body.textContent).toContain('Apply Provider Changes')
  })
})

function cleanupAfterDialog() {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) {
    container.remove()
  }
  container = null
}
