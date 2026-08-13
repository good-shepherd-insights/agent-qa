// `config.target.edit` — the closed typed action class's third member (Phase 395-05, D-01/D-02/D-15
// · CFGM-01).
//
// `config-field-set.ts`'s header carries the arguments for the tier, the scope and the one-op-per-
// action shape; they are not restated. What is different about this one is its refusal.
//
// AN ABSENT TARGET IS A NAMED REFUSAL THAT LISTS THE CONFIGURED NAMES, which is 387's disambiguation
// posture and D-15's never-guess line arriving in the write half. The failure this prevents is not
// an exception — it is a `setIn` at `registry.targets.shpo.url` CREATING a target called `shpo` with
// a url and no platform, which whole-config validation then refuses for the wrong reason, in a
// message about a required field rather than about a typo. The names the refusal lists are already
// readable through `config.get`, so listing them discloses nothing a caller could not already see.
//
// THE URL EDIT IS WHERE D-02's PER-VALUE RULE IS SHARPEST. The same op, the same path, two different
// answers: `registry.targets.shop.url` moved from `https://shop.example.com/cart` to
// `/basket` is an ordinary edit, and the same field moved to `https://shop.evil.example` is a change
// of which machine this product will drive. A per-op or per-path risk map cannot tell those apart —
// which is exactly why D-02 put the flag on the proposal and computed it from the values.

import { ConfigProposeOutputSchema, ConfigTargetEditInputSchema } from '@vostride/agent-qa-schema'
import type { ConfigProposeOutput, ConfigTargetEditInput } from '@vostride/agent-qa-schema'

import { constructConfigTargetEditProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_TARGET_EDIT_FUNCTION_ID = 'config.target.edit'

export const configTargetEditSpec: FunctionSpec<ConfigTargetEditInput, ConfigProposeOutput> = {
  id: CONFIG_TARGET_EDIT_FUNCTION_ID,
  summary: 'Propose changing a configured target\'s URL or auth binding, as a reviewable diff.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigTargetEditInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'configFiles',
  risk: {
    name: `fn:${CONFIG_TARGET_EDIT_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
  },
  async invoke(input, deps): Promise<ConfigProposeOutput> {
    // The same four-way guard its siblings carry, including `configScan` (395-04, CFGM-02).
    const { configFiles, configValidate, configProposals, configScan } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_TARGET_EDIT_FUNCTION_ID)
    }
    return await constructConfigTargetEditProposal(
      { action: CONFIG_TARGET_EDIT_FUNCTION_ID, ...input },
      { configFiles, configValidate, configProposals, configScan },
    )
  },
}
