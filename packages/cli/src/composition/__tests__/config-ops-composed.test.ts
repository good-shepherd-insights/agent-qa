// The four 395-05 actions over the REAL ports and a REAL file (395-05 · CFGM-01/02 · D-01/D-02/D-11).
//
// WHY THIS FILE EXISTS BESIDE `agent`'s `config-ops.test.ts`, AND WHY EITHER ALONE WOULD BE WEAKER.
// That file drives the real ops through the real pipeline with a yaml DOUBLE — a double built from
// the same library and the same calls the shipped port makes, which is as close as `packages/agent`
// can get, because `yaml` is not among its runtime dependencies. Close is not the same, and this
// project has recorded what the gap costs: a contract measured on one side only agrees with itself.
// So the halves this file pins are exactly the ones a double cannot:
//
//   1. `createConfigFilesPort.inspect` — the structural probe a collision refusal and a not-found
//      refusal both rest on, answered from a file on disk rather than from a fixture string.
//   2. `createConfigFilesPort.setField` with a STRUCTURED value — a target entry and a hook entry
//      are maps, and the append is past the end of a real sequence.
//   3. `createConfigFilesPort.mintHookId` — the REAL mint, checked against the REAL
//      `isCanonicalHookId`. A double's id proves only that somebody typed a plausible string.
//   4. `createConfigValidatePort` over the whole candidate SET — with `core`'s actual
//      `AgentQaConfigSchema` and `HooksFileSchema`, so "the hooks file is validated" is measured
//      against the schema that will refuse it at run time rather than against a marker.
//
// WHAT MAKES EACH CELL RED is named on the cell. The two sharpest: (H2) reds on a validator that
// reads only the config yaml — the state this code was in before 395-05 — and (H1) reds on any id
// this codebase did not mint, including a hand-formatted `h_` string that looks right.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import { isCanonicalHookId } from '@vostride/agent-qa-ids'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  base64Decode,
  utf8Decode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigProposalV1,
  ConfigProposeOutput,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createConfigFilesPort, createConfigValidatePort } from '../local-agent-host.js'

const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/** The house style, comment-dense — the comments are cell (C3)'s subject. */
const SEEDED_CONFIG = `# agent-qa Configuration

# File discovery and project settings
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

# Named resource definitions (LLM configs, app targets)
registry:
  targets:
    # Optional: add more web or mobile targets here.
    local-form:
      platform: web
      url: http://127.0.0.1:8931/form.html

# How runs behave by default.
use:
  mobile:
    appState: reset
  parallel: false
`

const SEEDED_HOOKS = `hooks:
  - id: h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper
    name: Fetch first HN story
    runtime: node
    file: scripts/fetch-hn-top-story.mjs
    timeout: 30s
    network: true
`

let root: string
let configPath: string
let filed: { kind: string; emittedBy: string; payload: ConfigProposalV1 }[]

function registry() {
  const deps = {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' as const }),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }: { recordId: string }) =>
        Promise.resolve({ kind: 'not-found' as const, schemaVersion: 1, recordId }),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    // THE TWO PRODUCTION PORTS THIS FILE IS ABOUT.
    configFiles: createConfigFilesPort(configPath),
    configValidate: createConfigValidatePort(),
    // The REAL scan with an EMPTY seed set, on `config-apply.test.ts`'s stated reasoning: the
    // function is production's and the seeds are not, because a cell whose verdict depends on
    // whether a developer exported a token is a cell that measures the machine.
    configScan: { scan: (parts: Parameters<typeof scanConstructedArtifact>[0]) =>
      scanConstructedArtifact(parts, {}) },
    // The store is 395-01's proven ground and is not this file's subject; what matters here is that
    // the PAYLOAD reaching it is the one the real ports produced.
    configProposals: {
      put: (record: { kind: string; emittedBy: string; payload: ConfigProposalV1 }) => {
        filed.push(record)
        return Promise.resolve({ proposalId: `prop-${filed.length}` })
      },
    },
  } as unknown as FunctionDeps

  return createFunctionRegistry({
    deps,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
    confirm: () => true,
  })
}

async function call(id: string, input: unknown): Promise<ConfigProposeOutput> {
  return await invokeFunction(registry(), id, input, HUMAN) as ConfigProposeOutput
}

/** The candidate bytes the store was handed, decoded — never a string the test built. */
function candidateText(index = 0): string {
  const payload = filed[0]?.payload
  if (payload?.payloadKind !== 'applyable') throw new Error('expected an applyable payload')
  const file = payload.files[index]
  if (file === undefined) throw new Error(`no file at ${index}`)
  return utf8Decode(base64Decode(file.newContentBase64))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-ops-'))
  configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, SEEDED_CONFIG)
  writeFileSync(join(root, 'hooks.yaml'), SEEDED_HOOKS)
  filed = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the 395-05 actions over the real ports (D-01)', () => {
  it('(C1) creates a target as one house-style block, and the file on disk is untouched', async () => {
    const answer = await call('config.target.create', {
      name: 'shop',
      platform: 'web',
      url: 'https://shop.example.com',
    })
    expect(answer.outcome).toBe('proposed')
    if (answer.outcome !== 'proposed') throw new Error('unreachable')

    expect(answer.crossBoundaryReasons).toEqual(['new-origin'])
    expect(candidateText()).toContain('    shop:\n      platform: web\n      url: https://shop.example.com')
    // NOTHING WAS WRITTEN. A proposal is an artifact, not an edit — the git commit happens only
    // after somebody accepts, through a port this path never reaches.
    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
  })

  it('(C2) refuses a collision, with candidates read off the REAL document', async () => {
    const answer = await call('config.target.create', {
      name: 'local-form',
      platform: 'web',
      url: 'https://elsewhere.example',
    })
    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('target-exists')
    // The name came out of the file, through `inspect`. This reds on a probe that answered from a
    // parse of something else, and on one that returned nothing at all.
    expect(answer.candidates).toEqual(['local-form'])
    expect(filed).toHaveLength(0)
  })

  it('(C3) every comment in the committed file survives a structured write', async () => {
    await call('config.target.create', {
      name: 'shop',
      platform: 'web',
      url: 'https://shop.example.com',
    })
    const content = candidateText()
    for (const comment of [
      '# agent-qa Configuration',
      '# File discovery and project settings',
      '# Named resource definitions (LLM configs, app targets)',
      '# Optional: add more web or mobile targets here.',
      '# How runs behave by default.',
    ]) {
      expect(content, comment).toContain(comment)
    }
  })

  it('(C4) an edit at a FIXED path answers differently for two values', async () => {
    const near = await call('config.target.edit', {
      name: 'local-form',
      changes: { url: 'http://127.0.0.1:8931/other.html' },
    })
    if (near.outcome !== 'proposed') throw new Error('unreachable')
    expect(near.crossBoundaryReasons).toEqual([])

    filed = []
    const far = await call('config.target.edit', {
      name: 'local-form',
      changes: { url: 'http://127.0.0.1:9999/form.html' },
    })
    if (far.outcome !== 'proposed') throw new Error('unreachable')
    // A DIFFERENT PORT IS A DIFFERENT ORIGIN, which is the case a host-only comparison misses.
    expect(far.crossBoundaryReasons).toEqual(['new-origin'])
  })

  it('(C5) a credential in an auth reference is refused, and the file is never opened for writing',
    async () => {
      const answer = await call('config.auth.set', {
        target: 'local-form',
        authStateName: 'AKIAQWERTYUIOPASDFGH',
      })
      expect(answer.outcome).toBe('refused')
      if (answer.outcome !== 'refused') throw new Error('unreachable')
      expect(answer.reason).toBe('refs-only')
      expect(filed).toHaveLength(0)
      expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
    })

  it('(H1) a hook is appended with an id the REAL canonical check accepts', async () => {
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
    })
    expect(answer.outcome).toBe('proposed')
    if (answer.outcome !== 'proposed') throw new Error('unreachable')

    // THE ONE FILE THIS ACTION TOUCHES, and it is not the config yaml.
    expect(answer.files).toEqual(['hooks.yaml'])
    expect(answer.crossBoundaryReasons).toEqual(['hook-added'])

    const content = candidateText()
    const ids = content.split('\n')
      .filter((line) => line.includes('id: h_'))
      .map((line) => line.slice(line.indexOf('h_')).trim())
    expect(ids).toHaveLength(2)
    // BOTH — the committed one and the minted one — measured against the SHIPPED predicate. A
    // hand-formatted `h_` string fails here, which is the whole reason the mint is a port call.
    for (const id of ids) expect(isCanonicalHookId(id), id).toBe(true)
    expect(ids[0]).toBe('h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper')
    expect(ids[1]).not.toBe(ids[0])
    expect(content).toContain('name: Seed the cart')
  })

  it('(H2) the REAL hooks schema validates the candidate — an unreadable duration blocks', async () => {
    // `HookDefinitionSchema.timeout` is refined through `ms()`, and the ACTION's DTO accepts any
    // non-empty string, so this is a candidate only whole-input validation can refuse. It reds on
    // the validator this code had before 395-05, which read the config yaml and nothing else.
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
      timeout: 'whenever',
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(answer.paths).toEqual(['hooks.yaml'])
    expect(answer.validationIssues?.join(' ')).toContain('hooks.yaml')
    expect(answer.validationIssues?.join(' ')).toContain('Invalid duration format')
  })

  it('(H3) CONTROL: the same hook with a readable duration is proposed', async () => {
    // WITHOUT THIS, (H2) would pass against a validator that refuses every hooks file. The control
    // is what makes the refusal a fact about the duration rather than about the file.
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'node',
      file: 'scripts/seed.mjs',
      timeout: '45s',
    })
    expect(answer.outcome).toBe('proposed')
  })

  it('(H4) a duplicate hook NAME is refused by the hooks schema, not by this code', async () => {
    // The refinement lives in `core`'s `HooksFileSchema`, and this cell is what says the pipeline
    // reaches it. An op that had grown its own duplicate check would be a second, weaker copy.
    const answer = await call('config.hook.add', {
      name: 'Fetch first HN story',
      runtime: 'node',
      file: 'scripts/other.mjs',
    })
    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.validationIssues?.join(' ')).toContain('Duplicate hook name')
  })

  it('(H5) a project with no hooks file gets one, and it validates', async () => {
    rmSync(join(root, 'hooks.yaml'))
    const answer = await call('config.hook.add', {
      name: 'Seed the cart',
      runtime: 'bash',
      file: 'scripts/seed.sh',
    })
    expect(answer.outcome).toBe('proposed')
    if (answer.outcome !== 'proposed') throw new Error('unreachable')
    const payload = filed[0]?.payload
    if (payload?.payloadKind !== 'applyable') throw new Error('unreachable')
    expect(payload.files[0]?.changeKind).toBe('add')
    expect(payload.files[0]?.baseDigest).toBeUndefined()
    expect(candidateText()).toContain('timeout: 30s')
  })
})
