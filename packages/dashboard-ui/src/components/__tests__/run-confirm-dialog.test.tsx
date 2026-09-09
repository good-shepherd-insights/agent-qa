// @vitest-environment jsdom
//
// THE RUN TRIGGER'S DIALOG (Phase 401 plan 09, D-11).
//
// WHAT THESE CELLS ARE FOR, precisely. The mechanism — parking, reaping, minting, denying — is
// measured end to end over the shipped server in `packages/cli`'s `run-trigger-confirm.test.ts`;
// nothing here re-measures any of it, and a cell here that tried would be asserting about a fake.
// What only this file can say is what a PERSON is offered: three answers and no fourth, the
// action's own disclosure beside them, and a denial that reads as a denial rather than as a wait.

import { readFileSync } from "node:fs"
import { resolve as resolvePath } from "node:path"

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  MAX_QUEUED_CONFIRMS,
  RESOLVED_DIALOG_LINGER_MS,
  RunConfirmDialog,
  RunConfirmHost,
} from "@/components/run-confirm-dialog"
import { CONFIRM_ANSWER_VOCABULARY } from "@/lib/api"

// THE CHANNEL, CAPTURED — the seam the SHIPPED host reads (401-14, CR-05).
//
// jsdom has no `EventSource`, and `RunConfirmHost` takes an early return without one — which is
// exactly how the wire came to be source-pinned rather than driven (401-VERIFICATION §
// behaviour-unverified). So the cell below supplies a stub constructor to get PAST that guard and
// then drives the host through `openRunConfirmChannel`'s own callbacks: the same three functions
// the production `EventSource` listeners invoke, with the same frames. It asserts the request
// arrived and rendered BEFORE it asserts anything about a resolution, so a cell that silently took
// the early return could not pass by asserting the absence of something.
const channel = vi.hoisted(() => ({
  callbacks: undefined as
    | undefined
    | {
        onScope?: (frame: { scopeId: string }) => void
        onConfirmRequest?: (frame: { confirmId: string; actionClass: string; preview?: string }) => void
        onConfirmResolved?: (frame: { confirmId: string; answer: string; by: string }) => void
      },
  // What the host wrote into `api.ts`'s module-level scope box, and how many times it closed the
  // socket — both read by the cleanup cell, which is the only one that can see either.
  scopeWrites: [] as (string | undefined)[],
  closes: 0,
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    // The REAL vocabulary stays real — the three-answers cell above reads it, and a mocked enum
    // would make that assertion agree with this file instead of with the wire.
    openRunConfirmChannel: (callbacks: NonNullable<typeof channel.callbacks>) => {
      channel.callbacks = callbacks
      return { close: () => { channel.closes += 1 } } as unknown as EventSource
    },
    setRunConfirmScope: (scopeId?: string) => { channel.scopeWrites.push(scopeId) },
    answerRunConfirm: async () => ({ ok: true }),
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(element: ReactElement): HTMLDivElement {
  container = document.createElement("div")
  document.body.appendChild(container)
  const activeRoot = createRoot(container)
  root = activeRoot
  act(() => { activeRoot.render(element) })
  return container
}

beforeEach(() => {
  channel.callbacks = undefined
  channel.scopeWrites = []
  channel.closes = 0
  // A CONSTRUCTOR THAT DOES NOTHING, only so the host's `typeof EventSource === "undefined"` guard
  // is not the thing under test. The mocked `openRunConfirmChannel` never constructs one.
  ;(globalThis as { EventSource?: unknown }).EventSource = class {}
})

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
  vi.useRealTimers()
  delete (globalThis as { EventSource?: unknown }).EventSource
})

describe("the run trigger's confirm dialog", () => {
  it.each(['fn:runs.mark', 'run:start', 'fn:runs.start', 'fn:runs.mark-extra'])('names the actual operation for %s without changing its answers', actionClass => {
    const onAnswer = vi.fn()
    const host = mount(<RunConfirmDialog confirmId="operation-copy" actionClass={actionClass} preview="Action preview" onAnswer={onAnswer} />)
    const marking = actionClass === 'fn:runs.mark'
    const title = marking ? 'Approval needed to record this mark' : 'Approval needed to start this run'
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(title)
    expect(host.textContent).toContain(title)
    expect(host.querySelector('[data-confirm-answer="accept"]')?.getAttribute('title')).toBe(marking ? 'allow this one mark' : 'allow this one run')
    expect(host.querySelector('[data-confirm-answer="deny"]')?.getAttribute('title')).toBe(marking ? 'refuse — the mark is not recorded' : 'refuse — the run does not start')
    expect(host.querySelector('[data-confirm-answer="accept-always"]')?.getAttribute('title')).toBe('record a standing approval for this action class')
    for (const answer of CONFIRM_ANSWER_VOCABULARY) {
      act(() => host.querySelector<HTMLButtonElement>(`[data-confirm-answer="${answer}"]`)!.click())
      expect(onAnswer).toHaveBeenLastCalledWith('operation-copy', answer)
    }
    expect(host.textContent).not.toContain('Mark saved.')
  })
  it("offers the confirm vocabulary's three answers and NO fourth", () => {
    const host = mount(
      <RunConfirmDialog
        confirmId="confirm-401-09"
        actionClass="run:start"
        preview="one run against a shared target"
        onAnswer={() => {}}
      />,
    )

    const offered = [...host.querySelectorAll("[data-confirm-answer]")]
      .map((node) => node.getAttribute("data-confirm-answer"))
    // READ OFF THE WIRE'S OWN ENUM rather than typed here. A hand-written list would be a second
    // spelling of the vocabulary, and it would agree with the server right up until somebody
    // changed one of them — which is the drift this assertion exists to catch.
    expect(offered).toEqual([...CONFIRM_ANSWER_VOCABULARY])
    // The action's own disclosure travels WITH the question, because a run trigger has no
    // transcript for a cost preview to have arrived in a moment earlier.
    expect(host.querySelector("[data-confirm-preview]")?.textContent)
      .toBe("one run against a shared target")
  })

  it("sends the literal the server validates, never the label a person read", () => {
    const answered: { confirmId: string; answer: string }[] = []
    const host = mount(
      <RunConfirmDialog
        confirmId="confirm-401-09"
        actionClass="run:start"
        onAnswer={(confirmId, answer) => { answered.push({ confirmId, answer }) }}
      />,
    )

    const always = host.querySelector<HTMLButtonElement>('[data-confirm-answer="accept-always"]')
    expect(always?.textContent, "the label and the literal are free to differ, and do").toBe("Always")
    act(() => { always?.click() })
    expect(answered).toEqual([{ confirmId: "confirm-401-09", answer: "accept-always" }])
  })

  it("A DENIED-ON-SILENCE READS AS DENIED, and says which silence it was", () => {
    // THE ONE RENDERING RULE THAT IS A POLICY. Fail-closed is the product's deliberate answer to a
    // channel that can vanish mid-question; rendering it as "still waiting" — a spinner, a greyed
    // dialog, a retry — would paper over a decision the gate has already taken and recorded.
    for (const [by, expected] of [
      ["timeout", "denied — nobody answered before the window closed"],
      ["channel-closed", "denied — this page stopped watching"],
    ] as const) {
      const host = mount(
        <RunConfirmDialog
          confirmId="confirm-401-09"
          actionClass="run:start"
          resolution={{ answer: "deny", by }}
          onAnswer={() => {}}
        />,
      )
      expect(host.querySelector("[data-confirm-outcome]")?.textContent).toBe(expected)
      // AND THE BUTTONS ARE GONE. A resolved question that still offers answers invites a person to
      // approve something that was decided without them.
      expect(host.querySelectorAll("[data-confirm-answer]")).toHaveLength(0)
      expect(host.querySelector("[data-run-confirm-dialog]")?.getAttribute("data-confirm-resolved-by"))
        .toBe(by)
      act(() => { root?.unmount() })
      container?.remove()
    }
  })

  it("is a dialog on the trigger flow, announced as one", () => {
    // UI hint: no — a dialog on an existing flow, never a page (D-11). The role is what makes that
    // true for somebody using a screen reader rather than only for somebody looking at it.
    const host = mount(
      <RunConfirmDialog confirmId="c" actionClass="run:start" onAnswer={() => {}} />,
    )
    const dialog = host.querySelector("[data-run-confirm-dialog]")
    expect(dialog?.getAttribute("role")).toBe("dialog")
    expect(dialog?.getAttribute("aria-modal")).toBe("true")
    expect(dialog?.getAttribute("aria-label")).toBeTruthy()
  })
})

describe("the run confirm host answers only its own question (401-14, CR-05)", () => {
  it("a resolution for a DIFFERENT confirm leaves this question pending and answerable", () => {
    // THE DEFECT: `onConfirmResolved` set the resolution from ANY frame, so a stale or overlapping
    // `confirm_resolved` rendered THIS question as resolved with another question's answer — and
    // the linger timer then cleared it, costing the person their chance to answer. The chat sibling
    // has always keyed its resolution to the matching `confirmId` (`use-chat-turn.ts`); the run
    // path is the half of that pair that was left standing.
    //
    // NOT A SECURITY BYPASS, and the cell does not claim one: `answerRunConfirm` posts the real
    // confirmId and the SERVER decides, so a spurious "approved" render approves nothing. What is
    // lost is the answer.
    const host = mount(<RunConfirmHost />)

    // DELIVERY FIRST. If the host had taken its no-EventSource early return there would be no
    // callbacks here, and every assertion below would be about a component that never mounted.
    expect(channel.callbacks, "the host opened no channel — nothing below measures anything")
      .toBeDefined()

    act(() => {
      channel.callbacks!.onConfirmRequest!({
        confirmId: "confirm-A",
        actionClass: "run:start",
        preview:
          'Start a run against target "the-one-being-asked-about" (declared: at least one target shared).',
      })
    })
    expect(host.querySelector("[data-run-confirm-dialog]")?.getAttribute("data-confirm-id"))
      .toBe("confirm-A")

    // A frame for somebody else's question.
    act(() => {
      channel.callbacks!.onConfirmResolved!({ confirmId: "confirm-B", answer: "accept", by: "answer" })
    })

    const dialog = host.querySelector("[data-run-confirm-dialog]")
    expect(dialog?.getAttribute("data-confirm-id"), "the pending question changed identity")
      .toBe("confirm-A")
    expect(dialog?.getAttribute("data-confirm-resolution"), "another question's answer resolved this one")
      .toBeNull()
    // AND IT IS STILL ANSWERABLE — the three live buttons, which is the thing actually lost when a
    // stale frame resolves a pending question and the linger timer then clears it.
    expect(host.querySelectorAll("[data-confirm-answer]")).toHaveLength(3)

    // THE CONTROL, one thing different: the SAME confirmId, and it resolves.
    act(() => {
      channel.callbacks!.onConfirmResolved!({ confirmId: "confirm-A", answer: "accept", by: "answer" })
    })
    expect(host.querySelector("[data-run-confirm-dialog]")?.getAttribute("data-confirm-resolution"))
      .toBe("accept")
    expect(host.querySelectorAll("[data-confirm-answer]")).toHaveLength(0)
  })
})

describe("the run confirm host QUEUES an arriving question behind an unresolved one (401-16, G-401-15)", () => {
  // THE DEFECT THIS CLOSES. `onConfirmRequest` set `pendingConfirmIdRef.current = frame.confirmId`
  // unconditionally and then `setPending(frame)`, so a second question replaced the first within
  // about a second: A was not disabled, not marked superseded, not stacked, not queued — it was
  // gone from the document. Thirty seconds later A's own `confirm_resolved` arrived on the same
  // socket and 401-14's keyed guard CORRECTLY dropped it, because A was no longer the pending
  // question. So the person clicked Run twice, answered once, got one run, and was never told the
  // other was refused — and the 401-14 guard is what made that loss silent rather than
  // misattributed. Measured on the real wire in `run-confirm-browser.e2e.test.ts` (UAT item 15 §5).
  //
  // THE RULING (UAT test 1, 2026-08-23) IS QUEUE, NOT REFUSE: B waits behind A; A stays answerable
  // and resolves normally. These cells measure that ruling, plus the three edges the ruling's
  // sketch does not name — a queued question whose window closed, a drain that must be reachable
  // from wherever the pending id is cleared, and a bound.
  //
  // FAKE TIMERS, because the drain happens after the resolved dialog's 6 s linger and this file is
  // not going to spend thirty real seconds proving it. `RESOLVED_DIALOG_LINGER_MS` is imported
  // rather than spelled, so a change to the linger moves these cells with it.

  function request(confirmId: string): void {
    act(() => {
      channel.callbacks!.onConfirmRequest!({
        confirmId,
        actionClass: "run:start",
        preview: `Start a run against target "t" (declared: every target local). [${confirmId}]`,
      })
    })
  }

  function resolveFrame(confirmId: string, answer: string, by: string): void {
    act(() => { channel.callbacks!.onConfirmResolved!({ confirmId, answer, by }) })
  }

  function linger(): void {
    act(() => { vi.advanceTimersByTime(RESOLVED_DIALOG_LINGER_MS) })
  }

  function shown(host: HTMLElement): {
    id: string | null
    resolution: string | null
    resolvedBy: string | null
    answers: number
    outcome: string | null
  } {
    const dialog = host.querySelector("[data-run-confirm-dialog]")
    if (dialog === null) {
      return { id: null, resolution: null, resolvedBy: null, answers: 0, outcome: null }
    }
    return {
      id: dialog.getAttribute("data-confirm-id"),
      resolution: dialog.getAttribute("data-confirm-resolution"),
      resolvedBy: dialog.getAttribute("data-confirm-resolved-by"),
      answers: dialog.querySelectorAll("[data-confirm-answer]").length,
      outcome: dialog.querySelector("[data-confirm-outcome]")?.textContent ?? null,
    }
  }

  function mountHost(): HTMLDivElement {
    const host = mount(<RunConfirmHost />)
    // DELIVERY FIRST — a host that took its no-EventSource early return would make every assertion
    // below a statement about a component that never opened anything.
    expect(channel.callbacks, "the host opened no channel — nothing below measures anything")
      .toBeDefined()
    return host
  }

  it("an arriving question WAITS — the one on screen keeps its identity and its three answers", () => {
    vi.useFakeTimers()
    const host = mountHost()

    request("confirm-A")
    expect(shown(host).id).toBe("confirm-A")

    request("confirm-B")

    // EXACTLY ONE DIALOG, AND IT IS STILL A'S. This is the assertion the shipped code fails: it
    // rendered B here, and A's confirmId was nowhere in the document.
    expect(host.querySelectorAll("[data-run-confirm-dialog]")).toHaveLength(1)
    expect(shown(host).id, "the arriving question replaced the one being asked").toBe("confirm-A")
    expect(shown(host).resolution, "A was rendered as resolved by B's mere arrival").toBeNull()
    expect(shown(host).answers, "A stopped being answerable").toBe(3)
    // B IS NOT RENDERED AT ALL — it is waiting, not stacked, not a second dialog.
    expect(host.innerHTML.includes("confirm-B"), "the waiting question was rendered").toBe(false)
  })

  it("the answered question resolves ON ITSELF, and the waiting one is raised only afterwards", () => {
    vi.useFakeTimers()
    const host = mountHost()

    request("confirm-A")
    request("confirm-B")

    resolveFrame("confirm-A", "accept", "answer")

    // A's own answer, on A. Under the shipped code this frame arrived for a question that was no
    // longer pending and was dropped, which is exactly how the loss became silent.
    expect(shown(host).id).toBe("confirm-A")
    expect(shown(host).resolution).toBe("accept")
    expect(shown(host).answers, "a resolved question still offers answers").toBe(0)
    // AND B IS STILL WAITING — the person is reading A's outcome and is not being handed the next
    // question underneath it.
    expect(host.innerHTML.includes("confirm-B"), "B was raised before A's outcome was seen")
      .toBe(false)

    linger()

    expect(shown(host).id, "the waiting question was never raised").toBe("confirm-B")
    expect(shown(host).resolution).toBeNull()
    expect(shown(host).answers, "the raised question is not answerable").toBe(3)
  })

  it("a question that dies at its OWN window dies ON SCREEN, and then the next one is raised", () => {
    vi.useFakeTimers()
    const host = mountHost()

    request("confirm-A")
    request("confirm-B")

    // Nobody answered A; the server denied it at its window and said so on this socket. THIS IS
    // THE SENTENCE WHOSE ABSENCE WAS THE GAP.
    resolveFrame("confirm-A", "deny", "timeout")

    expect(shown(host).id).toBe("confirm-A")
    expect(shown(host).resolvedBy).toBe("timeout")
    expect(shown(host).outcome).toBe("denied — nobody answered before the window closed")

    linger()

    expect(shown(host).id).toBe("confirm-B")
    expect(shown(host).answers).toBe(3)
  })

  it("a question whose window closed WHILE IT WAITED is never handed to the person", () => {
    // THE EDGE THE RULING'S SKETCH DOES NOT COVER. A queued question's server-side window keeps
    // running while it waits, so by the time the drain reaches it the answer may already be
    // refused. Raising it would trade a silent denial for a click that does nothing — worse, not
    // better, because the person would believe they had just approved a run.
    vi.useFakeTimers()
    const host = mountHost()
    const raised: (string | null)[] = []
    const record = (): void => {
      const id = shown(host).id
      if (raised[raised.length - 1] !== id) raised.push(id)
    }

    request("confirm-A")
    record()
    request("confirm-B")
    request("confirm-C")
    record()

    // B's window closes while B is still WAITING.
    resolveFrame("confirm-B", "deny", "timeout")
    record()
    // 401-14's guard still holds for the question on screen: B's frame resolved nothing.
    expect(shown(host).id).toBe("confirm-A")
    expect(shown(host).resolution, "a waiting question's resolution resolved the pending one")
      .toBeNull()
    expect(shown(host).answers).toBe(3)

    resolveFrame("confirm-A", "accept", "answer")
    record()
    linger()
    record()

    expect(shown(host).id, "the drain skipped past the dead question to the live one").toBe("confirm-C")
    expect(shown(host).answers).toBe(3)
    expect(raised, "a question whose window had already closed was raised as answerable")
      .not.toContain("confirm-B")
  })

  it("the queue is BOUNDED, and an arrival past the bound is dropped rather than accumulating", () => {
    vi.useFakeTimers()
    const host = mountHost()
    const raised: string[] = []

    request("confirm-A")
    raised.push(shown(host).id!)
    // One more arrival than the bound admits.
    for (let index = 1; index <= MAX_QUEUED_CONFIRMS + 1; index += 1) {
      request(`confirm-q${String(index)}`)
    }

    // Drain the whole queue by answering each raised question in turn.
    for (let index = 0; index < MAX_QUEUED_CONFIRMS + 2; index += 1) {
      const current = shown(host).id
      if (current === null) break
      resolveFrame(current, "accept", "answer")
      linger()
      const next = shown(host).id
      if (next !== null) raised.push(next)
    }

    const expected = ["confirm-A"]
    for (let index = 1; index <= MAX_QUEUED_CONFIRMS; index += 1) {
      expected.push(`confirm-q${String(index)}`)
    }
    expect(raised, "the queue admitted more than its bound, or dropped the wrong end").toEqual(expected)
    expect(shown(host).id, "the queue never emptied").toBeNull()
  })

  it("the queue does not outlive the channel — it dies with the host, like the pending id and the scope", () => {
    // THE REGRESSION THIS GUARDS. `setRunConfirmScope` writes into a MODULE-LEVEL box in `api.ts`,
    // and a queue hoisted to module scope for the same reason would survive a remount and raise a
    // question belonging to a channel that no longer exists.
    vi.useFakeTimers()
    mountHost()
    const firstRoot = root
    const firstContainer = container

    request("confirm-A")
    request("confirm-B")

    act(() => { firstRoot!.unmount() })
    firstContainer!.remove()
    root = null
    container = null

    expect(channel.closes, "the channel was never closed").toBe(1)
    expect(
      channel.scopeWrites[channel.scopeWrites.length - 1],
      "a closed channel left a scope behind, so a later trigger would name a browser that is gone",
    ).toBeUndefined()

    const second = mountHost()
    linger()
    expect(shown(second).id, "a fresh host raised something nobody asked it").toBeNull()

    // A FRESH CHANNEL, A FRESH QUESTION, AND THE OLD ONE MUST NOT COME BACK. The drain runs where
    // a pending question clears, so a queue that outlived its socket does not surface on the empty
    // mount above — it surfaces HERE, behind the next question this page is actually asked. The
    // mutation ledger measured the shorter version of this cell passing under a module-scoped
    // queue, which is what a control that cannot red looks like.
    request("confirm-C")
    expect(shown(second).id).toBe("confirm-C")
    resolveFrame("confirm-C", "accept", "answer")
    linger()
    expect(
      shown(second).id,
      "a question queued against a closed channel was raised on a fresh host",
    ).toBeNull()
  })

  it("SOURCE: the queue is a ref, and 401-14's keyed guard is untouched", () => {
    // TWO SOURCE CLAIMS THAT NO RENDER CAN MAKE.
    //
    // (1) THE STALENESS TRAP THIS FILE'S OWN SUBJECT NAMES. The channel's callbacks are captured
    // ONCE at mount, so React state read inside them is the state as of that render and stays
    // there forever — a queue held in `useState` would be read as `[]` by every later arrival, and
    // the cells above would still pass for a one-deep queue while silently losing the third.
    //
    // (2) 401-14's keyed resolution guard must survive this change verbatim for the PENDING
    // question. The queued-resolution bookkeeping is a separate concern and must not weaken it.
    const source = readFileSync(
      resolvePath(process.cwd(), "src/components/run-confirm-dialog.tsx"),
      "utf8",
    )
    expect(source, "the queue is in React state, read from a mount-captured callback")
      .toMatch(/queue\w*Ref\s*=\s*useRef/)
    expect(source, "401-14's keyed resolution guard was weakened or removed")
      .toContain("frame.confirmId !== pendingConfirmIdRef.current")
  })
})
