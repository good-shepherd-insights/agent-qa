import type { IssueId } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import type { Verdict } from '../verdict/verdict'
import type { DeltaEnvelope } from './envelope'

type FileIssue = DeltaEnvelope & {
  kind: 'FileIssue'
  class: Verdict['class']
  severity: 'S1' | 'S2' | 'S3' | 'S4'
  prose: string
  anchors: Anchor[]
}

type RecordOccurrence = DeltaEnvelope & {
  kind: 'RecordOccurrence'
  targetIssueId: IssueId
}

type Reopen = DeltaEnvelope & {
  kind: 'Reopen'
  targetIssueId: IssueId
}

type ProposeResolve = DeltaEnvelope & {
  kind: 'ProposeResolve'
  targetIssueId: IssueId
}

type Merge = DeltaEnvelope & {
  kind: 'Merge'
  survivorId: IssueId
  victimId: IssueId
}

type Noop = DeltaEnvelope & {
  kind: 'Noop'
}

export type IssueDelta = FileIssue | RecordOccurrence | Reopen | ProposeResolve | Merge | Noop
