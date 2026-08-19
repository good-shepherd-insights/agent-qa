// `config.project.scaffold` — the from-zero configuration, as ONE reviewable proposal
// (Phase 395-08, D-04 / D-13 / D-14 / D-15 · CFGM-05).
//
// THE EIGHTH REGISTERED CONFIG OP, ON D-01's FOOTING. One op per action: the planner picks it by
// tool name, 396's projection publishes it and 397's parity walk enumerates it, all with no harness
// change. `config.project.scaffold` — three lowercase dot segments, no underscore, so the chat
// tool-name mapping (`.` ↔ `_`) has one pre-image and `parity-coverage`'s id pattern accepts it.
//
// THE MODEL FILLS ONE FIELD AND DERIVES NOTHING (D-13). `ConfigProjectScaffoldInputSchema` is a
// strict `{ domain }`, and every field it does not have is a field a model could otherwise invent.
// The scheme, the target name, the platform, the whole file set: all of it comes from
// `parseHostnameToken` and the shared content module, which is what makes the proposal a person
// approves a deterministic function of bytes they typed.
//
// THE NEVER-GUESS BOUNDARY IS A REFUSAL, NOT A FALLBACK (D-15). A token that does not parse as a
// hostname does not become a search, a completion or a best guess — it becomes a typed `refused`
// naming both continuations. `booking.com` against `booking.de` is a coin flip review should not
// have to catch, so the product declines to flip it.
//
// IT COMMITS NOTHING, WHICH IS WHY IT CARRIES NO `declaredTier`, on `config.field.set`'s stated
// reasoning. The RAISE lives on `config.proposal.apply`, where git history changes — and 395-07's
// two-sided enforcement makes a scaffold, which is always cross-boundary, unsatisfiable by any
// standing grant from either side.

import { ConfigProjectScaffoldInputSchema, ConfigProposeOutputSchema } from '@vostride/agent-qa-schema'
import type { ConfigProjectScaffoldInput, ConfigProposeOutput } from '@vostride/agent-qa-schema'

import { classifyConfigProposeOutput } from './config-propose-verdict.js'
import { constructConfigProjectScaffoldProposal } from '../../config-mutation/construct.js'
import { FunctionNotBoundError } from '../spec.js'
import type { FunctionSpec } from '../spec.js'

export const CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID = 'config.project.scaffold'

export const configProjectScaffoldSpec: FunctionSpec<
  ConfigProjectScaffoldInput,
  ConfigProposeOutput
> = {
  id: CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
  summary:
    'Propose configuring this project for a site from zero — config, hooks and gitignore as one '
    + 'reviewable diff.',
  requiredScopes: ['config-write'],
  resultKind: 'unary',
  input: ConfigProjectScaffoldInputSchema,
  output: ConfigProposeOutputSchema,
  boundThrough: 'scaffoldContent',
  risk: {
    name: `fn:${CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID}`,
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
    // FIVE DEPS, ONE `boundThrough`, on `config.undo.propose`'s arrangement — with the declared
    // name being this op's OWN one. `scaffoldContent` is what a host that cannot render the shared
    // scaffold substance lacks, and it is the fact that makes this op specifically unavailable.
    //
    // `configScan`'s ABSENCE REFUSES, as it does for every propose op (395-04, CFGM-02) — and this
    // op is the sharpest case for it. D-12 says the scan reads WHOLE NEW FILES for scaffold, and
    // every byte of this proposal is a new file: there is no committed artifact to have been
    // cleared earlier. A construction that cannot scan must not surface a diff.
    const { configFiles, configValidate, configProposals, configScan, scaffoldContent } = deps
    if (
      configFiles === undefined
      || configValidate === undefined
      || configProposals === undefined
      || configScan === undefined
      || scaffoldContent === undefined
    ) {
      throw new FunctionNotBoundError(CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID)
    }
    return await constructConfigProjectScaffoldProposal(
      { action: CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID, domain: input.domain },
      { configFiles, configValidate, configProposals, configScan, scaffoldContent },
    )
  },
}
