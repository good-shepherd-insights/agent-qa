import { sha256hex } from '../determinism/sha256'
import type { Anchor } from '../identity/anchor'
import type {
  BriefLine,
  CautionLine,
  LosslessServedBriefProofV1,
  ReadTrace,
  ServedAdmissionEvent,
  ServedBrief,
  ServedPromptTurn,
} from './served-brief'

const FIELD = '\x1f'
const RECORD = '\x01'

function text(value: string): string {
  return `${value.length}:${value}`
}

function numberValue(value: number): string {
  return String(value)
}

function booleanValue(value: boolean): string {
  return value ? '1' : '0'
}

function optionalNumber(value: number | undefined): string {
  return value === undefined ? '0' : `1${FIELD}${numberValue(value)}`
}

function record(tag: string, fields: string[]): string {
  return [tag, ...fields].join(FIELD)
}

function arrayValue(values: string[]): string {
  return [numberValue(values.length), ...values].join(FIELD)
}

function v2Scalar(value: string | number | boolean): string {
  if (typeof value === 'boolean') return text(booleanValue(value))
  return text(String(value))
}

function v2Array(values: string[]): string {
  return [v2Scalar(values.length), ...values.map(text)].join('')
}

function v2Record(tag: string, fields: string[]): string {
  return `${v2Scalar(tag)}${v2Array(fields)}`
}

function v2OptionalNumber(value: number | undefined): string {
  return v2Record(
    'optional-number',
    value === undefined ? [v2Scalar(false)] : [v2Scalar(true), v2Scalar(value)],
  )
}

function serializeScope(scope: ServedBrief['scope']): string {
  return record('scope', [
    text(scope.tier),
    text(scope.key),
  ])
}

function serializeScopeV2(scope: ServedBrief['scope']): string {
  return v2Record('scope', [v2Scalar(scope.tier), v2Scalar(scope.key)])
}

function serializeAnchor(anchor: Anchor): string {
  switch (anchor.t) {
    case 'page':
      return record('anchor:page', [
        text(anchor.route),
      ])
    case 'flow':
      return record('anchor:flow', [
        text(anchor.name),
      ])
    case 'el':
      return record('anchor:el', [
        text(anchor.role),
        text(anchor.name),
        optionalNumber(anchor.ordinal),
      ])
    case 'platform':
      return record('anchor:platform', [
        text(anchor.platform),
      ])
    case 'selector':
      return record('anchor:selector', [
        text(anchor.literal),
      ])
    case 'error':
      return record('anchor:error', [
        text(anchor.message),
      ])
  }
}

function serializeAnchorV2(anchor: Anchor): string {
  switch (anchor.t) {
    case 'page':
      return v2Record('anchor:page', [v2Scalar(anchor.route)])
    case 'flow':
      return v2Record('anchor:flow', [v2Scalar(anchor.name)])
    case 'el':
      return v2Record('anchor:el', [
        v2Scalar(anchor.role),
        v2Scalar(anchor.name),
        v2OptionalNumber(anchor.ordinal),
      ])
    case 'platform':
      return v2Record('anchor:platform', [v2Scalar(anchor.platform)])
    case 'selector':
      return v2Record('anchor:selector', [v2Scalar(anchor.literal)])
    case 'error':
      return v2Record('anchor:error', [v2Scalar(anchor.message)])
  }
}

function serializeBriefLine(line: BriefLine): string {
  return record('brief-line', [
    text(line.id),
    text(line.kind),
    text(line.summary),
    numberValue(line.trust),
    text(line.status),
    booleanValue(line.servedAsCanary),
    text(line.tier),
  ])
}

function serializeBriefLineV2(line: BriefLine): string {
  return v2Record('brief-line', [
    v2Scalar(line.id),
    v2Scalar(line.kind),
    v2Scalar(line.summary),
    v2Scalar(line.trust),
    v2Scalar(line.status),
    v2Scalar(line.servedAsCanary),
    v2Scalar(line.tier),
  ])
}

function serializeReadTrace(trace: ReadTrace): string {
  return record('read-trace', [
    text(trace.id),
    text(trace.detailLevel),
    text(trace.bodyDigest),
  ])
}

function serializeReadTraceV2(trace: ReadTrace): string {
  return v2Record('read-trace', [
    v2Scalar(trace.id),
    v2Scalar(trace.detailLevel),
    v2Scalar(trace.bodyDigest),
  ])
}

function serializeCautionLine(line: CautionLine): string {
  return record('caution-line', [
    text(line.id),
    arrayValue(line.anchors.map(serializeAnchor)),
    text(line.summary),
  ])
}

function serializeCautionLineV2(line: CautionLine): string {
  return v2Record('caution-line', [
    v2Scalar(line.id),
    v2Array(line.anchors.map(serializeAnchorV2)),
    v2Scalar(line.summary),
  ])
}

function serializeAdmissionEventV2(event: ServedAdmissionEvent): string {
  return v2Record('admission-event', [
    v2Scalar(event.ordinal),
    v2Scalar(event.turnOrdinal),
    v2Scalar(event.surface),
    v2Scalar(event.id),
    v2Scalar(event.sourceId),
    v2Scalar(event.clusterKey),
    v2Scalar(event.renderedCost),
    v2Scalar(event.chargeRepeated),
  ])
}

function serializePromptTurnV2(turn: ServedPromptTurn): string {
  return v2Record('prompt-turn', [
    v2Scalar(turn.ordinal),
    v2Scalar(turn.turnOrdinal),
    v2Scalar(turn.runDate),
    v2Scalar(turn.policyL0),
    v2Scalar(turn.learnedL1),
    v2Scalar(turn.learnedL2),
    v2Scalar(turn.contextTier),
    v2Scalar(turn.volatileTier),
    v2Scalar(turn.policyDigest),
    v2Scalar(turn.contextTierDigest),
    v2Scalar(turn.volatileTierDigest),
  ])
}

function serializeProofV2(proof: LosslessServedBriefProofV1): string {
  return v2Record('lossless-proof', [
    v2Scalar(proof.schemaVersion),
    v2Scalar(proof.completeness),
    v2Scalar(proof.recordCap),
    v2Scalar(proof.combinedBudget),
    v2Array(proof.admissionEvents.map(serializeAdmissionEventV2)),
    v2Array(proof.promptTurns.map(serializePromptTurnV2)),
  ])
}

function canonicalServedBriefV1(brief: ServedBrief): string {
  return [
    'served-brief:v1',
    serializeScope(brief.scope),
    numberValue(brief.asOfBuild),
    numberValue(brief.budget),
    text(brief.truncation),
    arrayValue(brief.channel1.map(serializeBriefLine)),
    arrayValue(brief.channel2.map(serializeReadTrace)),
    arrayValue(brief.channel3.map(serializeCautionLine)),
  ].join(RECORD)
}

function canonicalServedBriefV2(
  brief: ServedBrief & { proof: LosslessServedBriefProofV1 },
): string {
  return v2Record('served-brief:v2', [
    serializeScopeV2(brief.scope),
    v2Scalar(brief.asOfBuild),
    v2Scalar(brief.budget),
    v2Scalar(brief.truncation),
    v2Array(brief.channel1.map(serializeBriefLineV2)),
    v2Array(brief.channel2.map(serializeReadTraceV2)),
    v2Array(brief.channel3.map(serializeCautionLineV2)),
    serializeProofV2(brief.proof),
  ])
}

export function computeBriefDigest(brief: ServedBrief): string {
  return sha256hex(
    brief.proof === undefined
      ? canonicalServedBriefV1(brief)
      : canonicalServedBriefV2(
          brief as ServedBrief & { proof: LosslessServedBriefProofV1 },
        ),
  )
}
