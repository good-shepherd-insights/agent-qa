// 2026-09-07, 417 GATE1-01: DATA crosses this bridge in both directions: a candidate
// reader projection in, a gate receipt to the leased writer capability out. Eval execution
// stays behind the existing session composition boundary, loaded only when invoked.
import { dirname, resolve } from 'node:path'
import { trustPriorsForHost, type ResolveTrustPriors } from '../curation/trust-priors.js'
import type { KnowledgeReaderPort, ReplayGatePort } from '@vostride/agent-qa-agent'
import {
  createKnowledgeReader,
  LOCAL_CURATION_CAPABILITIES,
  type LocalCurationCapabilities,
} from '@vostride/agent-qa-agent-local'
import {
  GateReceiptSchema,
  receiptDigestOf,
  type GateReceipt,
  type ResolvePromotionPosture,
} from '@vostride/agent-qa-schema'
import { resolveConfiguredKnowledgeRoot } from '../config.js'
import type {
  EvalSession,
  RunReplayGateInput,
  RunReplayGateResult,
} from '../eval-session-composition.js'

/**
 * Writer authority the CALLER already holds, structurally the curation tail's
 * `CurationWriterAuthority` (422 D-14).
 *
 * Declared here rather than imported so this DATA bridge keeps its one-way import list: the
 * gate carries a lease it was lent, it does not reach into the curation subtree to learn what
 * a lease is.
 */
export interface ReplayGateClaimAuthority {
  readonly leaseId: string
  readonly epoch: number
}

export interface ReplayGateHostDeps {
  resolveTrustPriors?: ResolveTrustPriors
  /**
   * Borrowed writer authority, resolved at CLAIM time and never captured at composition
   * (422 D-14).
   *
   * A FUNCTION rather than a value, and that is the whole contract: the host that owns the
   * pump composes this bridge BEFORE it acquires its lease, so a value read at composition is
   * always `undefined` and every borrowed call would fall back to acquiring a lease the same
   * process already holds — which the writer answers `held`, by the caller, against itself.
   *
   * Answering `undefined` at invocation is the STANDALONE posture and is not a failure: the
   * operator's `eval replay-gate` verb owns no lease and must acquire and release its own.
   */
  resolveClaimAuthority?: () => ReplayGateClaimAuthority | undefined
  configPath: string
  agentQaRoot: string
  record: boolean
  session: EvalSession
  composition: Omit<
    RunReplayGateInput,
    'injection' | 'committedRoot' | 'agentQaRoot' | 'maskingContextFactory' | 'producedBy'
  >
  reader?: KnowledgeReaderPort
  curation?: Pick<LocalCurationCapabilities, 'recordGateReceipt'> & {
    maintenance: Pick<
      LocalCurationCapabilities['maintenance'],
      'acquireWriterLease' | 'releaseLease'
    >
  }
  runReplayGate?: (input: RunReplayGateInput) => Promise<RunReplayGateResult>
  resolvePromotionPosture?: ResolvePromotionPosture
}
export type ReplayGateVerbResult =
  | {
      kind: 'receipt'
      receipt: GateReceipt
      recorded: 'appended' | 'duplicate' | 'dry-run' | 'lease-held' | 'lease-refused'
      lines: string[]
      notices: string[]
      exit: 0 | 1 | 2
    }
  | { kind: 'refused'; refusal: { path: string; reason: string }; notices: string[]; exit: 2 }
export interface ReplayGateHost {
  port: ReplayGatePort
  run(candidateId: string): Promise<ReplayGateVerbResult>
}
/** Cache prior data at binding; resolve the eval session only when an operator invokes the gate. */
export function createReplayGatePortForHost(input: {
  resolveTrustPriors?: ResolveTrustPriors
  configPath: string
  agentQaRoot: string
  /** See {@link ReplayGateHostDeps.resolveClaimAuthority} — consulted per call, never here. */
  resolveClaimAuthority?: () => ReplayGateClaimAuthority | undefined
}): ReplayGatePort {
  const resolveTrustPriors = input.resolveTrustPriors ?? trustPriorsForHost(input).resolve
  return {
    async runReplayGate(candidateId) {
      const { resolveEvalSession, runReplayGateVerb } =
        await import('../eval-session-composition.js')
      const session = await resolveEvalSession({ configPath: input.configPath, keyOnly: true })
      const result = await runReplayGateVerb(session, candidateId, {
        resolveTrustPriors,
        agentQaRoot: input.agentQaRoot,
        onProgress: () => undefined,
      })
      if (result.kind === 'refused') throw new Error(result.refusal.reason)
      return checkedReceipt(result.receipt, candidateId)
    },
  }
}
function checkedReceipt(value: unknown, candidateId: string): GateReceipt {
  const receipt = GateReceiptSchema.parse(value)
  if (receipt.gate !== 1 || receipt.candidateId !== candidateId ||
    receipt.receiptDigest !== receiptDigestOf(receipt))
    throw new Error('Gate 1 returned a foreign candidate, wrong gate or invalid receipt digest')
  return receipt
}
export function createReplayGateHost(deps: ReplayGateHostDeps): ReplayGateHost {
  const resolveTrustPriors = deps.resolveTrustPriors ?? trustPriorsForHost(deps).resolve
  const configDir = dirname(resolve(deps.configPath))
  const knowledgeRoot = resolveConfiguredKnowledgeRoot(deps.session.config, configDir)
  const reader = deps.reader ?? createKnowledgeReader(() => knowledgeRoot, undefined, undefined, resolveTrustPriors)
  const curation = deps.curation ?? LOCAL_CURATION_CAPABILITIES
  async function run(candidateId: string): Promise<ReplayGateVerbResult> {
    const read = reader.candidateInjection
    if (read === undefined) throw new Error('knowledge reader binds no candidateInjection')
    const found = await read.call(reader, { candidateId })
    if (found.kind === 'not-found')
      return {
        kind: 'refused',
        refusal: {
          path: knowledgeRoot,
          reason: `candidate ${candidateId} not found`,
        },
        notices: [],
        exit: 2,
      }
    if (found.injection.candidateId !== candidateId)
      throw new Error('Gate 1 reader returned a foreign candidate')
    const runGate =
      deps.runReplayGate ?? (await import('../eval-session-composition.js')).runReplayGate
    const result = await runGate({
      ...deps.composition,
      injection: found.injection,
      committedRoot: resolve(configDir, 'agent-qa-eval'),
      agentQaRoot: deps.agentQaRoot,
      maskingContextFactory: deps.session.maskingContextFactory,
      producedBy: { opId: 'eval.replay-gate' },
    })
    if (result.kind === 'refused') return { ...result, exit: 2 }
    const receipt = checkedReceipt(result.receipt, candidateId)
    const answer: Extract<ReplayGateVerbResult, { kind: 'receipt' }> = {
      kind: 'receipt',
      receipt,
      lines: result.lines,
      notices: [...result.notices],
      recorded: 'dry-run',
      exit: receipt.verdict === 'pass' ? 0 : receipt.verdict === 'fail' ? 1 : 2,
    }
    if (!deps.record) return answer
    const lease = curation.maintenance.acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired') {
      answer.recorded = lease.kind === 'held' ? 'lease-held' : 'lease-refused'
      answer.exit = 2
      answer.notices.push(
        lease.kind === 'held'
          ? 'writer lease held by another process; receipt printed, not recorded — re-run when the daemon releases it'
          : `writer lease refused: ${lease.reason}; receipt printed, not recorded`,
      )
      return answer
    }
    try {
      const outcome = await curation.recordGateReceipt({
        resolveTrustPriors,
        receipt,
        lease: { leaseId: lease.leaseId, epoch: lease.epoch },
        knowledgeRoot,
        auditBaseDir: deps.agentQaRoot,
        executionContext: deps.session.executionContext,
        sourceBuildOrdinal: receipt.producedAtOrdinal,
        ...(deps.resolvePromotionPosture === undefined
          ? {}
          : { resolvePromotionPosture: deps.resolvePromotionPosture }),
      })
      answer.recorded = outcome.kind
      return answer
    } finally {
      curation.maintenance.releaseLease({ knowledgeRoot, leaseId: lease.leaseId })
    }
  }
  return {
    run,
    port: {
      async runReplayGate(id) {
        const result = await run(id)
        if (result.kind === 'refused') throw new Error(result.refusal.reason)
        return result.receipt
      },
    },
  }
}
