// `config.target.edit` — the closed typed action class's third member (Phase 395-05, D-01/D-02/D-15
// · CFGM-01).
//
// 2026-09-30, 432-11 D-05/D-07: THIS OP WRITES IN THE CALL. It is constructed, scanned and validated
// as described below and then published through the direct writer; the answer names the files and
// fields it changed, a blocked change is answered with its report and nothing is kept, and no git
// runs. Where the paragraphs below say "proposal", read the change this call writes.
//
// `config-field-set.ts`'s header carries the arguments for the tier and the one-op-per-action
// shape; they are not restated. 2026-10-01 (432-23, D-12): the op declares no scope, because no
// caller is checked for one. What is different about this one is its refusal.
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

import { ConfigChangeOutputSchema, ConfigTargetEditInputSchema } from '@vostride/agent-qa-schema'
import type { ConfigChangeOutput, ConfigTargetEditInput } from '@vostride/agent-qa-schema'

import { classifyConfigChangeOutput } from './config-propose-verdict.js'
import { editConfigTarget } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_TARGET_EDIT_FUNCTION_ID = 'config.target.edit'

export const configTargetEditSpec: FunctionSpec<ConfigTargetEditInput, ConfigChangeOutput> = {
  id: CONFIG_TARGET_EDIT_FUNCTION_ID,
  summary: 'Change a configured target\'s URL, written in this call.',
  resultKind: 'unary',
  input: ConfigTargetEditInputSchema,
  output: ConfigChangeOutputSchema,
  boundThrough: 'configWrite',
  risk: {
    name: `fn:${CONFIG_TARGET_EDIT_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
  },
  /**
   * This op's own union, folded into a clause verdict (2026-08-20, Phase 399.1 D-01/D-02).
   *
   * THE FOLD IS SHARED BECAUSE THE UNION IS. Six ops answer with `ConfigChangeOutput` (432-11), and a
   * per-op copy of the mapping would be a guardrail refusal that reports `refused` on some doors
   * and `executed` on others the first time one copy is edited. See `config-propose-verdict.ts`
   * for why `blocked` and `refused` are the same status and different words.
   */
  classify: classifyConfigChangeOutput,
  async invoke(input, deps): Promise<ConfigChangeOutput> {
    // The same four-way guard its siblings carry, including `configScan` (395-04, CFGM-02).
    const { configFiles, configValidate, configScan, configWrite } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configScan === undefined
      || configWrite === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_TARGET_EDIT_FUNCTION_ID)
    }
    return await editConfigTarget(
      { action: CONFIG_TARGET_EDIT_FUNCTION_ID, ...input },
      { configFiles, configValidate, configScan, configWrite },
    )
  },
}
