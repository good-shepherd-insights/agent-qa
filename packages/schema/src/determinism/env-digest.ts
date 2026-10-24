import { sha256hex } from './sha256'

export interface RedactedEnvVar {
  name: string
  present: boolean
  kind: string
  lengthBucket?: number
}

function text(input: string): string {
  return `${input.length}:${input}`
}

function numberText(input: number): string {
  return String(input)
}

function booleanText(input: boolean): string {
  return input ? '1' : '0'
}

function compareEnvVar(left: RedactedEnvVar, right: RedactedEnvVar): number {
  if (left.name !== right.name) {
    return left.name < right.name ? -1 : 1
  }

  if (left.present !== right.present) {
    return left.present ? 1 : -1
  }

  if (left.kind !== right.kind) {
    return left.kind < right.kind ? -1 : 1
  }

  const leftBucket = left.lengthBucket ?? -1
  const rightBucket = right.lengthBucket ?? -1
  return leftBucket - rightBucket
}

function envRecord(input: RedactedEnvVar): string {
  return [
    text(input.name),
    booleanText(input.present),
    text(input.kind),
    input.lengthBucket === undefined ? '' : numberText(input.lengthBucket),
  ].join('')
}

export function relevantEnvDigest(vars: readonly RedactedEnvVar[], salt: string): string {
  const body = [...vars].sort(compareEnvVar).map(envRecord).join('')
  return sha256hex(`${text(salt)}${body}`)
}
