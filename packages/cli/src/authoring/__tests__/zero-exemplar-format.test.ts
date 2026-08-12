// The stable-tier format block, staged through the REAL parser (394-27, WINDOWS 111 · WTST-01).
//
// WHY THIS FILE IS IN `packages/cli`, and why the sibling cell in `agent-local` is not enough.
// `authoring-loop.e2e.test.ts` reaches the composed op, the real registry and the real gates — but
// its `DraftAuthoringPort` is a FAKE that accepts any document carrying `name` and `steps`, because
// `parseTestFile` lives in `@vostride/agent-qa-core` and the FUNC-02 firewall forbids `agent` and
// `agent-local` from naming it. WINDOWS 111 is a defect about `test-id` and `target` — the two keys
// that fake does not look at — so a parsability claim made there is a claim about the fake.
// `createDraftAuthoringPort` is the shipped shelf and it parses through `parseTestFile`; this is the
// only process where the loop and that parser can be in the same room.
//
// PRODUCED, NEVER ASSERTED. Nothing below spells a document. The generator is handed the request
// `compileDraft` actually built, lifts the canonical example out of the stable block by title, and
// returns it — so an example that drifted from what `parseTestFile` accepts reds here rather than
// teaching every model a schema the shelf refuses (T-394-99).

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runAuthoringLoop } from '@vostride/agent-qa-agent'
import type {
  AuthoringReadPortLike,
  DraftShelfPortLike,
  JobModelRequest,
} from '@vostride/agent-qa-agent'
import type { AuthoringBrief, ScopeKey } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDraftAuthoringPort } from '../../composition/local-agent-host.js'

const INTENT = 'Confirm the local account form shows its heading'
const SCOPE: ScopeKey = { tier: 'product', key: 'local-form' }
const SHELF_DIR = 'tests/.agent-qa-drafts'

/** The bootstrap condition itself: a fresh project, and therefore no memory at all. */
const ZERO_EXEMPLAR_BRIEF: AuthoringBrief = {
  exemplars: [],
  procedures: [],
  facts: [],
  cautions: [],
  coverage: {},
  truncation: 'none',
  admissions: [],
}

// The title and the marker as a MODEL reads them — literals, not imports. Importing the constants
// would give this generator a channel to the schema that a model does not have.
const FORMAT_BLOCK_TITLE = 'Test document format'
const FORMAT_EXAMPLE_MARKER = 'A complete document looks exactly like this:'

/** One `## `-titled block's body, off the rendered markdown a model is handed. */
function promptBlockBody(text: string, title: string): string | undefined {
  for (const part of text.split(/^## /m).slice(1)) {
    const split = part.indexOf('\n\n')
    if (part.slice(0, split) === title) return part.slice(split + 2).replace(/\n+$/, '')
  }
  return undefined
}

function documentFromPrompt(request: JobModelRequest): string {
  const format = promptBlockBody(request.system ?? '', FORMAT_BLOCK_TITLE)
  if (format === undefined || !format.includes(FORMAT_EXAMPLE_MARKER)) {
    throw new Error(`the prompt carries no usable "${FORMAT_BLOCK_TITLE}" block, and this `
      + 'generator knows no document schema of its own')
  }
  const marker = format.indexOf(FORMAT_EXAMPLE_MARKER)
  const example = `${format.slice(marker + FORMAT_EXAMPLE_MARKER.length).trim()}\n`
  const intent = promptBlockBody(request.prompt, 'Intent') ?? ''
  const scope = promptBlockBody(request.prompt, 'Scope') ?? ''

  return example
    .replace(/^name: .*$/m, `name: ${intent}`)
    .replace(/^target: .*$/m, `target: ${scope.slice(scope.indexOf(':') + 1)}`)
}

/** Reaching stage 4 is the proof stage 3 staged real bytes; there is nothing here to verify with. */
const VERIFY_REACHED = 'the draft reached stage 4'

let root: string
let configPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zero-exemplar-format-'))
  configPath = join(root, 'agent-qa.config.yaml')
  // The house config verbatim, on `authoring-draft-edit.e2e.test.ts`'s reason: the shelf and the
  // workspace resolution exist to satisfy THIS pattern, and a bespoke one measures a workspace
  // nobody has.
  writeFileSync(
    configPath,
    `workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local
`,
  )
  for (const name of ['hooks.yaml', '.env', '.env.secrets.local']) {
    writeFileSync(join(root, name), '')
  }
  mkdirSync(join(root, 'tests'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('a zero-exemplar scope compiles a document the SHIPPED parser accepts', () => {
  it('stages the prompt-taught example through the real shelf, and stage 4 is reached', async () => {
    const authoring = createDraftAuthoringPort(configPath)
    const compileRequests: JobModelRequest[] = []
    const verified: string[] = []

    const read: AuthoringReadPortLike = {
      getAuthoringBrief: () => Promise.resolve(ZERO_EXEMPLAR_BRIEF),
      suiteTextCorpus: () => Promise.resolve([]),
    }

    const shelf: DraftShelfPortLike = {
      model: () => Promise.resolve({
        modelId: 'fixture:zero-exemplar-format',
        generate(request: JobModelRequest) {
          // The refinement round asks about an existing draft and carries no format block; a
          // generator with nothing to add says so. The compile call is the one under test.
          if (!/^Agent context: authoring\.draft\.write — compile /.test(request.system ?? '')) {
            return Promise.resolve({ text: 'no changes needed' })
          }
          compileRequests.push(request)
          return Promise.resolve({ text: documentFromPrompt(request) })
        },
      }),
      // THE SHIPPED SHELF. `stageDraft` runs `parseTestFile` first and writes only bytes that
      // survived it, so an `unparsable` arm here is a fact about the real parser.
      write: (contents: string) => authoring.stageDraft(contents),
      runs: {
        start: () => { throw new Error('this cell starts no runs') },
        get: () => { throw new Error('this cell reads no runs') },
      },
      applyPatches: () => { throw new Error('this cell applies no patches') },
      verifyDraft: (input: { readonly draftPath: string }) => {
        verified.push(input.draftPath)
        throw new Error(VERIFY_REACHED)
      },
    } as unknown as DraftShelfPortLike

    const failure = await runAuthoringLoop({ intent: INTENT, scope: SCOPE }, { read, shelf })
      .then(() => undefined, (error: unknown) => error as Error)

    // NOT `AuthoringDraftUnparsableError` — which is exactly what the live model produced on 5/5
    // gate-allowed invocations, and what this generator produces when the block is absent.
    expect(failure?.message).toBe(VERIFY_REACHED)

    // The condition, produced rather than assumed: the exemplar block carried the empty answer, so
    // the only schema channel in that prompt was the stable block.
    expect(compileRequests[0]?.prompt).toContain('No exemplar tests were served for this scope.')

    // The bytes really are on the shelf, and the SHIPPED read path parses them back into the four
    // fields a receipt joins on.
    const staged = readdirSync(join(root, SHELF_DIR))
    expect(staged).toHaveLength(1)
    expect(verified).toEqual([`${SHELF_DIR}/${staged[0] as string}`])

    const parsed = await authoring.parseDraft(verified[0] as string)
    expect(parsed.kind).toBe('parsed')
    if (parsed.kind !== 'parsed') return
    expect(parsed.draft.testName).toBe(INTENT)
    // `test-id` is the key the live emission omitted; the shipped read path prefers an authored one
    // and falls back to the name, so a document that carried none would read back as the name.
    expect(parsed.draft.testId).not.toBe(parsed.draft.testName)
    expect(parsed.draft.testId).toMatch(/^t_/)
    expect(parsed.draft.steps.length).toBeGreaterThan(0)
  })

  it('refuses the same document with its test-id removed — so the cell above is not vacuous', async () => {
    // THE NON-VACUITY GUARD, and it is the whole reason this file exists. The `agent-local` fake
    // shelf accepts this document; the shipped one does not, and names the key.
    const authoring = createDraftAuthoringPort(configPath)

    const staged = await authoring.stageDraft(
      `name: ${INTENT}\ntarget: local-form\nsteps:\n  - Verify the page heading says "Local form"\n`,
    )

    expect(staged.kind).toBe('unparsable')
    if (staged.kind !== 'unparsable') return
    expect(staged.reason).toContain('test-id')
    // Nothing was written: the shelf directory does not exist at all.
    expect(readdirSync(join(root, 'tests'))).toEqual([])
  })
})
