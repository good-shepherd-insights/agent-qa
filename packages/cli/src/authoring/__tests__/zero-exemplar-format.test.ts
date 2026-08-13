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
  DraftStageOutcome,
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

/**
 * The one sentence that makes a fifth key emittable (394-33, WR-06).
 *
 * The generator emits `context` if and only if it reads this rule off the block. It is not a
 * literal this file decided to write: with the shipping block — which says four keys and that no
 * other key is accepted — nothing below emits one, and the reachability cell reds. That is the
 * whole instrument, and it is why the rule is matched rather than the key name: a block merely
 * MENTIONING `context` (in a rejection sentence, say) must not be read as permission.
 */
const CONTEXT_OPTIONAL_RULE = /^`context` is optional:/m

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

  const document = example
    .replace(/^name: .*$/m, () => `name: ${intent}`)
    .replace(/^target: .*$/m, () => `target: ${scope.slice(scope.indexOf(':') + 1)}`)

  // A FIFTH KEY, EMITTED ONLY BECAUSE THE BLOCK TAUGHT IT. The value is derived from the Intent
  // block rather than spelled here, so a generator that ignored the prompt entirely could not
  // produce it either.
  if (!CONTEXT_OPTIONAL_RULE.test(format)) return document
  return document.replace(
    /^target: .*$/m,
    (line) => `${line}\ncontext: Standing background for this test — ${intent}`,
  )
}

/** Reaching stage 4 is the proof stage 3 staged real bytes; there is nothing here to verify with. */
const VERIFY_REACHED = 'the draft reached stage 4'

/**
 * One whole invocation of the loop against the SHIPPED shelf, and everything it produced.
 *
 * Shared by every cell below rather than retyped per case: the arrangement — a zero-exemplar
 * brief, a schema-blind generator, the real `createDraftAuthoringPort` as the shelf — is the
 * CONDITION under test, and two spellings of it would let one cell measure a setup the other
 * does not have.
 */
async function driveZeroExemplarLoop(): Promise<{
  readonly authoring: ReturnType<typeof createDraftAuthoringPort>
  readonly failure: Error | undefined
  readonly compileRequests: readonly JobModelRequest[]
  readonly staged: readonly DraftStageOutcome[]
  readonly verified: readonly string[]
}> {
  const authoring = createDraftAuthoringPort(configPath)
  const compileRequests: JobModelRequest[] = []
  const staged: DraftStageOutcome[] = []
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
    // survived it, so an `unparsable` arm here is a fact about the real parser — and the outcome
    // is RECORDED, so a cell can read the `ParsedDraftLike` the real parser produced rather than
    // re-deriving one of its own.
    write: async (contents: string) => {
      const outcome = await authoring.stageDraft(contents)
      staged.push(outcome)
      return outcome
    },
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

  return { authoring, failure, compileRequests, staged, verified }
}

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
    const { authoring, failure, compileRequests, verified } = await driveZeroExemplarLoop()

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

  it('reaches ParsedDraftLike.context from stage 3 — the root the gate scans (WR-06)', async () => {
    // THE CLAIM, AND WHY IT IS MADE HERE. `ParsedDraftLike.context` was widened into the shape in
    // 394-15 so `screenDraftForCredentials` could scan it, and nothing on the compile path had
    // ever populated it: the format block told stage 3 that four keys were all a document may
    // carry. This cell is that root's first end-to-end reachability proof, and it is a fact about
    // the SHIPPED parser — `agent-local`'s shelf is a fake that reads `name` and `steps` and would
    // have answered `staged` for a document whose `context` it never looked at (WINDOWS 116).
    const { failure, staged, verified, authoring } = await driveZeroExemplarLoop()

    expect(failure?.message).toBe(VERIFY_REACHED)

    // ① the compile prompt is what taught it — the rule is present in the block a model reads.
    const [staging] = staged
    expect(staging?.kind).toBe('staged')
    if (staging === undefined || staging.kind !== 'staged') return

    // ② the value survived `parseTestFile` into the field the credential gate scans, on the way
    // OUT of the shelf's own staging verb.
    expect(staging.draft.context).toContain(INTENT)

    // ③ and it is on disk, so a later read — the repair loop's, an accept's — finds it too.
    const parsed = await authoring.parseDraft(verified[0] as string)
    expect(parsed.kind).toBe('parsed')
    if (parsed.kind !== 'parsed') return
    expect(parsed.draft.context).toBe(staging.draft.context)
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
