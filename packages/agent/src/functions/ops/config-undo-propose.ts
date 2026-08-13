// `config.undo.propose` — the seventh propose op, and the reason there is no revert verb
// (Phase 395-06, D-07 · CFGM-03).
//
// UNDO IS A PROPOSAL. L10 says propose+apply is the ONE write path, and an instant-revert op would
// be a second one: a verb that changed committed configuration without a review round-trip, whose
// freshness, scanning, classification and attribution arguments would all have to be made again —
// or, far more likely, silently not made. So this op does what every other config action does. It
// builds a candidate configuration and files a `ConfigProposal` a person decides on, and
// `config.proposal.apply` is still the only thing that commits.
//
// THE COST IS STATED AND ACCEPTED (D-07). An undo takes an approval round-trip rather than being
// instant. What that buys is that the undo is reviewable as a diff, refuses when the files have
// moved under it, is scanned like anything else, and — because its own apply commit carries the
// D-06 trailer — becomes the next undo's source with no special case anywhere. Undo-of-undo is
// free, and it is free because nothing here is special.
//
// THE INPUT IS EMPTY, AND THE EMPTINESS IS A REFUSAL. `ConfigUndoProposeInputSchema` is a strict
// `{}`: which commit to reverse is answered from the repository's own history through the
// `Agent-QA-Proposal` trailer, so a field naming a target would be a second answer to a question git
// already answers — and a wrong value in it is a revert of something nobody asked about. A model
// filling this shape has nothing to get wrong.
//
// IT COMMITS NOTHING, WHICH IS WHY IT CARRIES NO `declaredTier`, on `config.field.set`'s stated
// reasoning: a proposal commits nothing, so gating it would be asking about the request rather than
// the act. The RAISE lives on `config.proposal.apply`, where the person's git history changes.

import { ConfigProposeOutputSchema, ConfigUndoProposeInputSchema } from '@vostride/agent-qa-schema'
import type { ConfigProposeOutput, ConfigUndoProposeInput } from '@vostride/agent-qa-schema'

import { constructConfigUndoProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_UNDO_PROPOSE_FUNCTION_ID = 'config.undo.propose'

export const configUndoProposeSpec: FunctionSpec<ConfigUndoProposeInput, ConfigProposeOutput> = {
  id: CONFIG_UNDO_PROPOSE_FUNCTION_ID,
  summary:
    'Propose reversing the last agent-qa configuration commit, as a reviewable diff awaiting a '
    + 'decision.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigUndoProposeInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'configUndoSource',
  risk: {
    name: `fn:${CONFIG_UNDO_PROPOSE_FUNCTION_ID}`,
    recognized: true,
    readOnly: false,
  },
  async invoke(input, deps): Promise<ConfigProposeOutput> {
    // FIVE DEPS, ONE `boundThrough`, on `config.field.set`'s stated arrangement — with the declared
    // name being this op's OWN one. `configUndoSource` is what a host that cannot read git history
    // lacks, and it is the fact that makes this op specifically unavailable; the other four are the
    // shared construction bundle and are checked here by name so an in-layer caller holding the
    // spec gets the same refusal a gate caller would.
    //
    // `configScan`'s ABSENCE REFUSES, exactly as it does for the other six propose ops (395-04,
    // CFGM-02). This op constructs from bytes it did NOT author — bytes read out of a commit — which
    // is the case where a pre-existing secret is most likely to be in the artifact and least likely
    // to be anybody's recent mistake. A construction that cannot scan must not surface a diff.
    const { configFiles, configValidate, configProposals, configScan, configUndoSource } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
      || configUndoSource === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_UNDO_PROPOSE_FUNCTION_ID)
    }
    void input
    return await constructConfigUndoProposal(
      { action: CONFIG_UNDO_PROPOSE_FUNCTION_ID },
      { configFiles, configValidate, configProposals, configScan, configUndoSource },
    )
  },
}
