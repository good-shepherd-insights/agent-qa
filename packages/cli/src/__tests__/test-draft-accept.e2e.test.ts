// Accepting a `test-draft` really commits it — the op, the route and the host in one process
// (394-10, D-05/D-06 · WTST-01).
//
// WHY THIS FILE IS IN `packages/cli`. The one-commit apply lives at the CLI host because it needs
// `workspaceRelativeIdentityPath` from `@vostride/agent-qa-core`, which neither `agent` nor
// `agent-local` may name — so this is the only place where `proposals.accept` and a real git
// repository can be in the same process. The op's own contract (which port each kind reaches, what
// it reports, who it refuses) is measured where the op lives, in
// `packages/agent/src/functions/__tests__/proposals-accept.test.ts`.
//
// THE INBOX IS A DOUBLE, AND THAT IS A MEASUREMENT RATHER THAN A CONVENIENCE. Nothing on any host
// in this build persists a `test-draft` record: `writePendingProposal` takes a
// `KnowledgeProposalV1`, `extractStoredProposal` refuses every other kind BY NAME, and
// `envelopeAt`/`envelopeOf` in the same store are typed to the knowledge arm alone. So a
// `test-draft` envelope cannot come off disk today, and a cell that waited for one would be waiting
// for a store nobody has built. What IS real here is everything downstream of the envelope: the
// registered op, the gate, the route, the bound port, the workspace, and the git repository the
// commit lands in.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  ProposalInboxEntryDto,
  ProposalsAcceptOutput,
  ProposalsRejectOutput,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTestDraftApplyPort } from '../composition/local-agent-host.js'

const PROPOSAL_ID = 'prop_aaaaaaaa-bbbb'
const DRAFT_PATH = 'tests/.agent-qa-drafts/abc123.yaml'
const TARGET_PATH = 'tests/the-coupon-banner-appears.yaml'

const DRAFT_BYTES = `name: The coupon banner appears
target: local-form
steps:
  - Open the cart
  - Apply the coupon FREESHIP
  - Verify the coupon banner is visible
`

const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

let root: string
let configPath: string

function git(...args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout }
}

function headStatPaths(): string[] {
  return git('show', '--stat', '--name-only', '--format=', 'HEAD').stdout
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

function testDraftEntry(
  overrides: Partial<Extract<ProposalInboxEntryDto['envelope'], { kind: 'test-draft' }>> = {},
): ProposalInboxEntryDto {
  return {
    applyInFlight: false,
    envelope: {
      id: PROPOSAL_ID,
      kind: 'test-draft',
      status: 'pending',
      evidenceRefs: [],
      payload: {
        schemaVersion: 1,
        draftRef: {
          filePath: DRAFT_PATH,
          testId: 't_coupon',
          testName: 'The coupon banner appears',
          contentDigest: createHash('sha256').update(DRAFT_BYTES).digest('hex'),
        },
        targetPath: TARGET_PATH,
        disposition: 'keep-eligible',
        runsPreviewed: 9,
        runsConsumed: 3,
        repairIterations: 0,
        summaryLine: 'The coupon banner appears — keep-eligible',
      },
      ...overrides,
    },
  }
}

function registryFor(entry: ProposalInboxEntryDto, options: { bindApply?: boolean } = {}) {
  const rejected: string[] = []
  const deps: FunctionDeps = {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
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
    proposalsInbox: {
      list: () => Promise.resolve([entry]),
      show: ({ proposalId }) => Promise.resolve(
        proposalId === entry.envelope.id
          ? { kind: 'found' as const, entry }
          : { kind: 'not-found' as const, proposalId },
      ),
      reject: ({ proposalId }) => {
        rejected.push(proposalId)
        return Promise.resolve({ outcome: 'rejected' as const, entry })
      },
    },
    // THE REAL ONE, over the real workspace and the real repository.
    ...(options.bindApply === false ? {} : { draftApply: createTestDraftApplyPort(configPath) }),
  }

  return {
    rejected,
    registry: createFunctionRegistry({
      deps,
      auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
      // The production door for an accept: `mutating-shared` is an ask in every context, and this
      // is the arm the CLI host binds. Without it the call denies before dispatching anything, and
      // every cell below would pass while measuring nothing.
      resolveExecutionContext: () => 'local-interactive',
      confirm: () => true,
    }),
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'test-draft-accept-'))
  configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `workspace:
  testMatch:
    - tests/**/*.yaml
`,
  )
  mkdirSync(join(root, 'tests', '.agent-qa-drafts'), { recursive: true })
  writeFileSync(join(root, DRAFT_PATH), DRAFT_BYTES)

  git('init', '--quiet')
  git('config', 'user.name', 'agent-qa accept test')
  git('config', 'user.email', 'accept-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), 'tests/.agent-qa-drafts/\n')
  writeFileSync(join(root, 'README.md'), 'seeded\n')
  git('add', '--', '.gitignore', 'README.md', 'agent-qa.config.yaml')
  git('commit', '--quiet', '-m', 'seed')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('accepting a test-draft writes it and commits it', () => {
  it('puts the draft at its target path and adds exactly ONE commit of exactly ONE file', async () => {
    const built = registryFor(testDraftEntry())

    const answer = await invokeFunction(
      built.registry,
      'proposals.accept',
      { proposalId: PROPOSAL_ID },
      HUMAN,
    ) as ProposalsAcceptOutput

    expect(answer.apply.outcome).toBe('applied')
    expect(readFileSync(join(root, TARGET_PATH), 'utf8')).toBe(DRAFT_BYTES)
    expect(headStatPaths()).toEqual([TARGET_PATH])
    expect(git('rev-list', '--count', 'HEAD').stdout.trim()).toBe('2')
    expect(git('log', '-1', '--format=%B', 'HEAD').stdout).toContain(PROPOSAL_ID)
    expect(answer.apply).toMatchObject({ applied: { kind: 'test-draft' } })
  })

  it('refuses BY NAME when the host binds no apply, and leaves the repository untouched', async () => {
    const built = registryFor(testDraftEntry(), { bindApply: false })

    await expect(invokeFunction(
      built.registry,
      'proposals.accept',
      { proposalId: PROPOSAL_ID },
      HUMAN,
    )).rejects.toThrow(/declared but not bound/)

    expect(git('rev-list', '--count', 'HEAD').stdout.trim()).toBe('1')
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('leaves the working tree and the history untouched when the draft is REJECTED', async () => {
    const built = registryFor(testDraftEntry())

    const answer = await invokeFunction(
      built.registry,
      'proposals.reject',
      { proposalId: PROPOSAL_ID },
      HUMAN,
    ) as ProposalsRejectOutput

    expect(answer.outcome).toBe('rejected')
    expect(built.rejected).toEqual([PROPOSAL_ID])
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
    expect(git('rev-list', '--count', 'HEAD').stdout.trim()).toBe('1')
  })

  it('refuses a target a person has uncommitted work at, with nothing written and nothing committed', async () => {
    writeFileSync(join(root, TARGET_PATH), 'name: mine, not yet committed\nsteps:\n  - Open\n')
    const built = registryFor(testDraftEntry())

    await expect(invokeFunction(
      built.registry,
      'proposals.accept',
      { proposalId: PROPOSAL_ID },
      HUMAN,
    )).rejects.toThrow(/uncommitted work/)

    expect(readFileSync(join(root, TARGET_PATH), 'utf8'))
      .toBe('name: mine, not yet committed\nsteps:\n  - Open\n')
    expect(git('rev-list', '--count', 'HEAD').stdout.trim()).toBe('1')
  })
})
