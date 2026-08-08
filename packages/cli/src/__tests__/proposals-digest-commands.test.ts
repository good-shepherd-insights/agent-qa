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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction, RUNS_DIGEST_FUNCTION_ID } from '@vostride/agent-qa-agent'
import {
  createGrantOperations,
  grantsLedgerPath,
  proposeReview,
  publishBundleForTest,
} from '@vostride/agent-qa-knowledge-local'
import type { BundleStoreConfig } from '@vostride/agent-qa-knowledge-local'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import {
  asRunId,
  canonicalJson,
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  ProposalsAcceptOutputSchema,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  Anchor,
  CompletedRunHandoff,
  ProposalsAcceptOutput,
  RunDigest,
  Verdict,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDigestCommand } from '../commands/digest.js'
import { createProposalsCommand, renderAccept } from '../commands/proposals.js'
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

/**
 * Write the committed grant ledger by hand.
 *
 * The ONE place in this file that authors bytes rather than driving a verb, and it is the hand-edit
 * the whole read posture exists for: no producer can emit a damaged line, because the producer is
 * exactly the thing that refuses one.
 */
function writeGrantLedger(ws: Workspace, lines: readonly string[]): void {
  mkdirSync(ws.knowledgeRoot, { recursive: true })
  writeFileSync(grantsLedgerPath(ws.knowledgeRoot), `${lines.join('\n')}\n`, 'utf8')
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

    // The intact direction of the damage report: nothing was corrupted, so nothing is warned
    // about. Without this the warning case below would be satisfied by a rendering that printed
    // the warning unconditionally.
    expect(grants.stdout).not.toContain('unreadable line')
  })

  it('names every unreadable line on the same surface that lists the approvals', async () => {
    const ws = workspace()
    // A grant that FOLDS and a damaged line beside it: the operator most needing the warning is
    // the one whose ledger still lists approvals that will no longer authorize anything.
    writeGrantLedger(ws, [
      canonicalJson({
        schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
        kind: 'grant',
        at: '2026-08-08T10:00:00.000Z',
        grantId: 'grant_cli_damage_case',
        actionClass: 'fn:knowledge.proposal.apply',
        scope: STANDING_APPROVAL_SCOPE,
      }),
      // What a merge leaves behind when two branches both appended.
      '<<<<<<< HEAD{"schemaVersion":1,"kind":"revoke"}',
    ])

    const grants = await run(ws, ['proposals', 'grants', 'list'])
    expect(grants.stdout).toContain('grant_cli_damage_case')
    expect(grants.stdout).toContain('1 unreadable line')
    expect(grants.stdout).toContain('line 2')
    expect(grants.exitCode).toBeUndefined()
  })

  it('warns about the damage even when nothing folds at all', async () => {
    const ws = workspace()
    // The empty-fold arm. A ledger whose every line is damaged reads as "no standing approvals",
    // which is the answer that would send an operator looking in the wrong place.
    writeGrantLedger(ws, ['<<<<<<< HEAD{"schemaVersion":1,"kind":"grant"}'])

    const grants = await run(ws, ['proposals', 'grants', 'list'])
    expect(grants.stdout).toContain('No standing approvals are in force.')
    expect(grants.stdout).toContain('1 unreadable line')
    expect(grants.stdout).toContain('line 1')
    expect(grants.exitCode).toBeUndefined()
  })
})

// ---- accept --always over a damaged ledger (391-09, then 391-12 closing round-3 gap G-391-2) ----
//
// A person told `standing approval RECORDED` for an approval the reader refuses has no path to the
// explanation, so 391-09 made the mint refuse BY NAME. That refusal then propagated out of `invoke`
// as a throw and DISCARDED the `{apply, grant}` payload — telling a person the accept failed for a
// knowledge commit that had already happened, and sending them back to re-apply.
//
// 391-12 makes the refusal travel as DATA in a fourth `ledger-damaged` arm, so both halves of one
// decision ride one payload: the apply that committed, and the mint that did not.

describe('agent-qa proposals accept --always, over a grant ledger the build cannot fully read', () => {
  const LEDGER_AT = '2026-08-08T10:00:00.000Z'
  /** Two real, unprotected classes — deliberately NOT the apply class the accept below mints. */
  const FIRST_CLASS = 'fn:knowledge.forget.propose'
  const SECOND_CLASS = 'fn:knowledge.reject.propose'
  const ACCEPT_ID = 'proposals.accept'

  /** Two committed lines through the REAL mint — the produced-not-literal corpus law. */
  async function committedGrants(ws: Workspace): Promise<void> {
    const verbs = createGrantOperations({
      resolveKnowledgeRoot: () => ws.knowledgeRoot,
      auditBaseDir: ws.agentQaRoot,
      now: () => LEDGER_AT,
    })
    for (const actionClass of [FIRST_CLASS, SECOND_CLASS]) {
      const outcome = await verbs.record({ actionClass, scope: STANDING_APPROVAL_SCOPE })
      if (outcome.kind !== 'recorded') throw new Error(`fixture mint failed: ${outcome.kind}`)
    }
  }

  /** Fuse a merge marker onto the LAST committed line, in place — never an appended garbage line. */
  function damageLastLine(ws: Workspace): void {
    const path = grantsLedgerPath(ws.knowledgeRoot)
    const lines = readFileSync(path, 'utf8').split('\n')
    let last = lines.length - 1
    while (last >= 0 && (lines[last] ?? '').trim().length === 0) last -= 1
    if (last < 0) throw new Error('the fixture ledger has no line to damage')
    lines[last] = `<<<<<<< HEAD${lines[last] ?? ''}`
    writeFileSync(path, lines.join('\n'), 'utf8')
  }

  /**
   * The accept, driven on the PRODUCTION CLI composition.
   *
   * `confirm` is injected for the seam's documented purpose: this process has no tty, and the ask
   * arm has to ALLOW for the accept to reach the mint at all. The execution context is scoped for
   * the same reason — a headless process is fail-closed-denied before any ledger is touched, which
   * would answer a question about the gate rather than about the ledger.
   */
  async function acceptAlways<T>(
    ws: Workspace,
    call: (invoke: <R>(id: string, input: unknown) => Promise<R>) => Promise<T>,
  ): Promise<T> {
    const host = composeCliLocalAgent({
      agentQaRoot: ws.agentQaRoot,
      configPath: ws.configPath,
      confirm: () => true,
    })
    try {
      return await runSafetyScope({ executionContext: 'local-interactive' }, async () =>
        await call(async <R>(id: string, input: unknown): Promise<R> =>
          await invokeFunction(host.registry, id, input, CLI_FUNCTION_CALLER) as R))
    } finally {
      await host.close()
    }
  }

  it('reports the refused mint BESIDE the apply that committed, on ONE payload', async () => {
    const ws = workspace()
    const proposalId = mintProposal(ws, NEWER_RUN, 'damaged ledger button', 21)
    await committedGrants(ws)
    damageLastLine(ws)

    // Fixture validity first: one line still folds and the other is genuinely refused.
    const before = readFileSync(grantsLedgerPath(ws.knowledgeRoot), 'utf8')
    expect(before.split('\n').filter((line) => line.trim().length > 0)).toHaveLength(2)

    // No try/catch, deliberately. The accept must RESOLVE — a throw here is the defect, and a
    // `FunctionDeniedError` would mean the context scoping stopped taking and the mint was never
    // reached at all, so neither may be folded into a pass. Both fail this case loudly.
    const accepted = await acceptAlways(ws, async (invoke) =>
      await invoke<ProposalsAcceptOutput>(ACCEPT_ID, { proposalId, always: true }))

    // The apply half, ON THE ACCEPT PAYLOAD. It used to take a second `proposals show` round-trip
    // to establish this, and that round-trip only ever existed because the payload was discarded.
    expect(accepted.apply.outcome).toBe('applied')

    // The refusal travels as DATA. Compared as a STRING VALUE rather than through an imported
    // type, so this file stays loadable against the unmodified schema and the intact-ledger admit
    // control below is measurably green before the fix.
    expect(accepted.grant.kind).toBe('ledger-damaged')
    const damaged = accepted.grant as unknown as {
      kind: string
      reason: string
      refusedLines: readonly { lineNumber: number; reason: string }[]
    }
    // NON-EMPTY, and naming the line: a defensive extraction that quietly degraded to an empty
    // report would ship a refusal that names nothing, and this is what reds instead.
    expect(damaged.refusedLines.length).toBeGreaterThan(0)
    expect(damaged.refusedLines.map((line) => line.lineNumber)).toContain(2)
    expect(damaged.reason).toContain('1 line(s)')
    expect(damaged.reason).toContain('line 2')
    expect(damaged.reason).toContain('unparseable line')
    expect(damaged.reason).toContain('grants.jsonl')
    // WHAT THE REFUSAL SAYS ABOUT THE FILE, and only about the file. The write was refused, so no
    // line was appended and the ledger's bytes are unchanged — both true of `record` and of
    // `revoke`, which share this error and only one of which mints anything.
    expect(damaged.reason).toContain('No line was appended')
    expect(damaged.reason).toContain('byte-unchanged')
    // AND WHAT IT MUST NOT SAY. This call's apply COMMITTED before the mint ran, so a refusal
    // claiming the operation decided nothing is false of exactly the payload this arm exists to
    // carry — and the predictable thing a person does when told nothing happened is do it again.
    //
    // Ranged as a PATTERN rather than as the one removed sentence, for two reasons: the exact
    // sentence is already negative-grepped out of the whole package tree by this plan's gate, so
    // restating it here would only re-introduce the string it bans; and the property is the CLASS
    // of claim, not one spelling of it. Any future clause denying that the call decided/recorded/
    // did anything reds here, whatever words it picks.
    expect(damaged.reason).not.toMatch(/nothing was (?:decided|recorded|done)/iu)

    // And the refused mint changed no byte of the committed authorization file.
    expect(readFileSync(grantsLedgerPath(ws.knowledgeRoot), 'utf8')).toBe(before)

    // The render, over the payload the PRODUCTION composition actually produced — parsed through
    // the contract first, so an off-contract payload could not be rendered at all. Both halves,
    // and the damage on its own line so it cannot read as a footnote to the apply above it.
    const rendered = renderAccept(ProposalsAcceptOutputSchema.parse(accepted)).split('\n')
    expect(rendered[0]).toContain('applied (knowledge)')
    expect(rendered.slice(1).join('\n')).toContain('standing approval NOT recorded')
    expect(rendered.slice(1).join('\n')).toContain('2')
  })

  it('renders BOTH halves of a contract-parsed ledger-damaged payload', () => {
    // The cheap twin of the assertion above: no composition, no disk, no ledger — only the render
    // contract. `parse` is the guard that keeps a hand-built payload honest; an off-contract shape
    // throws here rather than reaching the renderer.
    const payload = ProposalsAcceptOutputSchema.parse({
      apply: {
        outcome: 'applied',
        applied: {
          kind: 'knowledge',
          outcome: {
            outcome: 'applied',
            proposal: {
              schemaVersion: 1,
              proposalId: 'prop_render-fixture',
              verb: 'reject',
              targetRef: { grain: 'record', recordId: 'rec-render-fixture' },
              deltas: [],
              proposedAt: 0,
              status: 'applied',
            },
          },
        },
      },
      grant: {
        kind: 'ledger-damaged',
        reason: 'GrantLedgerDamagedError: 1 line(s) of grants.jsonl could not be read — '
          + 'line 2: unparseable line. Repair the named line(s) in grants.jsonl and retry.',
        refusedLines: [{ lineNumber: 2, reason: 'unparseable line' }],
      },
    })

    const lines = renderAccept(payload).split('\n')
    expect(lines[0]).toContain('applied (knowledge)')
    // On its OWN line, and carrying the operator's two facts: the apply happened, the mint did not.
    const damage = lines.slice(1).join('\n')
    expect(damage).toContain('standing approval NOT recorded')
    expect(damage).toContain('line(s) 2')
    expect(damage).toContain('grants.jsonl')
    expect(damage).toContain('WAS applied')
  })

  it('records the standing approval over an UNDAMAGED workspace — the composition\'s admit side', async () => {
    const ws = workspace()
    const proposalId = mintProposal(ws, NEWER_RUN, 'intact ledger button', 22)
    await committedGrants(ws)

    const accepted = await acceptAlways(ws, async (invoke) =>
      await invoke<ProposalsAcceptOutput>(ACCEPT_ID, { proposalId, always: true }))

    // Same fixture, same composition, same confirm — only the damage is missing. So the refusal
    // above is the damaged line's and not the CLI host's.
    expect(accepted.apply.outcome).toBe('applied')
    expect(accepted.grant.kind).toBe('recorded')
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
