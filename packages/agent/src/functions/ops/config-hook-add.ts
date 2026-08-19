// `config.hook.add` — the closed typed action class's fifth member (Phase 395-05, D-01/D-02 ·
// CFGM-01).
//
// `config-field-set.ts`'s header carries the arguments for the tier, the scope and the one-op-per-
// action shape; they are not restated. Two things are different about this one.
//
// IT IS THE ONLY ACTION THAT WRITES A FILE OTHER THAN THE CONFIG YAML. The hooks file is the second
// member of the pinned config set, and it has its own schema — `core`'s `HooksFileSchema`, with the
// canonical-id rule and the duplicate-id and duplicate-name refinements. That is why 395-05 widened
// whole-config validation to the whole candidate SET: a validator that only ever read the config
// yaml would have declared this proposal valid without looking at the one artifact it wrote, which
// is D-03's whole-input law satisfied on paper and violated in fact.
//
// EVERY HOOK ADDITION IS CROSS-BOUNDARY, UNCONDITIONALLY (D-02). A hook is code this project will
// EXECUTE, and that is a different kind of change from a setting: a standing approval a person gave
// for configuration edits may not quietly also mean "and run whatever script it names". The fact is
// STATED by the construction rather than inferred from the path it wrote, because inferring "a hook
// was added" from a path is the per-op map D-02 refused — and 395-07's grant machinery refuses on
// the flag, so a hook addition that arrived unflagged would be a hole with no second wall behind it.
//
// THE INPUT NAMES A FILE AND NEVER CARRIES A BODY. The script is a thing a person writes and reviews
// in their editor; a proposal that carried executable text would be asking for approval of two
// artifacts in one decision. The hook's ID is minted host-side through the same machinery
// `isCanonicalHookId` accepts, because a hand-formatted id would parse as a string, reach a person's
// repository, and be refused at the next run rather than at the proposal.

import { ConfigHookAddInputSchema, ConfigProposeOutputSchema } from '@vostride/agent-qa-schema'
import type { ConfigHookAddInput, ConfigProposeOutput } from '@vostride/agent-qa-schema'

import { classifyConfigProposeOutput } from './config-propose-verdict.js'
import { constructConfigHookAddProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_HOOK_ADD_FUNCTION_ID = 'config.hook.add'

export const configHookAddSpec: FunctionSpec<ConfigHookAddInput, ConfigProposeOutput> = {
  id: CONFIG_HOOK_ADD_FUNCTION_ID,
  summary: 'Propose declaring a hook in the hooks file, as a reviewable diff awaiting a decision.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigHookAddInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'configFiles',
  risk: {
    name: `fn:${CONFIG_HOOK_ADD_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
  },
  /**
   * This op's own union, folded into a clause verdict (2026-08-20, Phase 399.1 D-01/D-02).
   *
   * THE FOLD IS SHARED BECAUSE THE UNION IS. Seven ops answer with `ConfigProposeOutput`, and a
   * per-op copy of the mapping would be a guardrail refusal that reports `refused` on some doors
   * and `executed` on others the first time one copy is edited. See `config-propose-verdict.ts`
   * for why `blocked` and `refused` are the same status and different words.
   */
  classify: classifyConfigProposeOutput,
  async invoke(input, deps): Promise<ConfigProposeOutput> {
    // The same four-way guard its siblings carry, including `configScan` (395-04, CFGM-02).
    const { configFiles, configValidate, configProposals, configScan } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_HOOK_ADD_FUNCTION_ID)
    }
    return await constructConfigHookAddProposal(
      { action: CONFIG_HOOK_ADD_FUNCTION_ID, ...input },
      { configFiles, configValidate, configProposals, configScan },
    )
  },
}
