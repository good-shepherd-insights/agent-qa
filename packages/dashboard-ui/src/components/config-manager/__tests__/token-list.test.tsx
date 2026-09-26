// @vitest-environment jsdom

// ACCESS TOKENS AS IN-PAGE LISTS (429-27 Task 1 · D-05, D-06, D-08, D-23, D-24 · research A7 · UI-SPEC S7, E9).
//
// MCP access tokens and run-service tokens list by name with the environment variable's NAME in
// clear, never a value. Add token asks for what the schema requires (a scope for an MCP token, an
// optional trust scope for a run-service token) and writes one append once the row is valid; a
// delete acts at once with Undo.

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenList } from '@/components/config-manager/token-list'
import { ConfigAutosaveProvider, useConfigAutosave, type ConfigAutosave } from '@/hooks/use-config-autosave'
import { applyConfigChanges, fetchConfig, fetchConfigRevision, undoConfigAction } from '@/lib/api'
import {
  ACCESS_TOKENS_HEADING,
  ADD_TOKEN_LABEL,
  FUNCTION_SCOPE_LABELS,
  NO_TOKENS_TEXT,
  SCOPE_REQUIRED_ERROR,
  TOKEN_NAME_REQUIRED_ERROR,
  TRUST_SCOPE_LABELS,
  deleteActionName,
  tokenEnvLine,
  undoLine,
} from '@/lib/config-copy'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  fetchConfig: vi.fn(),
  fetchConfigRevision: vi.fn(),
  applyConfigChanges: vi.fn(),
  undoConfigAction: vi.fn(),
  revealConfigValue: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONFIG_PATH = '/work/agent-qa.config.yaml'

const records = {
  services: {
    mcp: {
      tokens: [
        { name: 'ci', tokenEnvVar: 'AGENT_QA_MCP_TOKEN', scopes: ['read'] },
        { name: 'desktop', tokenEnvVar: 'AGENT_QA_DESKTOP_TOKEN', scopes: ['read', 'run'] },
      ],
    },
    dashboard: {
      runServiceTokens: [{ name: 'teammate', tokenEnvVar: 'AGENT_QA_RUN_TOKEN', trustScope: { project: 'acme-web' } }],
    },
  },
}

function answer(config: Record<string, unknown>) {
  return { config, provider: null, revision: 'rev-1', file: { path: CONFIG_PATH, lines: [] } }
}

let hook: ConfigAutosave | undefined

function Harness() {
  const autosave = useConfigAutosave()
  hook = autosave
  if (autosave.load.kind !== 'ready') return null
  const config = autosave.load.answer.config
  return (
    <ConfigAutosaveProvider value={autosave}>
      <section data-config-section="mcp">
        <TokenList kind="mcp" config={config} />
      </section>
      <section data-config-section="run-service-tokens">
        <TokenList kind="run-service" config={config} />
      </section>
    </ConfigAutosaveProvider>
  )
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<Harness />)
  })
  await flush()
}

async function unmount() {
  if (root) {
    await act(async () => root!.unmount())
  }
  root = null
  container?.remove()
  container = null
  hook = undefined
}

function section(id: 'mcp' | 'run-service-tokens') {
  return container?.querySelector(`[data-config-section="${id}"]`) as HTMLElement | null
}

function tokenRow(scope: HTMLElement | null, name: string) {
  return (Array.from(scope?.querySelectorAll('[data-token-row]') ?? []) as HTMLElement[]).find(
    (row) => row.getAttribute('data-token-name') === name,
  ) ?? null
}

function buttonIn(scope: ParentNode | null | undefined, text: string) {
  const buttons = Array.from(scope?.querySelectorAll('button') ?? []) as HTMLButtonElement[]
  return buttons.find((button) => button.textContent?.trim() === text || button.getAttribute('aria-label') === text) ?? null
}

function labelOf(control: Element): string | undefined {
  return control.ownerDocument.querySelector(`label[for="${control.id}"]`)?.textContent?.trim()
}

async function click(element: HTMLElement | null) {
  expect(element).not.toBeNull()
  await act(async () => {
    element!.focus()
    element!.click()
  })
  await flush()
}

async function type(input: HTMLInputElement | null, value: string) {
  expect(input).not.toBeNull()
  await act(async () => {
    input!.focus()
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input!, value)
    input!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

async function pressEnter(input: HTMLInputElement | null) {
  expect(input).not.toBeNull()
  await act(async () => {
    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  await flush()
}

function draftIn(scope: HTMLElement | null) {
  return scope?.querySelector('[data-token-draft]') as HTMLElement | null
}

function draftInput(draft: HTMLElement | null, name: string) {
  return draft?.querySelector(`input[name="${name}"]`) as HTMLInputElement | null
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(fetchConfig).mockResolvedValue(answer(records) as never)
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: 'rev-1' })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: 'rev-2' } as never)
})

afterEach(async () => {
  await unmount()
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe('TokenList (429-27 Task 1)', () => {
  it('TOKEN-ENV-NAME-IN-CLEAR: a token row shows its name and Token from {ENV_VAR}, the variable in clear and mono', async () => {
    await mount()

    const mcp = section('mcp')
    expect(mcp!.querySelector('h3')?.textContent).toBe(ACCESS_TOKENS_HEADING)
    expect(mcp!.querySelector('[data-field-list="services.mcp.tokens"]')).not.toBeNull()
    expect(section('run-service-tokens')!.querySelector('[data-field-list="services.dashboard.runServiceTokens"]')).not.toBeNull()
    expect(section('run-service-tokens')!.querySelector('h3')).toBeNull()

    const row = tokenRow(mcp, 'ci')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('ci')
    expect(row!.textContent).toContain(tokenEnvLine('AGENT_QA_MCP_TOKEN'))
    const mono = Array.from(row!.querySelectorAll('.font-mono')).map((element) => element.textContent)
    expect(mono).toContain('ci')
    expect(mono).toContain('AGENT_QA_MCP_TOKEN')
    const variable = Array.from(row!.querySelectorAll('.font-mono')).find((element) => element.textContent === 'AGENT_QA_MCP_TOKEN')
    expect(variable?.className).toContain('wrap-anywhere')
    expect(row!.textContent).not.toContain('[masked]')
    expect(row!.textContent).not.toContain('•')
    expect(row!.querySelector('input[type="password"]')).toBeNull()

    const teammate = tokenRow(section('run-service-tokens'), 'teammate')
    expect(teammate!.textContent).toContain(tokenEnvLine('AGENT_QA_RUN_TOKEN'))
  })

  it('ADD-MCP-TOKEN-NEEDS-SCOPE: the MCP add row offers the six scopes and writes one append only once a scope is checked', async () => {
    await mount()
    const mcp = section('mcp')

    await click(buttonIn(mcp, ADD_TOKEN_LABEL))
    const draft = draftIn(mcp)
    expect(draft).not.toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    const boxes = Array.from(draft!.querySelectorAll('[role="checkbox"]'))
    expect(boxes.map((box) => labelOf(box))).toEqual(FunctionScopeSchema.options.map((scope) => FUNCTION_SCOPE_LABELS[scope]))
    expect(draftInput(draft, 'project')).toBeNull()

    const name = draftInput(draft, 'name')
    expect(document.activeElement).toBe(name)
    await pressEnter(name)
    expect(draft!.textContent).toContain(TOKEN_NAME_REQUIRED_ERROR)

    await type(name, 'agent')
    await type(draftInput(draft, 'tokenEnvVar'), 'AGENT_QA_AGENT_TOKEN')
    await pressEnter(draftInput(draft, 'tokenEnvVar'))

    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(draft!.textContent).toContain(SCOPE_REQUIRED_ERROR)
    expect(hook!.status.state).toBe('draft')
    expect(hook!.draftTabs.has('advanced')).toBe(true)

    const read = boxes.find((box) => labelOf(box) === FUNCTION_SCOPE_LABELS.read) as HTMLElement
    await click(read)

    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'append', path: ['services', 'mcp', 'tokens'], value: { name: 'agent', tokenEnvVar: 'AGENT_QA_AGENT_TOKEN', scopes: ['read'] } }]],
    ])
    expect(draftIn(mcp)).toBeNull()
    expect(tokenRow(mcp, 'agent')).not.toBeNull()
    expect(hook!.draftTabs.has('advanced')).toBe(false)
  })

  it('ADD-RUN-SERVICE-TOKEN: the run-service add row takes an optional Project and Org and never writes an empty one', async () => {
    await mount()
    const service = section('run-service-tokens')

    await click(buttonIn(service, ADD_TOKEN_LABEL))
    let draft = draftIn(service)
    expect(draft!.querySelector('[role="checkbox"]')).toBeNull()
    expect(labelOf(draftInput(draft, 'project')!)).toBe(TRUST_SCOPE_LABELS.project)
    expect(labelOf(draftInput(draft, 'org')!)).toBe(TRUST_SCOPE_LABELS.org)

    await type(draftInput(draft, 'name'), 'ci-bot')
    await type(draftInput(draft, 'tokenEnvVar'), 'AGENT_QA_CI_TOKEN')
    await pressEnter(draftInput(draft, 'tokenEnvVar'))

    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'append', path: ['services', 'dashboard', 'runServiceTokens'], value: { name: 'ci-bot', tokenEnvVar: 'AGENT_QA_CI_TOKEN', trustScope: {} } }]],
    ])
    expect(tokenRow(service, 'ci-bot')).not.toBeNull()

    await click(buttonIn(service, ADD_TOKEN_LABEL))
    draft = draftIn(service)
    await type(draftInput(draft, 'name'), 'acme')
    await type(draftInput(draft, 'tokenEnvVar'), 'AGENT_QA_ACME_TOKEN')
    await type(draftInput(draft, 'project'), 'acme-web')
    await pressEnter(draftInput(draft, 'project'))

    const [changes] = vi.mocked(applyConfigChanges).mock.calls[1]!
    expect(changes).toEqual([
      { op: 'append', path: ['services', 'dashboard', 'runServiceTokens'], value: { name: 'acme', tokenEnvVar: 'AGENT_QA_ACME_TOKEN', trustScope: { project: 'acme-web' } } },
    ])
    const value = (changes[0] as { value: { trustScope: Record<string, unknown> } }).value
    expect(Object.keys(value.trustScope)).toEqual(['project'])
  })

  it('TOKEN-DELETE-UNDO: deleting a token removes its row at once with one undoable unset by name, and Undo restores it', async () => {
    await mount()
    const mcp = section('mcp')
    const write = deferred<{ revision: string; undo: { token: string; expiresAt: number } }>()
    vi.mocked(applyConfigChanges).mockReturnValueOnce(write.promise as never)

    const remove = buttonIn(tokenRow(mcp, 'ci'), deleteActionName('delete-mcp-token', 'ci'))
    expect(remove?.getAttribute('aria-label')).toBe('Delete token ci')
    expect(remove?.querySelector('svg')?.getAttribute('class')).toContain('lucide-trash')
    await click(remove)

    expect(tokenRow(mcp, 'ci')).toBeNull()
    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'unset', path: ['services', 'mcp', 'tokens', { name: 'ci' }] }], { undoable: true }],
    ])
    expect(document.activeElement).toBe(buttonIn(tokenRow(mcp, 'desktop'), deleteActionName('delete-mcp-token', 'desktop')))

    await act(async () => {
      write.resolve({ revision: 'rev-2', undo: { token: 'tok-mcp', expiresAt: Date.now() + 30_000 } })
    })
    await flush()
    expect(tokenRow(mcp, 'ci')).toBeNull()
    expect(hook!.status.state).toBe('undo')
    expect(hook!.status.undo?.line).toBe(undoLine('delete-mcp-token', 'ci'))

    vi.mocked(undoConfigAction).mockResolvedValueOnce({ restored: true, revision: 'rev-3' })
    await act(async () => {
      await hook!.undo()
    })
    await flush()
    expect(undoConfigAction).toHaveBeenCalledWith('tok-mcp')
    expect(tokenRow(mcp, 'ci')).not.toBeNull()

    vi.mocked(applyConfigChanges).mockClear()
    vi.mocked(applyConfigChanges).mockResolvedValueOnce({
      revision: 'rev-4',
      undo: { token: 'tok-service', expiresAt: Date.now() + 30_000 },
    } as never)
    const service = section('run-service-tokens')
    await click(buttonIn(tokenRow(service, 'teammate'), deleteActionName('delete-run-service-token', 'teammate')))

    expect(tokenRow(service, 'teammate')).toBeNull()
    expect(vi.mocked(applyConfigChanges).mock.calls).toEqual([
      [[{ op: 'unset', path: ['services', 'dashboard', 'runServiceTokens', { name: 'teammate' }] }], { undoable: true }],
    ])
    expect(hook!.status.undo?.line).toBe(undoLine('delete-run-service-token', 'teammate'))
    expect(document.activeElement).toBe(buttonIn(service, ADD_TOKEN_LABEL))
  })

  it('NO-TOKENS-EMPTY-STATE: a list with no tokens shows NO_TOKENS_TEXT beside Add token', async () => {
    vi.mocked(fetchConfig).mockResolvedValue(answer({}) as never)
    await mount()

    for (const id of ['mcp', 'run-service-tokens'] as const) {
      const add = buttonIn(section(id), ADD_TOKEN_LABEL)
      expect(add).not.toBeNull()
      expect(section(id)!.querySelector('[data-token-row]')).toBeNull()
      expect(add!.parentElement?.textContent).toContain(NO_TOKENS_TEXT)
    }
  })
})
