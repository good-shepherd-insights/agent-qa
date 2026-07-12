import { expectTypeOf } from 'vitest'
import type { Delta } from '../delta/delta'
import type {
  BundleDraft,
  BundleKind,
  CompareAndSet,
  DeltaEnvelope,
  FactSubtype,
} from '../delta/envelope'
import type { IssueDelta } from '../delta/issue-delta'
import type { ArtifactRef } from '../ids/artifact-ref'
import type { EvidenceToken, IssueId, RecordId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import type { ScopeKey } from '../identity/scope-key'

const recordId = 'record-1' as RecordId
const victimRecordId = 'record-2' as RecordId
const issueId = 'issue-1' as IssueId
const mergedIssueId = 'issue-2' as IssueId
const evidenceToken = 'evidence-1' as EvidenceToken

const scope: ScopeKey = { tier: 'test', key: 'checkout' }
const anchor: Anchor = { t: 'el', role: 'button', name: 'Submit' }
const distilledEvidenceRef: ArtifactRef = { id: 'screen-summary', sha: 'a'.repeat(64) }

const precondition: CompareAndSet = {
  recordId,
  observedStatus: 'active',
  observedOrdinal: 3,
}

const envelope: DeltaEnvelope = {
  origin: 'agent',
  scope,
  citedIds: [recordId],
  precondition: [precondition],
}

const bundle: BundleDraft = {
  kind: 'fact',
  subtype: 'behavioral',
  anchors: [anchor],
  scope,
  summary: 'Checkout submit is disabled until the card form validates.',
  body: 'The submit button remains disabled while the card number is incomplete.',
  distilledEvidenceRef,
  originStage: 'curation' as BundleDraft['originStage'],
}

// @ts-expect-error proposal bundles omit trust; deterministic code disposes trust later.
bundle.trust = 0.5

const addDelta: Delta = {
  ...envelope,
  kind: 'Add',
  bundle,
}

const confirmDelta: Delta = {
  ...envelope,
  kind: 'Confirm',
  targetId: recordId,
  evidenceToken,
}

const supersedeDelta: Delta = {
  ...envelope,
  kind: 'Supersede',
  victimId: victimRecordId,
  newBundle: bundle,
  evidenceToken,
}

const fileIssue: IssueDelta = {
  ...envelope,
  kind: 'FileIssue',
  class: 'app_bug',
  severity: 'S4',
  prose: 'The submit button remains disabled after valid card details are entered.',
  anchors: [anchor],
}

const mergeIssue: IssueDelta = {
  ...envelope,
  kind: 'Merge',
  survivorId: issueId,
  victimId: mergedIssueId,
}

const delta: Delta = confirmDelta

// @ts-expect-error proposal deltas omit status; deterministic code disposes status later.
delta.status = 'confirmed'

expectTypeOf<Extract<Delta, { kind: 'FileIssue' }>>().toEqualTypeOf<never>()
expectTypeOf<Extract<IssueDelta, { kind: 'Add' }>>().toEqualTypeOf<never>()

const acceptIssueDelta = (_: IssueDelta) => {}

// @ts-expect-error Add belongs to Delta, not the authored-shelf IssueDelta vocabulary.
acceptIssueDelta(addDelta)

const acceptIssueId = (_: IssueId) => {}

// @ts-expect-error RecordId and IssueId are distinct state-machine brands.
acceptIssueId(recordId)

const acceptBundleKind = (_: BundleKind) => {}

acceptBundleKind('procedure')

// @ts-expect-error BundleKind is closed; arbitrary strings cannot enter bundle identity.
acceptBundleKind('observed-flow')

expectTypeOf<BundleDraft['subtype']>().toEqualTypeOf<FactSubtype | undefined>()

// This proof file intentionally covers only proposal types; ServedBrief read-back fields stay in 314-05.
type ProposalKeys = keyof BundleDraft | keyof Delta | keyof IssueDelta
expectTypeOf<Extract<ProposalKeys, 'trust' | 'status'>>().toEqualTypeOf<never>()

void addDelta
void confirmDelta
void supersedeDelta
void fileIssue
void mergeIssue
