declare const recordIdBrand: unique symbol
declare const issueIdBrand: unique symbol
declare const evidenceTokenBrand: unique symbol

export type RecordId = string & { readonly [recordIdBrand]: 'RecordId' }
export type IssueId = string & { readonly [issueIdBrand]: 'IssueId' }
export type EvidenceToken = string & { readonly [evidenceTokenBrand]: 'EvidenceToken' }

export const asRecordId = (value: string): RecordId => value as RecordId
export const asIssueId = (value: string): IssueId => value as IssueId
export const asEvidenceToken = (value: string): EvidenceToken => value as EvidenceToken
