// @vitest-environment jsdom

// The fourth door's render, held to the 399.1 contract in the DOM medium (Phase 400 plan 06).
//
// WHAT THESE CELLS ARE FOR. `packages/cli/src/commands/result-render.ts` and `receipt-line.ts`
// state the laws a chat render obeys — the status vocabulary is closed and every member visually
// distinct, a payload is labelled with its op id only when the turn filed more than ONE RECEIPT,
// the complete masked payload renders by default and folds add above it rather than replacing it.
// Those modules print with picocolors and cannot be imported here; a browser is a different medium
// with the same obligations. So these cells re-express the LAWS rather than the code, and plan
// 400-09's Playwright cells hold the two media to the same claims against the built UI.
//
// THEY RENDER INTO `document.body` THROUGH `createRoot`, which is the call `main.tsx` makes. A
// component mounted into a detached node can satisfy every query in a file like this one while the
// real mount path is broken, and the cell would never know.

import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'

import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAUSE_RECEIPT_STATUSES, type ClauseReceiptStatus } from '@vostride/agent-qa-schema'

import { ChatMarkdown } from '@/chat/chat-markdown'
import { RECEIPT_STATUS_PRESENTATION } from '@/chat/receipt-row'
import { ChatTranscript, ChatTranscriptView, type ChatTranscriptViewProps } from '@/chat/chat-transcript'
import { ChatSessionProvider } from '@/chat/chat-session-context'
import {
  createChatTranscriptState,
  reduceChatTranscript,
  type ChatTranscriptEvent,
  type ChatTranscriptState,
} from '@/chat/use-chat-turn'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
  delete (globalThis as { __xss?: boolean }).__xss
})

/** Mount through the app's own entry call, into the document a person's browser would paint. */
function mount(element: ReactElement): HTMLElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => { root?.render(element) })
  return container
}

function fold(events: readonly ChatTranscriptEvent[]): ChatTranscriptState {
  return events.reduce(
    (carried, event) => reduceChatTranscript(carried, event),
    createChatTranscriptState(),
  )
}

const NOOP_HANDLERS = {
  onSend: () => {},
  onAnswerConfirm: () => {},
  status: 'idle',
  starters: [],
} satisfies Omit<ChatTranscriptViewProps, 'state'>

describe("the chat transcript reducer folds one turn from the door's own events", () => {
  it('takes clause statuses from RECEIPT events and never from result events', () => {
    // 399.1 D-01/D-05: `results[]` is the structural payload channel and the receipt is where the
    // classifier's verdict lives. A reducer that derived a status from the presence of a result
    // would answer `executed` for every clause that returned — which is precisely the defect
    // (G-399-2) that made a credential-blocked config mutation render green over an unwritten file.
    const state = fold([
      { channel: 'session', event: { kind: 'user_message', turnId: 't1', at: 'a', text: 'do three things' } },
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'config.get', payload: { ok: true } } },
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'one', functionId: 'config.get', origin: 'human', status: 'executed', outcome: 'read' } },
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'config.set', payload: { filed: true } } },
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'two', functionId: 'config.set', origin: 'human', status: 'refused', outcome: 'guardrail-hit' } },
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'three', functionId: 'runs.start', origin: 'human', status: 'failed', outcome: 'FunctionDeniedError' } },
    ])

    expect(
      state.entries
        .filter((entry) => entry.kind === 'receipt')
        .map((entry) => ({ functionId: entry.functionId, status: entry.status })),
    ).toEqual([
      { functionId: 'config.get', status: 'executed' },
      { functionId: 'config.set', status: 'refused' },
      { functionId: 'runs.start', status: 'failed' },
    ])
    // Two results arrived; neither invented a status of its own.
    expect(state.entries.filter((entry) => entry.kind === 'result')).toHaveLength(2)
    expect(state.receiptCountByTurn.t1).toBe(3)
  })
})

describe('the receipt status vocabulary is total and every member is visually distinct', () => {
  it('covers every CLAUSE_RECEIPT_STATUSES member with a distinct accessible label', () => {
    // The compile-time half is the `satisfies Record<ClauseReceiptStatus, …>` at the map itself: a
    // fifth member is a type error there. This is the runtime half, and it asks the question the
    // type cannot — whether the four entries are four different FACTS or one palette repeated. A
    // `refused` styled like `not-run` type-checks perfectly and tells a person a control that
    // worked never ran.
    expect(Object.keys(RECEIPT_STATUS_PRESENTATION).sort())
      .toEqual([...CLAUSE_RECEIPT_STATUSES].sort())
    const labels = CLAUSE_RECEIPT_STATUSES.map(
      (status: ClauseReceiptStatus) => RECEIPT_STATUS_PRESENTATION[status].accessibleLabel,
    )
    expect(new Set(labels).size).toBe(CLAUSE_RECEIPT_STATUSES.length)
    const classNames = CLAUSE_RECEIPT_STATUSES.map(
      (status: ClauseReceiptStatus) => RECEIPT_STATUS_PRESENTATION[status].className,
    )
    expect(new Set(classNames).size).toBe(CLAUSE_RECEIPT_STATUSES.length)
  })

  it('renders each status with its own accessible label in the DOM', () => {
    const state = fold(CLAUSE_RECEIPT_STATUSES.map((status, index) => ({
      channel: 'session' as const,
      event: {
        kind: 'clause_receipt' as const,
        turnId: 't1',
        at: 'a',
        clause: `clause ${String(index)}`,
        functionId: `op.${status}`,
        origin: 'human',
        status,
        outcome: 'outcome',
      },
    })))
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    for (const status of CLAUSE_RECEIPT_STATUSES) {
      const row = dom.querySelector(`[data-receipt-status="${status}"]`)
      expect(row, `${status} has no receipt row`).not.toBeNull()
      expect(row?.textContent).toContain(RECEIPT_STATUS_PRESENTATION[status].accessibleLabel)
    }
  })
})

describe('the op-labeling law is keyed on the RECEIPT count', () => {
  it("leaves a one-receipt turn's payload unlabelled", () => {
    const state = fold([
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'one', functionId: 'proposals.list', origin: 'human', status: 'executed', outcome: 'listed' } },
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'proposals.list', payload: { entries: [] } } },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    expect(dom.querySelectorAll('[data-payload-op-label]')).toHaveLength(0)
  })

  it('labels every payload when the turn filed more than one receipt, even though fewer results came back', () => {
    // 399.1 GAP 2, in this medium. Keying the label on `results.length` looks identical until a
    // turn has MIXED outcomes: one clause fails and files no result, so one surviving payload sits
    // directly beneath a DIFFERENT op's failure receipt and reads as that op's answer. The
    // verifier measured exactly that on the shipped binary.
    const state = fold([
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'one', functionId: 'runs.digest', origin: 'human', status: 'failed', outcome: 'RunDigestError' } },
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'two', functionId: 'proposals.list', origin: 'human', status: 'executed', outcome: 'listed' } },
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'proposals.list', payload: { entries: [] } } },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    const labels = [...dom.querySelectorAll('[data-payload-op-label]')].map((node) => node.textContent)
    expect(labels).toEqual(['proposals.list'])
  })
})

describe('the payload block renders expanded, under its fold lines (D-14)', () => {
  it('shows the complete payload by default with the registry fold above it and a collapse beside it', () => {
    const state = fold([
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'one', functionId: 'config.get', origin: 'human', status: 'executed', outcome: 'read' } },
      { channel: 'session', event: { kind: 'clause_result', turnId: 't1', at: 'a', functionId: 'config.get', payload: { targets: 3, name: 'acme' } } },
      { channel: 'turn', turnId: 't1', folds: [{ functionId: 'config.get', foldLines: ['3 targets configured'] }] },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)

    const block = dom.querySelector('[data-payload-block]')
    expect(block, 'no payload block rendered').not.toBeNull()
    // EXPANDED, and the whole payload — not a summary somebody curated.
    expect(block?.getAttribute('data-expanded')).toBe('true')
    expect(block?.textContent).toContain('"targets": 3')
    expect(block?.textContent).toContain('"name": "acme"')

    // The fold ADDS legibility ABOVE and never suppresses (399.1 D-04).
    const foldLine = dom.querySelector('[data-fold-line]')
    expect(foldLine?.textContent).toBe('3 targets configured')
    expect(
      (foldLine?.compareDocumentPosition(block as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // A collapse exists, and it is a USER TOGGLE rather than the default state.
    const toggle = dom.querySelector('[data-payload-toggle]')
    expect(toggle).not.toBeNull()
    act(() => { (toggle as HTMLButtonElement).click() })
    expect(dom.querySelector('[data-payload-block]')?.getAttribute('data-expanded')).toBe('false')
  })
})

describe('the transcript renders untrusted markdown inertly (T-400-19 / T-400-20)', () => {
  it('escapes a raw HTML block instead of executing it', () => {
    const dom = mount(<ChatMarkdown content={'<img src=x onerror="globalThis.__xss = true">\n\nplain'} />)
    expect(dom.querySelector('img')).toBeNull()
    expect(dom.textContent).toContain('<img src=x')
    expect((globalThis as { __xss?: boolean }).__xss).toBeUndefined()
  })

  it('neutralises every non-http(s) link protocol, including the ones a naive prefix check misses', () => {
    // The shipped `ObservationMarkdown` escape covers HTML BLOCKS. A markdown link is not a block —
    // `marked` renders `[x](javascript:…)` into an anchor whose href it does not sanitise — so the
    // escape alone leaves a one-click script execution in the dashboard origin. Each fixture below
    // defeats a different shortcut: casing, leading whitespace, an entity-encoded colon, and a
    // data URL that is inert only until a browser decides otherwise.
    const hostile = [
      '[a](javascript:globalThis.__xss=true)',
      '[b](JaVaScRiPt:globalThis.__xss=true)',
      '[c](  javascript:globalThis.__xss=true)',
      '[d](data:text/html;base64,PHNjcmlwdD5nbG9iYWxUaGlzLl9feHNzPXRydWU8L3NjcmlwdD4=)',
      '[e](vbscript:globalThis.__xss=true)',
    ]
    const dom = mount(<ChatMarkdown content={hostile.join('\n\n')} />)
    // NON-VACUOUS BY CONSTRUCTION: every fixture has to have been PARSED AS A LINK and then
    // refused. A cell that only asserted "no live anchors" would pass just as well against a
    // markdown renderer that failed to see these as links at all, which measures nothing.
    expect(dom.querySelectorAll('[data-blocked-href]')).toHaveLength(hostile.length)
    expect(dom.querySelectorAll('a')).toHaveLength(0)
    // The text survives — a refused link loses its destination, never the sentence around it.
    for (const label of ['a', 'b', 'c', 'd', 'e']) {
      expect(dom.textContent).toContain(label)
    }
    expect((globalThis as { __xss?: boolean }).__xss).toBeUndefined()
  })

  it('leaves an ordinary http link alone, so the guard is a filter and not a blanket', () => {
    const dom = mount(<ChatMarkdown content={'[docs](https://example.invalid/a)'} />)
    expect(dom.querySelector('a')?.getAttribute('href')).toBe('https://example.invalid/a')
  })
})

describe('a denial renders the remedies THIS surface can take (D-15)', () => {
  it("renders the dashboard projection and never another surface's flag instructions", () => {
    const state = fold([
      { channel: 'session', event: { kind: 'clause_receipt', turnId: 't1', at: 'a', clause: 'run it', functionId: 'runs.start', origin: 'human', status: 'failed', outcome: 'FunctionDeniedError' } },
      {
        channel: 'turn',
        turnId: 't1',
        denials: [{
          clause: 'run it',
          functionId: 'runs.start',
          reason: 'fail-closed: ask in ci without trust (tier): re-run locally to confirm interactively or opt in with --trust-session',
          remedies: [
            { kind: 'answer-confirm' },
            { kind: 'trust-session-flag', params: { flag: '--trust-session', command: 'run' } },
          ],
        }],
      },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    const remedies = [...dom.querySelectorAll('[data-remedy-kind]')].map(
      (node) => node.getAttribute('data-remedy-kind'),
    )
    // `trust-session-flag` lists ONLY `cli` in the shipped surface table. A browser has no such
    // flag, and this is the todo (`399-friction-refusal-remedies-unreachable`) in one assertion.
    expect(remedies).toEqual(['answer-confirm'])
    // And the WAY-FORWARD TEXT this surface composes carries no flag of another surface's. The
    // canonical reason beside it is a different thing: it is the gate's own audit sentence, whose
    // bytes phase 399 published and 400-02 deliberately did not move, so it is rendered verbatim
    // here exactly as the CLI renders it and exactly as the execution-audit row stores it. See
    // this plan's SUMMARY for the residue that leaves.
    const remedyText = [...dom.querySelectorAll('[data-remedy-kind]')]
      .map((node) => node.textContent ?? '')
      .join('\n')
    expect(remedyText).not.toContain('--trust-session')
    expect(remedyText).toContain('confirm')
    expect(dom.textContent).toContain('fail-closed: ask in ci without trust')
  })

  it('renders nothing where the dashboard projection is empty rather than inventing a way forward', () => {
    const state = fold([
      {
        channel: 'turn',
        turnId: 't1',
        denials: [{
          clause: 'run it',
          functionId: 'runs.start',
          reason: 'blocked: restricted tier',
          remedies: [{ kind: 'trust-session-flag', params: { flag: '--trust-session', command: 'run' } }],
        }],
      },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    expect(dom.querySelectorAll('[data-remedy-kind]')).toHaveLength(0)
    expect(dom.textContent).toContain('blocked: restricted tier')
  })
})

describe("the input row carries a person's bytes to the door unchanged (D-10)", () => {
  it('sends `/fn <op> [json]` verbatim rather than parsing it in the browser', () => {
    // The resolver table lives on the server and owns the parse. A browser that split the
    // directive here would be a second parser for one grammar, free to disagree with the one that
    // dispatches — and `/fn` is the passthrough the whole capability surface rides.
    const onSend = vi.fn()
    const dom = mount(
      <ChatTranscriptView state={createChatTranscriptState()} {...NOOP_HANDLERS} onSend={onSend} />,
    )
    const input = dom.querySelector('[data-chat-input]') as HTMLTextAreaElement
    expect(input).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(input, '/fn runs.digest {"limit": 3}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const form = dom.querySelector('[data-chat-form]') as HTMLFormElement
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(onSend).toHaveBeenCalledWith('/fn runs.digest {"limit": 3}')
  })
})

describe('the confirm bubble is a render over the plan-03 bridge (D-06 / D-07)', () => {
  it('renders INLINE in the transcript with the action class and the cost preview', () => {
    // D-06: never a modal. A dialog that covers the transcript hides the very context a person
    // needs in order to answer — the preview `chatPresent` pushed a moment earlier, saying what
    // this invocation is about to cost. The bubble sits where that context is.
    const state = fold([
      { channel: 'present', text: 'authoring.funnel.dispatch will consume up to 9 runs' },
      { channel: 'confirm-request', frame: { confirmId: 'c-1', actionClass: 'authoring.dispatch', preview: 'up to 9 runs' } },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    const bubble = dom.querySelector('[data-confirm-bubble]')
    expect(bubble, 'no confirm bubble rendered').not.toBeNull()
    expect(bubble?.textContent).toContain('authoring.dispatch')
    expect(bubble?.textContent).toContain('up to 9 runs')
    // The preview that arrived BEFORE the question is still above it, unhidden.
    const present = dom.querySelector('[data-entry="present"]')
    expect(present?.textContent).toContain('up to 9 runs')
    expect(
      (present?.compareDocumentPosition(bubble as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('offers exactly the TTY\'s three answers and posts each with the confirm\'s own id', () => {
    // D-07: full grant parity. `accept-always` rides 391's shipped grant machinery on the server;
    // the browser offers the same three words a terminal does and mints nothing itself.
    const onAnswerConfirm = vi.fn()
    const state = fold([
      { channel: 'confirm-request', frame: { confirmId: 'c-42', actionClass: 'authoring.dispatch' } },
    ])
    const dom = mount(
      <ChatTranscriptView state={state} {...NOOP_HANDLERS} onAnswerConfirm={onAnswerConfirm} />,
    )
    const buttons = [...dom.querySelectorAll('[data-confirm-answer]')]
    expect(buttons.map((node) => node.getAttribute('data-confirm-answer')))
      .toEqual(['accept', 'accept-always', 'deny'])
    for (const button of buttons) act(() => { (button as HTMLButtonElement).click() })
    expect(onAnswerConfirm.mock.calls).toEqual([
      ['c-42', 'accept'],
      ['c-42', 'accept-always'],
      ['c-42', 'deny'],
    ])
  })

  it('shows a deny-on-silence as the DENIAL it is, never as a question still pending', () => {
    // The server denies on timeout, on disconnect and where no channel is open, deliberately
    // (D-06 — fail-closed is the only honest default for a channel that can vanish mid-question).
    // A bubble that kept its buttons after that would be offering an answer to a question that is
    // already closed, and a spinner would be papering over the product's own decision.
    const state = fold([
      { channel: 'confirm-request', frame: { confirmId: 'c-7', actionClass: 'authoring.dispatch', preview: 'up to 9 runs' } },
      { channel: 'confirm-resolved', frame: { kind: 'confirm_resolved', confirmId: 'c-7', answer: 'deny', by: 'timeout' } },
    ])
    const dom = mount(<ChatTranscriptView state={state} {...NOOP_HANDLERS} />)
    const bubble = dom.querySelector('[data-confirm-bubble]')
    expect(bubble?.getAttribute('data-confirm-resolution')).toBe('deny')
    expect(bubble?.getAttribute('data-confirm-resolved-by')).toBe('timeout')
    expect(dom.querySelectorAll('[data-confirm-answer]')).toHaveLength(0)
    expect(bubble?.textContent).toContain('denied')
  })

  it('carries no client-side timer and no client-side grant (source assertion)', () => {
    // The window, the deny-on-silence and the standing-approval mint all live in the registry the
    // server composed. A browser-side timer would be a SECOND clock on one question — free to
    // disagree with the one that actually decides — and a browser-side grant would be a write the
    // 391 machinery never saw.
    // Read off DISK rather than through the bundler: the question is what the shipped module
    // contains, and a transformed copy is not the thing a reviewer or a `grep` would read.
    const source = readFileSync(
      resolvePath(process.cwd(), 'src/chat/confirm-bubble.tsx'),
      'utf8',
    )
    // COMMENTS ARE STRIPPED FIRST, and that is not a convenience. This repository has already paid
    // for the other way round twice: `validate:arch` read a sentence shaped like an import as a
    // dependency (400-03), and the paragraph above legitimately mentions `grants.list` while
    // explaining why this file never calls it. A source assertion that reads prose measures prose.
    const code = source
      .replaceAll(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/)
    expect(code).not.toMatch(/recordStandingApproval|grants\./)
    // And the three answers are spelled here, so a rename on the wire is a visible edit.
    for (const answer of ['accept', 'accept-always', 'deny']) {
      expect(source).toContain(`"${answer}"`)
    }
  })
})

describe('the page and the panel are two MOUNTS of one component (D-13)', () => {
  it('both mount files contain the transcript element and no render logic of their own', () => {
    // THE SOURCE ASSERTION IS THE POINT HERE, and it is not a stand-in for a DOM cell (plan 400-09
    // drives the built UI in a real browser). What it holds is the shape D-13 asks for: the second
    // entry DASH-01 forbids would arrive as a receipt/payload/remedy branch inside one of these
    // two files, and it would look reasonable on the day somebody wrote it.
    const page = readFileSync(resolvePath(process.cwd(), 'src/pages/chat.tsx'), 'utf8')
    const panel = readFileSync(resolvePath(process.cwd(), 'src/components/chat-panel.tsx'), 'utf8')

    for (const [name, source] of [['page', page], ['panel', panel]] as const) {
      expect(source, `${name} does not import the shared transcript`)
        .toContain('from "@/chat/chat-transcript"')
      expect(source, `${name} does not mount it`).toContain('<ChatTranscript />')
      const code = source
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n')
      // Nothing that renders a receipt, a payload, a remedy or a confirm may live in a mount.
      expect(code, `${name} grew transcript logic`).not.toMatch(
        /RECEIPT_STATUS_PRESENTATION|remediesRenderableBy|data-payload|data-receipt|ConfirmBubble|ReceiptRow/,
      )
    }
    // And they name the SAME module specifier, so "the same component" is a fact a grep can check
    // rather than an intention.
    const specifier = /from "(@\/chat\/chat-transcript)"/
    expect(specifier.exec(page)?.[1]).toBe(specifier.exec(panel)?.[1])
  })

  it('registers the chat route on the house idiom — crumb, error boundary, lazy Suspense', () => {
    const app = readFileSync(resolvePath(process.cwd(), 'src/app.tsx'), 'utf8')
    expect(app).toContain('const ChatPage = lazy(() => import("@/pages/chat"))')
    const entry = /path: "chat",[\s\S]{0,400}?<ChatPage \/>/.exec(app)?.[0] ?? ''
    expect(entry, 'the chat route entry was not found in app.tsx').not.toBe('')
    expect(entry).toContain('handle: { crumb: "Chat" }')
    expect(entry).toContain('errorElement: <RouteErrorBoundary />')
    expect(entry).toContain('<Suspense')
    // The panel is mounted beside the other global overlays, so it is reachable from every route.
    expect(app).toContain('<ChatPanel />')
    expect(app).toContain('<ChatSessionProvider>')
  })

  it('renders one transcript per mount, both reading the one session', () => {
    // The mounts are rendered TOGETHER under a single provider — which is the state that would
    // expose two hooks, two sessions and two streams if the provider were not the one holding
    // them. Both mounts show the same entry because there is only one transcript state.
    const dom = mount(
      <ChatSessionProvider>
        <TwoMountHarness />
      </ChatSessionProvider>,
    )
    expect(dom.querySelectorAll('[data-chat-transcript]')).toHaveLength(2)
    expect(dom.querySelectorAll('[data-chat-form]')).toHaveLength(2)
  })
})

/** Both mounts, side by side, exactly as the app renders them: the page's tree and the panel's. */
function TwoMountHarness() {
  return (
    <>
      <ChatTranscript />
      <ChatTranscript />
    </>
  )
}

describe('the browser completes `/fn <op>` from the ONE committed catalog (RESEARCH Open Q4)', () => {
  it('suggests only op ids the served artifact declares, and only for `/fn`', () => {
    // The suggestion set has exactly one source: the artifact produced from a real composition's
    // declarations, served over the door's catalog route. A component that assembled its own list
    // would be advertising capabilities nobody checked this door can reach.
    const capabilities = [
      { kind: 'op', opId: 'runs.digest' },
      { kind: 'alias', alias: 'digest', targetOpId: 'runs.digest' },
      { kind: 'op', opId: 'runs.start' },
      { kind: 'op', opId: 'config.get' },
    ]
    const dom = mount(
      <ChatTranscriptView
        state={createChatTranscriptState()}
        {...NOOP_HANDLERS}
        capabilities={capabilities}
      />,
    )
    const input = dom.querySelector('[data-chat-input]') as HTMLTextAreaElement
    const type = (value: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(
          globalThis.HTMLTextAreaElement.prototype,
          'value',
        )?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

    // Ordinary prose is not a capability query and must not sprout a completer.
    type('what changed in my last run?')
    expect(dom.querySelectorAll('[data-chat-completion]')).toHaveLength(0)

    type('/fn runs.')
    expect([...dom.querySelectorAll('[data-chat-completion]')].map((n) => n.textContent))
      .toEqual(['runs.digest', 'runs.start'])

    // And with no catalog served there are no suggestions, never a guessed one.
    const bare = mount(<ChatTranscriptView state={createChatTranscriptState()} {...NOOP_HANDLERS} />)
    const bareInput = bare.querySelector('[data-chat-input]') as HTMLTextAreaElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(bareInput, '/fn runs.')
      bareInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(bare.querySelectorAll('[data-chat-completion]')).toHaveLength(0)
  })
})
