// The production refusal's one spelling (432 D-18).
//
// Every door that can drive a target shows the same sentence: the run core (agent-local) and the
// dashboard live editor, which starts sessions without the core. It lives here because both of
// those packages depend on this one and the dashboard may not import agent-local.

import { scrubDisclosureText } from '../safety/action-descriptor'

/** The one line a config adds to run against production (432-03, D-18). */
export const ALLOW_PRODUCTION_OPT_IN = 'allowProduction: true'

/**
 * The distinct names, in first-occurrence order. Two members driving one target are one target to
 * the person reading a refusal; the order is the members' own, never a re-sort.
 */
export function distinctInFirstOccurrenceOrder(names: readonly string[]): string[] {
  return [...new Set(names)]
}

/**
 * The production refusal, as the one plain sentence every door shows (432-03, D-18).
 *
 * It names the production targets and the line to add, and nothing else: no remedy, no prompt, no
 * flag. Each name keeps its exact spelling apart from the characters a terminal or a browser acts
 * on, which are replaced, so the sentence stays one line on every channel.
 */
export function buildProductionRefusal(productionTargetNames: readonly string[]): string {
  const names = distinctInFirstOccurrenceOrder(productionTargetNames)
    .map((name) => `"${scrubDisclosureText(name)}"`)
  const subject =
    names.length === 0
      ? 'A target this run drives is'
      : names.length === 1
        ? `Target ${names[0]!} is`
        : `Targets ${names.join(', ')} are`
  return (
    `${subject} declared environment: production, and this config does not allow production runs. `
    + `Add ${ALLOW_PRODUCTION_OPT_IN} at the top level of agent-qa.config.yaml to allow them.`
  )
}
