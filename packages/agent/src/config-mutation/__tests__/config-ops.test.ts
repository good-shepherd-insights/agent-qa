// The closed action class, one describe per action (Phase 395-05, D-01/D-02/D-11 · CFGM-01).
//
// WHAT IS REAL HERE AND WHAT IS A DOUBLE. The OPS are real and are driven through `invoke` with
// composed deps — never through a hand-built proposal literal, because a literal proposal is a
// fixture asserting that somebody typed it correctly. The diff primitive, the classifier and the
// construction scan are production's. The three doubles are the host facts this package may not
// touch: bytes on disk, the yaml edit, and the store.
//
// THE YAML DOUBLE USES THE REAL `yaml` LIBRARY, WITH THE SHIPPED PORT'S CALLS. 395-04's blocked
// suite could get away with a line-level fake because `config.field.set` addresses one leaf; four of
// the five ops here write a MAP or append to a SEQUENCE and three of them ask the document what it
// already holds, and a hand-rolled stand-in for `setIn`/`getIn` would be a second implementation
// whose agreement with production is the thing in question. `yaml` is a devDependency of this
// package (the ownership contract pins RUNTIME dependencies), so the double calls what the port
// calls. The remaining risk — that the double and the port diverge anyway — is closed on the other
// side, in `cli`'s `config-ops-composed.test.ts`, which drives the REAL ports over a real file.
//
// WHAT MAKES EACH CELL RED, per op, because four near-identical ops invite four near-identical
// vacuous suites. The question answered for each describe is: which edge is NOT shared with the
// other three?
//
//   config.field.set     — shared baseline only. Its own edges are 395-04's file.
//   config.target.create — THE COLLISION. `setIn` at an occupied path replaces it; a create that
//                          merged or overwrote is the implementation this describe reds on, and no
//                          other op has a collision posture to red on.
//   config.target.edit   — THE NOT-FOUND, and the FIXED-PATH classifier pair: one path, two values,
//                          two different answers. A classifier ranged over paths passes every other
//                          op's cells and fails this one.
//   config.auth.set      — THE INPUT REFUSAL (D-11) and the ZERO STORE DELTA. Its sibling
//                          `config.field.set` FILES a blocked record for a secret; this op files
//                          nothing, so a pipeline that treated the two the same fails here and
//                          nowhere else.
//   config.hook.add      — A SECOND FILE. It writes the hooks file and not the config yaml, so a
//                          pipeline that validated, diffed or scanned "the config" fails here while
//                          passing every other describe.

import { isSecretAdjacentConfigField, utf8Decode, utf8Encode } from '@vostride/agent-qa-schema'
import type {
  ConfigProposalV1,
  ConfigProposeOutput,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import type { MaskingSeedSources } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'
import { Document as YamlDocument, isMap, isScalar, isSeq, parseDocument } from 'yaml'

import { invokeFunction } from '../../functions/invoke.js'
import { createFunctionRegistry } from '../../functions/registry.js'
import type { FunctionDeps } from '../../functions/spec.js'
import { configFieldSetSummaryLine } from '../construct.js'
import type { ConfigPathFacts, ConfigStructuredValue } from '../ports.js'

const CONFIG_FILE = 'agent-qa.config.yaml'
const HOOKS_FILE = 'hooks.yaml'

/** The id the double mints, so a cell can assert the pipeline used the PORT rather than a format. */
const MINTED_HOOK_ID = 'h_from-the-port-and-not-from-a-template'

/** The token the double validator refuses on. See {@link harness} — validation is MEASURED, not faked. */
// Lowercase deliberately: one of the variants below plants it in an npm package name, and npm
// package names are lowercase by the registry's own rule — an uppercase marker would have made
// that one variant silently valid, and the cell would have passed by measuring nothing.
const INVALID_MARKER = 'seeded-invalid'

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['config-write', 'read'],
  safeMode: false,
  origin: 'human',
}

/**
 * The house style, comment-dense, with one target already configured.
 *
 * THE COMMENTS ARE SUBJECTS, not decoration: CFGM-01's reviewable-diff spirit is measured by
 * asserting they survive a structured write, which is what a plain-object round trip destroys.
 */
const CONFIG = `# agent-qa Configuration

# File discovery and project settings
workspace:
  hooksFile: hooks.yaml
  envFile: .env

# Named resource definitions
registry:
  targets:
    # Optional: add more web or mobile targets here.
    shop:
      platform: web
      url: https://shop.example.com/cart

# How runs behave by default.
use:
  parallel: false
`

const HOOKS = `hooks:
  - id: h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper
    name: Fetch the first story
    runtime: node
    file: scripts/fetch.mjs
    timeout: 30s
    network: true
`

interface Filed {
  readonly kind: string
  readonly emittedBy: string
  readonly payload: ConfigProposalV1
}

interface Validated {
  readonly configFile: string
  readonly hooksFile: string
  readonly files: readonly { path: string; text?: string }[]
}

interface Harness {
  readonly deps: FunctionDeps
  readonly filed: Filed[]
  readonly validated: Validated[]
  scans: () => number
}

/**
 * The three host doubles, the REAL scan and the REAL yaml calls the shipped port makes.
 *
 * THE VALIDATOR IS NOT A CONSTANT `{ ok: true }`. It reads the candidate bytes it was handed and
 * refuses any member containing {@link INVALID_MARKER}, and it RECORDS what it was given. That turns
 * "validation ran" from a claim into a measurement with two independent halves: a variant seeded
 * with the marker must come back `schema-fail`, and the recorded call must contain the MUTATED bytes
 * of the file that op actually wrote — which is the half `config.hook.add` needs, because a
 * validator handed only the config yaml would return `ok` for a hooks file full of nonsense.
 */
function harness(options: {
  readonly config?: string
  readonly hooks?: string | undefined
  readonly seeds?: MaskingSeedSources
} = {}): Harness {
  const bytes = new Map<string, Uint8Array | undefined>([
    [CONFIG_FILE, utf8Encode(options.config ?? CONFIG)],
    [HOOKS_FILE, options.hooks === undefined ? undefined : utf8Encode(options.hooks)],
    ['.gitignore', utf8Encode('.agent-qa/\n')],
  ])
  const filed: Filed[] = []
  const validated: Validated[] = []
  let scanCount = 0

  const documentFor = (input?: Uint8Array): YamlDocument =>
    input === undefined ? new YamlDocument({}) : parseDocument(utf8Decode(input))

  const deps = {
    configFiles: {
      read: () => Promise.resolve({
        configFile: CONFIG_FILE,
        hooksFile: HOOKS_FILE,
        files: [...bytes].map(([path, content]) =>
          content === undefined ? { path } : { path, bytes: content }),
      }),
      // The shipped port's calls, not a re-derivation of them: `getIn(path, true)` for the node and
      // `setIn(path, value)` for the write, so a structured value and an append past a sequence's
      // end behave here exactly as they do against a real file.
      inspect: ({ bytes: input, paths }: { bytes?: Uint8Array; paths: readonly string[] }) => {
        const document = documentFor(input)
        return Promise.resolve(paths.map((path): ConfigPathFacts => {
          const node = document.getIn(path.split('.'), true)
          if (node === undefined || node === null) return { path, present: false }
          if (isSeq(node)) return { path, present: true, kind: 'sequence', length: node.items.length }
          if (isMap(node)) {
            return {
              path,
              present: true,
              kind: 'map',
              keys: node.items.map((item) => String(isScalar(item.key) ? item.key.value : item.key)),
            }
          }
          return { path, present: true, kind: 'scalar' }
        }))
      },
      setField: (
        { bytes: input, path, value }:
        { bytes?: Uint8Array; path: string; value: ConfigStructuredValue },
      ) => {
        const document = documentFor(input)
        const segments = path.split('.')
        const previous = document.getIn(segments) as unknown
        document.setIn(segments, value)
        const mutated = utf8Encode(document.toString())
        return Promise.resolve(
          typeof previous === 'string'
            || typeof previous === 'number'
            || typeof previous === 'boolean'
            ? { bytes: mutated, previousValue: previous }
            : { bytes: mutated },
        )
      },
      mintHookId: () => MINTED_HOOK_ID,
    },
    configValidate: {
      validate: (input: {
        configFile: string
        hooksFile: string
        files: readonly { path: string; bytes?: Uint8Array }[]
      }) => {
        validated.push({
          configFile: input.configFile,
          hooksFile: input.hooksFile,
          files: input.files.map((file) => ({
            path: file.path,
            ...(file.bytes === undefined ? {} : { text: utf8Decode(file.bytes) }),
          })),
        })
        const bad = input.files.filter((file) =>
          file.bytes !== undefined && utf8Decode(file.bytes).includes(INVALID_MARKER))
        return Promise.resolve(bad.length === 0
          ? { ok: true as const }
          // 395-10: PAIRS, not pre-joined strings. The pipeline joins them for the record — so the
          // cells' expected strings below are unchanged — and reads the path half into the blocked
          // record's `paths` (WR-11).
          : {
            ok: false as const,
            issues: bad.map((file) => ({ path: file.path, message: 'seeded invalid' })),
          })
      },
    },
    configProposals: {
      put: (record: { kind: string; emittedBy: string; payload: ConfigProposalV1 }) => {
        filed.push(record)
        return Promise.resolve({ proposalId: `prop-${filed.length}` })
      },
    },
    configScan: {
      scan: (parts: Parameters<typeof scanConstructedArtifact>[0]) => {
        scanCount += 1
        return scanConstructedArtifact(parts, options.seeds ?? {})
      },
    },
  } as unknown as FunctionDeps

  return { deps, filed, validated, scans: () => scanCount }
}

function registryFor(test: Harness) {
  return createFunctionRegistry({
    deps: test.deps,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
    confirm: { surface: 'tty-prompt', ask: () => true },
  })
}

async function call(
  test: Harness,
  id: string,
  input: unknown,
): Promise<ConfigProposeOutput> {
  return await invokeFunction(registryFor(test), id, input, CALLER) as ConfigProposeOutput
}

/** The applyable payload the store was handed, narrowed — never the value a cell constructed. */
function applyable(test: Harness) {
  const payload = test.filed[0]?.payload
  if (payload?.payloadKind !== 'applyable') throw new Error('expected an applyable payload')
  return payload
}

/** Every 8-character window of a value — a PARTIAL disclosure is the tempting middle ground. */
function windows(value: string): string[] {
  const out: string[] = []
  for (let index = 0; index + 8 <= value.length; index++) out.push(value.slice(index, index + 8))
  return out
}

/**
 * The CFGM-01 sentence, asserted the same way for every action.
 *
 * ONE HELPER RATHER THAN FIVE COPIES, so the shared claim reads identically and the per-op describes
 * contain only what is NOT shared. The claim: the proposal carries the unified diff of the committed
 * files, the receipts a later apply re-checks are present, and the envelope kind is `config`.
 */
function assertTheCfgm01Sentence(test: Harness, answer: ConfigProposeOutput, options: {
  readonly action: string
  readonly files: readonly string[]
}): void {
  expect(answer.outcome).toBe('proposed')
  if (answer.outcome !== 'proposed') throw new Error('unreachable')

  expect(test.filed).toHaveLength(1)
  expect(test.filed[0]?.kind).toBe('config')
  expect(test.filed[0]?.emittedBy).toBe(options.action)

  const payload = applyable(test)
  expect(payload.action).toBe(options.action)
  expect(payload.files.map((file) => file.path)).toEqual(options.files)
  // THE DIFF OF THE COMMITTED FILES, not a description of the change: the rendered text carries the
  // unified-diff framing, and it is the SAME text the answer returns to a surface.
  expect(answer.shownDiff).toContain(`--- a/${options.files[0]}`)
  expect(answer.shownDiff).toContain(`+++ b/${options.files[0]}`)
  expect(answer.shownDiff).toContain('@@')
  // THE RECEIPTS: the bytes and their digests, which is what CFGM-04's apply re-checks.
  expect(payload.shownDiffBase64.length).toBeGreaterThan(0)
  expect(payload.shownDiffDigest).toMatch(/^[0-9a-f]{64}$/)
  for (const file of payload.files) {
    expect(file.newContentBase64.length).toBeGreaterThan(0)
    if (file.changeKind === 'modify') expect(file.baseDigest).toMatch(/^[0-9a-f]{64}$/)
  }
  // VALIDATION RAN, over the candidate this op produced — see the harness header.
  expect(test.validated).toHaveLength(1)
}

describe('config.field.set — the shared baseline (395-01/04 own its own edges)', () => {
  it('carries the diff, the receipts and the config kind', async () => {
    const test = harness()
    const answer = await call(test, 'config.field.set', { path: 'use.parallel', value: true })
    assertTheCfgm01Sentence(test, answer, {
      action: 'config.field.set',
      files: [CONFIG_FILE],
    })
  })

  it('lands blocked schema-fail when the candidate does not validate', async () => {
    const test = harness()
    const answer = await call(
      test,
      'config.field.set',
      { path: 'use.llm', value: INVALID_MARKER },
    )
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(answer.validationIssues).toEqual([`${CONFIG_FILE}: seeded invalid`])
  })
})

describe('config.target.create — a create is never an upsert (CFGM-01 adjacency edge)', () => {
  it('carries the diff, the receipts and the config kind', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.create', {
      name: 'basket',
      platform: 'web',
      url: 'https://basket.example.com',
    })
    assertTheCfgm01Sentence(test, answer, {
      action: 'config.target.create',
      files: [CONFIG_FILE],
    })
  })

  it('lands blocked schema-fail when the candidate does not validate', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.create', {
      name: 'basket',
      platform: 'web',
      url: `https://basket.example.com/${INVALID_MARKER}`,
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(test.filed[0]?.payload.payloadKind).toBe('blocked')
  })

  it('THE EDGE: an existing name is a typed collision, and nothing is filed', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.create', {
      name: 'shop',
      platform: 'web',
      url: 'https://shop.evil.example',
    })

    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('target-exists')
    // It points at the op that DOES edit one, so the refusal ends the guessing rather than starting
    // a second round of it.
    expect(answer.detail).toContain('config.target.edit')
    expect(answer.candidates).toEqual(['shop'])
    // NO PROPOSAL, and no diff was ever rendered: this reds on a create that merged, that
    // overwrote, or that filed a blocked record for a request nobody needs to review.
    expect(test.filed).toHaveLength(0)
    expect(test.scans()).toBe(0)
  })

  it('writes the house-style block and leaves every existing comment standing', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.create', {
      name: 'basket',
      platform: 'web',
      url: 'https://basket.example.com',
    })
    if (answer.outcome !== 'proposed') throw new Error('unreachable')

    // THE ADDED LINES ARE THE WHOLE BLOCK AND NOTHING ELSE — a proposal that rewrote the file would
    // show the whole document as changed, which is the reviewability CFGM-01 is about.
    const added = answer.shownDiff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    expect(added).toEqual([
      '+    basket:',
      '+      platform: web',
      '+      url: https://basket.example.com',
    ])
    const removed = answer.shownDiff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---'))
    expect(removed).toEqual([])

    // AND THE COMMENTS SURVIVE, asserted against the candidate the store was handed rather than
    // against the diff — the diff only shows a window, and the claim is about the whole file.
    const content = utf8Decode(Uint8Array.from(
      Buffer.from(applyable(test).files[0]!.newContentBase64, 'base64'),
    ))
    expect(content).toContain('# agent-qa Configuration')
    expect(content).toContain('# Optional: add more web or mobile targets here.')
    expect(content).toContain('# How runs behave by default.')
  })

  it('a created target is a NEW ORIGIN, and binding an auth state is secret-adjacent too', async () => {
    const plain = harness()
    const first = await call(plain, 'config.target.create', {
      name: 'basket',
      platform: 'web',
      url: 'https://basket.example.com',
    })
    if (first.outcome !== 'proposed') throw new Error('unreachable')
    expect(first.crossBoundary).toBe(true)
    expect(first.crossBoundaryReasons).toEqual(['new-origin'])

    const bound = harness()
    const second = await call(bound, 'config.target.create', {
      name: 'basket',
      platform: 'web',
      url: 'https://basket.example.com',
      authStateName: 'basket-default',
    })
    if (second.outcome !== 'proposed') throw new Error('unreachable')
    // BOTH REASONS, in the pinned vocabulary's order rather than the order they were found.
    expect(second.crossBoundaryReasons).toEqual(['secret-adjacent-field', 'new-origin'])
  })
})

describe('config.target.edit — never guess, and decide from the VALUE (D-02/D-15)', () => {
  it('carries the diff, the receipts and the config kind', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.edit', {
      name: 'shop',
      changes: { url: 'https://shop.example.com/basket' },
    })
    assertTheCfgm01Sentence(test, answer, {
      action: 'config.target.edit',
      files: [CONFIG_FILE],
    })
  })

  it('lands blocked schema-fail when the candidate does not validate', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.edit', {
      name: 'shop',
      changes: { url: `https://shop.example.com/${INVALID_MARKER}` },
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
  })

  it('THE EDGE: an absent target is a typed not-found that LISTS what is configured', async () => {
    const test = harness()
    const answer = await call(test, 'config.target.edit', {
      name: 'shpo',
      changes: { url: 'https://shop.example.com/basket' },
    })

    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('target-not-found')
    // THE NAMES, which is what turns a refusal into something a caller can act on. This reds on a
    // refusal that says only "no such target" — and on a `setIn` that would have CREATED `shpo`.
    expect(answer.candidates).toEqual(['shop'])
    expect(test.filed).toHaveLength(0)
  })

  it('THE EDGE: one FIXED path, two values, two different cross-boundary answers', async () => {
    // The claim D-02 is about, and the one a classifier ranged over PATHS cannot make: both calls
    // below edit `registry.targets.shop.url` — the same op, the same path, the same target — and
    // the answers differ because the VALUES do.
    const sameOrigin = harness()
    const near = await call(sameOrigin, 'config.target.edit', {
      name: 'shop',
      changes: { url: 'https://shop.example.com/basket' },
    })
    if (near.outcome !== 'proposed') throw new Error('unreachable')
    expect(near.crossBoundary).toBe(false)
    expect(near.crossBoundaryReasons).toEqual([])

    const newOrigin = harness()
    const far = await call(newOrigin, 'config.target.edit', {
      name: 'shop',
      changes: { url: 'https://shop.evil.example/cart' },
    })
    if (far.outcome !== 'proposed') throw new Error('unreachable')
    expect(far.crossBoundary).toBe(true)
    expect(far.crossBoundaryReasons).toEqual(['new-origin'])

    // AND THE PATH REALLY IS THE SAME ONE in both, so the pair cannot pass because the two calls
    // happened to address different fields.
    expect(isSecretAdjacentConfigField('registry.targets.shop.url')).toBe(false)
    for (const answer of [near, far]) {
      expect(answer.shownDiff).toContain('    url: https://')
    }
  })
})

describe('config.auth.set — refs only, refused on the INPUT (D-11, ratified as law)', () => {
  it('carries the diff, the receipts and the config kind, and is secret-adjacent', async () => {
    const test = harness()
    const answer = await call(test, 'config.auth.set', {
      target: 'shop',
      authStateName: 'shop-default',
    })
    assertTheCfgm01Sentence(test, answer, {
      action: 'config.auth.set',
      files: [CONFIG_FILE],
    })
    if (answer.outcome !== 'proposed') throw new Error('unreachable')
    expect(answer.crossBoundaryReasons).toEqual(['secret-adjacent-field'])
    // THE DIFF CONTAINS A REFERENCE AND NOTHING ELSE: a name, at the one path this configuration
    // binds an auth state.
    expect(answer.shownDiff).toContain('+  authState: shop-default')
  })

  it('lands blocked schema-fail when the candidate does not validate', async () => {
    const test = harness()
    const answer = await call(test, 'config.auth.set', {
      target: 'shop',
      pluginPackage: `@acme/${INVALID_MARKER}`,
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
  })

  it('appends a plugin declaration past the end rather than over the last one', async () => {
    const withPlugins = harness({
      config: `${CONFIG}plugins:\n  auth:\n    - package: "@vostride/agent-qa-subscription-auth"\n`,
    })
    const answer = await call(withPlugins, 'config.auth.set', {
      target: 'shop',
      pluginPackage: '@acme/auth',
    })
    if (answer.outcome !== 'proposed') throw new Error('unreachable')
    const content = utf8Decode(Uint8Array.from(
      Buffer.from(applyable(withPlugins).files[0]!.newContentBase64, 'base64'),
    ))
    // BOTH declarations, in order. This reds on a write at a fixed index (the existing one is gone)
    // and on writing the whole sequence back (the existing one is gone too, differently).
    expect(content).toContain('- package: "@vostride/agent-qa-subscription-auth"')
    expect(content).toContain('- package: "@acme/auth"')
    expect(answer.crossBoundaryReasons).toEqual(['secret-adjacent-field'])
  })

  it('THE EDGE: a recognised credential is REFUSED on the input, and nothing is filed', async () => {
    const secret = 'AKIAQWERTYUIOPASDFGH'
    const test = harness()
    const answer = await call(test, 'config.auth.set', {
      target: 'shop',
      authStateName: secret,
    })

    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('refs-only')
    // NAMED, so the person is told what they pasted rather than only that it was wrong.
    expect(answer.detail).toContain('awsKey')
    expect(answer.detail).toContain('authStateName')
    expect(answer.detail).toContain('workspace.envFile')

    // ZERO STORE DELTA — the difference from `config.field.set`, which FILES a blocked record for a
    // secret. This reds on a pipeline that treated the two dispositions as one.
    expect(test.filed).toHaveLength(0)

    // THE ABSENCE, WINDOWED — and it is not vacuous, because the line below proves this codebase's
    // summary channel really does print values it is given.
    expect(configFieldSetSummaryLine('use.authState', secret)).toContain(secret)
    for (const window of windows(secret)) expect(answer.detail).not.toContain(window)
  })

  it('THE EDGE: a value NO detector names is refused STRUCTURALLY, by what a reference IS', async () => {
    // A base64-shaped token. The cell PROVES the detector half is silent on it first — so what
    // refuses it below is the positive shape rule and nothing else. This is the answer to the
    // door-enumeration failure mode: the rule names nothing it refuses, so a credential family
    // nobody has listed is refused on the day it is invented.
    const unnamed = 'Zm9vYmFyYmF6cXV4Cg'
    expect(scanConstructedArtifact([{ label: 'probe', text: unnamed }], {}).findings).toEqual([])

    const test = harness()
    const answer = await call(test, 'config.auth.set', { target: 'shop', authStateName: unnamed })
    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('refs-only')
    expect(answer.detail).toContain('auth-state-name')
    expect(test.filed).toHaveLength(0)

    // THE GUARD REJECTS SOMETHING ITS OWN ASSUMPTION ADMITS, in the other direction: a legal
    // reference passes, so the rule is not "refuse everything".
    const legal = harness()
    const proposed = await call(legal, 'config.auth.set', {
      target: 'shop',
      authStateName: 'shop-default',
    })
    expect(proposed.outcome).toBe('proposed')
  })

  it('KNOWN BOUND: a credential that is ALSO a legal reference, unnamed and unseeded, is admitted',
    async () => {
      // THE HONEST RESIDUE, recorded as a passing cell rather than left unsaid. `hunter2` is a real
      // password and a legal auth-state slug; no detector names it and nobody seeded it, so both
      // gates admit it and it is written as a reference. The bound is a property of the design:
      // a rule that admits by SHAPE cannot see inside a value that has the right shape.
      const password = 'hunter2'
      const admitted = harness()
      const answer = await call(admitted, 'config.auth.set', {
        target: 'shop',
        authStateName: password,
      })
      expect(answer.outcome).toBe('proposed')

      // AND THE PAIRED HALF, which is the structural answer and the reason the seeded gate exists:
      // seed the SAME value and it is refused with no new pattern written anywhere.
      const seeded = harness({ seeds: { env: { APP_PASSWORD: password } } })
      const refused = await call(seeded, 'config.auth.set', {
        target: 'shop',
        authStateName: password,
      })
      expect(refused.outcome).toBe('refused')
      if (refused.outcome !== 'refused') throw new Error('unreachable')
      expect(refused.reason).toBe('refs-only')
      expect(refused.detail).toContain('seeded-secret')
      for (const window of windows(password)) expect(refused.detail).not.toContain(window)
    })

  it('refuses a binding for a target nobody configured, and names the ones that exist', async () => {
    const test = harness()
    const answer = await call(test, 'config.auth.set', {
      target: 'checkout',
      authStateName: 'shop-default',
    })
    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('target-not-found')
    expect(answer.candidates).toEqual(['shop'])
  })

  it('refuses an env-var name by saying where it belongs, AFTER the secret check', async () => {
    const test = harness()
    const answer = await call(test, 'config.auth.set', {
      target: 'shop',
      envVarName: 'SHOP_API_TOKEN',
    })
    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('unsupported-reference')
    expect(answer.detail).toContain('workspace.envFile')

    // PRECEDENCE, and it is the pipeline's own: a value that is both unwritable AND credential-shaped
    // is reported as a credential, because that is the fact the person needs. A refusal ordered the
    // other way would tell somebody who pasted an AWS key that the field is unsupported.
    const both = harness()
    const secretly = await call(both, 'config.auth.set', {
      target: 'shop',
      envVarName: 'AKIAQWERTYUIOPASDFGH',
    })
    if (secretly.outcome !== 'refused') throw new Error('unreachable')
    expect(secretly.reason).toBe('refs-only')
  })
})

describe('config.hook.add — the one action that writes another file (D-02)', () => {
  it('carries the diff, the receipts and the config kind — for the HOOKS file', async () => {
    const test = harness({ hooks: HOOKS })
    const answer = await call(test, 'config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
    })
    assertTheCfgm01Sentence(test, answer, {
      action: 'config.hook.add',
      // THE EDGE, in one line: the file this proposal touches is not the config yaml.
      files: [HOOKS_FILE],
    })
  })

  it('THE EDGE: whole-input validation was handed the MUTATED hooks file', async () => {
    const test = harness({ hooks: HOOKS })
    await call(test, 'config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
    })

    const call1 = test.validated[0]
    expect(call1).toBeDefined()
    // The candidate is the whole SET, and the hooks member carries the new entry. This reds on a
    // pipeline that validated only the config yaml — which would have passed every other describe
    // in this file, because every other op writes the config yaml.
    expect(call1?.hooksFile).toBe(HOOKS_FILE)
    const hooksMember = call1?.files.find((file) => file.path === HOOKS_FILE)
    expect(hooksMember?.text).toContain('Seed the cart')
    // ...and the config yaml went along UNCHANGED, so "whole set" is not "whole set, mutated".
    const configMember = call1?.files.find((file) => file.path === CONFIG_FILE)
    expect(configMember?.text).toBe(CONFIG)
  })

  it('lands blocked schema-fail when the hooks file does not validate', async () => {
    const test = harness({ hooks: HOOKS })
    const answer = await call(test, 'config.hook.add', {
      name: INVALID_MARKER,
      runtime: 'bash',
      file: 'scripts/seed.sh',
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(answer.validationIssues).toEqual([`${HOOKS_FILE}: seeded invalid`])
    expect(answer.paths).toEqual([HOOKS_FILE])
  })

  it('THE EDGE: every hook addition flags hook-added, and the id comes from the PORT', async () => {
    const test = harness({ hooks: HOOKS })
    const answer = await call(test, 'config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
      timeout: '45s',
      network: false,
    })
    if (answer.outcome !== 'proposed') throw new Error('unreachable')

    // STATED, NEVER INFERRED (D-02). A hook is code this project will run, so the flag is
    // unconditional — it does not depend on what the hook does or where its file lives.
    expect(answer.crossBoundary).toBe(true)
    expect(answer.crossBoundaryReasons).toEqual(['hook-added'])

    const added = answer.shownDiff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    expect(added).toEqual([
      `+  - id: ${MINTED_HOOK_ID}`,
      '+    name: Seed the cart',
      '+    runtime: node',
      '+    file: scripts/seed.mjs',
      '+    timeout: 45s',
      '+    network: false',
    ])
    // APPENDED, NOT OVERWRITTEN: the committed hook is untouched, so nothing was removed.
    expect(answer.shownDiff.split('\n').filter((line) =>
      line.startsWith('-') && !line.startsWith('---'))).toEqual([])
  })

  it('creates the hooks file when a project has none, and scans the whole new file', async () => {
    const test = harness({ hooks: undefined })
    const answer = await call(test, 'config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
    })
    if (answer.outcome !== 'proposed') throw new Error('unreachable')

    const payload = applyable(test)
    expect(payload.files[0]?.changeKind).toBe('add')
    // An added file has no base digest, because there is no base — a fact, not an omission.
    expect(payload.files[0]?.baseDigest).toBeUndefined()
    // The default timeout is written, because `HookDefinitionSchema` requires one and the DTO makes
    // it optional. A hook proposed without a duration would be refused at the next run.
    expect(answer.shownDiff).toContain('+    timeout: 30s')
  })
})

/**
 * The closed class, as a set the registry itself answers.
 *
 * WRITTEN AGAINST A NAMED CONSTANT THE LATER PLANS EXTEND, so this cell reds on an UNPLANNED op
 * rather than on the planned ones: 395-08's `config.project.scaffold` and D-07's `config.undo.*`
 * arrive by editing the constant beside the registration, in one commit a reviewer can read.
 */
const EXPECTED_CONFIG_FAMILY = [
  'config.auth.set',
  'config.field.set',
  'config.get',
  'config.hook.add',
  'config.project.scaffold',
  'config.proposal.apply',
  'config.target.create',
  'config.target.edit',
  'config.undo.propose',
] as const

describe('the config action class is CLOSED, and the registry is where that is legible (D-01)', () => {
  it('registers exactly the expected config family, and every member is config-write', () => {
    const registry = registryFor(harness())
    const declarations = registry.list(CALLER)
    const family = declarations
      .map((declaration) => declaration.id)
      .filter((id) => id.startsWith('config.'))
      .sort()

    expect(family).toEqual([...EXPECTED_CONFIG_FAMILY])

    // AND THE SHAPE OF THE CLASS, not only its membership: every one of these is a registry op in
    // its own right — which is what makes the planner able to pick an action by tool name and 396
    // able to project each as its own MCP tool — and every writing member carries `config-write`.
    for (const id of EXPECTED_CONFIG_FAMILY) {
      const declaration = declarations.find((entry) => entry.id === id)
      expect(declaration, id).toBeDefined()
      if (id === 'config.get') {
        expect(declaration?.requiredScopes, id).toEqual(['read'])
        continue
      }
      expect(declaration?.requiredScopes, id).toEqual(['config-write'])
      expect(declaration?.risk.readOnly, id).toBe(false)
    }
  })

  it('every propose op refuses by name when no scan is bound (CFGM-02, fail closed)', async () => {
    // THE ABSENCE MUST REFUSE, for all four new ops and not only for the one 395-04 measured. A
    // guardrail that quietly stops existing when one composition line is missing is the permissive
    // direction a security control may not fail in.
    const test = harness()
    const { configScan: _dropped, ...withoutScan } = test.deps as unknown as Record<string, unknown>
    const registry = createFunctionRegistry({
      deps: withoutScan as unknown as FunctionDeps,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      resolveExecutionContext: () => 'local-interactive',
      confirm: { surface: 'tty-prompt', ask: () => true },
    })

    const samples: readonly [string, unknown][] = [
      ['config.field.set', { path: 'use.parallel', value: true }],
      ['config.target.create', { name: 'basket', platform: 'web', url: 'https://basket.example.com' }],
      ['config.target.edit', { name: 'shop', changes: { url: 'https://shop.example.com/x' } }],
      ['config.auth.set', { target: 'shop', authStateName: 'shop-default' }],
      ['config.hook.add', { name: 'Seed', runtime: 'node', file: 'scripts/seed.mjs' }],
    ]
    for (const [id, input] of samples) {
      await expect(invokeFunction(registry, id, input, CALLER), id).rejects.toThrow(/not bound/i)
    }
    expect(test.filed).toHaveLength(0)
  })
})
