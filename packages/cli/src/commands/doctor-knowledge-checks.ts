/**
 * The four knowledge trust rows `agent-qa doctor` prints (407 TRST-02, 416 D-19).
 *
 * WHY THESE THREE EXIST. Before this, none of doctor's rows touched the knowledge substrate at
 * all: a daemon whose embedder worker exits on every boot could run a whole session with no
 * embedder and nothing on the surface said so. `Knowledge store` reports the index face,
 * `Embedder` reports the capability outcome, and `Retrieval rung` reports the fold of the two —
 * the one word the run banner would show for the same host.
 *
 * STATUS DISCIPLINE IS THE LOAD-BEARING PART (D-19). `doctor` sets exit code 1 on a `fail`, so a
 * `fail` for a rung REACHED BY DESIGN would red the CI gate of every deliberately-degraded
 * install — the static floor is the no-budget escape hatch and `lexical-only` means the floor was
 * explicitly disabled. `fail` is therefore reserved for a subsystem that ERRORED: an index file
 * that is present and will not open, or a daemon whose embedder worker never registered. The
 * `Retrieval rung` row can never be `fail` at all; degraded is not failed.
 *
 * ONE FOLD, NOT THREE (D-17). All three rows read `foldRetrievalRung` from knowledge-local — the
 * same function the runner's evidence recorder and the dashboard banner read. Three surfaces
 * folding the same two axes independently is exactly how a banner and a doctor row come to
 * disagree about one machine.
 *
 * THE IMPORT ROUTE IS NOT INCIDENTAL. 385 D-14/SC5 gives knowledge-local's writer entry exactly
 * ONE importer workspace-wide, enforced at file granularity by the `reader-carveout` arch rule.
 * The probes below therefore arrive through `LOCAL_KNOWLEDGE_PROBES`, bound at that one legal
 * composition edge, rather than by naming knowledge-local from the CLI.
 */
import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import {
  DEFAULT_EMBEDDING_PROFILE,
  type EmbeddingProfile,
  type RecordedRetrievalRung,
  type RetrievalRungReason,
  type PromotionJudgePosture,
} from '@vostride/agent-qa-schema'
import {
  LOCAL_KNOWLEDGE_PROBES,
  type AcquireEmbedderOutcome,
  type IndexFace,
  type ReadEmbedderWorkerRegistrationOutcome,
  type ReadWriterLeaseOutcome,
} from '@vostride/agent-qa-agent-local'

import { buildTrustPriorsResolver, formatTrustPriorDisclosure, type TrustPriorsResolution } from '../curation/trust-priors.js'
import { resolveRawConfigKnowledgeRoot } from '../config.js'
import { buildPromotionPostureResolver, type PromotionPostureResolution } from '../curation/promotion-posture.js'
import { LOCAL_CURATION_CAPABILITIES, latestBuildOrdinal } from '@vostride/agent-qa-agent-local'
import { createReplayGatePortForHost } from '../gates/replay-gate-host.js'
import { readDaemonEventLedger, type DaemonEvent } from '../daemon/events.js'
import type { CheckResult, DoctorCheck } from './doctor.js'

const { foldRetrievalRung, indexDbPath } = LOCAL_KNOWLEDGE_PROBES

/**
 * The closed reason vocabulary rendered for a person, as a TOTAL map rather than a switch with a
 * default: a ninth `RetrievalRungReason` becomes a compile error here instead of a blank cause
 * printed after an em dash. 407-11 pins this table equal to the dashboard's copy of it — the two
 * surfaces share no UI module, so the labels are defined twice by necessity and asserted equal.
 */
export const RUNG_CAUSE_LABELS: Record<RetrievalRungReason, string> = {
  'native-runtime-unavailable': 'native ONNX runtime unavailable',
  'profile-unresolved': 'embedder profile unresolved (deferred)',
  'low-ram-deferral': 'embedding deferred on low memory',
  'model-not-downloaded': 'embedding model not downloaded',
  'embedder-load-failed': 'embedder failed to load',
  'index-unavailable': 'knowledge index unavailable, scanning bundles',
  'floor-disabled': 'static floor disabled',
  'profile-static-configured': 'static profile configured',
}

/** D-16: no knowledge reader bound is not a rung. Every row still prints; none is omitted. */
export const NO_KNOWLEDGE_ROOT_MESSAGE = 'no knowledge root configured'

/**
 * The 399 wording of record (D-20). The folded failure is named by its CAUSE, not its symptom,
 * and the raw worker stderr that carries it never reaches the terminal (T-407-18).
 */
export const EMBEDDER_WORKER_NOT_REGISTERED_TEXT = 'daemon embedder worker not registered: could not resolve profile (deferred)'

const STORE_FIX_PREFIX = 'Rebuild the index with `agent-qa knowledge rebuild-index`, or remove the corrupt file at'
const EMBEDDER_FIX =
  'Set an explicit embedder profile in agent-qa.config.yaml (the daemon cannot resolve `deferred`), then restart the daemon.'
const RUNG_FIX = 'Run the checks above; the rung follows from the store and embedder rows.'
const LEARNING_MODE_FIX =
  'Replay gating is not bound on this host. Seed the eval root and commit a measured noise floor with `agent-qa eval floor --commit`; repair any reported posture refusal.'

/** The fold's index axis held OPEN, so the `Embedder` row reads its own subject's cause. */
const INDEX_PRESENT: IndexFace = { source: 'index' }

const SKIPPED: CheckResult = { status: 'skip', message: NO_KNOWLEDGE_ROOT_MESSAGE }

export interface KnowledgeCheckProbes {
  buildPromotionPosture?: typeof buildPromotionPostureResolver
  classifyIndexFace?: (knowledgeRoot: string) => IndexFace
  resolveEmbedderCapability?: (options: {
    preferredProfile: EmbeddingProfile
    allowDownload: false
    agentQaRoot: string
  }) => Promise<AcquireEmbedderOutcome>
  readWriterLease?: (knowledgeRoot: string) => ReadWriterLeaseOutcome
  readEmbedderWorkerRegistration?: (agentQaRoot: string) => ReadEmbedderWorkerRegistrationOutcome
  readDaemonEventLedger?: (agentQaRoot: string) => { events: readonly DaemonEvent[] }
}

export interface CreateKnowledgeChecksInput {
  /** The RAW config doctor loaded; `null` means it could not be read at all. */
  config: Record<string, unknown> | null
  configPath: string
  preferredProfile?: EmbeddingProfile
  probes?: KnowledgeCheckProbes
}

interface DaemonHalf {
  registration: ReadEmbedderWorkerRegistrationOutcome
  lastExit: DaemonEvent | undefined
}

interface KnowledgeProbe {
  trustPriors: TrustPriorsResolution
  learning: PromotionPostureResolution
  face: IndexFace
  embedder: AcquireEmbedderOutcome
  /** The fold over BOTH axes — the word the banner would show. */
  rung: RecordedRetrievalRung
  /** The same fold with the index axis held open, so the embedder row names its own cause. */
  embedderRung: RecordedRetrievalRung
  /** Consulted only when a daemon lease is live; `undefined` means nobody holds authority. */
  daemon: DaemonHalf | undefined
}

interface KnowledgeCheckContext {
  agentQaRoot: string
  knowledgeRoot: string | null
  relativeRoot: string
  relativeIndexPath: string
  priors: () => TrustPriorsResolution
  probe: () => Promise<KnowledgeProbe>
}

/**
 * D-16/D-19's "no knowledge root configured" predicate.
 *
 * A VALIDATED config always materialises `knowledge.dir` (the schema defaults it), and doctor
 * loads the RAW config — so "the key is absent" cannot be the test. The two facts that can make
 * this host have no store are: the config could not be read or named a root at all, or the
 * directory it names is not on disk.
 */
function resolveKnowledgeRootOnDisk(
  config: Record<string, unknown> | null,
  configPath: string,
): string | null {
  const root = resolveRawConfigKnowledgeRoot(config, configPath)
  if (root === null) return null
  return existsSync(root) ? root : null
}

/**
 * Printed relative to the cwd so it stays short and copy-pasteable — but its length is NOT
 * bounded: a deeper project, or a run from the filesystem root, widens it without limit.
 *
 * This docstring used to claim the reason WORD was the only variable-length segment of a row.
 * The 407 UAT measured that false: at `COLUMNS=80` the `Knowledge store` FAIL row came to 113
 * columns with a 7-character reason word, and the reason vocabulary is a closed four-value enum
 * capped at 14 characters (`absent|corrupt|locked|schema-version`), so the length came from the
 * PATH. What bounds a row now is the RENDERER — `formatCheckRow` in `doctor.ts` — which is where
 * the budget belongs, because no message length can overrun a width the renderer enforces.
 */
function displayPath(absolute: string): string {
  return relative(process.cwd(), absolute) || '.'
}

function lastEmbedderWorkerExit(events: readonly DaemonEvent[]): DaemonEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'embedder-worker-exit') return event
  }
  return undefined
}

function stringField(event: DaemonEvent | undefined, field: string): string | undefined {
  const value = event?.[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * `reason` is absent IFF the rung is `memidex`, and every caller below has already returned on
 * that arm. The fallback exists only to keep the lookup total; no row can reach it.
 */
function causeLabel(rung: RecordedRetrievalRung): string {
  return RUNG_CAUSE_LABELS[rung.reason ?? 'index-unavailable']
}

function createKnowledgeStoreCheck(context: KnowledgeCheckContext): DoctorCheck {
  return {
    name: 'Knowledge store',
    fixInstructions: `${STORE_FIX_PREFIX} ${context.relativeIndexPath} and re-run.`,
    check: async (): Promise<CheckResult> => {
      if (context.knowledgeRoot === null) return SKIPPED
      const { face } = await context.probe()
      if (face.source === 'index') {
        return { status: 'pass', message: `index open at ${context.relativeRoot} (memidex)` }
      }
      // Present-but-unopenable is the ERRORED subsystem D-19 reserves `fail` for. The reason WORD
      // goes to the terminal; the driver's own text (which quotes paths) stays out of it (T-407-18).
      if (face.filePresent) {
        return {
          status: 'fail',
          message: `index at ${context.relativeIndexPath} could not be opened: ${face.reason}`,
        }
      }
      return {
        status: 'warn',
        message: `no index at ${context.relativeRoot} — scanning bundles (${RUNG_CAUSE_LABELS['index-unavailable']})`,
      }
    },
  }
}

function createEmbedderCheck(context: KnowledgeCheckContext): DoctorCheck {
  return {
    name: 'Embedder',
    fixInstructions: EMBEDDER_FIX,
    check: async (): Promise<CheckResult> => {
      if (context.knowledgeRoot === null) return SKIPPED
      const { embedder, embedderRung, daemon } = await context.probe()

      // D-20's second half, consulted FIRST when it exists: an in-process probe answers "what can
      // this process do", which is not the same question as "does the standing daemon actually
      // have an embedder". A host can resolve native in-process while the daemon has been serving
      // every run of the day with none.
      if (daemon !== undefined && daemon.registration.kind !== 'parsed') {
        const stderr = stringField(daemon.lastExit, 'stderr') ?? ''
        if (stderr.includes('could not resolve profile')) {
          return { status: 'fail', message: EMBEDDER_WORKER_NOT_REGISTERED_TEXT }
        }
        const reason = stringField(daemon.lastExit, 'reason') ?? 'no registration published'
        return { status: 'fail', message: `embedder worker failed to start: ${reason}` }
      }

      if (embedder.kind === 'ready' && embedder.rung === 'native') {
        return { status: 'pass', message: `native (${embedder.profile.model_id})` }
      }
      const label = causeLabel(embedderRung)
      if (embedderRung.rung === 'static-floor') {
        return { status: 'warn', message: `static floor — ${label}` }
      }
      return { status: 'warn', message: `none — ${label}` }
    },
  }
}

function createRetrievalRungCheck(context: KnowledgeCheckContext): DoctorCheck {
  return {
    name: 'Retrieval rung',
    fixInstructions: RUNG_FIX,
    check: async (): Promise<CheckResult> => {
      if (context.knowledgeRoot === null) return SKIPPED
      const { rung } = await context.probe()
      // D-19: never a failure. A lower rung is a rung reached by design, and this row is the one
      // that would otherwise red the CI gate of every host running on the floor on purpose.
      if (rung.rung === 'memidex') return { status: 'pass', message: 'memidex' }
      return { status: 'warn', message: `${rung.rung} — ${causeLabel(rung)}` }
    },
  }
}

function createLearningModeCheck(context: KnowledgeCheckContext): DoctorCheck {
  const check = createLearningAvailabilityCheck(context)
  return { ...check,
    get fixInstructions() {
      return context.priors().kind === 'refused'
        ? `Inspect the calibration marker and its referenced revisions in the selected committed eval root ${displayPath(resolve(dirname(context.agentQaRoot), 'agent-qa-eval'))} without changing them. Follow docs/label-calibration.md#inspection-and-recovery; marker replacement is a separate explicit operator action.`
        : check.fixInstructions
    },
    check: async () => {
    const priors = context.knowledgeRoot === null ? context.priors() : (await context.probe()).trustPriors
    const row = await check.check()
    const disclosure = priors.kind === 'refused'
      ? 'label calibration: invalid or unavailable; trust priors: unavailable'
      : `${priors.calibration}; ${formatTrustPriorDisclosure(priors.disclosure)}`
    return { ...row, status: priors.kind === 'refused' && row.status !== 'skip' ? 'fail' : row.status,
      message: `${row.message}; ${disclosure}` }
  } }
}

function createLearningAvailabilityCheck(context: KnowledgeCheckContext): DoctorCheck {
  return {
    name: 'Learning mode',
    fixInstructions: LEARNING_MODE_FIX,
    check: async (): Promise<CheckResult> => {
      if (context.knowledgeRoot === null) return SKIPPED
      const { learning } = await context.probe()
      if (learning.kind === 'no-eval-root') {
        return { status: 'warn', message: `deterministic-verdict-floor — no eval root at ${displayPath(learning.committedRoot)}` }
      }
      if (learning.kind === 'unavailable') {
        const panel = learning.judge?.panelSize === undefined ? '' : `; judge ${judgeLabelOf(learning.judge)}`
        return { status: 'fail', message: `posture-unavailable — ${learningRefusalLabel(learning.refusals[0])}${panel}` }
      }
      const { replayGateAvailable, judge, canary } = learning.host
      const judgeLabel = judgeLabelOf(judge)
      if (replayGateAvailable) {
        const evidence = canary.kind === 'provided' ? canary.attributedRows ?? 'not reported' : 'none'
        // 2026-09-08, 418 D-04/D-14/D-21: cumulative since-v4 counts only.
        // Reuse the tail's validated reader and completed-run census; never guess old receipts.
        const { listCompletedRunDirs, readCurationTailReceipt } = await import('../curation/curation-tail.js')
        const totals = { rideAlong: 0, capExceeded: 0, staged: 0 }
        for (const dir of listCompletedRunDirs(context.agentQaRoot)) {
          const receipt = readCurationTailReceipt(dir)
          if (receipt === undefined) continue
          totals.rideAlong += receipt.canary.rideAlongUncredited
          totals.capExceeded += receipt.canary.ablationCapExceeded
          totals.staged += receipt.canary.staged
        }
        const shares = learning.host.lowerTrustShares
          .map(({ product, active, lowerTrust }) => `${lowerTrust}/${active} active in ${product}`)
          .join(', ') || 'none'
        return {
          status: 'pass',
          message: `gated (Gate 1 bound; judge ${judgeLabel}; canary evidence ${evidence}; since-v4 ride-along ${totals.rideAlong}; cap-exceeded ${totals.capExceeded}; lower-trust ${shares}; staged ${totals.staged})`,
        }
      }
      if (judge.reason === 'no-eligible-judge') {
        return {
          status: 'warn',
          message: `deterministic-verdict-floor — no replay gate bound; configured judge ${judgeLabel}`,
        }
      }
      return {
        status: 'warn',
        message: judge.reason === 'no-judge-configured'
          ? 'deterministic-verdict-floor — no replay gate bound, no judge configured'
          : `deterministic-verdict-floor — no replay gate bound; judge ${judgeLabel} configured`,
      }
    },
  }
}

/** Copy the complete declared family list; never infer an eligible subset for display. */
function judgeLabelOf(judge: PromotionJudgePosture): string {
  if (judge.reason === 'no-eligible-judge' && judge.panelSize !== undefined) {
    const families = judge.members?.map(member => member.judgeFamily || 'unknown').join(', ') ?? 'unknown'
    return `ineligible (panel: ${families})`
  }
  return judge.judgeFamily ?? (judge.reason === 'no-judge-configured' ? 'none'
    : judge.reason === 'no-eligible-judge' ? 'ineligible' : 'not reported')
}

/** Refusals retain diagnostic detail internally; this row never echoes arbitrary input. */
function learningRefusalLabel(refusal: string | undefined): string {
  if (refusal?.startsWith('noise-floor: no artefact for profile ')) {
    return 'noise-floor: no artefact for the active profile'
  }
  if (refusal?.startsWith('noise-floor: no minimumGateSet value at ')) {
    return 'noise-floor: no minimumGateSet value'
  }
  return 'eval posture could not be resolved'
}

/**
 * The four rows, over ONE shared read-only probe.
 *
 * The probe is memoised because the rows are views of one host state:
 * probing per row could report an index face to the store row and a different one to the rung row
 * if a drain landed between them, which is the disagreement this whole design exists to prevent.
 * It is also lazy; an absent knowledge root probes only calibration disclosure.
 */
export function createKnowledgeChecks(
  input: CreateKnowledgeChecksInput,
): [DoctorCheck, DoctorCheck, DoctorCheck, DoctorCheck] {
  const knowledgeRoot = resolveKnowledgeRootOnDisk(input.config, input.configPath)
  const agentQaRoot = resolve(dirname(resolve(input.configPath)), '.agent-qa')
  const preferredProfile = input.preferredProfile ?? DEFAULT_EMBEDDING_PROFILE

  const probes = input.probes ?? {}
  const classify = probes.classifyIndexFace ?? LOCAL_KNOWLEDGE_PROBES.classifyIndexFace
  const capability = probes.resolveEmbedderCapability ?? LOCAL_KNOWLEDGE_PROBES.resolveEmbedderCapability
  const lease = probes.readWriterLease ?? LOCAL_KNOWLEDGE_PROBES.readWriterLease
  const registration =
    probes.readEmbedderWorkerRegistration ?? LOCAL_KNOWLEDGE_PROBES.readEmbedderWorkerRegistration
  const ledger = probes.readDaemonEventLedger ?? readDaemonEventLedger
  const buildPosture = probes.buildPromotionPosture ?? buildPromotionPostureResolver

  let pending: Promise<KnowledgeProbe> | undefined
  let cachedPriors: TrustPriorsResolution | undefined
  const priors = () => cachedPriors ??= buildTrustPriorsResolver({ configPath: input.configPath, inspectCalibration: true })

  async function runProbe(root: string): Promise<KnowledgeProbe> {
    const trustPriors = priors()
    const face = classify(root)
    let learning: PromotionPostureResolution
    try {
      if (trustPriors.kind === 'refused') throw new Error(trustPriors.reason)
      const resolveTrustPriors = trustPriors.resolve
      learning = await buildPosture({ configPath: input.configPath,
        knowledgeRoot: root, agentQaRoot,
        canaryFacts: facts => LOCAL_CURATION_CAPABILITIES.readCanaryPostureFacts({ ...facts, resolveTrustPriors }),
        lowerTrustShares: facts => LOCAL_CURATION_CAPABILITIES.readLowerTrustShares({ ...facts, resolveTrustPriors }),
        currentBuildOrdinal: product => latestBuildOrdinal({ root: agentQaRoot, product }),
        replayGate: createReplayGatePortForHost({ configPath: input.configPath, agentQaRoot, resolveTrustPriors }),
      })
    } catch (error) {
      const refusals = [error instanceof Error ? error.message : String(error)]
      learning = {
        kind: 'unavailable',
        committedRoot: resolve(dirname(resolve(input.configPath)), 'agent-qa-eval'),
        refusals,
        resolve: () => ({ kind: 'unavailable', replayGateAvailable: false, refusals }),
      }
    }

    let embedder: AcquireEmbedderOutcome
    try {
      // `allowDownload: false` is not an option this surface offers: a probe that fetched a model
      // would CHANGE the answer by asking the question (T-407-19).
      embedder = await capability({ preferredProfile, allowDownload: false, agentQaRoot })
    } catch {
      embedder = { kind: 'deferred', reason: 'load-failure' }
    }

    let daemon: DaemonHalf | undefined
    if (lease(root).kind === 'parsed') {
      let events: readonly DaemonEvent[] = []
      try {
        events = ledger(agentQaRoot).events
      } catch {
        events = []
      }
      daemon = { registration: registration(agentQaRoot), lastExit: lastEmbedderWorkerExit(events) }
    }

    return {
      learning,
      trustPriors,
      face,
      embedder,
      rung: foldRetrievalRung(face, embedder, preferredProfile),
      embedderRung: foldRetrievalRung(INDEX_PRESENT, embedder, preferredProfile),
      daemon,
    }
  }

  const context: KnowledgeCheckContext = {
    agentQaRoot,
    knowledgeRoot,
    relativeRoot: knowledgeRoot === null ? '' : displayPath(knowledgeRoot),
    relativeIndexPath: knowledgeRoot === null ? '' : displayPath(indexDbPath(knowledgeRoot)),
    priors,
    probe: () => {
      if (knowledgeRoot === null) throw new TypeError('no knowledge root to probe')
      pending ??= runProbe(knowledgeRoot)
      return pending
    },
  }

  return [
    createKnowledgeStoreCheck(context),
    createEmbedderCheck(context),
    createRetrievalRungCheck(context),
    createLearningModeCheck(context),
  ]
}
