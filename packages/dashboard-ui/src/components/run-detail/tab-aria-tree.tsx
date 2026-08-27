// THE ARIA-TREE TAB, ON THE DURABLE STEP (405-11 · D-14 / DETL-06, RESEARCH D2).
//
// THE SNAPSHOT HAS NO PRODUCER, AND THIS TAB SAYS SO RATHER THAN GUESSING. It used to read a
// per-step reasoning trace over its own HTTP call and paint the before/after accessibility
// snapshots out of it. That trace table and its route went with the v1 projection, and the bus
// deliberately collapses a `ScreenState` to a sha256 before it reaches the wire — so no durable
// row anywhere carries this text.
//
// SO THE TAB STAYS AND ITS EMPTY STATE BECOMES THE TRUTH, which is not the same as deleting it. A
// reader who opens ARIA Tree and finds nothing has learned a real fact about what this run
// recorded; a tab that vanished would have taught them nothing, and a tab that rendered the hash
// as though it were a tree would have taught them something false. The screen-state hash pair IS
// rendered — on the overview, as a comparable short id beside a changed/unchanged verdict.

import type { DisplayStep } from "@/lib/display-step"

/** What the tab says when nothing recorded a tree for this step. */
export const NO_ARIA_TREE_LABEL = "No ARIA tree snapshot available for this step"

interface TabAriaTreeProps {
  step: DisplayStep
}

export function TabAriaTree(_props: TabAriaTreeProps) {
  return (
    <div
      data-aria-tree-state="not-captured"
      className="flex items-center justify-center h-full text-muted-foreground text-sm py-12"
    >
      {NO_ARIA_TREE_LABEL}
    </div>
  )
}
