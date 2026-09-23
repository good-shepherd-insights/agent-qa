import { useId } from 'react'
import { ChevronRight } from 'lucide-react'
import { actionWireSchema, type Action } from '@vostride/agent-qa-schema'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ADD_CORRECTION_LABEL } from '@/lib/feedback-view'

export const CORRECTED_EXPECTATION_LABEL = 'Corrected expectation (optional)'
export const CORRECTED_EXPECTATION_HELP = 'Prose is retained as evidence.'
export const CORRECTED_ACTION_LABEL = 'Corrected action JSON (optional)'
export const CORRECTED_ACTION_EXAMPLE = '{"type":"click","ref":"e1"}'
export const CORRECTED_ACTION_HELP =
  'The ref must identify the intended target in the recorded decision. Action scoring requires a valid executable correction for exactly one recorded decision.'
export const CORRECTED_ACTION_ERROR =
  'Corrected action JSON must be valid JSON matching an Action, including its required fields.'

export type ParsedCorrectedAction = { kind: 'empty' } | { kind: 'valid'; action: Action } | { kind: 'invalid' }

/** The one validation the fields and the submit share; the server's strict schema re-validates. */
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
