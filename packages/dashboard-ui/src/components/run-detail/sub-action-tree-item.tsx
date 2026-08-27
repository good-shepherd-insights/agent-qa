// ONE RECORDED SUB-ACTION IN THE DURABLE TREE (405-08 · D-16).
//
// REPOINTED OFF THE v1 SHAPE. This item used to take `SubActionData` — the v1 projection's row —
// and reverse-engineer a label out of an untyped `plannedAction` blob with a `JSON.parse` and a
// try/catch. The durable projection carries the planner's OWN sentence in `plan`, so the item
// renders that verbatim instead of re-deriving a worse one from the action it produced.
//
// THE CACHE ANSWER COMES FROM THE STEP. `RunDetailSubAction` records no `cached` flag; the
// projection records `cacheStatus` on the step, and a step served from cache served every action
// under it. So `cached` is a prop the step passes down rather than a fact this row invents.
//
// `data-sub-action-result` CARRIES THE RAW WORD, not the presentation, because 405-12's Playwright
// cells address the built bundle and a page that painted the right word into the wrong element
// would still pass a text assertion.

import type { RunDetailSubAction } from "@vostride/agent-qa-schema"

import { CacheStatusIconWrapper } from "./cache-status-marker"
import { cn } from "@/lib/utils"

interface SubActionTreeItemProps {
  sub: RunDetailSubAction
  /** The owning step's key — see `runDetailStepKey`. */
  stepId: string
  /** Whether the owning step was served from cache (D-16). */
  cached: boolean
  isSelected: boolean
  onSelect: () => void
}

/** The two words a recorded result can be. Raw, closed, and never a sentence. */
function resultWord(sub: RunDetailSubAction): 'success' | 'failure' {
  return sub.result.success ? 'success' : 'failure'
}

export function SubActionTreeItem({ sub, stepId, cached, isSelected, onSelect }: SubActionTreeItemProps) {
  const result = resultWord(sub)
  const statusHost = (
    <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          result === 'success' ? "bg-emerald-500" : "bg-red-500",
        )}
      />
    </span>
  )

  return (
    <li
      role="treeitem"
      aria-level={2}
      aria-selected={isSelected}
      data-sub-action={String(sub.subActionIndex)}
      data-sub-action-result={result}
      data-sub-action-id={`${stepId}-${String(sub.subActionIndex)}`}
    >
      <button
        className={cn(
          "flex w-full items-center gap-2 py-1.5 px-3 text-left rounded-[2px] text-sm",
          "hover:bg-muted/50 transition-colors",
          isSelected && "bg-primary/10 ring-1 ring-primary/30"
        )}
        onClick={onSelect}
      >
        {cached ? (
          <CacheStatusIconWrapper
            marker="sub-action-status"
            state="cached"
            tone="primary"
            label="Cached action"
          >
            {statusHost}
          </CacheStatusIconWrapper>
        ) : (
          statusHost
        )}
        <span className="text-xs text-muted-foreground shrink-0">#{sub.subActionIndex + 1}</span>
        <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{sub.plan}</span>
      </button>
    </li>
  )
}
