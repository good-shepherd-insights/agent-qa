// THE SHARED LIVE PREVIEW (428 D-02/D-14 · PXH-LIVE-01). Skeleton for the RED cells.

import type { ReactNode } from 'react'

import type { MemberRow } from '@/lib/run-stream-reducer'

export interface LivePreviewRunSubject {
  kind: 'run'
  runId: string
  handles: readonly number[] | undefined
  membersByHandle: Readonly<Record<number, MemberRow>>
  terminal: boolean
  runOver: boolean
}

export interface LivePreviewEditorSubject {
  kind: 'editor'
  sessionId: string
  sessionGone: boolean
  onStartFresh: () => void
}

export type LivePreviewSubject = LivePreviewRunSubject | LivePreviewEditorSubject

export interface LivePreviewProps {
  subject: LivePreviewSubject
  chrome?: ReactNode
}

export function LivePreview({ subject }: LivePreviewProps) {
  return <section data-live-preview data-preview-subject={subject.kind} />
}
