declare const recordIdBrand: unique symbol
declare const evidenceTokenBrand: unique symbol

export type RecordId = string & { readonly [recordIdBrand]: 'RecordId' }
export type EvidenceToken = string & { readonly [evidenceTokenBrand]: 'EvidenceToken' }

export const asRecordId = (value: string): RecordId => value as RecordId
export const asEvidenceToken = (value: string): EvidenceToken => value as EvidenceToken
