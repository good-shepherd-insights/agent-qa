// `config.target.create` — the closed typed action class's second member (Phase 395-05, D-01/D-02 ·
// CFGM-01).
//
// EVERY PARAGRAPH `config-field-set.ts` OPENS WITH APPLIES HERE VERBATIM and is not restated: one
// registered op per action, no `declaredTier` because a proposal commits nothing, and
// `requiredScopes: ['config-write']` because the scope describes what the capability is ABOUT. Read
// that file for the arguments; what follows is what is different about this one.
//
// A CREATE IS NEVER AN UPSERT, AND THAT IS THIS OP'S WHOLE EDGE. The yaml `setIn` that backs every
// mutation in this phase REPLACES whatever is at the path it is given, so the natural implementation
// of "add a target" quietly deletes the `product`, `appPackage` and `authState` a target of that
// name already carried, and renders it as a diff a person would have to read line by line to notice.
// The pipeline refuses the collision by name and points at `config.target.edit`, which is the op
// that exists for changing one.
//
// IT DOES NOT ADDRESS THE TARGET NAME AS A SETTABLE PATH, and that is not a whitelist. D-03's
// no-whitelist law is about which config paths a person may set — `config.field.set` still answers
// any of them. This op exists because "add a web target" is a shape the model can fill correctly
// from an utterance and a raw dotted-path set is not: `platform` and `url` together are what makes a
// target valid, and a shape that carries both is what stops half a target from being proposed.

import { ConfigProposeOutputSchema, ConfigTargetCreateInputSchema } from '@vostride/agent-qa-schema'
import type { ConfigProposeOutput, ConfigTargetCreateInput } from '@vostride/agent-qa-schema'

import { classifyConfigProposeOutput } from './config-propose-verdict.js'
import { constructConfigTargetCreateProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_TARGET_CREATE_FUNCTION_ID = 'config.target.create'

export const configTargetCreateSpec: FunctionSpec<ConfigTargetCreateInput, ConfigProposeOutput> = {
  id: CONFIG_TARGET_CREATE_FUNCTION_ID,
  summary: 'Propose adding a web target to the registry, as a reviewable diff awaiting a decision.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigTargetCreateInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'configFiles',
  risk: {
    name: `fn:${CONFIG_TARGET_CREATE_FUNCTION_ID}`,
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
    // THE SAME FOUR-WAY GUARD ITS SIBLINGS CARRY, INCLUDING `configScan` (395-04, CFGM-02). A
    // construction that cannot scan must not surface a diff: the alternative is a guardrail that
    // silently stops existing whenever a host forgets one line of wiring, which is the permissive
    // direction a security control may not fail in.
    const { configFiles, configValidate, configProposals, configScan } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_TARGET_CREATE_FUNCTION_ID)
    }
    return await constructConfigTargetCreateProposal(
      { action: CONFIG_TARGET_CREATE_FUNCTION_ID, ...input },
      { configFiles, configValidate, configProposals, configScan },
    )
  },
}
