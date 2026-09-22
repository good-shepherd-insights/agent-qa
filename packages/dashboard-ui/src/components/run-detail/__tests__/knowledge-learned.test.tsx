// @vitest-environment jsdom

// THE LEARNED HALF A PERSON ACTUALLY SEES (407-09 · LERN-02, D-09..D-12, T-407-21/T-407-22).
//
// WHY THESE CELLS RENDER INTO `document.body` THROUGH `createRoot`. That is the call `main.tsx`
// makes. A component mounted into a detached node can satisfy every query in a file like this one
// while the real mount path is broken, and the cell would never know.
//
// THE DOM CONTRACT IS THE SUBJECT, not the styling. `data-learned-state`, `data-learned-count-line`,
// `data-record-change`, `data-record-id` and `data-pending-proposals` are what 407-11's Playwright
// cells address on the built bundle, so every one of them is pinned here in the cheap medium first.
// The two class assertions that DO appear (`text-primary` on a routed reference, `font-mono` on the
// id) pin the UI-SPEC's accent reservation and its no-wrap rule — contracts, not looks.
//
// THE ABSENCE CELLS ARE THE POINT. D-12's whole posture is that this half never renders blank and
// never renders a `0` nobody measured, and both of those are claims about elements and text that
// must NOT exist. An assertion that only ever checks what IS rendered cannot see either one.

import { act, type ReactElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter } from "react-router"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CurationSnapshotSchema,
  RunKnowledgeProjectionSchema,
  type RunKnowledgeProjection,
} from "@vostride/agent-qa-schema"

import { KnowledgeLearned } from "@/components/run-detail/knowledge-learned"
import {
  BREAKDOWN_NOT_RECORDED_TEXT,
  COUNTS_NOT_RECORDED_TEXT,
  curationBreakdownLine,
  legacyCurationPairText,
} from "@/lib/post-processing-view"
import {
  CHANGED_NOTHING_TEXT,
  CHANGES_NOT_AVAILABLE_TEXT,
  CHANGES_UNREADABLE_TEXT,
  COUNTS_NOT_RECORDED_SENTENCE,
  CURATION_FAILED_PARTIAL_TEXT,
  CURATION_FAILED_TEXT,
  DELTAS_PENDING_TEXT,
  LEARNED_HEADING,
  REVIEW_PROPOSALS_CTA,
  STORE_READ_INCOMPLETE_TEXT,
  learnedView,
  pendingProposalsLine,
  type LearnedRowView,
  type LearnedView,
  type ProposalsView,
} from "@/lib/knowledge-view"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount() })
  container?.remove()
  root = undefined
  container = undefined
})

function mount(element: ReactElement): HTMLElement {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  // A `MemoryRouter` because a routed reference renders a `<Link>`, and a `Link` outside a router
  // throws. The unrouted arm renders a span and would pass without one — which is exactly why both
  // arms are mounted the same way here.
  act(() => { root?.render(<MemoryRouter>{element}</MemoryRouter>) })
  return container
}

function render(view: LearnedView, proposals?: ProposalsView): HTMLElement {
  return mount(<KnowledgeLearned view={view} proposals={proposals} />)
}

function stateOf(host: HTMLElement): string | null {
  return host.querySelector("[data-learned-state]")?.getAttribute("data-learned-state") ?? null
}

function rowsOf(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("li[data-record-change]")]
}

function row(overrides: Partial<LearnedRowView> = {}): LearnedRowView {
  const base: LearnedRowView = {
    key: "fact-cart-page-4ccac:confirmed:7::",
    kind: "confirmed",
    recordId: "fact-cart-page-4ccac",
  }
  // The default key tracks the default kind and id, so a cell that varies either still gets the
  // composite `learnedRow` would have produced rather than a stale literal (WR-02, widened to the
  // producer's own five-member identity tuple by REVIEW WR-01 — the two trailing segments are the
  // empty spellings of an absent `evidenceToken` and `byRecordId`).
  const merged = { ...base, ...overrides }
  return {
    ...merged,
    key: overrides.key ?? `${merged.recordId}:${merged.kind}:7::`,
  }
}

describe('419 receipt-backed promotion attribution', () => {
  it.each(['user-sovereign', 'gate1+gate2', 'gate1-lower-trust', 'deterministic-verdict-floor'] as const)(
    'renders the recorded %s path and receipt prefix', promotionPath => {
      const promotionReceiptDigest = '0123456789abcdef'.repeat(4)
      const host = render({ state: 'done', rows: [row({ kind: 'promoted', promotionPath, promotionReceiptDigest })] })
      const attribution = host.querySelector(`[data-promotion-path="${promotionPath}"]`)
      expect(attribution?.textContent).toBe(`promoted via ${promotionPath} · 0123456789ab`)
      expect(attribution?.getAttribute('data-promotion-receipt')).toBe(promotionReceiptDigest)
      expect(rowsOf(host)[0]?.getAttribute('data-record-change')).toBe('promoted')
    },
  )

  it('renders a path without inventing a receipt', () => {
    const host = render({ state: 'done', rows: [row({ kind: 'promoted', promotionPath: 'user-sovereign' })] })
    const attribution = host.querySelector('[data-promotion-path="user-sovereign"]')
    expect(attribution?.textContent).toBe('promoted via user-sovereign')
    expect(attribution?.getAttribute('data-promotion-receipt')).toBe('')
  })

  it('leaves historical promoted rows without an attribution element', () => {
    const host = render({ state: 'done', rows: [row({ kind: 'promoted' })] })
    expect(host.querySelector('[data-promotion-path]')).toBeNull()
    expect(host.textContent).not.toContain('promoted via')
  })
})

describe("an unsettled curation says so in words, never in a spinner (D-12)", () => {
  it("carries the pending word on the root and the one sentence a reader can act on", () => {
    const host = render({ state: "pending", sentence: DELTAS_PENDING_TEXT, rows: [] })

    expect(stateOf(host)).toBe("pending")
    expect(host.textContent).toContain(DELTAS_PENDING_TEXT)
    expect(rowsOf(host).length).toBe(0)
    expect(host.querySelector('[data-slot="skeleton"]')).toBeNull()
  })

  it("carries the running word with the SAME sentence — one fact is being waited on, not two", () => {
    const host = render({ state: "running", sentence: DELTAS_PENDING_TEXT, rows: [] })

    expect(stateOf(host)).toBe("running")
    expect(host.textContent).toContain(DELTAS_PENDING_TEXT)
  })

  it("renders NO count line while curation is unsettled — counts come only from the frozen row", () => {
    const host = render({ state: "pending", sentence: DELTAS_PENDING_TEXT, rows: [] })

    expect(host.querySelector("[data-learned-count-line]")).toBeNull()
  })
})

describe("a failed curation states the consequence, not just the failure (D-12)", () => {
  it("carries the failed word and says nothing was learned — and offers no retry", () => {
    const host = render({ state: "failed", sentence: CURATION_FAILED_TEXT, rows: [] })

    expect(stateOf(host)).toBe("failed")
    expect(host.textContent).toContain(CURATION_FAILED_TEXT)
    expect(rowsOf(host).length).toBe(0)
    expect(host.querySelector("button")).toBeNull()
  })
})

// A FAILED CHAIN CANNOT UN-COMMIT WHAT IT ALREADY WROTE (owner ruling 2026-08-31 · REVIEW CR-01 /
// G-407-12, the Learned-half twin of the "a served row wins" ruling 407-22 applied to the Used
// half). 407-26 hoisted `learnedView`'s rows fold above the whole curation-status ladder and put
// the chain's fate in its own slot; these cells are the half a person sees.
//
// TWO PRODUCERS, THEREFORE TWO SLOTS. `chainNote` reports the CHAIN — these records were committed
// before it stopped — and `readNote` reports the READ — this is not all of the store. The op folds
// `curation` and `learned` independently and the conformance file's `attributed-failed` world
// carries both at once, so one paragraph could only ever speak for one of them while silently
// standing in for the other. Both are pinned below, in document order, each by its own attribute.
describe("a failed chain paints the records it committed and notes its fate BESIDE them (CR-01, G-407-12)", () => {
  it("paints the row and the chain note, and prints NO sentence over the records", () => {
    const host = render({
      state: "failed",
      rows: [row()],
      chainNote: CURATION_FAILED_PARTIAL_TEXT,
    })

    expect(stateOf(host)).toBe("failed")
    expect(rowsOf(host).length).toBe(1)
    expect(host.querySelector("[data-learned-chain-note]")?.textContent)
      .toBe(CURATION_FAILED_PARTIAL_TEXT)
    // The falsifiable claim is the one that must be gone: `Curation failed — nothing was learned
    // from this run.` printed over a record the same projection carries is a claim that projection
    // disproves. The slot it lived in is empty here, not reworded.
    expect(host.querySelector("[data-learned-sentence]")).toBeNull()
    expect(host.textContent).not.toContain(CURATION_FAILED_TEXT)
  })

  it("leaves the no-rows arm exactly as it shipped — the approved sentence, and no note ELEMENT", () => {
    const host = render({ state: "failed", sentence: CURATION_FAILED_TEXT, rows: [] })

    expect(stateOf(host)).toBe("failed")
    expect(host.querySelector("[data-learned-sentence]")?.textContent).toBe(CURATION_FAILED_TEXT)
    expect(rowsOf(host).length).toBe(0)
    // Absent, never blank. An empty paragraph would be a chain-failure stamp on an arm whose
    // failure is already stated above it, and a cell could not tell the two apart.
    expect(host.querySelector("[data-learned-chain-note]")).toBeNull()
  })

  it("prints BOTH notes when a failed chain's records arrive over a partly-read store", () => {
    const host = render({
      state: "failed",
      rows: [row()],
      chainNote: CURATION_FAILED_PARTIAL_TEXT,
      scanIncomplete: true,
      readNote: STORE_READ_INCOMPLETE_TEXT,
    })

    expect(rowsOf(host).length).toBe(1)
    expect(host.querySelector("[data-learned-state]")?.getAttribute("data-learned-read"))
      .toBe("incomplete")
    expect(host.querySelector("[data-learned-chain-note]")?.textContent)
      .toBe(CURATION_FAILED_PARTIAL_TEXT)
    expect(host.querySelector("[data-learned-read-note]")?.textContent)
      .toBe(STORE_READ_INCOMPLETE_TEXT)

    // ORDER IS PART OF THE CONTRACT: the chain note is about the LIST a reader is already looking
    // at, the read note is about how much of the store anyone could see, so the chain note rides
    // directly under the rows and the read note under it. Read off a query naming BOTH paragraphs
    // by their own attributes — an index into a broader `<p>` query would also catch the heading
    // region and would pass on an ordering nobody asserted.
    const notes = [...host.querySelectorAll<HTMLElement>(
      "p[data-learned-chain-note], p[data-learned-read-note]",
    )]
    expect(notes.map(note => note.textContent))
      .toEqual([CURATION_FAILED_PARTIAL_TEXT, STORE_READ_INCOMPLETE_TEXT])

    const chain = host.querySelector("[data-learned-chain-note]")
    const read = host.querySelector("[data-learned-read-note]")
    expect(chain).not.toBeNull()
    expect(read).not.toBeNull()
    expect(
      (chain?.compareDocumentPosition(read as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe("a settled curation with no counts says so — never a zero (D-12)", () => {
  it("carries the counts-absent word, the sentence and the fragment, with no digit anywhere", () => {
    const host = render({
      state: "counts-absent",
      countLine: COUNTS_NOT_RECORDED_TEXT,
      sentence: COUNTS_NOT_RECORDED_SENTENCE,
      rows: [],
    })

    expect(stateOf(host)).toBe("counts-absent")
    expect(host.textContent).toContain(COUNTS_NOT_RECORDED_SENTENCE)
    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe(COUNTS_NOT_RECORDED_TEXT)
    expect(host.textContent).not.toContain("0")
  })
})

describe("a settled curation that changed nothing says that, and lists nothing (D-12)", () => {
  it("renders the both-zero phrase beside the heading and the changed-nothing sentence", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(0, 0),
      sentence: CHANGED_NOTHING_TEXT,
      rows: [],
    })

    expect(stateOf(host)).toBe("done")
    expect(host.querySelector("[data-learned-count-line]")?.textContent).toBe(legacyCurationPairText(0, 0))
    expect(host.textContent).toContain(CHANGED_NOTHING_TEXT)
    expect(rowsOf(host).length).toBe(0)
  })

  it("keeps the counts on screen when they moved but no change record reached this run", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(3, 1),
      sentence: CHANGES_NOT_AVAILABLE_TEXT,
      rows: [],
    })

    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe(legacyCurationPairText(3, 1))
    expect(host.textContent).toContain(CHANGES_NOT_AVAILABLE_TEXT)
    expect(rowsOf(host).length).toBe(0)
  })
})

/**
 * LEARNED-BREAKDOWN-LINE AND LEARNED-LEGACY-NOTE, AT THE MOUNT (425-06 · D-16/D-17/D-18).
 *
 * The heading's line is now the curation card's own breakdown string, and the note beneath it is
 * what a pre-423 or withheld row says about the breakdown it never recorded. The note is a SECOND
 * element rather than a second clause on the count line: a reader scanning the counts should not
 * have to parse a sentence out of them, and a cell should be able to assert the absence.
 */
describe("the heading spells one number one way, and labels a coarser one (425-06)", () => {
  it("LEARNED-BREAKDOWN-LINE: renders the five-bucket line in the heading's own count slot", () => {
    const breakdown = { added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1 }
    const host = render({ state: "done", countLine: curationBreakdownLine(breakdown), rows: [] })

    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe("1 added · 1 confirmed · 1 superseded · 1 deprecated · 1 proposed")
    expect(host.querySelector("[data-learned-count-note]")).toBeNull()
  })

  it("LEARNED-LEGACY-NOTE: renders the note as its own muted paragraph beneath the heading row", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(2, 0),
      countNote: BREAKDOWN_NOT_RECORDED_TEXT,
      rows: [],
    })

    const note = host.querySelector("[data-learned-count-note]")
    expect(note?.tagName).toBe("P")
    expect(note?.textContent).toBe(BREAKDOWN_NOT_RECORDED_TEXT)
    expect(note?.className).toContain("text-xs")
    expect(note?.className).toContain("text-muted-foreground")
    expect(host.querySelector("[data-learned-count-line]")?.textContent).toBe("2 curated · 0 deprecated")
  })

  it("LEARNED-LEGACY-NOTE: omits the note element ENTIRELY when there is no absence to label", () => {
    const host = render({ state: "done", countLine: legacyCurationPairText(3, 1), rows: [] })

    expect(host.querySelector("[data-learned-count-note]")).toBeNull()
  })
})

describe("the record list is one addressable row per change (D-10)", () => {
  const populated: LearnedView = {
    state: "done",
    countLine: legacyCurationPairText(3, 1),
    rows: [
      row({ kind: "promoted", recordId: "MEM-001", ref: "agentqa://memory/MEM-001" }),
      row({ kind: "deprecated", recordId: "fact-page-https-example-com-0f9a" }),
    ],
  }

  it("renders the heading, the count line and one li per change, in the projection's order", () => {
    const host = render(populated)

    expect(host.querySelector("h4")?.textContent).toBe(LEARNED_HEADING)
    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe(legacyCurationPairText(3, 1))
    expect(rowsOf(host).map((el) => el.getAttribute("data-record-change")))
      .toEqual(["promoted", "deprecated"])
    expect(rowsOf(host).map((el) => el.getAttribute("data-record-id")))
      .toEqual(["MEM-001", "fact-page-https-example-com-0f9a"])
  })

  it("renders the kind word in the row's badge as well as in its attribute", () => {
    const host = render(populated)

    expect(rowsOf(host)[0]?.textContent).toContain("promoted")
    expect(rowsOf(host)[1]?.textContent).toContain("deprecated")
  })

  it("renders the record id in a mono element on every row — the address is always readable", () => {
    const host = render(populated)

    for (const el of rowsOf(host)) {
      const id = el.querySelector("[data-record-id-text]")
      expect(id?.className).toContain("font-mono")
      expect(id?.textContent).toBe(el.getAttribute("data-record-id"))
    }
  })

  /**
   * A CONTENT-DERIVED BUNDLE ID IS ONE UNBROKEN TOKEN (407-23 · G-407-2, LERN-02).
   *
   * `RecordRow`'s own docstring already argues that a change record's id is a content-derived
   * bundle id far more often than an entity short-ID — `fact-page-https-example-com-0f9a` and its
   * longer siblings carry no space to break at. `break-word` would let such a token overflow; only
   * `overflow-wrap: anywhere` reduces its min-content width so the baseline row can SHRINK it.
   * The reference beside it solves the same problem the other way (`truncate max-w-[32rem]`) and is
   * deliberately not touched here.
   */
  it("lets a content-derived record id shrink its own box rather than widen the row", () => {
    const host = render(populated)

    for (const el of rowsOf(host)) {
      const id = el.querySelector("[data-record-id-text]")
      expect(id?.className).toContain("wrap-anywhere")
    }
  })

  it("renders a ROUTED reference as an accent anchor with the truncation rule the SPEC states", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ kind: "confirmed", recordId: "TST-001", ref: "agentqa://test/TST-001", href: "/test/t_1" })],
    })

    const anchor = host.querySelector<HTMLAnchorElement>("li[data-record-change] a[data-record-ref]")
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute("href")).toBe("/test/t_1")
    expect(anchor?.textContent).toBe("agentqa://test/TST-001")
    expect(anchor?.className).toContain("text-primary")
    expect(anchor?.className).toContain("truncate")
    expect(anchor?.className).toContain("max-w-[32rem]")
  })

  it("renders an UNROUTED reference as text — this build says what, not where to click", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ kind: "confirmed", recordId: "MEM-001", ref: "agentqa://memory/MEM-001" })],
    })

    const ref = host.querySelector("li[data-record-change] [data-record-ref]")
    expect(ref?.tagName).toBe("SPAN")
    expect(ref?.textContent).toBe("agentqa://memory/MEM-001")
    expect(host.querySelector("li[data-record-change] a")).toBeNull()
  })

  it("renders no reference element at all for a record that has no canonical address", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ recordId: "fact-page-https-example-com-0f9a" })],
    })

    expect(host.querySelector("[data-record-ref]")).toBeNull()
    expect(rowsOf(host)[0]?.getAttribute("data-record-id")).toBe("fact-page-https-example-com-0f9a")
  })

  it("drops the state sentence once rows are painted — the rows ARE the answer", () => {
    const host = render(populated)

    expect(host.querySelector("[data-learned-sentence]")).toBeNull()
  })
})

describe("a curated NEW fact is painted, not denied (CR-04, R-407-15-01)", () => {
  const everyKind = ["added", "confirmed", "superseded", "deprecated", "promoted"] as const

  it("renders one li per kind for all FIVE Learned kinds, in the view's order", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(3, 1),
      rows: everyKind.map((kind, index) => row({ kind, recordId: `rec_${String(index)}` })),
    })

    expect(rowsOf(host).map((el) => el.getAttribute("data-record-change"))).toEqual([...everyKind])
  })

  it("gives `added` the emerald a promotion wears — the SPEC allows no new colour for it", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ kind: "added", recordId: "fact-el-textbox-password-9a05ce" })],
    })

    const badge = rowsOf(host)[0]?.querySelector("span")
    expect(badge?.className).toContain("text-emerald-500")
  })

  /**
   * THE VERIFIER'S REPRODUCTION, AT THE COMPONENT. Gap 2's projection painted a count line beside
   * a sentence denying the record it had been handed; the fixed half paints the row instead.
   */
  it("paints the added record's row and no sentence at all", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ kind: "added", recordId: "fact-el-textbox-password-9a05ce" })],
    })

    expect(rowsOf(host).length).toBe(1)
    expect(rowsOf(host)[0]?.getAttribute("data-record-id")).toBe("fact-el-textbox-password-9a05ce")
    expect(host.querySelector("[data-learned-sentence]")).toBeNull()
  })

  /**
   * WR-02 AT THE MOUNT. Two changes on one bundle share a `recordId`, so keying by it collided and
   * React warned; a cell that only counted `li` would have passed on the first render and lost a
   * row on the re-render that fires as curation settles. This one watches the console too.
   */
  it("renders BOTH changes of one record, with no duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const host = render({
        state: "done",
        countLine: legacyCurationPairText(1, 0),
        rows: [
          row({ key: "r:confirmed:12", kind: "confirmed", recordId: "r" }),
          row({ key: "r:superseded:13", kind: "superseded", recordId: "r" }),
        ],
      })

      expect(rowsOf(host).length).toBe(2)
      expect(rowsOf(host).map((el) => el.getAttribute("data-record-change")))
        .toEqual(["confirmed", "superseded"])
      const warned = spy.mock.calls.some((call) => String(call[0]).includes("same key"))
      expect(warned).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("an unreadable store is stamped on the root, never inferred from an empty list (407-14)", () => {
  const unreadable: LearnedView = {
    state: "done",
    countLine: legacyCurationPairText(3, 1),
    sentence: CHANGES_UNREADABLE_TEXT,
    rows: [],
    scanIncomplete: true,
  }

  it("carries data-learned-read=incomplete, the counts, the sentence and no rows", () => {
    const host = render(unreadable)

    expect(host.querySelector("[data-learned-state]")?.getAttribute("data-learned-read"))
      .toBe("incomplete")
    expect(host.querySelector("[data-learned-count-line]")?.textContent)
      .toBe(legacyCurationPairText(3, 1))
    expect(host.querySelector("[data-learned-sentence]")?.textContent)
      .toBe(CHANGES_UNREADABLE_TEXT)
    expect(rowsOf(host).length).toBe(0)
  })

  it("omits the attribute ENTIRELY on a clean read — absent, never an empty string", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(3, 1),
      sentence: CHANGES_NOT_AVAILABLE_TEXT,
      rows: [],
    })

    const section = host.querySelector("[data-learned-state]")
    expect(section?.hasAttribute("data-learned-read")).toBe(false)
    expect(stateOf(host)).toBe("done")
    // AND NO NOTE AT ALL (407-18). An empty paragraph beneath a clean read would be a degradation
    // stamp nobody earned; the element is absent, not blank.
    expect(host.querySelector("[data-learned-read-note]")).toBeNull()
  })
})

describe("a partial read is painted beside the rows, and beneath an unsettled sentence (REVIEW CR-01, WR-05)", () => {
  it("paints the row, the incomplete stamp and the read note — and NO sentence", () => {
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row()],
      scanIncomplete: true,
      readNote: STORE_READ_INCOMPLETE_TEXT,
    })

    expect(host.querySelector("[data-learned-state]")?.getAttribute("data-learned-read"))
      .toBe("incomplete")
    expect(rowsOf(host).length).toBe(1)
    expect(host.querySelector("[data-learned-sentence]")).toBeNull()
    expect(host.querySelector("[data-learned-read-note]")?.textContent)
      .toBe(STORE_READ_INCOMPLETE_TEXT)
  })

  it("paints the pending sentence AND the note when a chain has not settled over an unreadable store", () => {
    const host = render({
      state: "pending",
      sentence: DELTAS_PENDING_TEXT,
      rows: [],
      scanIncomplete: true,
      readNote: STORE_READ_INCOMPLETE_TEXT,
    })

    expect(stateOf(host)).toBe("pending")
    expect(host.querySelector("[data-learned-state]")?.getAttribute("data-learned-read"))
      .toBe("incomplete")
    expect(host.querySelector("[data-learned-sentence]")?.textContent).toBe(DELTAS_PENDING_TEXT)
    expect(host.querySelector("[data-learned-read-note]")?.textContent)
      .toBe(STORE_READ_INCOMPLETE_TEXT)
    expect(host.querySelector("[data-learned-count-line]")).toBeNull()
    expect(rowsOf(host).length).toBe(0)
  })

  /**
   * REVIEW WR-01 AT THE MOUNT. Two `confirmed` events on ONE bundle at ONE ordinal survive the
   * outcome-event dedupe when their evidence tokens differ, so the 407-15 triple keyed them
   * identically and React warned and dropped one. The key now differs only in the token segment,
   * and the console is watched to prove the difference is enough.
   */
  it("renders two confirmations that differ ONLY in the evidence token, with no duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const host = render({
        state: "done",
        countLine: legacyCurationPairText(2, 0),
        rows: [
          row({ key: "r:confirmed:12:tok-a:", kind: "confirmed", recordId: "r" }),
          row({ key: "r:confirmed:12:tok-b:", kind: "confirmed", recordId: "r" }),
        ],
      })

      expect(rowsOf(host).length).toBe(2)
      const warned = spy.mock.calls.some((call) => String(call[0]).includes("same key"))
      expect(warned).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it("renders the row() default key in the producer's five-member form", () => {
    expect(row().key).toBe("fact-cart-page-4ccac:confirmed:7::")
    expect(row({ kind: "promoted", recordId: "r" }).key).toBe("r:promoted:7::")
  })
})

describe("the proposals line is a count and a door (D-11, T-407-22)", () => {
  const proposals: ProposalsView = {
    count: 3,
    line: pendingProposalsLine(3),
    ctaText: REVIEW_PROPOSALS_CTA,
    command: "agent-qa proposals list --status pending",
  }

  it("stamps the count on the line and renders the single CTA as the runnable review command (423 D-19)", async () => {
    const host = render({ state: "done", countLine: legacyCurationPairText(0, 0), sentence: CHANGED_NOTHING_TEXT, rows: [] }, proposals)

    const line = host.querySelector("[data-pending-proposals]")
    expect(line?.getAttribute("data-pending-proposals")).toBe("3")
    expect(line?.textContent).toContain(pendingProposalsLine(3))

    const cta = host.querySelector<HTMLButtonElement>("button[data-review-proposals]")
    expect(host.querySelector("[data-pending-proposals] a")).toBeNull()
    expect(cta?.getAttribute("href")).toBeNull()
    expect(cta?.getAttribute("data-review-command")).toBe("agent-qa proposals list --status pending")
    expect(cta?.textContent).toContain("agent-qa proposals list --status pending")
    // The projection's own `ctaText` still names the control for assistive technology, and it
    // leads the accessible name so the visible command is part of it.
    expect(cta?.getAttribute("aria-label")).toBe(`${proposals.ctaText}: agent-qa proposals list --status pending`)

    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    await act(async () => { cta?.click() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith("agent-qa proposals list --status pending")
    expect(cta?.getAttribute("data-copy-status")).toBe("copied")
  })

  it("says so when the clipboard is unavailable, and keeps the command readable on the control", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    const host = render({ state: "done", countLine: legacyCurationPairText(0, 0), sentence: CHANGED_NOTHING_TEXT, rows: [] }, proposals)
    const cta = host.querySelector<HTMLButtonElement>("button[data-review-proposals]")
    await act(async () => { cta?.click() })
    expect(cta?.getAttribute("data-copy-status")).toBe("failed")
    expect(host.querySelector("[data-review-command-status]")?.textContent)
      .toBe("Could not copy the review command. Run: agent-qa proposals list --status pending")
    expect(cta?.textContent).toContain("agent-qa proposals list --status pending")
  })

  it("renders NO line and NO attribute when the page passed no proposals — a zero is not news", () => {
    const host = render({ state: "done", countLine: legacyCurationPairText(0, 0), sentence: CHANGED_NOTHING_TEXT, rows: [] })

    expect(host.querySelector("[data-pending-proposals]")).toBeNull()
    expect(host.querySelector("[data-review-proposals]")).toBeNull()
  })

  it("shows the proposals line beside an unsettled half — the inbox is not this run's chain", () => {
    const host = render({ state: "pending", sentence: DELTAS_PENDING_TEXT, rows: [] }, proposals)

    expect(stateOf(host)).toBe("pending")
    expect(host.querySelector("[data-pending-proposals]")).not.toBeNull()
  })
})

describe("projection text reaches the DOM as TEXT, never as markup (T-407-21)", () => {
  it("renders a hostile record id as a text node — no element is created from it", () => {
    const hostile = '<img src=x onerror=alert(1)>'
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ recordId: hostile })],
    })

    expect(host.querySelector("img")).toBeNull()
    expect(host.textContent).toContain(hostile)
    expect(rowsOf(host)[0]?.getAttribute("data-record-id")).toBe(hostile)
  })

  it("renders a hostile reference string as a text node too — an href is never taken from one", () => {
    const hostile = 'javascript:alert(1)'
    const host = render({
      state: "done",
      countLine: legacyCurationPairText(1, 0),
      rows: [row({ recordId: "MEM-001", ref: hostile })],
    })

    expect(host.querySelector("li[data-record-change] a")).toBeNull()
    expect(host.querySelector("[data-record-ref]")?.textContent).toBe(hostile)
  })
})

// 423 D-15 · WIN #313. The op now serves a fixed curation snapshot and a separately counted
// since-then section beside `learned.changes`. These cells drive schema-valid projections through
// the real `learnedView` into the real component, so the failed-chain fix is protected on the path
// a page actually takes, and the snapshot's presence or absence is stated rather than inferred.
const RUN_423 = "run-423-24-learned"
type ReadyProjection = Extract<RunKnowledgeProjection, { kind: "ready" }>
type LearnedChange = ReadyProjection["learned"]["changes"][number]

function joinedContent(recordId: string): NonNullable<LearnedChange["recordContent"]> {
  return {
    content: `body ${recordId}`,
    summary: `summary ${recordId}`,
    kind: "fact",
    applicability: { product: "shop", scope: "checkout", anchors: ["page:/checkout"], openedAtOrdinal: 3 },
    currentStatus: "active",
    currentTrust: { confirmations: 1, contradictions: 0, evidenceTokens: [], lastEventOrdinal: 30 },
  }
}

function recorded(recordId: string, change: LearnedChange["change"], atOrdinal: number, extra: Partial<LearnedChange> = {}) {
  return {
    schemaVersion: 1 as const, recordId, change, atOrdinal, sourceRunId: RUN_423,
    evidenceToken: `receipt-${recordId}-${String(atOrdinal)}`, ...extra,
  }
}

function fiveBucketSnapshot() {
  return CurationSnapshotSchema.parse({
    schemaVersion: 1,
    rows: [
      { recordId: "fact-added", bucket: "added", changes: [{ bucket: "added", change: recorded("fact-added", "added", 20) }] },
      { recordId: "fact-confirmed", bucket: "confirmed", changes: [{ bucket: "confirmed", change: recorded("fact-confirmed", "confirmed", 21) }] },
      { recordId: "fact-victim", bucket: "superseded", byRecordId: "fact-replacement", changes: [
        { bucket: "superseded", change: recorded("fact-victim", "superseded", 22, { byRecordId: "fact-replacement" }) },
        { bucket: "added", change: recorded("fact-replacement", "added", 22) },
      ] },
      { recordId: "fact-deprecated", bucket: "deprecated", changes: [{ bucket: "deprecated", change: recorded("fact-deprecated", "deprecated", 23) }] },
      { recordId: "fact-proposed", bucket: "proposed", changes: [{ bucket: "proposed", change: recorded("fact-proposed", "added", 24) }] },
    ],
    breakdown: { added: 1, confirmed: 1, superseded: 1, deprecated: 1, proposed: 1 },
  })
}

function joined(change: LearnedChange): LearnedChange {
  return { ...change, recordContent: joinedContent(change.recordId) }
}

function readyProjection(
  status: ReadyProjection["curation"]["status"],
  learned: Partial<ReadyProjection["learned"]>,
  counts?: { curated: number; deprecated: number },
): ReadyProjection {
  return RunKnowledgeProjectionSchema.parse({
    kind: "ready", runId: RUN_423, buildOrdinal: 2, knowledgeStore: "bound", steps: [],
    curation: { status, ...(counts === undefined ? {} : { counts }) },
    learned: { changes: [], canaryAttributions: [], ...learned },
  }) as ReadyProjection
}

function snapshotChanges(): LearnedChange[] {
  return fiveBucketSnapshot().rows.flatMap(row => row.changes.map(entry => joined(entry.change)))
}

function sectionOf(host: HTMLElement): HTMLElement {
  const section = host.querySelector<HTMLElement>("[data-learned-state]")
  if (section === null) throw new Error("expected the Learned section")
  return section
}

describe("423 D-15: a failed chain keeps its learned rows beside the snapshot sections (WIN #313)", () => {
  it("FAILED-CHAIN-ROWS-RETAINED: a chain that learned before failing paints every served change, joined or absent", () => {
    const projection = readyProjection("failed", {
      changes: [
        joined(recorded("fact-before-failure", "added", 20)),
        { ...recorded("fact-purged-since", "confirmed", 21), contentAbsence: { reason: "not-found" } },
      ],
    })
    const host = render(learnedView(projection))

    expect(stateOf(host)).toBe("failed")
    expect(rowsOf(host).map(el => el.getAttribute("data-record-id")))
      .toEqual(["fact-before-failure", "fact-purged-since"])
    expect(rowsOf(host).map(el => el.getAttribute("data-record-change"))).toEqual(["added", "confirmed"])
    expect(host.querySelector("[data-learned-chain-note]")?.textContent).toBe(CURATION_FAILED_PARTIAL_TEXT)
    expect(host.querySelector("[data-learned-sentence]")).toBeNull()
    expect(host.textContent).not.toContain(CURATION_FAILED_TEXT)
  })

  it("FAILED-NO-SNAPSHOT: an absent snapshot is stated on the half, with no since-then count and no invented counts", () => {
    const projection = readyProjection("failed", { changes: [joined(recorded("fact-before-failure", "added", 20))] })
    const view = learnedView(projection)
    const host = render(view)
    const section = sectionOf(host)

    expect(view.curationSnapshot).toBeUndefined()
    expect(section.getAttribute("data-learned-snapshot")).toBe("absent")
    expect(section.hasAttribute("data-learned-since-then")).toBe(false)
    expect(host.querySelector("[data-learned-count-line]")).toBeNull()
    expect(rowsOf(host).length).toBe(1)
    expect(rowsOf(host)[0]?.hasAttribute("data-learned-section")).toBe(false)
  })

  it("FAILED-NO-SNAPSHOT: a historical settled chain states the same absence and keeps its legacy counts", () => {
    const projection = readyProjection("done", { changes: [joined(recorded("fact-legacy", "confirmed", 9))] }, { curated: 1, deprecated: 0 })
    const host = render(learnedView(projection))

    expect(sectionOf(host).getAttribute("data-learned-snapshot")).toBe("absent")
    expect(host.querySelector("[data-learned-count-line]")?.textContent).toBe(legacyCurationPairText(1, 0))
    expect(rowsOf(host).length).toBe(1)
  })

  it("ALL-FIVE-BUCKETS: a completed snapshot is recorded, and every change it names stays in this run's curation", () => {
    const snapshot = fiveBucketSnapshot()
    const changes = snapshotChanges()
    const projection = readyProjection("done", {
      changes, curationSnapshot: snapshot, sinceThen: { changes: [], count: 0 },
    }, { curated: 4, deprecated: 1 })
    const view = learnedView(projection)
    const host = render(view)
    const section = sectionOf(host)

    expect(view.curationSnapshot).toEqual({ breakdown: snapshot.breakdown, sinceThenCount: 0 })
    expect(section.getAttribute("data-learned-snapshot")).toBe("recorded")
    expect(section.getAttribute("data-learned-since-then")).toBe("0")
    expect(rowsOf(host).map(el => el.getAttribute("data-record-id"))).toEqual(changes.map(row => row.recordId))
    expect(rowsOf(host).map(el => el.getAttribute("data-learned-section"))).toEqual(changes.map(() => "curation"))
  })

  it("LATER-LINKED-ROWS: a later promotion is painted as a since-then row beside the unchanged curation rows", () => {
    const snapshot = fiveBucketSnapshot()
    const later = joined(recorded("fact-added", "promoted", 91))
    const projection = readyProjection("done", {
      changes: [...snapshotChanges(), later], curationSnapshot: snapshot, sinceThen: { changes: [later], count: 1 },
    }, { curated: 4, deprecated: 1 })
    const view = learnedView(projection)
    const host = render(view)
    const rows = rowsOf(host)

    expect(view.curationSnapshot?.sinceThenCount).toBe(1)
    expect(sectionOf(host).getAttribute("data-learned-since-then")).toBe("1")
    expect(rows.length).toBe(snapshotChanges().length + 1)
    expect(rows.at(-1)?.getAttribute("data-record-change")).toBe("promoted")
    expect(rows.at(-1)?.getAttribute("data-record-id")).toBe("fact-added")
    expect(rows.map(el => el.getAttribute("data-learned-section")))
      .toEqual([...snapshotChanges().map(() => "curation"), "since-then"])
  })
})
