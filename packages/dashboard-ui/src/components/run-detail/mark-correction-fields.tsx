import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { actionWireSchema, type Action, type RunsMarkInput } from '@vostride/agent-qa-schema'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ADD_CORRECTION_LABEL } from '@/lib/feedback-view'

export type MarkCorrection = Pick<RunsMarkInput, 'correctedExpectation' | 'correctedAction'>

export const CORRECTED_EXPECTATION_LABEL = 'Corrected expectation (optional)'
export const CORRECTED_EXPECTATION_HELP = 'Prose is retained as evidence.'
export const CORRECTED_ACTION_LABEL = 'Corrected action JSON (optional)'
export const CORRECTED_ACTION_EXAMPLE = '{"type":"click","ref":"e1"}'
export const CORRECTED_ACTION_HELP =
  'The ref must identify the intended target in the recorded decision. Action scoring requires a valid executable correction for exactly one recorded decision.'
export const CORRECTED_ACTION_ERROR =
  'Corrected action JSON must be valid JSON matching an Action, including its required fields.'

export type ParsedCorrectedAction = { kind: 'empty' } | { kind: 'valid'; action: Action } | { kind: 'invalid' }

/** The one validation both correction forms share; the server's strict schema re-validates. */
export function parseCorrectedAction(text: string): ParsedCorrectedAction {
  if (text.trim() === '') return { kind: 'empty' }
  try {
    return { kind: 'valid', action: actionWireSchema.parse(JSON.parse(text)) as Action }
  } catch {
    return { kind: 'invalid' }
  }
}

function ActionHelp() {
  return <>Example: <code>{CORRECTED_ACTION_EXAMPLE}</code>. {CORRECTED_ACTION_HELP}</>
}

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
    const parsed = parseCorrectedAction(nextAction)
    if (parsed.kind === 'invalid') { setInvalid(true); onChange(undefined, false); return }
    const correctedAction = parsed.kind === 'valid' ? parsed.action : undefined
    setInvalid(false)
    onChange(nextExpectation || correctedAction ? {
      ...(nextExpectation ? { correctedExpectation: nextExpectation } : {}),
      ...(correctedAction === undefined ? {} : { correctedAction }),
    } : undefined, true)
  }
  return <details className="w-full text-xs" data-mark-correction>
    <summary>Optional corrected expectation</summary>
    <label htmlFor={`${id}-expectation`} className="mt-2 block">{CORRECTED_EXPECTATION_LABEL}</label>
    <textarea id={`${id}-expectation`} aria-label="Corrected expectation" aria-describedby={`${id}-expectation-help`} maxLength={2000} disabled={disabled}
      className="w-full border border-border bg-background p-1 text-xs" value={expectation}
      onChange={event => change(event.target.value, action)} />
    <p id={`${id}-expectation-help`}>{CORRECTED_EXPECTATION_HELP}</p>
    <label htmlFor={`${id}-action`} className="mt-2 block">{CORRECTED_ACTION_LABEL}</label>
    <textarea id={`${id}-action`} aria-label="Corrected action JSON" aria-invalid={invalid} aria-describedby={`${id}-action-help${invalid ? ` ${id}-action-error` : ''}`} disabled={disabled}
      className="w-full border border-border bg-background p-1 font-mono text-xs" value={action}
      onChange={event => change(expectation, event.target.value)} />
    <p id={`${id}-action-help`}><ActionHelp /></p>
    {invalid ? <p id={`${id}-action-error`} role="alert">{CORRECTED_ACTION_ERROR}</p> : null}
  </details>
}

export type CorrectedActionField = { shown: true } | { shown: false; reason: string }

/**
 * The composer's correction (426 D-15). Controlled: the page's draft holds the raw text, so an invalid
 * action survives re-targeting and closing. The action field shows only while the gate allows it.
 */
export function CorrectionFields({ expectation, actionText, disabled, actionField, onChange }: {
  expectation: string
  actionText: string
  disabled: boolean
  actionField: CorrectedActionField
  onChange: (expectation: string, actionText: string) => void
}) {
  const id = useId()
  const expectationId = `${id}-expectation`
  const actionId = `${id}-action`
  const invalid = actionField.shown && parseCorrectedAction(actionText).kind === 'invalid'
  return (
    <Collapsible>
      <CollapsibleTrigger
        data-feedback-correction
        className="group flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        {ADD_CORRECTION_LABEL}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <div className="space-y-1">
          <Label htmlFor={expectationId} className="text-xs font-medium">
            {CORRECTED_EXPECTATION_LABEL}
          </Label>
          <Textarea
            id={expectationId}
            aria-describedby={`${expectationId}-help`}
            maxLength={2000}
            disabled={disabled}
            value={expectation}
            onChange={(event) => onChange(event.target.value, actionText)}
            className="max-h-40 overflow-y-auto"
          />
          <p id={`${expectationId}-help`} className="text-xs text-muted-foreground">
            {CORRECTED_EXPECTATION_HELP}
          </p>
        </div>
        {actionField.shown ? (
          <div data-feedback-action-gate="shown" className="space-y-1">
            <Label htmlFor={actionId} className="text-xs font-medium">
              {CORRECTED_ACTION_LABEL}
            </Label>
            <Textarea
              id={actionId}
              aria-invalid={invalid}
              aria-describedby={`${actionId}-help${invalid ? ` ${actionId}-error` : ''}`}
              disabled={disabled}
              value={actionText}
              onChange={(event) => onChange(expectation, event.target.value)}
              className="max-h-40 overflow-y-auto font-mono"
            />
            <p id={`${actionId}-help`} className="text-xs text-muted-foreground">
              <ActionHelp />
            </p>
            {invalid ? (
              <p id={`${actionId}-error`} role="alert" className="text-xs text-destructive">
                {CORRECTED_ACTION_ERROR}
              </p>
            ) : null}
          </div>
        ) : (
          <p data-feedback-action-gate="hidden" className="text-xs text-muted-foreground">
            {actionField.reason}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
