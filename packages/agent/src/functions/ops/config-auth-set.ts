// `config.auth.set` — refs only, ratified as law (Phase 395-05, D-11 · CFGM-01/CFGM-02).
//
// `config-field-set.ts`'s header carries the arguments for the tier, the scope and the one-op-per-
// action shape; they are not restated. What is different about this one is the law it enforces and
// where it enforces it.
//
// A LITERAL CREDENTIAL ARRIVING IN THE INPUT IS ITSELF THE FAILURE. D-11 ratified this action as
// writing REFERENCES — the name of an auth state, the name of a plugin package, the name of an
// environment variable — and never a value. 395-02 enforced the first half in the SHAPE of
// `ConfigAuthSetInputSchema`: there is no field a credential could be assigned to, which is a
// property of the type rather than a rule anybody remembers. This op enforces the second half, on
// the INPUT and before a single byte is mutated, because a law about what the configuration may hold
// is enforced too late if it is only enforced on the rendered artifact — by then the credential has
// been through a serialiser, a differ and a digest, and the honest disposition for the proposal that
// carries one is a refusal rather than a filed record somebody has to go and delete.
//
// THE REFUSAL IS ANSWERED, NOT FILED, AND THAT IS THIS OP'S EDGE OVER ITS FOUR SIBLINGS. A secret in
// a `config.field.set` value is a BLOCKED RECORD: any config path may legitimately hold any value,
// so the fact worth persisting is "somebody tried to write a secret into your configuration". A
// secret in an auth REFERENCE is a different fact — the caller filled a field with the wrong KIND of
// thing — and there is no candidate configuration to file because none was ever built. The store
// delta across a refused call is zero, and a cell measures it.
//
// TWO GATES, AND ONLY ONE OF THEM NAMES ANYTHING. The detector engine recognises credential families
// it knows and values the masker has been seeded with; `isLegalConfigReference` states positively
// what an auth-state name, a package name and an environment variable name ARE and refuses the
// complement. The second is the structural one — a rule that names nothing it refuses cannot be
// walked past by inventing a credential family nobody listed — and the residue where both miss is
// recorded as a KNOWN BOUND cell rather than described as closed.

import { ConfigAuthSetInputSchema, ConfigProposeOutputSchema } from '@vostride/agent-qa-schema'
import type { ConfigAuthSetInput, ConfigProposeOutput } from '@vostride/agent-qa-schema'

import { classifyConfigProposeOutput } from './config-propose-verdict.js'
import { constructConfigAuthSetProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_AUTH_SET_FUNCTION_ID = 'config.auth.set'

export const configAuthSetSpec: FunctionSpec<ConfigAuthSetInput, ConfigProposeOutput> = {
  id: CONFIG_AUTH_SET_FUNCTION_ID,
  summary: 'Propose pointing a target at a stored auth state or an auth plugin, by NAME only.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigAuthSetInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'configFiles',
  risk: {
    name: `fn:${CONFIG_AUTH_SET_FUNCTION_ID}`,
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
    // The same four-way guard its siblings carry, including `configScan` (395-04, CFGM-02) — and on
    // this op the scan is not only defence in depth for the rendered artifact: it is half of the
    // D-11 input check itself, so an unbound scan here would remove a gate rather than weaken one.
    const { configFiles, configValidate, configProposals, configScan } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_AUTH_SET_FUNCTION_ID)
    }
    return await constructConfigAuthSetProposal(
      { action: CONFIG_AUTH_SET_FUNCTION_ID, ...input },
      { configFiles, configValidate, configProposals, configScan },
    )
  },
}
