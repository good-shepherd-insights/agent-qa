// `config.field.set` — the first of the closed typed action class (Phase 395, D-01/D-03 · CFGM-01).
//
// ONE REGISTERED OP PER ACTION (D-01). The closed action class is legible in the registry itself,
// the planner picks actions by tool name, and 396's MCP projection and 397's parity walk pick this
// up with no harness change. A union op carrying a mode string would have projected as one tool
// whose real vocabulary lives inside a string field nothing validates.
//
// IT COMMITS NOTHING, WHICH IS WHY IT CARRIES NO `declaredTier`. The `knowledge.proposal.apply`
// header states the argument for its own three propose siblings and it holds verbatim here: "a
// proposal commits nothing, so gating it would be asking about the request rather than the act."
// The floor for `recognized: true` with `readOnly: false` is `mutating-local`, and that is the
// honest classification of writing a proposal file into this machine's own runtime root. The RAISE
// lives on `config.proposal.apply`, which is where the person's git history changes.
//
// `requiredScopes: ['config-write']` — already a member of the closed `FunctionScopeSchema` union,
// so this costs no vocabulary extension and gives 396's safe-mode hard tool filter the key it
// wants. A propose op carries the write scope because the scope describes what the CAPABILITY is
// about, not what one call happens to reach: a caller holding only `read` has no business drafting
// changes to the project's configuration.
//
// ANY SCHEMA-ADDRESSABLE PATH (D-03). There is no settable-field whitelist, and the absence is the
// decision: a rule that can only refuse what it can NAME cannot be driven to zero by naming more
// things. The guards are whole-input by construction — post-mutation validation of the ENTIRE
// config in the pipeline, and D-02's per-value classifier when 395-04 lands it.

import { ConfigFieldSetInputSchema, ConfigProposeOutputSchema } from '@vostride/agent-qa-schema'
import type { ConfigFieldSetInput, ConfigProposeOutput } from '@vostride/agent-qa-schema'

import { constructConfigFieldSetProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { ClauseVerdict, FunctionSpec } from '../spec.js'

export const CONFIG_FIELD_SET_FUNCTION_ID = 'config.field.set'

export const configFieldSetSpec: FunctionSpec<ConfigFieldSetInput, ConfigProposeOutput> = {
  id: CONFIG_FIELD_SET_FUNCTION_ID,
  summary: 'Propose setting one configuration field, as a reviewable diff awaiting a decision.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigFieldSetInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'configFiles',
  risk: {
    name: `fn:${CONFIG_FIELD_SET_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
  },
  /**
   * This op's own union, folded into a clause verdict (2026-08-20, Phase 399.1 D-01/D-02).
   *
   * FOUR ARMS, THREE VERDICTS, AND THE MAPPING IS THE WHOLE POINT. `blocked` is the arm G-399-2
   * caught reporting `executed` in green: the guardrail refused to write a secret into the config,
   * the file was byte-unchanged, and chat told the person the mutation completed. It is `refused` —
   * the control WORKED, and the reason (`guardrail-hit` distinguishing "you tried to write a secret"
   * from `schema-fail`'s "your config is invalid") is what the outcome carries. `refused` is the
   * op's OWN refusal arm and folds to the same status for the same reason: the request was declined
   * before anything was proposed.
   *
   * `proposed` IS `executed`, AND `no-change` IS TOO. A proposal really was filed — the op's whole
   * job is to file one — and a set of a value the config already holds is neither an error nor a
   * refusal; both ran to completion and the outcome line says which.
   *
   * NOTHING IS DERIVED FROM THROW-VS-RETURN HERE, and that asymmetry is RC-1b's actual defect: all
   * four of these arms RETURN, which is exactly why the engine could not tell them apart. A thrown
   * error is still `failed` and still the engine's own mapping — this fold never sees one.
   *
   * PURE, and it reads only the discriminant and one field beside it.
   */
  classify(output): ClauseVerdict {
    switch (output.outcome) {
      case 'blocked':
        return { status: 'refused', outcome: output.blockedReason }
      case 'refused':
        return { status: 'refused', outcome: output.reason }
      case 'no-change':
        return { status: 'executed', outcome: `no change: ${output.path} already holds that value` }
      case 'proposed':
        return { status: 'executed', outcome: `proposed ${output.proposalId}` }
    }
  },
  async invoke(input, deps): Promise<ConfigProposeOutput> {
    // FOUR DEPS, ONE `boundThrough`, on `proposals.accept`'s stated arrangement. The declared name
    // is the one whose absence means "this host has no config files at all"; the other three are
    // checked here, by name, so an in-layer caller holding the spec gets the same refusal a gate
    // caller would.
    //
    // `configScan` IS IN THAT LIST AND ITS ABSENCE REFUSES (395-04, CFGM-02). A construction that
    // cannot scan must not surface a diff: the alternative is a guardrail that silently stops
    // existing whenever a host forgets one line of wiring, which is the permissive direction a
    // security control may not fail in.
    const { configFiles, configValidate, configProposals, configScan } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_FIELD_SET_FUNCTION_ID)
    }
    return await constructConfigFieldSetProposal(
      { action: CONFIG_FIELD_SET_FUNCTION_ID, path: input.path, value: input.value },
      { configFiles, configValidate, configProposals, configScan },
    )
  },
}
