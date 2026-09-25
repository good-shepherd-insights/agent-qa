// THE LIVE VIEW'S CLOSED SETS AND THE EDITOR-SUBJECT REGISTRY (428 D-07/D-09/D-14).
//
// The type half of each closed set is pinned in the sibling `.test-d.ts`; these are the runtime
// halves, so a reordered or padded array is caught even where the types still agree.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LiveStreamDeclaration } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { createLiveEditorSubjects } from '../live-view/editor-subjects.js'
import type { LiveEditorAttachment } from '../live-view/editor-subjects.js'
import { LIVE_VIEW_END_REASONS, LIVE_VIEW_REFUSAL_REASONS } from '../live-view/protocol.js'

describe('the live view closed sets (428)', () => {
  it('C428-REFUSAL-REASONS-EXACT: the refusal vocabulary gains unknown_session and nothing else', () => {
    expect(LIVE_VIEW_REFUSAL_REASONS).toContain('unknown_session')
    expect([...LIVE_VIEW_REFUSAL_REASONS]).toEqual([
      'malformed',
      'bad_signature',
      'expired',
      'scope_mismatch',
      'unknown_run',
      'unknown_handle',
      'unknown_session',
    ])
  })

  it('C428-END-REASONS-EXACT: every end has its own name, and there are three', () => {
    expect([...LIVE_VIEW_END_REASONS]).toEqual(['runFinished', 'handleFinished', 'sessionEnded'])
  })
})

describe('EDITOR-SUBJECTS-REGISTRY (428 D-07)', () => {
  const attachmentDeclaring = (stream: LiveStreamDeclaration): {
    attachment: LiveEditorAttachment
    asked: number[]
  } => {
    const asked: number[] = []
    return {
      asked,
      attachment: {
        streamCapabilityOf: (handle) => {
          asked.push(handle)
          return stream
        },
        subscribeFrames: () => undefined,
        ended: new Promise<void>(() => {}),
      },
    }
  }

  it('register then attach returns the attachment; capabilityOf reads its handle 0; unregister forgets both', () => {
    const subjects = createLiveEditorSubjects()
    const { attachment, asked } = attachmentDeclaring({ kind: 'cdp-screencast' })

    subjects.register('session-a', attachment)
    expect(subjects.attach('session-a'), 'the registered attachment, not a copy').toBe(attachment)
    expect(subjects.capabilityOf('session-a')).toEqual({ kind: 'cdp-screencast' })
    expect(asked, 'the capability is the attachment\'s own answer for handle 0').toEqual([0])
    expect(subjects.attach('session-b'), 'keyed by session id alone').toBeUndefined()
    expect(subjects.capabilityOf('session-b')).toBeUndefined()

    subjects.unregister('session-a')
    expect(subjects.attach('session-a')).toBeUndefined()
    expect(subjects.capabilityOf('session-a')).toBeUndefined()
  })

  it('each registry is its own map, and the module holds no run registry', () => {
    const one = createLiveEditorSubjects()
    const two = createLiveEditorSubjects()
    const { attachment } = attachmentDeclaring({ kind: 'none' })
    one.register('session-a', attachment)
    expect(two.attach('session-a'), 'no process-wide state behind the factory').toBeUndefined()
    expect(createLiveEditorSubjects.length, 'the factory is handed nothing to consult').toBe(0)

    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '..', 'live-view', 'editor-subjects.ts'), 'utf8')
    const imports = source.match(/^import[\s\S]*?from '([^']+)'/gmu) ?? []
    expect(imports.length, 'the witness: the scan found the module\'s imports').toBeGreaterThan(0)
    for (const statement of imports) {
      expect(statement, 'only types, and only from the schema').toMatch(
        /^import type [\s\S]*from '@vostride\/agent-qa-schema'$/u,
      )
    }
  })
})
