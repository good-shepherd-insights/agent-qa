// A mark's test edit is exact-once across a crash inside the edit (quick 261002-mrk, closing
// 432-09 #4).
//
// `authoring.draft.edit` is one call: a model call, then a digest-guarded write of the edited test.
// The mark host checkpoints only after that call returns, so a crash between the write and the
// return left the file edited and the mark's intent without the edit. The retry then invoked the
// edit again against the already-edited file: a second model call and a second edit on top.
//
// These cells drive the REAL edit op over the REAL CLI shelf host (`createDraftAuthoringPort`, the
// final-test writer the composition binds), reached through `invokeFunction` exactly as the CLI's
// mark host reaches it. The only fault is injected at the shelf port: the real write runs, and the
// port then throws before the op can return.
//
// OBSERVED RED against agent-qa 76a72be76 (before the fix), 2026-10-02:
//
//   C-MRK-EDIT-ONCE      the model was asked once: expected 2 to be 1
//   C-MRK-EDIT-CHANGED   promise resolved "{ kind: 'marked', ... }" instead of rejecting
//                        (the retry edited again over a person's change)

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AUTHORING_DRAFT_EDIT_FUNCTION_ID,
  createFunctionRegistry,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import { generateTestId } from '@vostride/agent-qa-ids'
import {
  AuthoringDraftEditOutputSchema,
  type FunctionCaller,
  type TestEditPatchSet,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createDraftAuthoringPort } from '../composition/local-agent-host.js'
import { createFeedbackPortForHost } from '../gates/feedback-host.js'
import { files, markFixture } from '../gates/__tests__/feedback-fixture.js'

const CALLER: FunctionCaller = { surface: 'test', origin: 'human' }

const TEST_PATH = 'tests/mark-edit.yaml'
const TEST_NAME = 'Checkout with a coupon'
const COMMITTED = `name: ${TEST_NAME}
test-id: ${generateTestId()}
target: local-form
steps:
  - Open the cart
  - Apply the coupon FREESHIP
  - Verify the total is 0.00
`
const EMISSION = JSON.stringify({
  thoughts: 'the banner assertion belongs at the end',
  patches: [{ op: 'add', path: '/steps/3', value: 'Verify the coupon banner is visible' }],
})

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

/** A failed run whose member is a test bug, so the mark's fix is an edit of the member's own file. */
function testEditFixture() {
  const f = markFixture()
  roots.push(f.root)
  const member = f.handoff.tests[0]!
  member.steps[0]!.servedBrief.channel3 = []
  member.filePath = TEST_PATH
  member.testName = TEST_NAME
  member.rootCause = { class: 'test_bug', producer: 'deterministic-classifier', confidence: 1,
    evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Assertion drift' },
    memoryMisdirectionRuledOut: true, perTest: 0 }
  f.save()
  mkdirSync(join(f.root, 'tests'), { recursive: true })
  writeFileSync(join(f.root, TEST_PATH), COMMITTED)
  return f
}

/**
 * The edit op on a real registry over the CLI's own shelf host. `crashAfterWrite` makes the port
 * throw once AFTER the real write has landed, which is the window inside the op.
 */
function editHost(configPath: string, options: { crashAfterWrite: boolean }) {
  const authoring = createDraftAuthoringPort(configPath)
  let crash = options.crashAfterWrite
  const counts = { generations: 0, writes: 0 }
  const deps = {
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    draftShelf: {
      model: () => Promise.resolve({
        modelId: 'fixture:mark-edit-once',
        generate: () => {
          counts.generations += 1
          return Promise.resolve({ text: EMISSION })
        },
      }),
      write: (contents: string) => authoring.stageDraft(contents),
      applyPatches: (draft: { readonly filePath: string }, patchSet: TestEditPatchSet) =>
        authoring.applyPatchesToDraft(draft as never, patchSet),
      runs: {
        start: () => { throw new Error('an edit starts no run') },
        get: () => { throw new Error('an edit reads no run') },
      },
      verifyDraft: () => { throw new Error('an edit re-runs no gates') },
      publish: async (request: Parameters<typeof authoring.publishDraft>[0]) => {
        const written = await authoring.publishDraft(request)
        if (written.kind === 'written') counts.writes += 1
        if (crash) {
          crash = false
          throw new Error('injected crash between the edit write and its return')
        }
        return written
      },
    },
    draftEvaluation: {
      resolveDraft: (path: string) => authoring.parseDraft(path),
      openEvaluation: () => Promise.reject(new Error('an edit opens no evaluation')),
    },
  } as unknown as FunctionDeps
  const registry = createFunctionRegistry({ deps, auditSink: { appendGuardrailAudit() {} } })
  return {
    counts,
    invokeAuthoringDraftEdit: async (draftInput: unknown) => AuthoringDraftEditOutputSchema.parse(
      await invokeFunction(registry, AUTHORING_DRAFT_EDIT_FUNCTION_ID, draftInput, CALLER),
    ),
  }
}

describe('a mark retried after a crash inside its authoring edit (432-09 #4)', () => {
  it('C-MRK-EDIT-ONCE: answers the recorded write without a second model call or a second edit', async () => {
    const f = testEditFixture()
    const target = join(f.root, TEST_PATH)
    const host = editHost(f.configPath, { crashAfterWrite: true })
    const port = () => createFeedbackPortForHost({ ...f.deps, invokeAuthoringDraftEdit: host.invokeAuthoringDraftEdit })

    await expect(port().mark({ runId: f.handoff.runId, kind: 'false-fail' }))
      .rejects.toThrow('injected crash between the edit write and its return')
    const edited = readFileSync(target, 'utf8')
    expect(edited, 'the first attempt wrote the edit').not.toBe(COMMITTED)
    expect(existsSync(join(f.runDir, 'marks.jsonl')), 'no receipt before the retry').toBe(false)

    const result = await port().mark({ runId: f.handoff.runId, kind: 'false-fail' })

    expect(host.counts.generations, 'the model was asked once').toBe(1)
    expect(host.counts.writes, 'the file was written once').toBe(1)
    expect(readFileSync(target, 'utf8'), 'no second edit over the edited file').toBe(edited)
    expect(edited.match(/Verify the coupon banner is visible/g)).toHaveLength(1)
    expect(result).toMatchObject({ kind: 'marked', receipt: { ordinal: 1, disposition: { kind: 'applied',
      fix: 'test-edit', change: { kind: 'test-file', filePath: TEST_PATH, contentDigest: sha256(edited) } } } })
    expect(files(f.runDir).filter(path => path.includes('mark-edit')), 'the edit record is cleared with the receipt')
      .toEqual([])
    expect(await port().mark({ runId: f.handoff.runId, kind: 'false-fail' }))
      .toMatchObject({ kind: 'already-marked' })
    expect(host.counts.generations).toBe(1)
  })

  it('C-MRK-EDIT-CHANGED: refuses rather than edits again when the recorded file changed after the crash', async () => {
    const f = testEditFixture()
    const target = join(f.root, TEST_PATH)
    const host = editHost(f.configPath, { crashAfterWrite: true })
    const port = () => createFeedbackPortForHost({ ...f.deps, invokeAuthoringDraftEdit: host.invokeAuthoringDraftEdit })
    await expect(port().mark({ runId: f.handoff.runId, kind: 'false-fail' })).rejects.toThrow('injected crash')
    const changed = `${readFileSync(target, 'utf8')}  - A step a person added by hand\n`
    writeFileSync(target, changed)

    await expect(port().mark({ runId: f.handoff.runId, kind: 'false-fail' })).rejects.toThrow('target-changed')

    expect(host.counts.generations, 'no second model call').toBe(1)
    expect(readFileSync(target, 'utf8'), 'the person\'s bytes are left as they are').toBe(changed)
    expect(existsSync(join(f.runDir, 'marks.jsonl'))).toBe(false)
  })

  it('C-MRK-EDIT-UNSCOPED: an edit outside a mark records nothing', async () => {
    const f = testEditFixture()
    const host = editHost(f.configPath, { crashAfterWrite: false })
    const answer = await host.invokeAuthoringDraftEdit({ testRef: `${TEST_PATH}::${TEST_NAME}`, intent: 'add a banner check' })
    expect(answer.written).toMatchObject({ kind: 'written', filePath: TEST_PATH })
    expect(files(f.agentQaRoot).filter(path => path.includes('mark-edit'))).toEqual([])
  })
})
