import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { calibrateLabels, canonicalJson, collectSoftPopulation, committedFileText, computeCorpusDigest, computeSoftWeight, createLabelRevision, deriveLabelRevisionId, type StandaloneLabelRecord } from '@vostride/agent-qa-eval'
import { sha256hex, type GuardrailPolicy } from '@vostride/agent-qa-schema'
import { assertCommittedEgressSafe, CommittedEgressBlockedError, defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import { assertCalibrationPath, calibrationGenerationId, guardLabelCalibration, LABEL_CALIBRATION_PATH, type LabelCalibrationArtifact } from './calibration-source.js'
import { readCommittedCorpus } from './committed-corpus-source.js'
import { loadCalibrationEvidence } from './calibration-evidence-source.js'
import { loadLabelEvidence } from './label-evidence-source.js'
import { committedLabelRevisionPath, FsCommittedRootStore } from './committed-root-store.js'
import { REPORT_EGRESS_CHANNEL } from './report-committing.js'
import { acquireMarkLock } from './mark-lock.js'

export interface RunLabelCalibrationInput {
  committedRoot: string
  agentQaRoot: string
  reportOutputBaseDir: string
  commit?: boolean
  replace?: boolean
  minGold?: { value: number; source: 'default' | 'cli' }
  policy?: GuardrailPolicy
  /** Synchronous failure injection at actual publication boundaries; never supplied by learners. */
  onBoundary?: (stage: string) => void
}
export type RunLabelCalibrationResult =
  | { kind: 'dry-run' | 'committed' | 'unchanged'; artifact: LabelCalibrationArtifact; refreshedCount: number }
  | { kind: 'refused' | 'busy' | 'input-drift' | 'publication-failed'; reason: string }
  | { kind: 'write-conflict'; path: string }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }

// Outside label traversal: lock tombstones are runtime ownership, never label history.
const LOCK_PATH = '.label-calibration.lock'
function markerText(root: string): string | undefined {
  const path = join(root, LABEL_CALIBRATION_PATH)
  assertCalibrationPath(root, path)
  try { return readFileSync(path, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function prepare(input: RunLabelCalibrationInput) {
  if (input.minGold && (!Number.isSafeInteger(input.minGold.value) || input.minGold.value < 2 || !['default', 'cli'].includes(input.minGold.source))) throw new Error('invalid minimum')
  // Validate directory entries before readers can silently skip a symlinked product subtree.
  function checkTree(directory: string): void {
    assertCalibrationPath(input.committedRoot, directory)
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'blobs') continue
      const path = join(directory, entry.name)
      assertCalibrationPath(input.committedRoot, path)
      if (entry.isDirectory()) checkTree(path)
    }
  }
  for (const name of ['labels', 'corpus', 'cassettes']) checkTree(join(input.committedRoot, name))
  const read = readCommittedCorpus(input.committedRoot)
  if (read.refusals.length) throw new Error('committed corpus refused')
  if (read.snapshot.entries.some(entry => !read.snapshot.labelsById.has(entry.cassetteId)
    || !read.snapshot.cassettesById.has(entry.cassetteId))) throw new Error('incomplete committed corpus')
  const evidence = loadLabelEvidence({ snapshot: read.snapshot, agentQaRoot: input.agentQaRoot })
  if (evidence.refusals.length) throw new Error('complete population unavailable')
  const calibration = loadCalibrationEvidence(input)
  if (Object.entries(calibration.missingEvidenceCounts).some(([key, value]) => value && /refused|unreadable|invalid|path/.test(key))) throw new Error('calibration evidence refused')
  const population = collectSoftPopulation(evidence)
  const report = calibrateLabels({ ...calibration, minGold: input.minGold ? {
    value: input.minGold.value, source: input.minGold.source === 'cli' ? 'flag' : 'default',
  } : undefined })
  const corpusDigest = computeCorpusDigest(read.snapshot.entries)
  const desired: { product: string; record: StandaloneLabelRecord; changed: boolean }[] = []
  for (const [id, current] of [...read.snapshot.labelsById].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (current.label.tier !== 'near-gold' || current.label.sourceChannel !== 'self-heal-pair' || current.quarantine) continue
    const entries = read.snapshot.entries.filter(entry => entry.cassetteId === id)
    const cassette = read.snapshot.cassettesById.get(id), pairing = current.label.pairing
    if (entries.length !== 1 || !cassette || !pairing) throw new Error('pair identity unavailable')
    const product = entries[0]!.product
    const recoveringId = pairing.relation === 'contrastive-positive' ? id : pairing.pairedCassetteId
    const observation = population.observations.find(row => row.product === product && row.runId === current.provenance.runId
      && row.testIndex === cassette.testIndex && row.stepIndex === cassette.stepIndex
      && row.attempt === (current.provenance.rerun?.attempt ?? 0) && row.recoveringCassetteId === recoveringId)
    if (!observation) throw new Error('pair population unavailable')
    const state = population.observations.filter(row => row.product === product && row.failedScreenStateHash === observation.failedScreenStateHash)
    const wanted = canonicalJson(observation.recoveringAction)
    const weight = computeSoftWeight({ k: state.filter(row => canonicalJson(row.recoveringAction) === wanted).length,
      n: state.length, corpusDigest, evidenceDigest: population.evidenceDigest, recoveringDecision: observation.recoveringDecision })
    const record = createLabelRevision(current, { weight })
    desired.push({ product, record, changed: record !== current })
  }
  const body: Omit<LabelCalibrationArtifact, 'generationId'> = {
    ...report, schemaVersion: 1,
    minGold: { value: report.minGold.value, source: report.minGold.source === 'flag' ? 'cli' : 'default' },
    evidenceDigest: sha256hex(canonicalJson({ population: population.evidenceDigest,
      observations: calibration.observations, goldSetDigest: report.goldSetDigest, missing: calibration.missingEvidenceCounts })),
    targetRevisions: desired.map(({ record }) => ({ cassetteId: record.cassetteId, revisionId: record.revision?.id ?? deriveLabelRevisionId(record) })),
  }
  const artifact: LabelCalibrationArtifact = { ...body, generationId: calibrationGenerationId(body) }
  if (!guardLabelCalibration(artifact)) throw new Error('invalid calibration output')
  const parts = desired.filter(row => row.changed).map(({ product, record }) => {
    const revision = { ...record, revision: { ...record.revision!, generationId: artifact.generationId } }
    return { relPath: committedLabelRevisionPath(product, record.cassetteId, record.revision!.id), label: `label-revision:${record.cassetteId}`, text: committedFileText(revision) }
  })
  // Drift identity is invocation-local. Generated staged history is deliberately excluded.
  const identity = sha256hex(canonicalJson({ entries: read.snapshot.entries,
    labels: [...read.snapshot.labelsById], cassettes: [...read.snapshot.cassettesById].sort(),
    handoffs: evidence.handoffs, marks: evidence.marks, observations: calibration.observations,
    marker: markerText(input.committedRoot) ?? null }))
  return { artifact, parts, identity, refreshedCount: parts.length }
}

function writeCheckedTemp(root: string, path: string, text: string): void {
  assertCalibrationPath(root, path)
  // An interrupted identical generation may leave this private temporary file behind.
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== text) throw new Error('temporary publication conflict')
    return
  }
  const fd = openSync(path, 'wx', 0o600)
  try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
}

/** The only explicit operator producer. Immutable revisions precede the one atomic marker swap. */
export async function runLabelCalibration(input: RunLabelCalibrationInput): Promise<RunLabelCalibrationResult> {
  if (input.replace && !input.commit) return { kind: 'refused', reason: '--replace requires --commit' }
  let planned: ReturnType<typeof prepare>
  try { planned = prepare(input) } catch { return { kind: 'refused', reason: 'Calibration inputs unavailable or invalid; inspect committed labels and run evidence.' } }
  if (!input.commit) {
    try {
      // Preview discloses the same data as publication but must not create audit bytes.
      assertCommittedEgressSafe([...planned.parts, { label: 'label-calibration', text: committedFileText(planned.artifact) }], {
        channel: REPORT_EGRESS_CHANNEL, policy: input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
      })
      return { kind: 'dry-run', artifact: planned.artifact, refreshedCount: planned.refreshedCount }
    } catch (error) {
      if (error instanceof CommittedEgressBlockedError) return { kind: 'egress-blocked', detections: error.blocked.map(({ label, detector }) => ({ label, detector })) }
      return { kind: 'refused', reason: 'Calibration preview could not be checked safely.' }
    }
  }
  const lock = join(input.committedRoot, LOCK_PATH), marker = join(input.committedRoot, LABEL_CALIBRATION_PATH)
  let release: (() => void) | undefined, lockInode: number | undefined
  const temps: string[] = []
  const unchangedInputs = () => {
    try { return lstatSync(lock).ino === lockInode && prepare(input).identity === planned.identity } catch { return false }
  }
  try {
    assertCalibrationPath(input.committedRoot, lock)
    mkdirSync(dirname(lock), { recursive: true })
    try { release = await acquireMarkLock(lock, 'label-calibration', () => new Error('calibration-busy')) }
    catch (error) { if (error instanceof Error && error.message === 'calibration-busy') return { kind: 'busy', reason: 'Another calibration publisher holds the operator lock.' }; throw error }
    lockInode = lstatSync(lock).ino
    input.onBoundary?.('after-lock')
    if (!unchangedInputs()) return { kind: 'input-drift', reason: 'Calibration inputs changed; retry from the current snapshot.' }
    const artifactPart = { relPath: LABEL_CALIBRATION_PATH, label: 'label-calibration', text: committedFileText(planned.artifact) }
    const parts = [...planned.parts, artifactPart]
    assertCommittedEgressSafe(parts, { channel: REPORT_EGRESS_CHANNEL,
      policy: input.policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput), auditSink: new JsonlAuditSink(input.reportOutputBaseDir) })
    const store = new FsCommittedRootStore(input)
    // Preview every destination before the first revision or marker byte is created.
    const previews = parts.map(part => { assertCalibrationPath(input.committedRoot, join(input.committedRoot, part.relPath)); return store.previewText(part.relPath, part.text) })
    const conflict = parts.find((part, i) => previews[i] === 'conflict' && (part !== artifactPart || !input.replace))
    if (conflict) return { kind: 'write-conflict', path: conflict.relPath }
    if (previews.every(value => value === 'identical')) return { kind: 'unchanged', artifact: planned.artifact, refreshedCount: 0 }
    for (const [i, part] of planned.parts.entries()) {
      input.onBoundary?.(`before-revision:${i}`)
      if (!unchangedInputs()) return { kind: 'input-drift', reason: 'Calibration inputs changed before publication.' }
      const destination = join(input.committedRoot, part.relPath)
      assertCalibrationPath(input.committedRoot, destination)
      if (store.previewText(part.relPath, part.text) === 'identical') continue
      const temp = join(dirname(destination), `.calibration-${planned.artifact.generationId}-${i}.tmp`)
      mkdirSync(dirname(destination), { recursive: true })
      writeCheckedTemp(input.committedRoot, temp, part.text); temps.push(temp)
      // Hard-link publishes a complete file exclusively; an existing path is never overwritten.
      linkSync(temp, destination)
    }
    input.onBoundary?.('before-marker')
    if (!unchangedInputs()) return { kind: 'input-drift', reason: 'Calibration inputs changed before publication.' }
    const temp = join(dirname(marker), `.calibration-${planned.artifact.generationId}.tmp`)
    assertCalibrationPath(input.committedRoot, dirname(marker))
    mkdirSync(dirname(marker), { recursive: true })
    writeCheckedTemp(input.committedRoot, temp, artifactPart.text); temps.push(temp)
    input.onBoundary?.('before-rename')
    if (!unchangedInputs()) return { kind: 'input-drift', reason: 'Calibration inputs changed before publication.' }
    assertCalibrationPath(input.committedRoot, marker)
    renameSync(temp, marker)
    input.onBoundary?.('after-marker')
    return { kind: 'committed', artifact: planned.artifact, refreshedCount: planned.refreshedCount }
  } catch (error) {
    if (error instanceof CommittedEgressBlockedError) return { kind: 'egress-blocked', detections: error.blocked.map(({ label, detector }) => ({ label, detector })) }
    return { kind: 'publication-failed', reason: 'Calibration publication interrupted; a complete generation remains selected. Retry the identical command.' }
  } finally {
    for (const temp of temps) { try { unlinkSync(temp) } catch { /* Already renamed or externally removed. */ } }
    release?.()
  }
}
