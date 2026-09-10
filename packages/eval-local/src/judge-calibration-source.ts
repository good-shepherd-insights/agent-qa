import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { canonicalJson, committedFileText, composeBaselineProfileKey, createPanelIdentity,
  projectJudgeConfigContract, projectMatcherConfigContract, wilsonInterval,
  JUDGE_CALIBRATION_MIN_N, type JudgeCalibrationMinimum, type JudgeCalibrationDiagnostics, type JudgeIdentityBlock,
} from '@vostride/agent-qa-eval'
import { sha256hex, slugBranch, type GuardrailPolicy } from '@vostride/agent-qa-schema'
import { assertCommittedEgressSafe, CommittedEgressBlockedError, defaultGuardrailPolicyInput, loadGuardrailPolicy } from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import { assertCalibrationPath } from './calibration-source.js'
import { loadJudgeCalibrationEvidence, type LoadJudgeCalibrationEvidenceInput } from './judge-calibration-evidence-source.js'
import { acquireMarkLock } from './mark-lock.js'
import { REPORT_EGRESS_CHANNEL } from './report-committing.js'

export const JUDGE_CALIBRATION_SCHEMA_VERSION = 1
export const JUDGE_CALIBRATION_SUBDIR = 'judge-calibration'
const hash = (value: unknown) => sha256hex(canonicalJson(value))
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const id = z.string().min(1).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value))
const unit = z.number().finite().min(0).max(1)
const interval = z.object({ lower: unit, upper: unit, halfWidth: unit }).strict()
const rateFields = { numerator: count, denominator: count, rate: unit.optional() }
const validRate = (v: { numerator: number; denominator: number; rate?: number }) => v.numerator <= v.denominator
  && (v.denominator === 0 ? v.rate === undefined : v.rate === v.numerator / v.denominator)
const rate = z.object(rateFields).strict().refine(validRate)
const tallyFields = { settled: count, abstained: count, errors: count, n: count,
  numerator: count, denominator: count, agreement: unit.optional(), wilson95: interval.optional() }
const tally = z.object(tallyFields).strict()
const counts = z.object({ selected: count, admitted: count, eligible: count, attempted: count,
  eligibilityRefused: count, evidenceSkipped: count, truthComparable: count, unresolvedTruth: count }).strict()
const cost = z.object({ callBound: count,
  usage: z.object({ calls: count, inputTokens: count.optional(), outputTokens: count.optional() }).strict() }).strict()
const profileSchema = z.object({ plannerModelId: id, fingerprint: digest, matcherVersion: count,
  judgeModelId: id, judgeVersion: count }).strict()
const identitySchema = z.object({ judgeModelId: id, judgeFamily: z.string(), judgeVersion: count,
  confidenceThreshold: z.literal('high'),
  panelSize: count.min(2).max(3), members: z.array(z.object({ judgeModelId: id, judgeFamily: z.string() }).strict()).min(2).max(3) }).strict()
const common = { schemaVersion: z.literal(JUDGE_CALIBRATION_SCHEMA_VERSION), generationId: digest,
  profileKey: id, profile: profileSchema, identity: identitySchema, constitutionDigest: digest,
  corpusDigest: digest, goldSetDigest: digest, replayEvidenceDigest: digest, evidenceDigest: digest,
  minN: count.min(2), minNSource: z.enum(['default', 'flag']), selected: count, admitted: count, cost }
const schema = z.union([
  z.object({ ...common, status: z.literal('capability-gap'), reason: z.enum(['no-credential', 'single-family-host']), n: z.literal(0) }).strict(),
  z.object({ ...common, status: z.enum(['calibrated', 'uncalibrated']), n: count,
    counts, pooled: tally, perMember: z.array(z.object({ judgeModelId: id, ...tallyFields }).strict()),
    pooledAgreement: unit.optional(), wilson95: interval.optional(), abstention: rate,
    disagreement: z.object({ ...rateFields, pairs: z.array(z.object({ memberModelIds: z.tuple([id, id]), ...rateFields }).strict().refine(validRate)) }).strict().refine(validRate),
  }).strict(),
])
export type JudgeCalibrationArtifact = z.infer<typeof schema>
export interface JudgeCalibrationReadInput extends LoadJudgeCalibrationEvidenceInput {
  identity: JudgeIdentityBlock
  minN: JudgeCalibrationMinimum
}
export type JudgeCalibrationRead = { kind: 'absent' }
  | { kind: 'loaded'; artifact: JudgeCalibrationArtifact }
  | { kind: 'refused'; reason: string }
export type JudgeCalibrationPublication = { kind: 'committed' | 'unchanged'; artifact: JudgeCalibrationArtifact; path: string }
  | { kind: 'refused' | 'busy' | 'input-drift' | 'publication-failed'; reason: string }
  | { kind: 'write-conflict'; path: string }
  | { kind: 'egress-blocked'; detections: readonly { label: string; detector: string }[] }

/** Locator only. Admission always checks the complete key and profile separately. */
export function judgeCalibrationPath(profileKey: string): string {
  return `reports/${JUDGE_CALIBRATION_SUBDIR}/${slugBranch(profileKey)}.json`
}
export function judgeCalibrationGenerationId(body: unknown): string { return hash(body) }

/** Strict syntax and arithmetic, including independently recomputed Wilson bounds. */
export function guardJudgeCalibration(value: unknown): JudgeCalibrationArtifact | undefined {
  try { return guardArtifact(value) } catch { return undefined }
}
function guardArtifact(value: unknown): JudgeCalibrationArtifact | undefined {
  const parsed = schema.safeParse(value)
  if (!parsed.success) return undefined
  const a = parsed.data, { generationId, ...body } = a
  if (hash(body) !== generationId || a.constitutionDigest !== hash(projectJudgeConfigContract())
    || a.profile.matcherVersion !== projectMatcherConfigContract().version
    || a.profileKey !== composeBaselineProfileKey(a.profile)
    || !same(a.identity, createPanelIdentity(a.identity.members.map(member => member.judgeModelId)))
    || a.profile.judgeModelId !== a.identity.judgeModelId || a.profile.judgeVersion !== a.identity.judgeVersion
    || (a.minNSource === 'default' && a.minN !== JUDGE_CALIBRATION_MIN_N) || a.admitted > a.selected) return undefined
  if (a.status === 'capability-gap') return same(a.cost, { callBound: 0, usage: { calls: 0 } }) ? a : undefined
  const c = a.counts, ids = a.identity.members.map(member => member.judgeModelId)
  if (a.n !== a.pooled.n || (a.status === 'calibrated') !== (a.n >= a.minN)
    || c.selected !== a.selected || c.admitted !== a.admitted || c.admitted > c.selected
    || c.eligible + c.eligibilityRefused !== c.admitted || c.attempted > c.eligible
    || c.evidenceSkipped !== c.selected - c.eligibilityRefused - c.attempted
    || c.truthComparable + c.unresolvedTruth !== c.attempted
    || a.cost.callBound !== c.attempted * ids.length * 2 || a.cost.usage.calls !== a.cost.callBound
    || (c.attempted === 0 && (a.cost.usage.inputTokens !== undefined || a.cost.usage.outputTokens !== undefined))
    || !same(a.perMember.map(member => member.judgeModelId).sort(), [...ids].sort())) return undefined
  for (const row of [a.pooled, ...a.perMember]) {
    if (row.settled + row.abstained + row.errors !== c.attempted || row.n > row.settled
      || row.n > c.truthComparable || row.settled - row.n > c.unresolvedTruth
      || row.denominator !== row.n || row.numerator > row.n
      || (row.n === 0 ? row.agreement !== undefined || row.wilson95 !== undefined
        : row.agreement !== row.numerator / row.n || !same(row.wilson95, wilsonInterval(row.numerator, row.n)))) return undefined
  }
  if (!same(a.pooledAgreement, a.pooled.agreement) || !same(a.wilson95, a.pooled.wilson95)
    || a.abstention.numerator !== a.pooled.abstained || a.abstention.denominator !== c.attempted) return undefined
  const expectedPairs = ids.flatMap((left, i) => ids.slice(i + 1).map(right => [left, right].sort().join('\0'))).sort()
  const pairs = a.disagreement.pairs
  if (!same(pairs.map(pair => [...pair.memberModelIds].sort().join('\0')).sort(), expectedPairs)
    || pairs.some(pair => {
      const settled = pair.memberModelIds.map(memberId => a.perMember.find(member => member.judgeModelId === memberId)!.settled)
      return pair.denominator > Math.min(...settled)
        || pair.denominator < Math.max(0, settled[0]! + settled[1]! - c.attempted)
    })
    || a.disagreement.numerator !== pairs.reduce((n, pair) => n + pair.numerator, 0)
    || a.disagreement.denominator !== pairs.reduce((n, pair) => n + pair.denominator, 0)) return undefined
  return a
}

function envelope(input: JudgeCalibrationReadInput) {
  const identity = identitySchema.parse(input.identity)
  if (!same(identity, createPanelIdentity(identity.members.map(member => member.judgeModelId)))) throw new Error('invalid identity')
  const { plannerModelId, fingerprint, matcherVersion, judgeModelId, judgeVersion } = input.profile
  const profile = profileSchema.parse({ plannerModelId, fingerprint, matcherVersion, judgeModelId, judgeVersion })
  if (profile.judgeModelId !== identity.judgeModelId || profile.judgeVersion !== identity.judgeVersion
    || (input.profile.judgeMemberModelIds !== undefined && !same(createPanelIdentity(input.profile.judgeMemberModelIds), identity))) throw new Error('foreign identity')
  return { profile, identity, profileKey: composeBaselineProfileKey(profile),
    minN: input.minN.value, minNSource: input.minN.source, constitutionDigest: hash(projectJudgeConfigContract()) }
}
export class JudgeCalibrationEvidenceError extends Error {
  constructor(readonly skippedCounts: JudgeCalibrationDiagnostics) { super('Judge calibration evidence unavailable or refused.') }
}
function evidenceIdentity(input: JudgeCalibrationReadInput) {
  assertCalibrationPath(input.committedRoot, input.committedRoot)
  if (!lstatSync(input.committedRoot).isDirectory()) throw new Error('committed corpus unavailable')
  const read = loadJudgeCalibrationEvidence(input)
  if (Object.values(read.skippedCounts).some(n => n !== undefined && n > 0)) throw new JudgeCalibrationEvidenceError(read.skippedCounts)
  return { corpusDigest: read.corpusDigest, goldSetDigest: read.goldSetDigest,
    replayEvidenceDigest: read.replayEvidenceDigest, evidenceDigest: read.evidenceDigest,
    selected: read.selected, admitted: read.evidence.length }
}

/** Project only measured summary data; raw rows, credentials and audit paths cannot cross. */
export function createJudgeCalibrationArtifact(input: JudgeCalibrationReadInput,
  result: { status: 'capability-gap'; reason: 'no-credential' | 'single-family-host' }
    | ReturnType<typeof import('@vostride/agent-qa-eval').summarizeJudgeCalibration>,
): JudgeCalibrationArtifact {
  const metrics = result.status === 'capability-gap' ? { ...result, n: 0, cost: { callBound: 0, usage: { calls: 0 } } }
    : { status: result.status, n: result.n, counts: result.counts, pooled: result.pooled,
      perMember: result.perMember, pooledAgreement: result.pooledAgreement, wilson95: result.wilson95,
      abstention: result.abstention, disagreement: result.disagreement, cost: result.cost }
  const body = JSON.parse(JSON.stringify({ schemaVersion: JUDGE_CALIBRATION_SCHEMA_VERSION, ...envelope(input), ...evidenceIdentity(input), ...metrics }))
  const artifact = guardJudgeCalibration(JSON.parse(JSON.stringify({ ...body, generationId: hash(body) })))
  if (!artifact) throw new Error('invalid calibration output')
  return artifact
}

function admitted(input: JudgeCalibrationReadInput, artifact: JudgeCalibrationArtifact): boolean {
  const expected = { ...envelope(input), ...evidenceIdentity(input) }
  return Object.entries(expected).every(([key, value]) => same(Reflect.get(artifact, key), value))
}
function checkedText(root: string, path: string): string | undefined {
  assertCalibrationPath(root, path)
  try { if (!lstatSync(path).isFile()) throw new Error('invalid artifact path'); return readFileSync(path, 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
function checkEgress(artifact: JudgeCalibrationArtifact, policy?: GuardrailPolicy, auditDirectory?: string) {
  assertCommittedEgressSafe([{ label: 'judge-calibration', text: committedFileText(artifact) }], {
    channel: REPORT_EGRESS_CHANNEL, policy: policy ?? loadGuardrailPolicy(defaultGuardrailPolicyInput),
    ...(auditDirectory ? { auditSink: new JsonlAuditSink(auditDirectory) } : {}),
  })
}
export function readJudgeCalibration(input: Omit<JudgeCalibrationReadInput, 'minN'> & {
  /** Operators may require an exact minimum; report consumers retain the recorded policy. */
  minN?: JudgeCalibrationMinimum
}): JudgeCalibrationRead {
  try {
    const expected = envelope({ ...input, minN: input.minN ?? { value: JUDGE_CALIBRATION_MIN_N, source: 'default' } })
    const text = checkedText(input.committedRoot, join(input.committedRoot, judgeCalibrationPath(expected.profileKey)))
    if (text === undefined) return { kind: 'absent' }
    const artifact = guardJudgeCalibration(JSON.parse(text))
    if (!artifact || !admitted({ ...input, minN: input.minN ?? {
      value: artifact.minN, source: artifact.minNSource,
    } }, artifact)) return { kind: 'refused', reason: 'Judge calibration identity or evidence is invalid or stale.' }
    checkEgress(artifact)
    return { kind: 'loaded', artifact }
  } catch { return { kind: 'refused', reason: 'Judge calibration or evidence unavailable; inspect the profile and local corpus.' } }
}

/** One checked file, with immutable create or explicit atomic replace under the operator lock. */
export async function publishJudgeCalibration(input: JudgeCalibrationReadInput & {
  artifact: JudgeCalibrationArtifact; replace?: boolean; policy?: GuardrailPolicy;
  auditDirectory: string; onBoundary?: (stage: string) => void;
}): Promise<JudgeCalibrationPublication> {
  let release: (() => void) | undefined, temp: string | undefined
  try {
    const artifact = guardJudgeCalibration(input.artifact)
    if (!artifact || !admitted(input, artifact)) return { kind: 'refused', reason: 'Judge calibration identity or evidence is invalid or stale.' }
    assertCalibrationPath(input.agentQaRoot, input.auditDirectory)
    checkEgress(artifact, input.policy, input.auditDirectory)
    const path = judgeCalibrationPath(artifact.profileKey), destination = join(input.committedRoot, path)
    const original = checkedText(input.committedRoot, destination)
    const originalInode = original === undefined ? undefined : lstatSync(destination).ino
    // Even replace cannot overwrite a foreign key or corrupted prior artifact.
    if (original !== undefined) {
      const previous = guardJudgeCalibration(JSON.parse(original))
      if (!previous || !same(previous.profile, artifact.profile) || !same(previous.identity, artifact.identity)) {
        return { kind: 'refused', reason: 'Existing judge calibration has an invalid or foreign identity.' }
      }
    }
    const lock = join(input.committedRoot, '.judge-calibration.lock')
    assertCalibrationPath(input.committedRoot, lock)
    mkdirSync(dirname(lock), { recursive: true })
    try { release = await acquireMarkLock(lock, 'judge-calibration', () => new Error('judge-calibration-busy')) }
    catch (error) { if (error instanceof Error && error.message === 'judge-calibration-busy') return { kind: 'busy', reason: 'Another judge calibration publisher holds the operator lock.' }; throw error }
    const inode = lstatSync(lock).ino, owner = checkedText(input.committedRoot, join(lock, 'owner.json'))
    const unchanged = () => {
      try { return lstatSync(lock).ino === inode && checkedText(input.committedRoot, join(lock, 'owner.json')) === owner
        && checkedText(input.committedRoot, destination) === original
        && (originalInode === undefined || lstatSync(destination).ino === originalInode)
        && admitted(input, artifact) } catch { return false }
    }
    input.onBoundary?.('after-lock')
    if (!unchanged()) return { kind: 'input-drift', reason: 'Judge calibration inputs or lock ownership changed; retry.' }
    const text = committedFileText(artifact)
    if (original === text) return { kind: 'unchanged', artifact, path }
    if (original !== undefined && !input.replace) return { kind: 'write-conflict', path }
    assertCalibrationPath(input.committedRoot, destination)
    mkdirSync(dirname(destination), { recursive: true })
    temp = join(dirname(destination), `.judge-calibration-${randomUUID()}.tmp`)
    assertCalibrationPath(input.committedRoot, temp)
    const fd = openSync(temp, 'wx', 0o600)
    try { writeFileSync(fd, text, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
    const tempInode = lstatSync(temp).ino
    input.onBoundary?.('before-rename')
    if (!unchanged() || lstatSync(temp).ino !== tempInode || checkedText(input.committedRoot, temp) !== text) return { kind: 'input-drift', reason: 'Judge calibration inputs or destination changed before publication.' }
    assertCalibrationPath(input.committedRoot, destination)
    if (original === undefined) linkSync(temp, destination)
    else renameSync(temp, destination)
    return { kind: 'committed', artifact, path }
  } catch (error) {
    if (error instanceof CommittedEgressBlockedError) return { kind: 'egress-blocked', detections: error.blocked.map(({ label, detector }) => ({ label, detector })) }
    return { kind: 'publication-failed', reason: 'Judge calibration publication interrupted; inspect local inputs and retry.' }
  } finally {
    if (temp) { try { unlinkSync(temp) } catch { /* Renamed or removed by the owner. */ } }
    release?.()
  }
}
