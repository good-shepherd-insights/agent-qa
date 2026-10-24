// §7.9 floor law: this blunter prose ships on a no-model host and is the fallback
// for every failed wording call. Producer text stays text; renderers own masking.
import type { Mark } from '@vostride/agent-qa-schema'

export interface FloorProseInput {
  kind: Mark
  fix: 'fact' | 'caution' | 'procedure-hint'
  stepText: string
  verifierReasoning: string
  servedSummary?: string
  note?: string
}

function bounded(text: string, limit: number): string {
  if (text.length <= limit) return text
  const prefix = text.slice(0, limit - 1)
  const boundary = prefix.search(/\s+\S*$/)
  return `${(boundary > 0 ? prefix.slice(0, boundary) : prefix).trimEnd()}…`
}

export function floorProse(input: FloorProseInput): { summary: string; body: string } {
  const { kind, fix, stepText, verifierReasoning, servedSummary } = input
  const reading = kind === 'confirmed-bug' ? 'Confirmed' : 'Overturned'
  const claim = servedSummary === undefined ? '' : `\nSuperseded claim: ${servedSummary}`
  let summary: string
  if (fix === 'procedure-hint') {
    summary = `Path to "${stepText}": ${servedSummary ?? 'review the recorded route'}`
  } else if (kind === 'false-pass') {
    summary = `"${stepText}" is not done when ${verifierReasoning.split(/[.;\n]/)[0]}`
  } else if (kind === 'false-fail') {
    summary = `On "${stepText}", the observed state is the expected outcome`
  } else {
    summary = `On "${stepText}", the observed failure is confirmed`
  }
  const body = `${kind} / ${fix}: ${stepText}\n${reading} verifier reading: ${verifierReasoning}${claim}`
  // Reserve space for the final user-note line, even when the recorded reading is long.
  const note = input.note === undefined ? '' : bounded(`User note: ${input.note}`, 1100)
  return {
    summary: bounded(summary, 160),
    body: note === '' ? bounded(body, 1200)
      : `${bounded(body, 1200 - note.length - 1)}\n${note}`,
  }
}
