// D-02's three-tier approval, enforced TWO-SIDED and measured on the production composition
// (395-07 · CFGM-01 · spec/v2 §4.3, spec/v2/execution-safety.md §2.4).
//
// THE TWO SIDES ARE TWO MECHANISMS IN TWO FILES, and this suite is arranged so that each one's
// cells stay green when the other is severed. That disjointness is the claim — 391 D-05 spends two
// guards on one rule because neither subsumes the other, and a suite whose cells all red under
// either mutation would be describing one mechanism spelled twice:
//
//   MINT (`agent/…/ops/proposals-accept.ts`) — accept-with-always on a flagged proposal answers a
//        typed `cross-boundary` arm and calls the grants port NOT AT ALL. It guards what a producer
//        may author. It cannot guard a line that is already in the file.
//   READ (`agent/…/ops/config-proposal-apply.ts`) — a covering grant is treated as not matching
//        when the proposal it would authorize is flagged. It guards what a COMMITTED file may
//        authorize, including a line minted from an ordinary in-scope proposal, and including one
//        typed in by hand: `grants.jsonl` travels in pull requests.
//
// WHY THE TWO SIDES ARE DRIVEN THROUGH TWO DIFFERENT VERBS, which is a fact about this codebase and
// not a convenience. `proposals.accept` carries `fn:proposals.accept`, which is in the closed
// PROTECTED set — `grantsFor` never returns a line covering it, so no covering grant is ever
// consulted on that route and a read-side filter placed there would guard a consultation that does
// not happen. `config.proposal.apply` carries its own registered class, which is deliberately NOT
// protected, so it is the one door on this road a standing approval can open. The mint cells
// therefore drive the accept and the read cells drive the apply verb, and each is run in the
// execution context where its own question is the one being answered:
//
//   MINT cells  — `local-interactive` + an injected confirm, because `proposals.accept` is
//                 `mutating-shared` AND protected: in a headless context it is fail-closed-denied
//                 before the route is reached, and every cell below would pass while measuring
//                 nothing. Cell (M0) is the headless control that keeps that honest — it asserts
//                 the denial still happens, so the interactive scoping is a way IN and not a way
//                 AROUND. The confirm is a SPY, and every mint cell asserts it was called: a cell
//                 that reached the mint without an ask would be measuring a gate that stopped.
//   READ cells  — `local-headless` with NO confirm bound, which is the sharp arrangement: in that
//                 context a standing approval is the ONLY rung of the ladder that can allow, so a
//                 cell that gets past the gate got past it on the grant and on nothing else.
//                 Cell (R3) is the control for that — the same flagged proposal with NO grant is
//                 `fail-closed-denied`, which is what proves the grant in (R1)/(R2) is load-bearing.
//
// WHAT MAKES EACH CELL RED — the acceptance bar is the implementation a cell must fail on, never
// the suite it passes:
//
//   (M0) headless denial      — the gate stopping at `fn:proposals.accept`, or the protected class
//                               leaving the closed set. Reds if either changes.
//   (M1) mint refusal         — the mint half severed: the flag never consulted, so the flagged
//                               accept-with-always appends a real ledger line. Measured as BYTES,
//                               against a ledger seeded NON-EMPTY, so "nothing was written" is a
//                               comparison of a file that exists against itself.
//   (M2) mint allow           — a mint that refused by CLASS rather than by proposal, i.e. anything
//                               that made `fn:config.proposal.apply` behave like a protected class.
//                               This is the cell that stops (M1) being satisfied by refusing
//                               everything, and it is the single most likely wrong implementation
//                               of a safety flag.
//   (R1) read refusal         — the read half severed: the covering grant satisfies the ask and the
//                               flagged proposal commits. Reds on a `commits` delta.
//   (R2) read allow           — a read filter keyed on the CLASS instead of on the proposal. It
//                               uses the SAME grant, the SAME context and the SAME verb as (R1) and
//                               differs only in the proposal's flag, so the pair isolates the flag
//                               as the boundary.
//   (R3) no-grant control     — the read cells' own setup. Without it, (R1) would pass identically
//                               against a build that denied for a reason having nothing to do with
//                               the flag.
//   (R4) flag without reasons — a refusal whose SHAPE requires the reasons to be non-empty. The
//                               record is doctored to carry the flag with an empty reason list —
//                               a case the producer's own invariant rejects — and the refusal must
//                               still fire.
//   (B)  the binding          — a production composition that bound the gate's approvals reader
//                               without binding the grants PORT the read half folds. The two are
//                               the same committed file, and this cell reads both back.
//
// AND ONE BOUND IS STATED RATHER THAN HIDDEN, in cell (R2): this enforcement is exactly as good as
// the flag. A proposal whose classifier could not see its own values computes `crossBoundary:
// false` and is grantable — which is correct for an in-scope edit and is also the shape of 395-06's
// recorded `config.undo.propose` residue (`fieldEdits: []`). (R2) is that sentence as an executable
// fact; see the plan SUMMARY's Known Stubs for who closes it.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { createGrantOperations, grantsLedgerPath } from '@vostride/agent-qa-knowledge-local'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type {
  ConfigApplyOutcome,
  ConfigProposeOutput,
  ProposalRecord,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'

/** The grantable class, READ off the shipped op rather than typed (391 D-04). */
const CONFIG_APPLY_CLASS = 'fn:config.proposal.apply'

/**
 * A real, registered, UNPROTECTED class that is NOT the one under test.
 *
 * The seeded ledger line uses it so that every "the ledger did not change" assertion below compares
 * a non-empty file against itself. An absence over an empty channel is the trap this project keeps
 * recording; a file that exists, folds, and is byte-identical is not one.
 */
const UNRELATED_CLASS = 'fn:knowledge.forget.propose'

const CONFIG_FILE = 'agent-qa.config.yaml'

/**
 * The house-style config, valid against the real schema.
 *
 * `use.llm` names a registry entry that exists and every value parses, because a candidate that
 * failed whole-config validation would file a BLOCKED record and every cell here would be measuring
 * the wrong road in.
 */
const SEEDED_CONFIG = `# agent-qa Configuration

workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra
  targets:
    local-form:
      platform: web
      url: http://127.0.0.1:8931/form.html

use:
  llm: judge
  timeout:
    step: 30s
    test: 90m
    navigation: 2m
  mobile:
    appState: reset
  parallel: false
`

let root: string
let configPath: string
let agentQaRoot: string
let knowledgeRoot: string

function git(...args: string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout }
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').stdout.trim())
}

/** The committed ledger's exact bytes, or `undefined` when no file exists at all. */
function ledgerBytes(): string | undefined {
  const path = grantsLedgerPath(knowledgeRoot)
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function ledgerLines(): string[] {
  return (ledgerBytes() ?? '').split('\n').filter((line) => line.trim().length > 0)
}

/** One committed line through the REAL mint — the produced-not-literal corpus law (391's own). */
async function mintGrant(actionClass: string): Promise<void> {
  const verbs = createGrantOperations({
    resolveKnowledgeRoot: () => knowledgeRoot,
    auditBaseDir: agentQaRoot,
    now: () => '2026-08-14T09:00:00.000Z',
  })
  const outcome = await verbs.record({ actionClass, scope: STANDING_APPROVAL_SCOPE })
  if (outcome.kind !== 'recorded') throw new Error(`fixture mint failed: ${outcome.kind}`)
}

function pendingProposalPath(proposalId: string): string {
  return join(agentQaRoot, 'proposals', `${proposalId}.json`)
}

function storedRecord(proposalId: string): ProposalRecord {
  return JSON.parse(readFileSync(pendingProposalPath(proposalId), 'utf8')) as ProposalRecord
}

/** Propose through the PRODUCTION composition, headless — proposing asks nobody. */
async function propose(input: {
  readonly path: string
  readonly value: string
}): Promise<ConfigProposeOutput> {
  const host = composeCliLocalAgent({ agentQaRoot, configPath })
  try {
    return await invokeFunction(
      host.registry, 'config.field.set', input, CLI_FUNCTION_CALLER,
    ) as ConfigProposeOutput
  } finally {
    await host.close()
  }
}

/**
 * The two fixtures the whole suite turns on, PRODUCED through the shipped classifier.
 *
 * Neither flag is asserted from a literal anywhere: `flagged()` asserts the proposal really came
 * back `crossBoundary: true` with `secret-adjacent-field` among its reasons, and `inScope()`
 * asserts the opposite — so a classifier that started flagging everything, or nothing, fails the
 * fixture rather than quietly turning the cells below into two copies of one case.
 */
async function flaggedProposalId(): Promise<string> {
  // `workspace.envFile` NAMES THE FILE THE ENVIRONMENT VALUES ARE READ FROM, so repointing it
  // changes which secrets resolve into every run — the first entry on
  // `SECRET_ADJACENT_CONFIG_FIELDS`, and a change a person must be asked about individually.
  //
  // NOT `use.authState`, which is the entry a reader would reach for first and which this suite
  // MEASURED to be unwritable: the committed config's `use` is `UseSchema`, which is `.strict()`
  // and carries no `authState` key (only the per-test `UseOverrideSchema` does), so a proposal
  // there is refused by whole-config validation as `schema-fail` before it can be flagged at all.
  // Recorded as a finding in this plan's SUMMARY; the fixture uses a path that is genuinely both
  // writable and secret-adjacent, because a flagged fixture that could never be proposed would
  // make every cell below a measurement of nothing.
  const answer = await propose({ path: 'workspace.envFile', value: '.env.staging' })
  if (answer.outcome !== 'proposed') throw new Error(`fixture: ${answer.outcome}`)
  expect(answer.crossBoundary).toBe(true)
  expect(answer.crossBoundaryReasons).toContain('secret-adjacent-field')
  return answer.proposalId
}

async function inScopeProposalId(): Promise<string> {
  const answer = await propose({ path: 'use.timeout.step', value: '45s' })
  if (answer.outcome !== 'proposed') throw new Error(`fixture: ${answer.outcome}`)
  expect(answer.crossBoundary).toBe(false)
  expect(answer.crossBoundaryReasons).toEqual([])
  return answer.proposalId
}

/**
 * The MINT side's driver: `proposals.accept`, interactive, with a SPY confirm.
 *
 * The spy is returned so every cell can assert the ask really was reached. A mint cell that passed
 * without the confirm having been called would be one whose gate had stopped asking, and the
 * refusal it observed would be a fact about the gate rather than about the flag.
 */
async function acceptAlways(proposalId: string): Promise<{
  readonly answer: ProposalsAcceptOutput
  readonly confirmCalls: number
}> {
  const confirm = vi.fn(() => true)
  const host = composeCliLocalAgent({ agentQaRoot, configPath, confirm })
  try {
    const answer = await runSafetyScope({ executionContext: 'local-interactive' }, async () =>
      await invokeFunction(
        host.registry, 'proposals.accept', { proposalId, always: true }, CLI_FUNCTION_CALLER,
      ) as ProposalsAcceptOutput)
    return { answer, confirmCalls: confirm.mock.calls.length }
  } finally {
    await host.close()
  }
}

/**
 * The READ side's driver: `config.proposal.apply`, HEADLESS, with NO confirm bound.
 *
 * Both halves are the arrangement. Headless makes a standing approval the only rung that can
 * allow; binding no confirm means there is no second way through for a cell to pass on by accident.
 */
async function applyHeadless(proposalId: string): Promise<ConfigApplyOutcome> {
  const host = composeCliLocalAgent({ agentQaRoot, configPath })
  try {
    return await runSafetyScope({ executionContext: 'local-headless' }, async () =>
      await invokeFunction(
        host.registry, 'config.proposal.apply', { proposalId }, CLI_FUNCTION_CALLER,
      ) as ConfigApplyOutcome)
  } finally {
    await host.close()
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-grant-enforcement-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')
  knowledgeRoot = join(root, 'agent-qa-knowledge')
  mkdirSync(agentQaRoot, { recursive: true })
  mkdirSync(knowledgeRoot, { recursive: true })
  writeFileSync(configPath, SEEDED_CONFIG)

  git('init', '--quiet')
  // A fresh temp repository has no identity and `git commit` refuses without one; signing is
  // disabled so a developer machine configured to sign every commit does not make this depend on
  // a key.
  git('config', 'user.name', 'agent-qa grant enforcement test')
  git('config', 'user.email', 'grant-enforcement-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), '.agent-qa/\nagent-qa-knowledge/\n')
  git('add', '--', '.gitignore', CONFIG_FILE)
  git('commit', '--quiet', '-m', 'seed')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('D-02 mint side: accept-with-always never pre-approves a flagged proposal', () => {
  it('(M0) CONTROL: headless, the accept is fail-closed-denied before any of this is reached',
    async () => {
      await mintGrant(UNRELATED_CLASS)
      const proposalId = await flaggedProposalId()
      const before = ledgerBytes()

      // `fn:proposals.accept` is `mutating-shared` AND protected, so no grant can satisfy it and a
      // headless context has no other rung. This is what the interactive scoping in every other
      // mint cell is a way IN to — and the reason those cells are not measuring nothing.
      const host = composeCliLocalAgent({ agentQaRoot, configPath })
      try {
        await expect(
          runSafetyScope({ executionContext: 'local-headless' }, async () =>
            await invokeFunction(
              host.registry, 'proposals.accept', { proposalId, always: true }, CLI_FUNCTION_CALLER,
            )),
        ).rejects.toMatchObject({ name: 'FunctionDeniedError' })
      } finally {
        await host.close()
      }

      expect(ledgerBytes()).toBe(before)
      expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
      expect(commitCount()).toBe(1)
    })

  it('(M1) refuses the mint, applies anyway, and leaves the ledger byte-identical', async () => {
    await mintGrant(UNRELATED_CLASS)
    const proposalId = await flaggedProposalId()
    // NON-EMPTY, so the byte comparison below is a file compared against itself rather than an
    // absence compared against an absence.
    const before = ledgerBytes()
    expect(before).toBeDefined()
    expect(ledgerLines()).toHaveLength(1)

    const { answer, confirmCalls } = await acceptAlways(proposalId)

    // The ask really happened. Without this the refusal could be a gate that stopped asking.
    expect(confirmCalls).toBe(1)

    // THE APPLY HALF SURVIVES THE REFUSAL. Pitfall 9: refusals come back beside the receipt, never
    // instead of it — the person asked for the change and got it, and one commit exists to prove it.
    expect(answer.apply.outcome).toBe('applied')
    expect(answer.apply).toMatchObject({ applied: { kind: 'config' } })
    expect(commitCount()).toBe(2)
    expect(readFileSync(configPath, 'utf8')).toContain('envFile: .env.staging')

    // THE MINT HALF, as DATA, in the classifier's own words.
    expect(answer.grant.kind).toBe('cross-boundary')
    if (answer.grant.kind !== 'cross-boundary') throw new Error('unreachable')
    expect(answer.grant.reasons).toContain('secret-adjacent-field')

    // AND THE COMMITTED LEDGER IS EXACTLY WHERE IT WAS — bytes, not line count, so a rewritten
    // line of the same length fails too.
    expect(ledgerBytes()).toBe(before)
    expect(ledgerBytes()).not.toContain(CONFIG_APPLY_CLASS)
  })

  it('(M2) CONTROL: an in-scope proposal accepted with --always DOES record one', async () => {
    await mintGrant(UNRELATED_CLASS)
    const proposalId = await inScopeProposalId()

    const { answer, confirmCalls } = await acceptAlways(proposalId)

    expect(confirmCalls).toBe(1)
    expect(answer.apply.outcome).toBe('applied')

    // THE CLASS IS GRANTABLE. This is what makes (M1) a statement about the PROPOSAL: a mint that
    // refused by class would fail here, and a mint that refused everything would fail here too.
    expect(answer.grant.kind).toBe('recorded')
    if (answer.grant.kind !== 'recorded') throw new Error('unreachable')
    // PRODUCED, never typed: the class the mint recorded is the apply op's own `risk.name`.
    expect(answer.grant.grant.actionClass).toBe(CONFIG_APPLY_CLASS)
    expect(answer.grant.grant.proposalId).toBe(proposalId)

    // Exactly one line was appended, and it is the new one.
    expect(ledgerLines()).toHaveLength(2)
    expect(ledgerBytes()).toContain(CONFIG_APPLY_CLASS)
  })
})

describe('D-02 read side: a covering grant never satisfies a flagged proposal', () => {
  it('(R3) CONTROL: with NO grant, the same flagged apply is fail-closed-denied', async () => {
    const proposalId = await flaggedProposalId()
    expect(ledgerBytes()).toBeUndefined()

    // This is the read cells' own setup, measured: headless + no grant = the gate stops it. So
    // whatever gets past the gate in (R1)/(R2) got past it on the standing approval and on nothing
    // else, and (R1)'s refusal is demonstrably NOT this one.
    await expect(applyHeadless(proposalId)).rejects.toMatchObject({ name: 'FunctionDeniedError' })

    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
    expect(commitCount()).toBe(1)
  })

  it('(R1) the covering grant does not match: the flagged apply refuses, committing nothing',
    async () => {
      await mintGrant(CONFIG_APPLY_CLASS)
      const proposalId = await flaggedProposalId()
      const before = readFileSync(configPath, 'utf8')

      await expect(applyHeadless(proposalId))
        .rejects.toMatchObject({ name: 'CrossBoundaryConfigApplyError' })

      // NOT the gate's refusal — the class the grant covers really is this op's, and (R2) proves
      // the same grant admits. The refusal names the reason and the way through.
      await expect(applyHeadless(proposalId)).rejects.toThrow(/secret-adjacent-field/)
      await expect(applyHeadless(proposalId)).rejects.toThrow(/proposals accept/)

      // NOTHING WAS WRITTEN AND NOTHING WAS COMMITTED. The refusal is above every mutation, which
      // is the property rather than the message.
      expect(readFileSync(configPath, 'utf8')).toBe(before)
      expect(commitCount()).toBe(1)
      expect(git('status', '--porcelain', '--', CONFIG_FILE).stdout.trim()).toBe('')
    })

  it('(R2) CONTROL: the SAME grant satisfies an in-scope proposal, headless, with no confirm',
    async () => {
      await mintGrant(CONFIG_APPLY_CLASS)
      const proposalId = await inScopeProposalId()

      const outcome = await applyHeadless(proposalId)

      // THE FLAG IS THE BOUNDARY, NOT THE CLASS. Same verb, same context, same ledger line, no
      // confirm bound — and it commits. A read filter keyed on the class would fail here, and
      // (R1)'s refusal would then be saying nothing about cross-boundary-ness at all.
      expect(outcome.outcome).toBe('applied')
      expect(commitCount()).toBe(2)
      expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG.replace('step: 30s', 'step: 45s'))

      // THE BOUND, STATED AS AN EXECUTABLE FACT: this enforcement is exactly as good as the flag.
      // A proposal the classifier scored `false` is grantable and applies unattended — correct for
      // this in-scope edit, and the same road a proposal whose values the classifier could not
      // enumerate would take. See the SUMMARY's Known Stubs.
      expect(storedRecordCrossBoundary(proposalId)).toBe(false)
    })

  it('(R4) a record carrying the flag with NO reasons is still refused', async () => {
    await mintGrant(CONFIG_APPLY_CLASS)
    const proposalId = await inScopeProposalId()

    // A case the PRODUCER'S OWN INVARIANT rejects: `computeCrossBoundary` returns
    // `crossBoundary: reasons.length > 0`, so it can never mint this. A doctored record can, and so
    // can a build reading a record written by an older shape — and a guard whose refusal cannot be
    // expressed for the one input it exists to refuse is a guard with a hole exactly where it
    // matters. The stored payload schema admits the state; this asserts the enforcement does too.
    const record = storedRecord(proposalId)
    if (record.kind !== 'config' || record.payload.payloadKind !== 'applyable') {
      throw new Error('unreachable')
    }
    record.payload.crossBoundary = true
    record.payload.crossBoundaryReasons = []
    writeFileSync(pendingProposalPath(proposalId), `${JSON.stringify(record, null, 2)}\n`)

    await expect(applyHeadless(proposalId))
      .rejects.toMatchObject({ name: 'CrossBoundaryConfigApplyError' })
    await expect(applyHeadless(proposalId)).rejects.toThrow(/no reason recorded/)
    expect(commitCount()).toBe(1)
  })

  it('(B) the production composition binds BOTH halves of the one committed ledger', async () => {
    // The read half folds `grants.jsonl` through `FunctionDeps.standingGrants`; the gate folds the
    // SAME file through its approvals reader. A composition that bound the reader and not the port
    // would let a grant satisfy the ask while the read half saw an empty ledger — the one
    // arrangement in which this enforcement silently does nothing. Both are read back here.
    await mintGrant(CONFIG_APPLY_CLASS)
    const host = composeCliLocalAgent({ agentQaRoot, configPath })
    try {
      const listed = await runSafetyScope({ executionContext: 'local-headless' }, async () =>
        await invokeFunction(
          host.registry, 'grants.list', {}, CLI_FUNCTION_CALLER,
        ) as { grants: readonly { actionClass: string }[] })
      // The PORT sees the line …
      expect(listed.grants.map((grant) => grant.actionClass)).toContain(CONFIG_APPLY_CLASS)
    } finally {
      await host.close()
    }
    // … and the GATE sees it too, which is what (R2) applying unattended proves: nothing but a
    // standing approval can allow an ask in a headless context with no confirm bound.
  })
})

/** The stored record's own verdict, read OFF DISK rather than from the propose call's return. */
function storedRecordCrossBoundary(proposalId: string): boolean | undefined {
  const path = join(agentQaRoot, 'applied', `${proposalId}.json`)
  const record = JSON.parse(
    readFileSync(existsSync(path) ? path : pendingProposalPath(proposalId), 'utf8'),
  ) as ProposalRecord
  if (record.kind !== 'config' || record.payload.payloadKind !== 'applyable') return undefined
  return record.payload.crossBoundary
}
