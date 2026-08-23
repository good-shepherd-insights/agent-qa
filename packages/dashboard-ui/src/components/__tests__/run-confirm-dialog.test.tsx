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
import { afterEach, describe, expect, it } from "vitest"

import { RunConfirmDialog } from "@/components/run-confirm-dialog"
import { CONFIRM_ANSWER_VOCABULARY } from "@/lib/api"

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

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
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
