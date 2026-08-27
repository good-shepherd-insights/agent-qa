// ONE MEMBER OF A RUN, AND EVERYTHING RECORDED BENEATH IT (405-08 · D-16 / D-17 / D-18).
//
// PRESENTATIONAL, AND DELIBERATELY SO. This component takes a group the page already folded out of
// `runs.detail` and paints it. It fetches nothing, holds no run id, and derives no fact — the
// grouping, the filter and every sentence it renders come from `lib/run-detail-view.ts`, which is
// pure and separately pinned.
//
// A MEMBER THAT NEVER RAN IS NOT AN EMPTY BOX (D-18). Its stream began with a terminal event, so
// the projection wrote the member row and no steps. Rendering that as blank space under a header
// reads as "it passed everything"; rendering it with the did-not-run note, its persisted outcome
// and the producer's own `failureSummary` says what actually happened.
//
// THE OUTCOME BADGE APPEARS ONLY ON A MEMBER THAT DID NOT RUN. D-16 is explicit that per-member
// verdicts beside the aggregate are 406's DETL-04 and are not pre-claimed here; D-18 is the one
// place CONTEXT asks for the outcome word on this page, and it asks for it about a member with no
// steps. A member that ran shows its name, its handle and its re-run count — nothing else.
//
// TWO SENTENCES, TWO SPEAKERS. The did-not-run note is this product's; `failureSummary` is the
// runner's. They are rendered side by side rather than concatenated, because a reader looking at a
// member that never started is entitled to know which claim came from where (405-06's
// `memberNote` decision, restated in markup).

import { useState, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  memberDisplayName,
  memberHandleLabel,
  memberNote,
  reranLabel,
  type RunDetailGroup,
} from "@/lib/run-detail-view"

interface MemberGroupProps {
  group: RunDetailGroup
  /** Whether this run has more than one member — a single-member run gets no grouping chrome. */
  showChrome: boolean
  children?: ReactNode
}

/** The did-not-run body: this product's note, the persisted outcome, and the runner's own line. */
function ThinMemberBody({ group }: { group: RunDetailGroup }) {
  const note = memberNote(group.member, group)
  const { failureSummary } = group.member

  return (
    <div className="mx-2 mb-1.5 rounded-[2px] border border-border/60 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
      <span data-member-note>{note}</span>
      {failureSummary ? (
        <span data-member-failure-summary className="ml-2 select-text text-foreground/70">
          {failureSummary}
        </span>
      ) : null}
    </div>
  )
}

export function MemberGroup({ group, showChrome, children }: MemberGroupProps) {
  const [open, setOpen] = useState(true)
  const { member } = group
  const isThin = group.steps.length === 0
  const rerun = reranLabel(member.attempts)

  const body = isThin ? <ThinMemberBody group={group} /> : <ul role="group">{children}</ul>

  // No chrome, and the member ran: the steps stand on their own directly under the tree.
  if (!showChrome) {
    return isThin ? <li role="none">{body}</li> : <>{children}</>
  }

  return (
    <li role="none" data-member={String(member.testIndex)}>
      <div className="mt-3 mb-1 flex items-center gap-2 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground first:mt-0">
        <button
          type="button"
          aria-expanded={open}
          aria-label={memberDisplayName(member)}
          onClick={() => setOpen((prev) => !prev)}
          className="shrink-0 rounded-sm p-0.5 transition-colors hover:bg-muted/60"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        </button>
        <span className="min-w-0 truncate">{memberDisplayName(member)}</span>
        <span data-member-handle className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
          {memberHandleLabel(member.testIndex)}
        </span>
        {rerun ? (
          <span data-member-rerun className="shrink-0 text-[10px] text-amber-500">
            {rerun}
          </span>
        ) : null}
        {isThin && member.outcome ? (
          <Badge
            data-member-outcome={member.outcome}
            className="ml-auto shrink-0 text-[10px] uppercase tracking-wide"
          >
            {member.outcome}
          </Badge>
        ) : null}
      </div>
      {open ? body : null}
    </li>
  )
}
