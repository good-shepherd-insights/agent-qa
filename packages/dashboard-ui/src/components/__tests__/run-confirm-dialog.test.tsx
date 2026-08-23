// @vitest-environment jsdom
//
// THE RUN TRIGGER'S DIALOG (Phase 401 plan 09, D-11).
//
// WHAT THESE CELLS ARE FOR, precisely. The mechanism — parking, reaping, minting, denying — is
// measured end to end over the shipped server in `packages/cli`'s `run-trigger-confirm.test.ts`;
// nothing here re-measures any of it, and a cell here that tried would be asserting about a fake.
// What only this file can say is what a PERSON is offered: three answers and no fourth, the
// action's own disclosure beside them, and a denial that reads as a denial rather than as a wait.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RunConfirmDialog, RunConfirmHost } from "@/components/run-confirm-dialog"
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
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    // The REAL vocabulary stays real — the three-answers cell above reads it, and a mocked enum
    // would make that assertion agree with this file instead of with the wire.
    openRunConfirmChannel: (callbacks: NonNullable<typeof channel.callbacks>) => {
      channel.callbacks = callbacks
      return { close: () => {} } as unknown as EventSource
    },
    setRunConfirmScope: () => {},
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
  // A CONSTRUCTOR THAT DOES NOTHING, only so the host's `typeof EventSource === "undefined"` guard
  // is not the thing under test. The mocked `openRunConfirmChannel` never constructs one.
  ;(globalThis as { EventSource?: unknown }).EventSource = class {}
})

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
  delete (globalThis as { EventSource?: unknown }).EventSource
})

describe("the run trigger's confirm dialog", () => {
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
          'Start a run against target the-one-being-asked-about (declared: at least one target shared).',
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
