import { sha256hex } from '../determinism/sha256'
import type { Anchor } from '../identity/anchor'
import type { BriefLine, CautionLine, ReadTrace, ServedBrief } from './served-brief'

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

function serializeScope(scope: ServedBrief['scope']): string {
  return record('scope', [
    text(scope.tier),
    text(scope.key),
  ])
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

function serializeReadTrace(trace: ReadTrace): string {
  return record('read-trace', [
    text(trace.id),
    text(trace.detailLevel),
    text(trace.bodyDigest),
  ])
}

function serializeCautionLine(line: CautionLine): string {
  return record('caution-line', [
    text(line.id),
    arrayValue(line.anchors.map(serializeAnchor)),
    text(line.summary),
  ])
}

function canonicalServedBrief(brief: ServedBrief): string {
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

export function computeBriefDigest(brief: ServedBrief): string {
  return sha256hex(canonicalServedBrief(brief))
}
