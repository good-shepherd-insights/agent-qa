/**
 * Phase 377 D-01/D-02 contextual rendering (memory.md §5.3).
 *
 * The complete rendering is a derived-index projection only. Committed bundle bytes retain their
 * self-fields rendering and never depend on cross-bundle graph state.
 */
import type { DatabaseSync } from 'node:sqlite'

export function buildSituatingLine(_db: DatabaseSync, _recordRowid: number): string {
  throw new Error('buildSituatingLine is not implemented')
}

export function renderContextual(_selfFields: string, _situatingLine: string): string {
  throw new Error('renderContextual is not implemented')
}

export function computeRenderingDrift(_expected: string, _stored: string): boolean {
  throw new Error('computeRenderingDrift is not implemented')
}
