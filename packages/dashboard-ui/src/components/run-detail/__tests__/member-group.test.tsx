// @vitest-environment jsdom
//
// THE MEMBER-GROUPED STEP TREE (405-08 · DETL-01, D-16 / D-17 / D-18).
//
// The tree these cells drive reads the DURABLE projection and nothing else. Every fixture below is
// a real `RunDetailMember` / `RunDetailStep` / `RunDetailSubAction` — no casts through `unknown`,
// because a cast would throw away the one property that makes typing the UI on the op's contract
// worth anything: a payload drift becomes a compile error here rather than an `undefined` in a
// text node.
//
// COPY IS ASSERTED BY CONSTANT (405-06's law). `reranLabel`, `memberNote` and `DID_NOT_RUN_LABEL`
// come from `lib/run-detail-view.ts`, so a sentence moves in one place and these cells move with
// it. A string re-typed here would stay green while the page said something else.
//
// THE `data-*` ATTRIBUTES CARRY RAW WORDS, not labels — `data-member-outcome="failed"`,
// `data-sub-action-result="success"` — because 405-12's Playwright cells address the built bundle
// and a cell reading visible text would be asserting on presentation.

import { act, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  RunDetailMember,
  RunDetailStep,
  RunDetailSubAction,
} from "@vostride/agent-qa-schema"
import { asRef } from "@vostride/agent-qa-schema"

import { MemberGroup } from "@/components/run-detail/member-group"
import { StepTree } from "@/components/run-detail/step-tree"
import { SubActionTreeItem } from "@/components/run-detail/sub-action-tree-item"
import {
  DID_NOT_RUN_LABEL,
  memberDisplayName,
  memberHandleLabel,
  reranLabel,
  type RunDetailGroup,
} from "@/lib/run-detail-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

let container: HTMLDivElement
let root: Root

function mount(element: ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return container
}

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function member(testIndex: number, extra: Partial<RunDetailMember> = {}): RunDetailMember {
  return { testIndex, attempts: 1, ...extra }
}

function step(testIndex: number, stepIndex: number, extra: Partial<RunDetailStep> = {}): RunDetailStep {
  return {
    testIndex,
    stepIndex,
    stepText: `Step ${String(stepIndex)} of member ${String(testIndex)}`,
    cacheStatus: "miss",
    verifierVerdict: { pass: true, reasoning: "looks right" },
    selfHealOccurred: false,
    briefDigest: `d${String(testIndex)}${String(stepIndex)}`,
    status: "passed",
    durationMs: 1200,
    ...extra,
  }
}

function subAction(
  subActionIndex: number,
  extra: Partial<RunDetailSubAction> = {},
): RunDetailSubAction {
  return {
    testIndex: 0,
    stepIndex: 0,
    subActionIndex,
    plan: "click the primary button",
    plannedAction: { type: "click", ref: asRef("e1") },
    result: { success: true },
    screenStateHash: "abcdef0123456789".repeat(4),
    ...extra,
  }
}

function group(m: RunDetailMember, steps: RunDetailStep[], subActions: RunDetailSubAction[] = []): RunDetailGroup {
  return {
    member: m,
    steps: steps.map((s) => ({
      step: s,
      subActions: subActions.filter((a) => a.testIndex === s.testIndex && a.stepIndex === s.stepIndex),
    })),
  }
}

function tree(groups: RunDetailGroup[], showMemberChrome: boolean) {
  return mount(
    <StepTree
      groups={groups}
      showMemberChrome={showMemberChrome}
      selection={null}
      onSelect={() => {}}
    />,
  )
}

describe("the step tree groups by member (D-16)", () => {
  it("renders one group per member in handle order, each named and handled", () => {
    const view = tree(
      [
        group(member(0, { name: "Login" }), [step(0, 0)]),
        group(member(1, { name: "Checkout" }), [step(1, 0)]),
      ],
      true,
    )

    const members = [...view.querySelectorAll("[data-member]")]
    expect(members.map((el) => el.getAttribute("data-member"))).toEqual(["0", "1"])

    const text = view.textContent ?? ""
    expect(text).toContain("Login")
    expect(text).toContain(memberHandleLabel(0))
    expect(text).toContain("Checkout")
    expect(text).toContain(memberHandleLabel(1))
    expect(text.indexOf("Login")).toBeLessThan(text.indexOf("Checkout"))
  })

  it("names a member the projection never named, without inventing an identity", () => {
    const view = tree([group(member(0), [step(0, 0)]), group(member(1), [step(1, 0)])], true)

    expect(view.textContent).toContain(memberDisplayName(member(0)))
    expect(view.textContent).toContain(memberDisplayName(member(1)))
  })

  it("shows no grouping chrome at all for a single-member run", () => {
    const view = tree([group(member(0, { name: "Login" }), [step(0, 0)])], false)

    expect(view.querySelector("[data-member]")).toBeNull()
    expect(view.textContent).toContain("Step 0 of member 0")
  })

  it("renders NO outcome badge on a member that ran — per-member verdicts beside the aggregate are 406's DETL-04", () => {
    const view = tree(
      [
        group(member(0, { name: "Login", outcome: "passed" }), [step(0, 0)]),
        group(member(1, { name: "Checkout", outcome: "failed" }), [step(1, 0)]),
      ],
      true,
    )

    expect(view.querySelector("[data-member-outcome]")).toBeNull()
  })
})

describe("a re-run says so, and a first attempt says nothing (D-17)", () => {
  it("reads the re-run count off `attempts` for a member that was re-run", () => {
    const label = reranLabel(3)
    expect(label).toBeDefined()

    const view = tree([group(member(0, { name: "Flaky", attempts: 3 }), [step(0, 0)])], true)

    expect(view.textContent).toContain(label!)
  })

  it("says nothing about a re-run that did not happen", () => {
    const view = tree([group(member(0, { name: "Steady", attempts: 1 }), [step(0, 0)])], true)

    expect(view.textContent).not.toContain("re-ran")
  })
})

describe("a member that never ran renders honestly, never as an empty tree (D-18)", () => {
  it("shows the did-not-run note, the persisted outcome and the producer's own summary", () => {
    const view = tree(
      [
        group(
          member(1, { name: "Checkout", outcome: "skipped", failureSummary: "skipped by fail-fast" }),
          [],
        ),
      ],
      true,
    )

    expect(view.textContent).toContain(DID_NOT_RUN_LABEL)
    expect(view.querySelector('[data-member-outcome="skipped"]')).toBeTruthy()
    expect(view.textContent).toContain("skipped by fail-fast")
  })

  it("still renders the note when there is no grouping chrome to hang it on", () => {
    const view = mount(
      <ul>
        <MemberGroup group={group(member(0, { outcome: "cancelled" }), [])} showChrome={false} />
      </ul>,
    )

    expect(view.textContent).toContain(DID_NOT_RUN_LABEL)
    expect(view.querySelector("[data-member]")).toBeNull()
  })
})

describe("a sub-action carries its plan and its result word (D-16)", () => {
  it("renders the producer's plan text and addresses itself by ordinal", () => {
    const view = mount(
      <ul>
        <SubActionTreeItem
          sub={subAction(0)}
          stepId="0:0"
          cached={false}
          isSelected={false}
          onSelect={() => {}}
        />
      </ul>,
    )

    const item = view.querySelector('[data-sub-action="0"]')
    expect(item).toBeTruthy()
    expect(view.textContent).toContain("click the primary button")
    expect(item?.getAttribute("data-sub-action-result")).toBe("success")
  })

  it("spells a failed sub-action's result as the raw word, not as presentation", () => {
    const view = mount(
      <ul>
        <SubActionTreeItem
          sub={subAction(2, { result: { success: false, error: "element detached" } })}
          stepId="0:0"
          cached={false}
          isSelected={false}
          onSelect={() => {}}
        />
      </ul>,
    )

    const item = view.querySelector('[data-sub-action="2"]')
    expect(item?.getAttribute("data-sub-action-result")).toBe("failure")
  })
})
