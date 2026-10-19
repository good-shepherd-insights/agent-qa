import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 437 D-11 (CR-02): the exact WebView observer script the adapter sends through driver.execute,
// evaluated against a small hand-built DOM stub. The stub implements only what the script reads.

interface StubRect {
  left: number
  top: number
  width: number
  height: number
}

interface StubElement {
  tagName: string
  id: string
  attrs: Record<string, string>
  textContent: string
  value?: string
  type?: string
  alt?: string
  text?: string
  options?: StubElement[]
  selectedIndex?: number
  checked?: boolean
  disabled: boolean
  readOnly: boolean
  isContentEditable: boolean
  parentElement: StubElement | null
  children: StubElement[]
  labels?: StubElement[]
  rect: StubRect
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  getBoundingClientRect(): StubRect
  contains(other: StubElement): boolean
}

interface ElementSpec {
  attrs?: Record<string, string>
  text?: string
  value?: string
  children?: StubElement[]
}

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const OBSERVED_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'TEXTAREA',
  'SELECT',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
])

function el(tag: string, spec: ElementSpec = {}): StubElement {
  const tagName = tag.toUpperCase()
  const attrs = spec.attrs ?? {}
  const children = spec.children ?? []
  const node: StubElement = {
    tagName,
    id: attrs.id ?? '',
    attrs,
    textContent: spec.text ?? children.map((c) => c.textContent).join(''),
    disabled: 'disabled' in attrs,
    readOnly: 'readonly' in attrs,
    isContentEditable: attrs.contenteditable === 'true',
    parentElement: null,
    children,
    rect: { left: 0, top: 0, width: 0, height: 0 },
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => name in attrs,
    getBoundingClientRect: () => node.rect,
    contains: (other) => {
      for (let p: StubElement | null = other; p; p = p.parentElement) if (p === node) return true
      return false
    },
  }
  if (tagName === 'INPUT') {
    node.type = attrs.type ?? 'text'
    node.value = spec.value ?? attrs.value ?? ''
  } else if (tagName === 'TEXTAREA') {
    node.type = 'textarea'
    node.value = spec.value ?? node.textContent
  } else if (tagName === 'SELECT') {
    node.type = 'select-one'
    node.value = spec.value ?? ''
    node.options = children.filter((c) => c.tagName === 'OPTION')
    const chosen = node.options.findIndex((o) => 'selected' in o.attrs)
    node.selectedIndex = chosen !== -1 ? chosen : node.options.length > 0 ? 0 : -1
  } else if (tagName === 'OPTION') {
    node.text = node.textContent
  } else if (tagName === 'IMG') {
    node.alt = attrs.alt ?? ''
  }
  for (const child of children) child.parentElement = node
  return node
}

function walk(nodes: StubElement[], all: StubElement[]): void {
  for (const node of nodes) {
    all.push(node)
    walk(node.children, all)
  }
}

// A page lists its root elements; each element gets a distinct visible box in document order.
function page(...roots: StubElement[]) {
  const all: StubElement[] = []
  walk(roots, all)
  all.forEach((node, i) => {
    node.rect = { left: 10, top: 10 + i * 50, width: 200, height: 40 }
    // Document order visits a parent first, so its own flag is already set when a child inherits.
    node.isContentEditable =
      node.attrs.contenteditable === 'true' ||
      (node.parentElement?.isContentEditable === true && node.attrs.contenteditable !== 'false')
  })
  for (const node of all) {
    if (!FIELD_TAGS.has(node.tagName)) continue
    node.labels = all.filter(
      (l) => l.tagName === 'LABEL' && ((node.id && l.attrs.for === node.id) || l.contains(node)),
    )
  }
  const observed = all.filter(
    (n) =>
      OBSERVED_TAGS.has(n.tagName) ||
      (n.tagName === 'IMG' && 'alt' in n.attrs) ||
      'role' in n.attrs ||
      n.attrs.contenteditable === 'true',
  )
  const document = {
    activeElement: null,
    documentElement: { scrollWidth: 400, scrollHeight: 800 },
    querySelectorAll: () => observed,
    getElementById: (id: string) => all.find((n) => n.id === id) ?? null,
  }
  const window = {
    innerWidth: 400,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  }
  return { document, window, location: { href: 'https://shop.local/contact' } }
}

function form(...children: StubElement[]): StubElement {
  return el('form', { children })
}

type Page = ReturnType<typeof page>

let current: Page
let observerScripts: string[] = []

function evaluate(script: string): unknown {
  observerScripts.push(script)
  const run = new Function('document', 'window', 'location', script) as (
    d: Page['document'],
    w: Page['window'],
    l: Page['location'],
  ) => unknown
  return run(current.document, current.window, current.location)
}

function createMockDriver() {
  const chain: Record<string, any> = {}
  chain.move = vi.fn().mockReturnValue(chain)
  chain.down = vi.fn().mockReturnValue(chain)
  chain.up = vi.fn().mockReturnValue(chain)
  chain.pause = vi.fn().mockReturnValue(chain)
  chain.perform = vi.fn().mockResolvedValue(undefined)
  return {
    getPageSource: vi.fn().mockResolvedValue('<hierarchy />'),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 1920 }),
    takeScreenshot: vi.fn().mockResolvedValue(''),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    activateApp: vi.fn().mockResolvedValue(undefined),
    action: vi.fn().mockReturnValue(chain),
    keys: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    execute: vi
      .fn()
      .mockImplementation((command: unknown) =>
        Promise.resolve(
          typeof command === 'string' && !command.startsWith('mobile:')
            ? evaluate(command)
            : undefined,
        ),
      ),
    getContexts: vi.fn().mockResolvedValue(['NATIVE_APP', 'WEBVIEW_app.shop']),
    switchContext: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockRejectedValue(new Error('not supported')),
    $: vi.fn(),
  }
}

vi.mock('webdriverio', () => ({ remote: vi.fn() }))

import { ExplicitExtractor } from '@vostride/agent-qa-runner'
import { AndroidPlatformAdapter } from '../adapter.js'

let adapter: AndroidPlatformAdapter

beforeEach(async () => {
  vi.clearAllMocks()
  observerScripts = []
  const { remote } = await import('webdriverio')
  vi.mocked(remote).mockResolvedValue(createMockDriver() as any)
  adapter = new AndroidPlatformAdapter()
  await adapter.setup({ platform: 'android', appPackage: 'app.shop' } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function observe(p: Page) {
  current = p
  const state = await adapter.observe()
  expect(state.url).toBe('https://shop.local/contact')
  expect(observerScripts.length).toBeGreaterThan(0)
  return state
}

function textboxes(state: Awaited<ReturnType<typeof observe>>) {
  return state.elements.filter((e) => e.role === 'textbox')
}

describe('C437-WEBVIEW-OBSERVE', () => {
  it('a labelled input and a labelled textarea both reach the tree, named by their labels', async () => {
    const state = await observe(
      page(
        form(
          el('label', { attrs: { for: 'name' }, text: 'Name' }),
          el('input', { attrs: { id: 'name' } }),
          el('label', { attrs: { for: 'comments' }, text: 'Comments' }),
          el('textarea', { attrs: { id: 'comments' } }),
          el('button', { text: 'Send' }),
        ),
      ),
    )

    expect(state.tree).toContain('textbox "Name"')
    expect(state.tree).toContain('textbox "Comments"')
    const name = state.elements.find((e) => e.name === 'Name')!
    const comments = state.elements.find((e) => e.name === 'Comments')!
    expect(name.ref).not.toBe(comments.ref)
    expect(state.refMap[name.ref].bounds).not.toEqual(state.refMap[comments.ref].bounds)
  })

  it('two empty unlabelled fields are both kept', async () => {
    const state = await observe(
      page(form(el('input'), el('textarea'), el('button', { text: 'Send' }))),
    )

    const fields = textboxes(state)
    expect(fields).toHaveLength(2)
    expect(fields[0].ref).not.toBe(fields[1].ref)
  })

  it("a typed value never becomes a field's name", async () => {
    const state = await observe(
      page(form(el('input', { value: 'Zoë' }), el('button', { text: 'Send' }))),
    )

    const fields = textboxes(state)
    expect(fields).toHaveLength(1)
    expect(fields[0].name ?? '').toBe('')
    expect(state.tree).not.toContain('Zoë')
  })

  it('aria-labelledby and placeholder name a field when no label exists', async () => {
    const state = await observe(
      page(
        form(
          el('span', { attrs: { id: 'email-label' }, text: 'Email address' }),
          el('input', {
            attrs: { 'aria-labelledby': 'email-label', placeholder: 'you@example.com' },
          }),
          el('input', { attrs: { placeholder: 'Search' }, value: 'shoes' }),
        ),
      ),
    )

    expect(state.tree).toContain('textbox "Email address"')
    expect(state.tree).toContain('textbox "Search"')
    expect(textboxes(state).map((e) => e.name)).toEqual(['Email address', 'Search'])
    expect(state.tree).not.toContain('shoes')
  })

  it('non-editable nodes keep the role and name dedupe', async () => {
    const state = await observe(
      page(
        el('a', { text: 'Help' }),
        el('a', { text: 'Help' }),
        el('input', { attrs: { 'aria-label': 'Query' } }),
      ),
    )

    expect(state.elements.filter((e) => e.role === 'link' && e.name === 'Help')).toHaveLength(1)
    expect(state.tree).toContain('textbox "Query"')
  })

  it('a wrapping label names its select without the option text', async () => {
    const select = el('select', {
      children: [el('option', { text: 'Canada' }), el('option', { text: 'Peru' })],
    })
    const state = await observe(
      page(form(el('label', { children: [el('span', { text: 'Country ' }), select] }))),
    )

    expect(state.tree).toContain('combobox "Country"')
    expect(state.tree).not.toContain('Peru')
  })

  it('a button-type input keeps its caption as its name', async () => {
    const state = await observe(
      page(
        form(
          el('input', { attrs: { type: 'submit', value: 'Place order' } }),
          el('input', { value: 'typed' }),
        ),
      ),
    )

    expect(state.elements.map((e) => e.name ?? '')).toEqual(['Place order', ''])
    expect(state.tree).not.toContain('typed')
  })

  it('the typed text of a field is its value and never its name', async () => {
    const long = 'x'.repeat(250)
    const state = await observe(
      page(
        form(
          el('label', { attrs: { for: 'email' }, text: 'Email' }),
          el('input', { attrs: { id: 'email', type: 'email' }, value: 'ada@example.test' }),
          el('label', { attrs: { for: 'notes' }, text: 'Notes' }),
          el('textarea', { attrs: { id: 'notes' }, value: long }),
          el('label', {
            children: [
              el('span', { text: 'Country' }),
              el('select', {
                children: [
                  el('option', { attrs: { value: 'ca' }, text: 'Canada' }),
                  el('option', { attrs: { value: 'pe', selected: '' }, text: ' Peru ' }),
                ],
              }),
            ],
          }),
        ),
      ),
    )

    const email = state.elements.find((e) => e.name === 'Email')!
    expect(email.role).toBe('textbox')
    expect(email.value).toBe('ada@example.test')
    const notes = state.elements.find((e) => e.name === 'Notes')!
    expect(notes.value).toBe('x'.repeat(200))
    const country = state.elements.find((e) => e.role === 'combobox')!
    expect(country.name).toBe('Country')
    expect(country.value).toBe('Peru')
    expect(state.elements.some((e) => e.name.includes('ada@example.test'))).toBe(false)
    expect(state.tree).not.toContain('ada@example.test')
  })

  it('the text of a password field is never observed', async () => {
    const state = await observe(
      page(
        form(
          el('label', { attrs: { for: 'pw' }, text: 'Password' }),
          el('input', { attrs: { id: 'pw', type: 'password' }, value: 'hunter2-secret' }),
        ),
      ),
    )

    const fields = textboxes(state)
    expect(fields).toHaveLength(1)
    expect(fields[0].name).toBe('Password')
    expect('value' in fields[0]).toBe(false)
    expect(JSON.stringify(state)).not.toContain('hunter2-secret')
  })

  it('a selector capture of a WebView field returns what it holds, not its label', async () => {
    const state = await observe(
      page(
        form(
          el('label', { attrs: { for: 'email' }, text: 'Email' }),
          el('input', { attrs: { id: 'email', type: 'email' }, value: 'ada@example.test' }),
          el('button', { text: 'Send' }),
        ),
      ),
    )

    const captured = await new ExplicitExtractor().extract(
      { method: 'selector', variableName: 'email', selector: 'Email' },
      state,
    )
    expect(captured.success).toBe(true)
    expect(captured.value).toBe('ada@example.test')
  })

  it('an empty field carries no value', async () => {
    const state = await observe(
      page(
        form(
          el('label', { attrs: { for: 'city' }, text: 'City' }),
          el('input', { attrs: { id: 'city' } }),
          el('label', { attrs: { for: 'bio' }, text: 'Bio' }),
          el('textarea', { attrs: { id: 'bio' } }),
        ),
      ),
    )

    const fields = textboxes(state)
    expect(fields.map((e) => e.name)).toEqual(['City', 'Bio'])
    for (const field of fields) expect('value' in field).toBe(false)
  })
})
