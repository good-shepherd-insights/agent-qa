// 2026-09-07, 417 GATE1-01: DATA crosses this bridge in both directions: a candidate
// reader projection in, a gate receipt to the leased writer capability out. Eval execution
// stays behind the existing session composition boundary, loaded only when invoked.
import { dirname, resolve } from 'node:path'
import { trustPriorsForHost, type ResolveTrustPriors } from '../curation/trust-priors.js'
import { Gate1ReceiptNotPersistedError } from '@vostride/agent-qa-agent'
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
      // Resolved HERE, at the claim, and spread conditionally so a host that lends nothing
      // sends no member at all rather than an explicit `undefined` the verb would have to
      // read as a third state beside "borrowed" and "standalone".
      const borrowed = input.resolveClaimAuthority?.()
      const result = await runReplayGateVerb(session, candidateId, {
        resolveTrustPriors,
        agentQaRoot: input.agentQaRoot,
        onProgress: () => undefined,
        ...(borrowed === undefined ? {} : { claimAuthority: borrowed }),
      })
      if (result.kind === 'refused') throw new Error(result.refusal.reason)
      return checkedReceipt(acknowledged(result, candidateId), candidateId)
    },
  }
}
/**
 * The persisted outcomes. A receipt the writer APPENDED and one it recognised as a DUPLICATE
 * of what it already holds are both durable; everything else is a receipt that exists only in
 * this process (422 D-14).
 */
type ReplayGateRecording = Extract<ReplayGateVerbResult, { kind: 'receipt' }>['recorded']
const ACKNOWLEDGED_RECORDINGS: readonly ReplayGateRecording[] = ['appended', 'duplicate']

/**
 * Let a receipt out of the port only if the writer said it wrote it (422 D-14).
 *
 * The verb's own result is deliberately NOT narrowed by this: an operator running
 * `eval replay-gate` against a lease somebody else holds is entitled to see the receipt that
 * would have been recorded, and telling them nothing would be worse than telling them it was
 * not recorded. What changes is who may treat it as EVIDENCE — a programmatic caller gets the
 * refusal, because a screening result recorded here against a receipt the store never took is
 * a claim the store will contradict forever after.
 */
function acknowledged(
  result: Extract<ReplayGateVerbResult, { kind: 'receipt' }>,
  candidateId: string,
): GateReceipt {
  if (!ACKNOWLEDGED_RECORDINGS.includes(result.recorded)) {
    throw new Gate1ReceiptNotPersistedError(candidateId, result.recorded)
  }
  return result.receipt
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
    // 422 D-14. Resolved at the CLAIM, never at composition: the pump composes this bridge
    // before it takes its lease (the `heldAuthority` closure `post-run-tail` reads inside
    // `curateRun`), so a captured value is `undefined` forever and every borrowed call would
    // ask the writer for a lease this very process already holds — which it answers `held`.
    const borrowed = deps.resolveClaimAuthority?.()
    if (borrowed !== undefined) {
      // ZERO acquire and ZERO release, on the error path as much as the success path. The
      // fence is the caller's; dropping it here would end the caller's authority mid-drain,
      // and re-acquiring it would be this process bidding against itself.
      const outcome = await curation.recordGateReceipt({
        resolveTrustPriors,
        receipt,
        lease: { leaseId: borrowed.leaseId, epoch: borrowed.epoch },
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
    }
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
        return acknowledged(result, id)
      },
    },
  }
}
