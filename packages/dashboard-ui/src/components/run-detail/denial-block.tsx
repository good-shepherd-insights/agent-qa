import {
  remediesRenderableBy,
  type GateRemedy,
  type RemedyKindFor,
} from '@vostride/agent-qa-schema'

// The reason shown is the neutral one; the gate's canonical prose never reaches the DOM.

const DASHBOARD_REMEDY_TEXT = {
  'answer-confirm':
    'keep this chat open and re-run it — an ask-tier op raises a confirm here that you can answer',
  'session-pin-final':
    'this action class is pinned DENY for this conversation; a pin cannot be lifted, so start a new chat session to run it',
} as const satisfies Record<RemedyKindFor<'dashboard'>, string>

export function DenialBlock({
  neutralReason,
  remedies,
}: {
  neutralReason: string
  remedies: readonly GateRemedy[]
}) {
  const renderable = remediesRenderableBy('dashboard', remedies)
  return (
    <div
      data-entry="denial"
      className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"
    >
      <p className="text-foreground">{neutralReason}</p>
      {renderable.map((remedy) => (
        <p
          key={remedy.kind}
          data-remedy-kind={remedy.kind}
          className="text-xs text-muted-foreground"
        >
          {DASHBOARD_REMEDY_TEXT[remedy.kind as RemedyKindFor<'dashboard'>]}
        </p>
      ))}
    </div>
  )
}
