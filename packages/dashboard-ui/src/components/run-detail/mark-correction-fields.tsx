import { useState } from 'react'
import { actionWireSchema, type Action, type RunsMarkInput } from '@vostride/agent-qa-schema'

export type MarkCorrection = Pick<RunsMarkInput, 'correctedExpectation' | 'correctedAction'>

/** Optional score evidence on the existing mark form. Empty fields preserve one-click marks. */
export function MarkCorrectionFields({ disabled, onChange }: {
  disabled: boolean
  onChange: (value: MarkCorrection | undefined, valid: boolean) => void
}) {
  const [expectation, setExpectation] = useState('')
  const [action, setAction] = useState('')
  const [invalid, setInvalid] = useState(false)
  const change = (nextExpectation: string, nextAction: string) => {
    setExpectation(nextExpectation); setAction(nextAction)
    let correctedAction: Action | undefined
    try {
      if (nextAction.trim()) correctedAction = actionWireSchema.parse(JSON.parse(nextAction)) as Action
    } catch { setInvalid(true); onChange(undefined, false); return }
    setInvalid(false)
    onChange(nextExpectation || correctedAction ? {
      ...(nextExpectation ? { correctedExpectation: nextExpectation } : {}),
      ...(correctedAction === undefined ? {} : { correctedAction }),
    } : undefined, true)
  }
  return <details className="w-full" data-mark-correction>
    <summary>Optional corrected expectation</summary>
    <textarea aria-label="Corrected expectation" maxLength={2000} disabled={disabled}
      className="w-full border border-border bg-background p-1 text-xs" value={expectation}
      onChange={event => change(event.target.value, action)} />
    <textarea aria-label="Corrected action JSON" disabled={disabled}
      className="w-full border border-border bg-background p-1 font-mono text-xs" value={action}
      onChange={event => change(expectation, event.target.value)} />
    <p>Action scoring requires a valid expected action for exactly one recorded decision. Prose is retained as evidence.</p>
    {invalid ? <p role="alert">Enter a valid Action JSON object.</p> : null}
  </details>
}
