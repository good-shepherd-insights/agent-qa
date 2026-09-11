// The proposal stage's host-owned capabilities (Phase 422 plan 09, D-01/D-09/D-10/D-13..D-15).
//
// A MODULE OF ITS OWN, and the reason is measured rather than aesthetic. `daemon/host.ts` composes
// these too, and importing them from `composition/local-agent-host.ts` would pull four thousand
// lines of terminal-host machinery — yaml document editing, a readline confirm port, a child
// spawn, the config apply/scaffold surface — into the daemon's module graph. The daemon's own
// child-process tracers load this package's SOURCE under Node's strip-only TypeScript loader, and
// that graph is where the cost stops being theoretical: it is loaded for real, in a real child, on
// every daemon startup those cells drive.
//
// What lives here is exactly what both hosts need and neither can answer alone: a Gate-1 screening
// port over a bridge its host built, the committed knowledge reader, the corpus posture behind the
// eval session, and the adversarial staging seam. Everything host-specific — which lease is held,
// which knowledge root is served, which configuration is in force — arrives as an argument.

import {
  createKnowledgeReader,
} from '@vostride/agent-qa-agent-local'
import type { ComposeLocalAgentInput } from '@vostride/agent-qa-agent-local'
import type {
  KnowledgeReaderPort,
  PostRunJobCapabilities,
  ProposeCorpusPosture,
  ReplayGatePort,
} from '@vostride/agent-qa-agent'
import type { KnowledgeBundleSummary } from '@vostride/agent-qa-schema'

import { resolveConfig } from '../config.js'
import { trustPriorsForHost, type ResolveTrustPriors } from '../curation/trust-priors.js'

// ---- 422 D-13 / D-14: the proposal stage's host-owned capabilities -------------------------
//
// ONE builder, TWO hosts. The terminal (`composeCliLocalAgent`) and the daemon
// (`daemon/host.ts`) both compose these members from this function and from nowhere else, so
// "the two hosts agree" is a property of there being one construction site rather than a claim
// a reviewer has to re-derive by reading two literals side by side. A capability bound on the
// terminal and forgotten on the daemon is a silent behavioural split between two ways of running
// the same product, and 422-08 shipped the whole Gate-1 leg unbound on BOTH because each host
// composed its own `postRun` literal.
//
// Everything here is a CLI concern by construction: a replay gate needs an eval session, the
// committed corpus digest needs the committed root, and the adversarial staging seam lives behind
// an operator-admission boundary neither `agent` nor `agent-local` may name. What crosses into the
// composition is data and neutral closures.

export interface ProposalStageCapabilitiesInput {
  configPath: string
  agentQaRoot: string
  /** Which knowledge root this host serves from, resolved per call (the reader's own idiom). */
  resolveKnowledgeRoot: () => Promise<string> | string
  resolveTrustPriors?: ResolveTrustPriors
  resolvePromotionPosture?: ComposeLocalAgentInput['resolvePromotionPosture']
  /**
   * THIS host's one replay-gate bridge, as a memoised thunk (417/421 walls).
   *
   * Supplied rather than constructed here, and a thunk rather than a value, because both walls
   * that pin this seam pin it on the CALL: `replay-gate-binding.test.ts` requires exactly one
   * bridge-construction site per host file, and `judge-panel-host-paths.test.ts` requires
   * that the host has constructed none of them until an operation asks for one. A host builds its
   * bridge once — with its trust priors, its runtime root AND the lease it holds — and both the
   * promotion posture and this Gate-1 leg receive that same bridge. Two constructions would be
   * two sets of deps for one host's gate, which is the drift the walls exist to refuse.
   */
  replayGate: () => ReplayGatePort
}

/**
 * The five members 422-07 and 422-08 declared and left unbound, as ONE value.
 *
 * `Required<Pick<...>>` rather than a restatement: every member is the capability's own declared
 * type, so a shape change in `agent` fails to compile here instead of drifting into a second
 * spelling of a contract that has one owner.
 */
export type ProposalStageCapabilities = Required<
  Pick<
    PostRunJobCapabilities,
    | 'runReplayGate'
    | 'listBundles'
    | 'gateReceiptsFor'
    | 'readProposeCorpusPosture'
    | 'stageAdversarialProposal'
  >
>

/**
 * The product this run's proposal stage stages FOR, derived from the candidates the fold
 * committed rather than from configuration.
 *
 * The same derivation `orderProposalCandidates` makes inside the handler, and deliberately the
 * same one: a proposal job is about one run, a run is about one product, and two answers to
 * "which product" is how a stage ends up screening one corpus and staging against another.
 * `undefined` means the committed store recognises none of the fold's ids, which is the one
 * case where there is nothing this stage could honestly address.
 */
function productOfCandidates(
  bundles: readonly KnowledgeBundleSummary[],
  candidateIds: readonly string[],
): string | undefined {
  for (const candidateId of candidateIds) {
    const row = bundles.find((entry) => entry.bundleId === candidateId)
    if (row !== undefined) return row.product
  }
  return undefined
}

export function proposalStageCapabilities(
  input: ProposalStageCapabilitiesInput,
): ProposalStageCapabilities {
  const resolveTrustPriors = input.resolveTrustPriors
    ?? trustPriorsForHost({ configPath: input.configPath }).resolve
  // The physically read-only knowledge entry, over THIS host's root. Both members the selection
  // needs come from the one reader: a listing and a receipt history answered by two readers over
  // two roots would be two opinions about what is still ungated.
  const reader: Pick<KnowledgeReaderPort, 'listBundles' | 'gateReceipts'> = createKnowledgeReader(
    input.resolveKnowledgeRoot,
    undefined,
    input.resolvePromotionPosture,
    resolveTrustPriors,
  )
  const session = async () => {
    const { resolveEvalSession } = await import('../eval-session-composition.js')
    return await resolveEvalSession({ configPath: input.configPath, keyOnly: true })
  }
  return {
    // Resolved at the CALL, through the host's memo: the bridge stays unconstructed until
    // something actually screens, and the lease it lends is whichever one its host holds then.
    runReplayGate: async (candidateId) => await input.replayGate().runReplayGate(candidateId),
    listBundles: async () => await reader.listBundles(),
    gateReceiptsFor: async ({ candidateId }) => {
      const read = reader.gateReceipts
      if (read === undefined) throw new Error('knowledge reader binds no gateReceipts')
      return await read.call(reader, { candidateId })
    },
    /**
     * Which corpus this host's Gate-1 evidence is measured against (422 D-14).
     *
     * `readCanaryCorpusDigest`'s three arms map onto the posture's three one-for-one, and the
     * mapping is total on purpose: an unreadable committed root is NOT an absent one. Folding
     * them together would let a broken root read as "no corpus to screen against", which spends
     * the job's charge on a question nobody can check the answer to.
     */
    readProposeCorpusPosture: async (): Promise<ProposeCorpusPosture> => {
      try {
        const { readCanaryCorpusDigest } = await import('../eval-session-composition.js')
        const digest = readCanaryCorpusDigest(await session())
        if (digest.kind === 'digest') {
          return { kind: 'resolved', corpusDigest: digest.corpusDigest }
        }
        return digest.kind === 'no-eval-root'
          ? { kind: 'no-root' }
          : { kind: 'unavailable', reason: digest.reason }
      } catch (error) {
        return {
          kind: 'unavailable',
          reason: error instanceof Error ? error.message : String(error),
        }
      }
    },
    /**
     * The third stage's work: STAGE for review, and never admit (D-01).
     *
     * `admit` is deliberately absent rather than `false` — the verb branches on the flag being
     * true, and a background job that could pass it at all would be a background job that could
     * write the committed corpus. Nothing here has an operator behind it, so nothing here has
     * the authority an admission needs.
     *
     * A REFUSAL finishes with no counts rather than throwing: a host with no eval root, or one
     * whose committed root cannot be read, has an honest answer — it staged nothing — and a
     * throw here would become a retry that asks the same unanswerable question under the same
     * conditions until the declared bound runs out.
     */
    stageAdversarialProposal: async ({ candidateIds }) => {
      const { runAdversarialVerb } = await import('../eval-session-composition.js')
      const product = productOfCandidates(await reader.listBundles(), candidateIds)
      if (product === undefined) return { proposed: 0, skipped: 0 }
      const result = await runAdversarialVerb(await session(), {
        agentQaRoot: input.agentQaRoot,
        product,
      })
      if (result.kind === 'refused') return { proposed: 0, skipped: 0 }
      // The neutral DTO admits two counts and nothing else (D-11), so this is a PROJECTION and
      // not a summary: `proposed` is what a reviewer will actually be shown, and `skipped` is
      // everything this refresh considered and declined to stage. The probe gap, the spend and
      // the refusal texts stay in the adversarial audit sink, which is the surface that may
      // carry prose at all.
      return {
        proposed: result.staged.length,
        skipped:
          result.skips.length
          + result.stagingSkips.length
          + result.settledRefusals.length
          + result.refusals.length,
      }
    },
  }
}

/**
 * The operator's `eval.gate1.maxPerJob`, resolved by the HOST (422 D-14).
 *
 * DATA rather than a reader on the capability, because the handler must not learn to read
 * configuration; `undefined` means the recorded default and the difference is disclosed on the
 * durable charge as `cap.source`.
 *
 * Read through `resolveConfig` and NOT through an eval session. The bound is one integer on the
 * config block, and resolving a whole eval session for it puts a session resolution on the queue
 * open of every host that composes a `postRun` — including every host whose chain never reaches
 * a proposal job. The daemon's own startup measures that difference (its readiness pin sits
 * between the first log line and the signal handlers), which is how this was found.
 *
 * A configuration this host cannot read answers `undefined` too:
 * the recorded default is the safe bound, and refusing to open the queue because an optional
 * override could not be read would take the whole chain down for a knob nobody set.
 */
export async function resolveProposeGate1MaxPerJob(
  configPath: string,
): Promise<number | undefined> {
  try {
    const config = await resolveConfig({ configPath, loadAuthPlugins: false })
    return config.eval?.gate1?.maxPerJob
  } catch {
    return undefined
  }
}

