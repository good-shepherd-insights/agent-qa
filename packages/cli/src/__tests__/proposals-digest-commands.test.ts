// The three D-17 delivery verbs, driven as a person drives them (Phase 391 plan 06).
//
// `agent-qa digest`, `agent-qa proposals …` and `agent-qa proposals grants …` are THIN
// WRAPPERS: they resolve a project, build the registry at the composition root, call
// `invokeFunction` with the CLI's own caller mint, and print what comes back. This file proves
// exactly that and nothing more generous — the whole path is real (no stubbed gate, no stubbed
// registry, a real proposals store on disk), and the digest verb's output is asserted BYTE FOR
// BYTE against the op result obtained through a second composition.
//
// The second composition is what makes the byte claim non-circular. If the printed lines were
// built from anything the command held in memory, the value compared here — read out of a cold
// registry over the same directories — would be free to disagree with it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction, RUNS_DIGEST_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { proposeReview, publishBundleForTest } from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { asRunId, CURRENT_HANDOFF_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { Anchor, CompletedRunHandoff, RunDigest, Verdict } from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDigestCommand } from '../commands/digest.js'
import { createProposalsCommand } from '../commands/proposals.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'

const OLDER_RUN = 'run-391-06-cmd-older'
const NEWER_RUN = 'run-391-06-cmd-newer'

const ANCHOR: Anchor = { t: 'el', role: 'Button', name: 'Checkout' }

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function rootCause(perTest: number): Verdict {
  return {
    class: 'app_bug',
    producer: 'deterministic-classifier',
    confidence: 0.9,
    evidence: {
      citedSteps: [0],
      citedAnchors: [],
      citedArtifacts: [],
      rationale: 'the submit control is gone from the checkout DOM',
    },
    memoryMisdirectionRuledOut: true,
    perTest,
  } as Verdict
}

function handoff(runId: string, endedAt: number): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'digest-cmd-storefront' },
    buildOrdinal: 2,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1,
    endedAt,
    tests: [
      {
        testId: 'TST-501',
        testName: 'checks out',
        filePath: 'tests/checkout.yaml',
        testIndex: 0,
        outcome: 'failed',
        steps: [],
        rootCause: rootCause(0),
      },
    ],
  } as unknown as CompletedRunHandoff
}

interface Workspace {
  root: string
  configPath: string
  agentQaRoot: string
  knowledgeRoot: string
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-391-06-cmd-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.yaml'],
        testPathIgnore: [],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      use: { mobile: { appState: 'preserve' } },
    }, null, 2)}\n`,
    'utf8',
  )
  const agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  // Two completed runs, the newer one ending later, so "most recent" is a claim about
  // chronology rather than about whichever id sorts last.
  for (const [runId, endedAt] of [[OLDER_RUN, 100], [NEWER_RUN, 900]] as const) {
    const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(runId))
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, HANDOFF_FILE), `${JSON.stringify(handoff(runId, endedAt))}\n`, 'utf8')
  }
  return { root, configPath, agentQaRoot, knowledgeRoot: join(root, 'agent-qa-knowledge') }
}

function storeConfig(ws: Workspace): BundleStoreConfig {
  return {
    knowledgeRoot: ws.knowledgeRoot,
    productKey: 'Digest Command Product',
    auditBaseDir: ws.agentQaRoot,
    commitArtifacts: 'none',
  }
}

/** A real record, then a real proposal about it, attributed to a run — the shipped seams. */
function mintProposal(ws: Workspace, runId: string, summary: string, ordinal: number): string {
  const published = publishBundleForTest(storeConfig(ws), {
    draft: {
      kind: 'fact',
      subtype: 'selector',
      anchors: [ANCHOR],
      scope: { tier: 'product', key: 'digest-cmd' },
      summary,
      body: `Selecting ${summary} advances to the payment page.`,
      distilledEvidenceRef: { id: `cmd-${summary}`, sha: 'a'.repeat(64) },
      originStage: 'run-curation',
    },
    discriminant: {
      kind: 'fact',
      subtype: 'selector',
      elementRef: { role: 'Button', name: summary },
    },
    originClass: 'agent-verified',
    createdAtOrdinal: ordinal,
    screenStates: [],
    initialEvents: [],
    relations: [],
    provenance: { mode: 'run-linked', runId: 'digest-cmd', testId: 't', stepIndex: 0 },
    artifacts: [],
  })
  if (published.kind !== 'published') throw new Error(`fixture publish failed: ${published.kind}`)
  const outcome = proposeReview({
    agentQaRoot: ws.agentQaRoot,
    knowledgeRoot: ws.knowledgeRoot,
    request: { verb: 'forget', input: { target: { grain: 'record', recordId: published.id } } },
    origin: { emittedBy: 'knowledge.forget.propose', runId },
  })
  if (outcome.kind !== 'proposed') throw new Error(`fixture propose failed: ${outcome.kind}`)
  return outcome.proposal.proposalId
}

interface Invocation {
  stdout: string
  stderr: string
  exitCode: number | string | undefined
}

async function run(ws: Workspace, args: readonly string[]): Promise<Invocation> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  const priorExit = process.exitCode
  process.exitCode = undefined
  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createDigestCommand())
      .addCommand(createProposalsCommand())
    program.exitOverride()
    await program.parseAsync(['node', 'agent-qa', '--config', ws.configPath, ...args])
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode }
  } finally {
    process.exitCode = priorExit
    log.mockRestore()
    error.mockRestore()
  }
}

/** The op result, read through a SECOND cold composition over the same directories. */
async function digestThroughTheOp(ws: Workspace, runId: string): Promise<RunDigest> {
  const host = composeCliLocalAgent({ agentQaRoot: ws.agentQaRoot, configPath: ws.configPath })
  try {
    return await invokeFunction(
      host.registry,
      RUNS_DIGEST_FUNCTION_ID,
      { runId },
      CLI_FUNCTION_CALLER,
    ) as RunDigest
  } finally {
    await host.close()
  }
}

describe('agent-qa digest (D-17, the on-demand channel)', () => {
  it('prints the op result\'s lines, byte for byte, and composes nothing of its own', async () => {
    const ws = workspace()
    mintProposal(ws, NEWER_RUN, 'checkout button', 11)

    const invocation = await run(ws, ['digest', NEWER_RUN])
    const digest = await digestThroughTheOp(ws, NEWER_RUN)

    expect(invocation.stderr).toBe('')
    expect(invocation.exitCode).toBeUndefined()
    // The whole claim, as one comparison: the printed bytes ARE the op's lines.
    expect(invocation.stdout).toBe(digest.lines.join('\n'))
    // Non-vacuity — the digest has real sections to have printed, including the proposal
    // this fixture minted through the shipped seam.
    expect(digest.lines.length).toBeGreaterThan(3)
    expect(invocation.stdout).toContain('1 minted this run')
  })

  it('digests the most recently FINISHED run when none is named', async () => {
    const ws = workspace()

    const invocation = await run(ws, ['digest'])

    // `runs.list` orders by runId, and `${OLDER_RUN}` sorts AFTER `${NEWER_RUN}` — so an
    // implementation that took the last listed row would answer the older run here. The
    // chronology is what is being pinned.
    expect(OLDER_RUN > NEWER_RUN).toBe(true)
    expect(invocation.stdout).toContain(`digest — ${NEWER_RUN}`)
    expect(invocation.stdout).not.toContain(`digest — ${OLDER_RUN}`)
  })

  it('emits the structured sections under --json, not the rendered lines', async () => {
    const ws = workspace()
    const invocation = await run(ws, ['digest', NEWER_RUN, '--json'])

    const parsed = JSON.parse(invocation.stdout) as RunDigest
    expect(parsed.runId).toBe(NEWER_RUN)
    expect(parsed.chain).toEqual({ analysis: 'pending', curation: 'pending', issues: 'reserved' })
    expect(parsed.pendingProposalCount).toBe(0)
  })

  it('reports a run that never happened as an error, and sets a non-zero exit code', async () => {
    const ws = workspace()
    const invocation = await run(ws, ['digest', 'run-that-never-happened'])

    expect(invocation.stdout).toBe('')
    expect(invocation.stderr).toContain('RunNotFoundError')
    expect(invocation.exitCode).toBe(1)
  })
})

describe('agent-qa proposals (D-17, the decision surface)', () => {
  it('lists what is waiting, shows the receipts, then records the decision', async () => {
    const ws = workspace()
    const proposalId = mintProposal(ws, NEWER_RUN, 'checkout button', 11)

    const listed = await run(ws, ['proposals', 'list'])
    expect(listed.stdout).toContain('Proposals (1)')
    expect(listed.stdout).toContain(proposalId)
    expect(listed.stdout).toContain('pending')
    expect(listed.stdout).toContain(`run ${NEWER_RUN}`)

    // `show` is the ONE verb on this surface that renders evidence — D-18's boundary, made
    // concrete: the digest and the listing carry refs and counts, and a person reaches here
    // deliberately for the bytes.
    const shown = await run(ws, ['proposals', 'show', proposalId])
    expect(shown.stdout).toContain('receiptPreview')
    expect(shown.stdout).toContain('tombstonedRecords')

    const rejected = await run(ws, ['proposals', 'reject', proposalId, '--reason', 'not now'])
    expect(rejected.stdout).toContain('rejected')
    expect(rejected.stdout).toContain('not now')

    // The decision is DURABLE, read back through a fresh process-equivalent invocation.
    const after = await run(ws, ['proposals', 'list', '--status', 'rejected'])
    expect(after.stdout).toContain(proposalId)
    expect((await run(ws, ['proposals', 'list', '--status', 'pending'])).stdout)
      .toContain('Nothing is waiting on you.')
  })

  it('answers a named absence for an id nothing was minted under', async () => {
    const ws = workspace()
    const shown = await run(ws, ['proposals', 'show', 'prop_00000000-0000-4000-8000-000000000000'])
    expect(shown.stdout).toContain('No proposal is recorded under')
    expect(shown.exitCode).toBeUndefined()
  })

  it('reports an empty grant ledger as "every ask reaches you", not as an absence', async () => {
    const ws = workspace()
    const grants = await run(ws, ['proposals', 'grants', 'list'])
    expect(grants.stdout).toContain('No standing approvals are in force.')
    expect(grants.exitCode).toBeUndefined()

    // …and the WRITE verb beside it opens no fourth door. `grants.revoke` is `mutating-shared`
    // AND a member of the protected class set, so no standing approval can ever satisfy it: the
    // only ways through are session trust, a matching credential, or `local-interactive` plus a
    // bound confirm. A test process is headless with no terminal, so the gate refuses BEFORE
    // the ledger is touched — and the refusal is reported by name with the way forward in it.
    //
    // This is the assertion that makes `grants list` above a claim about a READ rather than
    // about a permissive surface: the same command tree, the same caller mint, one verb through
    // and one refused, on the tier each declares.
    const revoked = await run(ws, ['proposals', 'grants', 'revoke', 'grant_nothing_here'])
    expect(revoked.stdout).toBe('')
    expect(revoked.stderr).toContain('FunctionDeniedError')
    expect(revoked.stderr).toContain('fail-closed: ask in local-headless without trust')
    expect(revoked.stderr).toContain('--trust-session')
    expect(revoked.exitCode).toBe(1)
  })
})

describe('the surfaces own no capability of their own (L10)', () => {
  it('dispatches through invokeFunction with the CLI caller mint, and holds no gate', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    for (const file of ['digest.ts', 'proposals.ts']) {
      const source = readFileSync(
        fileURLToPath(new URL(`../commands/${file}`, import.meta.url)),
        'utf8',
      )
      // The ONE dispatch path, and the ONE caller. A hand-rolled caller literal here would be
      // a surface deciding its own origin, which is the fact the whole self-grant rule turns
      // on (D-06) — so `origin:` must not appear in either file at all.
      expect(source).toContain('invokeFunction')
      expect(source).toContain('CLI_FUNCTION_CALLER')
      expect(source).not.toMatch(/origin:\s*'(human|agent)'/u)
      // No gate, no registry construction, no store: a surface that could reach any of these
      // would have a path around the pipeline (T-384-01).
      expect(source).not.toContain('evaluate')
      expect(source).not.toContain('createRegistryFromSpecs')
      expect(source).not.toContain('agent-qa-knowledge-local')
      expect(source).not.toContain('agent-qa-safety')
    }
  })
})
