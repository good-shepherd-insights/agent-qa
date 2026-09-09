import { useId, useState } from 'react'
import { actionWireSchema, type Action, type RunsMarkInput } from '@vostride/agent-qa-schema'

export type MarkCorrection = Pick<RunsMarkInput, 'correctedExpectation' | 'correctedAction'>

/** Optional score evidence on the existing mark form. Empty fields preserve one-click marks. */
export function MarkCorrectionFields({ disabled, onChange }: {
  disabled: boolean
  onChange: (value: MarkCorrection | undefined, valid: boolean) => void
}) {
  const id = useId()
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
  return <details className="w-full text-xs" data-mark-correction>
    <summary>Optional corrected expectation</summary>
    <label htmlFor={`${id}-expectation`} className="mt-2 block">Corrected expectation (optional)</label>
    <textarea id={`${id}-expectation`} aria-label="Corrected expectation" aria-describedby={`${id}-expectation-help`} maxLength={2000} disabled={disabled}
      className="w-full border border-border bg-background p-1 text-xs" value={expectation}
      onChange={event => change(event.target.value, action)} />
    <p id={`${id}-expectation-help`}>Prose is retained as evidence.</p>
    <label htmlFor={`${id}-action`} className="mt-2 block">Corrected action JSON (optional)</label>
    <textarea id={`${id}-action`} aria-label="Corrected action JSON" aria-invalid={invalid} aria-describedby={`${id}-action-help${invalid ? ` ${id}-action-error` : ''}`} disabled={disabled}
      className="w-full border border-border bg-background p-1 font-mono text-xs" value={action}
      onChange={event => change(expectation, event.target.value)} />
    <p id={`${id}-action-help`}>Example: <code>{'{"type":"click","ref":"e1"}'}</code>. The ref must identify the intended target in the recorded decision. Action scoring requires a valid executable correction for exactly one recorded decision.</p>
    {invalid ? <p id={`${id}-action-error`} role="alert">Corrected action JSON must be valid JSON matching an Action, including its required fields.</p> : null}
  </details>
}
