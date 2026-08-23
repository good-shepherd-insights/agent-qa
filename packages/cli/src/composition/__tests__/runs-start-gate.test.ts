// THE FN/CHAT/MCP DOOR'S `runs.start` GATE (Phase 401 plan 05 — D-01/D-05/D-06/D-07/D-16).
//
// WHAT IS UNDER TEST is the door a caller actually reaches: `composeCliLocalAgent` → the 384
// registry → `invokeFunction` → the REAL op-level gate → the bound run invocation → this host's
// DEFAULT run execution → the in-process drive → the core's ONE `evaluate()`. Nothing on that path
// is substituted. `input.runExecution` is never supplied by any cell in this file, because the
// subject IS the default: a cell that injected a port would be measuring its own argument.
//
// THE RED BASELINE, measured on the pre-change build and pasted into the plan's SUMMARY rather
// than paraphrased. Before Task 1 this host's default was `createCliRunExecution` — a child
// process — and the two cells that discriminate could not pass:
//
//   FN-DOOR DENIAL  expected RunDeniedError, received RunProducedNoEventsError
//                   (the child denied, exited 2, and the gate's reason died in its stderr)
//   TWO GATES       expected 2 audit rows across 2 files, received 1
//                   (the child's run-dir row was written under ITS OWN minted run id, and the
//                    parent never saw a `run:start` decision at all)
//
// A DENIAL'S ASSERTION SURFACE IS FIVE ARTIFACTS, never an exit code or a message alone (401-03's
// Mutation B): the audit row's `outcome`, no run events, no build-ordinal ledger, zero requests at
// the target, and the reason read BACK off the row. Every denial cell below asserts all five and
// is paired with an allow control differing in EXACTLY ONE field.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { generateRunId } from '@vostride/agent-qa-ids'
import {
  RunDeniedError,
  RunIdAlreadyInUseError,
  RunIdNotMintedError,
} from '@vostride/agent-qa-agent-local'
import type { RunInvocationCoreOptions } from '@vostride/agent-qa-agent-local'
import {
  getActiveExecutionContext,
  setActiveExecutionContextResolver,
} from '@vostride/agent-qa-safety'
import { STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import type { RunStartAcknowledgement, RunsStartInput } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'
import type { ComposeCliLocalAgentInput } from '../local-agent-host.js'
import { runInProcessCliRun } from '../in-process-run-execution.js'
import {
  CountingTarget,
  auditRows,
  buildOrdinalsExist,
  createInProcessFixture,
  eventTypes,
  runDirs,
} from './in-process-run-fixture.js'
import type { AuditRow } from './in-process-run-fixture.js'

/**
 * The audit row, plus the one field this plan's cells turn on.
 *
 * `trustSource` is what `resolveAsk` stamps when a standing approval, a credential or session trust
 * carried an ask — the ONLY trace a consumed grant leaves on a row, and therefore the whole of the
 * grant-isolation measurement below. Widened HERE rather than on the shared fixture's `AuditRow`
 * (401-04's), because a helper two other plans read should not grow a field for one plan's cells.
 */
type GateAuditRow = AuditRow & { readonly trustSource?: string }

type Fixture = ReturnType<typeof createInProcessFixture>

/**
 * The OP-level gate's rows, which land somewhere else entirely.
 *
 * `composeLocalAgent` gives the registry a `JsonlAuditSink(agentQaRoot)`; the core gets a per-run
 * sink under `runs/<slug(runId)>/`. Two sinks, two files — which is why "the two gates never merge"
 * is a structural property here rather than a convention, and why this helper exists beside
 * `auditRows` (the run-dir reader) instead of being folded into it.
 */
function opAuditRows(fixture: Fixture): GateAuditRow[] {
  const path = join(fixture.agentQaRoot, 'execution_audit.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as GateAuditRow)
}

/** An empty browsers root, so a member's failure is a property of the fixture, not of the machine. */
function pinEmptyBrowsersRoot(fixture: Fixture): void {
  const browsersRoot = join(fixture.project, 'no-browsers')
  if (!existsSync(browsersRoot)) mkdirSync(browsersRoot, { recursive: true })
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot
}

/**
 * Compose the SHIPPED host and invoke `runs.start` through the SHIPPED dispatcher.
 *
 * Everything a door may answer is passed here and nothing else is: no `runExecution`, no producer,
 * no assembler. What comes back is what a real MCP or chat caller gets.
 */
async function invokeRunsStart(
  fixture: Fixture,
  request: RunsStartInput,
  door: Partial<Pick<ComposeCliLocalAgentInput, 'resolveExecutionContext' | 'confirm'>> = {},
): Promise<RunStartAcknowledgement> {
  pinEmptyBrowsersRoot(fixture)
  const { registry } = composeCliLocalAgent({
    agentQaRoot: fixture.agentQaRoot,
    configPath: fixture.configPath,
    ...door,
  })
  return await invokeFunction(
    registry,
    'runs.start',
    request,
    CLI_FUNCTION_CALLER,
  ) as RunStartAcknowledgement
}

/** Invoke and hand back whatever came out, so a cell can assert on a refusal without try/catch. */
async function invokeRunsStartOutcome(
  fixture: Fixture,
  request: RunsStartInput,
  door: Partial<Pick<ComposeCliLocalAgentInput, 'resolveExecutionContext' | 'confirm'>> = {},
): Promise<{ ack?: RunStartAcknowledgement; error?: unknown }> {
  try {
    return { ack: await invokeRunsStart(fixture, request, door) }
  } catch (error) {
    return { error }
  }
}

/** The one run-gate row. Exactly one, or the cell is reading a run it did not mean to. */
function theRunGateRow(fixture: Fixture): GateAuditRow {
  const rows = (auditRows(fixture) as GateAuditRow[]).filter((row) => row.action === 'run:start')
  expect(rows).toHaveLength(1)
  return rows[0]!
}

// ---- ambient channels, varied against the door's own answer (D-07) ---------------------------
//
// Two of them, because there are two and a cell that defeated one would pass under a door reading
// the other: `getActiveExecutionContext` is the process-global the OP gate falls back to, and the
// CI marker is what `resolveRunExecutionContext()` — this door's OWN fallback — reads. Varying
// both, against a door that supplies its context explicitly, is what makes "the injected value
// wins" a measurement instead of a coincidence.

const shippedExecutionContextResolver = getActiveExecutionContext
let restoreAmbient: (() => void) | undefined

beforeEach(() => { restoreAmbient = undefined })
afterEach(() => {
  restoreAmbient?.()
  restoreAmbient = undefined
})

function pinAmbient(value: 'ci' | 'local-interactive' | 'local-headless', ciMarker: boolean): void {
  const priorGithubActions = process.env.GITHUB_ACTIONS
  setActiveExecutionContextResolver(() => value as never)
  if (ciMarker) process.env.GITHUB_ACTIONS = 'true'
  else delete process.env.GITHUB_ACTIONS
  restoreAmbient = () => {
    setActiveExecutionContextResolver(() => shippedExecutionContextResolver())
    if (priorGithubActions === undefined) delete process.env.GITHUB_ACTIONS
    else process.env.GITHUB_ACTIONS = priorGithubActions
  }
}

describe('the fn/MCP door refuses an ungated run and acks a gated one (401-05, D-16)', () => {
  it('THE FN-DOOR DENIAL — an UNDECLARED target from a fail-closed context, five artifacts', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // No `environment:` line at all — the D-06 undeclared case, which classifies SHARED. The
      // allow control below writes `environment: local` and changes nothing else.
      const fixture = createInProcessFixture({ origin: target.origin })
      // The ambient says "there is a person here". The door says otherwise, and the door is what
      // the gate reads.
      pinAmbient('local-interactive', false)

      const { ack, error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern] },
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(ack).toBeUndefined()
      // THE TYPED REFUSAL RECEIPT, asserted on its FIELDS. The op does not re-wrap it (D-05:
      // `runs-start.ts` is untouched), and it does not need to: `RunDeniedError` already carries
      // the gate's reason, its STRUCTURED remedies and the surface-neutral reason, which is the
      // whole of what a receipt is for.
      expect(error).toBeInstanceOf(RunDeniedError)
      const denial = error as RunDeniedError
      expect(denial.remedies.length).toBeGreaterThan(0)
      for (const remedy of denial.remedies) {
        expect(typeof remedy.kind).toBe('string')
        expect(remedy.kind.length).toBeGreaterThan(0)
      }
      expect(denial.neutralReason.length).toBeGreaterThan(0)

      // (a) the audit row's OUTCOME field, never a message substring
      const row = theRunGateRow(fixture)
      expect(row.outcome).toBe('fail-closed-denied')
      expect(row.verdict).toBe('deny')
      expect(row.riskTier).toBe('mutating-shared')
      expect(row.executionContext).toBe('local-headless')
      // (b) THE RUN NEVER STARTED — `runStarted` is seq 1 of any run that began at all
      expect(eventTypes(fixture)).toEqual([])
      // (c) the durable assembly side effect never happened
      expect(buildOrdinalsExist(fixture)).toBe(false)
      // (d) nobody knocked on the target
      expect(target.hits).toEqual([])
      // (e) the reason the caller sees is READ BACK off the row, not typed into this cell — which
      // pins the door to RENDERING the gate's decision rather than composing one of its own.
      expect(denial.reason).toBe(row.reason)
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE ALLOW CONTROL — one field different (environment: local) and the run is acknowledged', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-interactive', false)

      const { ack, error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern] },
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(error).toBeUndefined()
      expect(ack).toBeDefined()
      // THE ACK IS READ OFF THE DURABLE RECORD, which is the op's own anti-fabrication law: the
      // run id it names has a run directory, and its `testCount` is the member set that record
      // carries rather than the request's pattern count.
      expect(typeof ack!.runId).toBe('string')
      expect(ack!.runId.length).toBeGreaterThan(0)
      expect(ack!.testCount).toBe(1)
      expect(runDirs(fixture).map((dir) => dir.split('/').pop())).toContain(ack!.runId)

      const row = theRunGateRow(fixture)
      expect(row.outcome).toBe('proceeded')
      expect(row.riskTier).toBe('mutating-local')
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE D-07 CROSSING — the door’s injected context beats BOTH varied ambients', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      // Every ambient channel says "interactive, not CI". A confirm port is present and WOULD
      // approve. If anything on this path read the ambient, the outcome would be
      // `prompted-approved` and the run would have started.
      pinAmbient('local-interactive', false)
      let confirmCalls = 0

      const { error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern] },
        {
          resolveExecutionContext: () => 'local-headless',
          confirm: { surface: 'tty-prompt', ask: () => { confirmCalls += 1; return true } },
        },
      )

      expect(error).toBeInstanceOf(RunDeniedError)
      expect(theRunGateRow(fixture).outcome).toBe('fail-closed-denied')
      // THE DISCRIMINATOR. `fail-closed-denied` is reached BEFORE the confirm is consulted; a door
      // that had resolved `local-interactive` would have asked and been told yes.
      expect(confirmCalls).toBe(0)
      expect(eventTypes(fixture)).toEqual([])
      expect(target.hits).toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE CROSSING’S OTHER ARM — injected local-interactive over an ambient CI asks, and proceeds', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      // Both ambients now say CI — including the CI MARKER, which is what this door's own
      // `resolveRunExecutionContext()` fallback reads. The door says interactive.
      pinAmbient('ci', true)
      let confirmCalls = 0

      const { error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern] },
        {
          resolveExecutionContext: () => 'local-interactive',
          confirm: { surface: 'tty-prompt', ask: () => { confirmCalls += 1; return true } },
        },
      )

      // The run STARTED, so whatever came back is not a denial.
      expect(error).not.toBeInstanceOf(RunDeniedError)
      expect(confirmCalls).toBe(1)
      const row = theRunGateRow(fixture)
      expect(row.outcome).toBe('prompted-approved')
      expect(row.executionContext).toBe('local-interactive')
      expect(eventTypes(fixture)).toContain('runStarted')
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE MCP POSTURE — `confirm: undefined` refuses to ask, and writes NOTHING to stdout', async () => {
    const target = new CountingTarget()
    await target.listen()
    // A TTY ON BOTH ENDS, and it is the whole discriminator.
    //
    // 396-01 D-09's rule is that the confirm FIELD's presence is read, not its value:
    // `confirm: undefined` REFUSES to ask, where an absent field would default to a tty prompt.
    // Under vitest that distinction is invisible for free — `createTtyConfirmPort()` sees no
    // terminal and answers `undefined` either way, so a cell run on the real streams passes under
    // a door that had collapsed the rule back into `??`. Measured: it does.
    //
    // So both streams are replaced with a terminal that ENDS IMMEDIATELY. The default port would
    // now build, write its prompt, and refuse on EOF — the same verdict — which is exactly why the
    // assertion is on the BYTES rather than on the verdict. Writing a prompt onto the one process
    // whose stdout is the JSON-RPC channel does not go unanswered; it breaks the connection.
    const realStdin = process.stdin
    const realStdout = process.stdout
    const written: string[] = []
    const fakeIn = new Readable({ read() { this.push(null) } }) as Readable & { isTTY?: boolean }
    fakeIn.isTTY = true
    const fakeOut = new Writable({
      write(chunk: unknown, _enc: unknown, done: () => void) { written.push(String(chunk)); done() },
    }) as Writable & { isTTY?: boolean }
    fakeOut.isTTY = true
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
      pinAmbient('local-interactive', false)

      Object.defineProperty(process, 'stdin', { value: fakeIn, configurable: true })
      Object.defineProperty(process, 'stdout', { value: fakeOut, configurable: true })
      let outcome: Awaited<ReturnType<typeof invokeRunsStartOutcome>>
      try {
        outcome = await invokeRunsStartOutcome(
          fixture,
          { patterns: [fixture.testPattern] },
          { resolveExecutionContext: () => 'local-interactive', confirm: undefined },
        )
      } finally {
        Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true })
        Object.defineProperty(process, 'stdout', { value: realStdout, configurable: true })
      }

      expect(outcome.error).toBeInstanceOf(RunDeniedError)
      // `prompted-denied`, not `fail-closed-denied`: the context IS interactive, and what refused
      // is the gate's own `DENY_CONFIRM` default standing in for a door that will not ask.
      expect(theRunGateRow(fixture).outcome).toBe('prompted-denied')
      // NOT ONE BYTE. This is the assertion a `??` reading of the field cannot satisfy.
      expect(written).toEqual([])
      expect(eventTypes(fixture)).toEqual([])
      expect(target.hits).toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)
})

describe('the two gates touch and never merge (401-05, INVK-02 adjacency edge)', () => {
  it('ONE CALL, TWO ROWS, TWO FILES, TWO ACTION NAMES', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)

      const { ack } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern] },
        { resolveExecutionContext: () => 'local-headless' },
      )
      expect(ack).toBeDefined()

      // THE OP-LEVEL ROW, in the composition's own sink at `<agentQaRoot>/execution_audit.jsonl`.
      const opRows = opAuditRows(fixture).filter((row) => row.action === 'fn:runs.start')
      expect(opRows).toHaveLength(1)
      expect(opRows[0]!.riskTier).toBe('mutating-local')
      expect(opRows[0]!.verdict).toBe('allow')
      expect(opRows[0]!.outcome).toBe('proceeded')

      // THE CORE-LEVEL ROW, in the RUN's own directory. A different action, a different tier
      // decision, a different file.
      const runRow = theRunGateRow(fixture)
      expect(runRow.action).toBe('run:start')
      expect(runRow.runId).toBe(ack!.runId)

      // Neither file carries the other's action. This is the "never merge" half, and it is asserted
      // as a set relation rather than by counting one file: a single sink serving both gates would
      // satisfy any per-file count you cared to write.
      expect(opAuditRows(fixture).map((row) => row.action)).not.toContain('run:start')
      expect(auditRows(fixture).map((row) => row.action)).not.toContain('fn:runs.start')
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE MECHANISM — with a LIVE reader at the run gate, the grant NAME is the whole difference', async () => {
    // WHY THIS CELL EXISTS, and why it composes the drive directly rather than the host.
    //
    // The isolation claim is `grantCovers` → `grant.actionClass === action.name`. At the shipped
    // door neither gate can consume a grant at all: the op's `mutating-local` tier never reaches
    // `resolveAsk`, and this door passes NO `reader` to the run gate (the D-08 overlay is plan
    // 08's, and nothing mints a `run:start` grant today). So a cell that only drove the door would
    // measure "no grant is ever consumed anywhere" and pass under a `grantCovers` that matched on
    // a prefix, a family, or nothing at all.
    //
    // Here the reader is LIVE and deliberately does NOT filter — it returns its one grant for every
    // action it is asked about — so the only thing that can refuse a name mismatch is `grantCovers`
    // itself. The two arms differ in ONE string.
    const readerServing = (actionClass: string): RunInvocationCoreOptions['reader'] => ({
      grantsFor: () => [{ actionClass, scope: STANDING_APPROVAL_SCOPE }],
    })

    const arm = async (actionClass: string): Promise<{ fixture: Fixture; error?: unknown }> => {
      const target = new CountingTarget()
      await target.listen()
      try {
        const fixture = createInProcessFixture({ origin: target.origin, environment: 'shared' })
        pinEmptyBrowsersRoot(fixture)
        try {
          await runInProcessCliRun(
            {
              configPath: fixture.configPath,
              agentQaRoot: fixture.agentQaRoot,
              executionContext: 'local-headless',
              reader: readerServing(actionClass),
            },
            { patterns: [fixture.testPattern] },
          )
          return { fixture }
        } catch (error) {
          return { fixture, error }
        }
      } finally {
        await target.close()
      }
    }

    // THE OP'S NAME does not satisfy the run gate. The grant is present, readable and in scope.
    const opNamed = await arm('fn:runs.start')
    expect(opNamed.error).toBeInstanceOf(RunDeniedError)
    const deniedRow = theRunGateRow(opNamed.fixture)
    expect(deniedRow.outcome).toBe('fail-closed-denied')
    expect(deniedRow.trustSource).toBeUndefined()
    expect(eventTypes(opNamed.fixture)).toEqual([])

    // THE RUN GATE'S OWN NAME does. Same reader, same scope, same fixture shape, same context —
    // one string different, and the ask resolves through the standing approval.
    const runNamed = await arm('run:start')
    expect(runNamed.error).not.toBeInstanceOf(RunDeniedError)
    const allowedRow = theRunGateRow(runNamed.fixture)
    expect(allowedRow.outcome).toBe('proceeded')
    expect(allowedRow.trustSource).toBe('standing-approval')
    expect(eventTypes(runNamed.fixture)).toContain('runStarted')
  }, 240_000)

  it('THE CONVERSE — a COMMITTED `run:start` grant is not consumed at the op gate', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)

      // A REAL ledger line, in the file the op gate's own `createStandingApprovalReader` reads —
      // not a stub. `grants.jsonl` is a committed artifact a human can write by hand, and a
      // hand-written line folds exactly like a minted one, which is the reader's own stated model.
      const knowledgeRoot = join(fixture.project, 'agent-qa-knowledge')
      mkdirSync(knowledgeRoot, { recursive: true })
      writeFileSync(
        join(knowledgeRoot, 'grants.jsonl'),
        `${JSON.stringify({
          schemaVersion: 1,
          kind: 'grant',
          at: '2026-08-23T00:00:00.000Z',
          grantId: 'g_401_05_converse',
          actionClass: 'run:start',
          scope: STANDING_APPROVAL_SCOPE,
        })}\n`,
      )
      // The reader the op gate uses is the SHIPPED one, and its exact-match filter is measured
      // here rather than assumed: asked about the op's action it answers with nothing, asked about
      // the run gate's it answers with the grant. So the file is live in both directions.
      const { createStandingApprovalReader } = await import('@vostride/agent-qa-knowledge-local')
      const reader = createStandingApprovalReader({ knowledgeRoot })
      expect(reader.grantsFor(
        { name: 'fn:runs.start', recognized: true },
        STANDING_APPROVAL_SCOPE,
      )).toEqual([])
      expect(reader.grantsFor(
        { name: 'run:start', recognized: true },
        STANDING_APPROVAL_SCOPE,
      )).toEqual([{ actionClass: 'run:start', scope: STANDING_APPROVAL_SCOPE }])

      const { ack } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern] },
        { resolveExecutionContext: () => 'local-headless' },
      )
      expect(ack).toBeDefined()

      // The op gate allowed on its DECLARED TIER and on nothing else. A grant consumed here would
      // have stamped `trustSource: 'standing-approval'` on this row — the field `resolveAsk` sets
      // and the only trace a consumed grant leaves.
      const opRows = opAuditRows(fixture).filter((row) => row.action === 'fn:runs.start')
      expect(opRows).toHaveLength(1)
      expect(opRows[0]!.outcome).toBe('proceeded')
      expect(opRows[0]!.trustSource).toBeUndefined()
      expect(opRows[0]!.riskTier).toBe('mutating-local')
    } finally {
      await target.close()
    }
  }, 120_000)
})

describe('the empty-input and suite edges of a bare runs.start (401-05, INVK-02)', () => {
  it('AN ARGUMENT-LESS runs.start RESOLVES THE CONFIGURED DEFAULT SET — and denies on class alone', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      // No patterns, no credential, no trust, an EMPTY request object — and an undeclared target.
      const fixture = createInProcessFixture({ origin: target.origin })
      pinAmbient('local-interactive', false)

      const { error } = await invokeRunsStartOutcome(
        fixture,
        {},
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(error).toBeInstanceOf(RunDeniedError)
      expect(theRunGateRow(fixture).outcome).toBe('fail-closed-denied')
      expect(eventTypes(fixture)).toEqual([])
      expect(buildOrdinalsExist(fixture)).toBe(false)
      expect(target.hits).toEqual([])
      expect((error as RunDeniedError).reason).toBe(theRunGateRow(fixture).reason)
    } finally {
      await target.close()
    }
  }, 120_000)

  it('THE SAME EMPTY REQUEST, target declared local — the default set RAN, both members of it', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-interactive', false)

      const { ack } = await invokeRunsStartOutcome(
        fixture,
        {},
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(ack).toBeDefined()
      // TWO, and the number is the assertion. The fixture's `testMatch` admits `tests/direct.yaml`
      // AND `tests/member.yaml`, so "absent patterns means the configured default set" is only
      // true if BOTH are in the run the record describes. A door that quietly resolved one file,
      // or none, would still have produced an ack.
      expect(ack!.testCount).toBe(2)
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(theRunGateRow(fixture).outcome).toBe('proceeded')
    } finally {
      await target.close()
    }
  }, 120_000)

  it('A SUITE PATTERN over the fn door runs the SUITE, and the MEMBER ran', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)

      const { ack } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.suitePattern] },
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(ack).toBeDefined()
      const events = eventTypes(fixture)
      expect(events).toContain('runStarted')
      // THE MEMBER RAN. Without this, a dispatcher that took the test path and assembled zero
      // members would pass on `runStarted` alone — which is the shape the retiring wire could
      // produce, because it forwarded patterns with no mode flag and let the child decide.
      expect(events).toContain('testStarted')
      expect(ack!.testCount).toBe(1)
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('AN UNHONOURABLE FIELD IS REFUSED BEFORE ANYTHING IS READ', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)

      const { error } = await invokeRunsStartOutcome(
        fixture,
        { scope: { tier: 'product', key: 'shop' } } as RunsStartInput,
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect((error as Error).name).toBe('RunRequestFieldRefusedError')
      expect((error as Error).message).toContain('scope')
      // NOTHING WAS READ, NOTHING WAS DECIDED, NOTHING WAS MINTED. The core states this ordering;
      // a drive standing in front of it is where the property is actually kept, because everything
      // before the core resolves the caller's config and loads its auth plugins.
      expect(runDirs(fixture)).toEqual([])
      expect(buildOrdinalsExist(fixture)).toBe(false)
      expect(target.hits).toEqual([])
      // Not even the OP gate's row exists for a request refused this early? It does — the op gate
      // ran and allowed, because the refusal is the RUN seam's and the op's own tier is unrelated.
      // Asserted so the boundary between the two is stated rather than left to be inferred.
      expect(opAuditRows(fixture).map((row) => row.action)).toEqual(['fn:runs.start'])
      expect(auditRows(fixture)).toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// THE TYPED DOOR'S IDENTITY REFUSALS, AND THE DOOR CENSUS (2026-08-23, plan 20 · CR-04).
//
// D-16's rule applied to a new refusal: reaching through the same seam is MEASURED per door, never
// assumed. The environment door is measured on the process a person starts
// (`commands/__tests__/run-gate.e2e.test.ts`); this file measures the typed door, where a caller
// gets a typed refusal instead of a stderr line and where a PATH-SHAPED id is answered by a
// different mechanism entirely — the codec, at parse, before the op is invoked at all.

/** The digest of every file in a run's directory. "Untouched" has to be a claim about bytes. */
function digestsUnder(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {}
  const digests: Record<string, string> = {}
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (!statSync(path).isFile()) continue
    digests[name] = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  return digests
}

describe('the typed door refuses a malformed or colliding run id (CR-04)', () => {
  it('a PATH-SHAPED id is refused by the CODEC, before the op runs at all', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)

      const { ack, error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern], runId: '../../escape' as never },
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(ack).toBeUndefined()
      expect(error).toBeDefined()
      // Pre-fix this exact request was ACKNOWLEDGED, naming `../../escape`, with the run's own
      // artifacts written into `.agent-qa/runs/escape/`.
      expect(runDirs(fixture)).toEqual([])
      expect(existsSync(join(fixture.project, '.agent-qa', 'runs', 'escape'))).toBe(false)
      expect(target.hits).toEqual([])
      // THE DISCRIMINATOR between this cell and the next: the codec refuses at PARSE, so the op's
      // own gate never ran and there is no `fn:runs.start` row. That is what makes "the schema door
      // and the core door are two different refusals" a measurement rather than a claim.
      expect(opAuditRows(fixture)).toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('an id the system would not have MINTED is refused by the core, by name', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)

      const { ack, error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern], runId: 'not-a-minted-id' as never },
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(ack).toBeUndefined()
      expect(error).toBeInstanceOf(RunIdNotMintedError)
      expect((error as Error).message).toContain('not-a-minted-id')
      // It passed the CODEC — `not-a-minted-id` is a perfectly good path segment — so the op DID
      // run and its own gate DID record a row. The run itself never started.
      expect(opAuditRows(fixture).map((row) => row.action)).toEqual(['fn:runs.start'])
      expect(runDirs(fixture)).toEqual([])
      expect(buildOrdinalsExist(fixture)).toBe(false)
      expect(target.hits).toEqual([])
    } finally {
      await target.close()
    }
  }, 120_000)

  it('a COLLIDING id is refused, and the victim run is byte-identical after', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)
      const victimId = generateRunId()

      const first = await invokeRunsStart(
        fixture,
        { patterns: [fixture.testPattern], runId: victimId as never },
        { resolveExecutionContext: () => 'local-headless' },
      )
      expect(first.runId).toBe(victimId)
      const victimDir = join(fixture.project, '.agent-qa', 'runs', victimId)
      const before = digestsUnder(victimDir)
      // Non-vacuity: the victim really holds the artifacts a collision would tamper with.
      expect(Object.keys(before)).toContain('events.jsonl')
      expect(Object.keys(before)).toContain('handoff.json')
      const hitsAfterFirst = [...target.hits]

      const { ack, error } = await invokeRunsStartOutcome(
        fixture,
        { patterns: [fixture.testPattern], runId: victimId as never },
        { resolveExecutionContext: () => 'local-headless' },
      )

      expect(ack).toBeUndefined()
      expect(error).toBeInstanceOf(RunIdAlreadyInUseError)
      expect((error as Error).message).toContain(victimId)
      // THE WHOLE CLAIM, at bytes. Measured pre-fix through this very door: `events.jsonl` grew
      // 2111 → 4221 bytes (7 → 14 envelopes) and `handoff.json` was overwritten in place.
      expect(digestsUnder(victimDir)).toEqual(before)
      // No SECOND run directory either — the refusal did not divert the run elsewhere.
      expect(runDirs(fixture).map((dir) => dir.split('/').pop())).toEqual([victimId])
      // …and it cost the target nothing, so it landed above assembly.
      expect(target.hits).toEqual(hitsAfterFirst)
    } finally {
      await target.close()
    }
  }, 240_000)

  it('THE CONTROL — a minted, free id is acknowledged and the run happens under it', async () => {
    const target = new CountingTarget()
    await target.listen()
    try {
      const fixture = createInProcessFixture({ origin: target.origin, environment: 'local' })
      pinAmbient('local-headless', false)
      const mintedId = generateRunId()

      const ack = await invokeRunsStart(
        fixture,
        { patterns: [fixture.testPattern], runId: mintedId as never },
        { resolveExecutionContext: () => 'local-headless' },
      )

      // The run every refusal cell above says did not happen is this one: same door, same request,
      // one field different.
      expect(ack.runId).toBe(mintedId)
      expect(runDirs(fixture).map((dir) => dir.split('/').pop())).toEqual([mintedId])
      expect(eventTypes(fixture)).toContain('runStarted')
      expect(buildOrdinalsExist(fixture)).toBe(true)
      expect(target.hits).toEqual(['/in-process-thing'])
    } finally {
      await target.close()
    }
  }, 120_000)
})

// ---------------------------------------------------------------------------------------------
// THE DOOR CENSUS — every production site that can name the run id a run executes under.
//
// TWO PREDICATES, DIFFERENT IN SHAPE, because one door is not a request field at all:
//
//   E1  REQUEST-shaped. Every production site that puts a `runId` onto the object the run seam
//       reads. Compared against a written role table, never against its own output.
//   E2  ENVIRONMENT-shaped. Every production read of `AGENT_QA_RUN_ID`. E1 cannot see this door's
//       ORIGIN — the value becomes an ordinary local long before it reaches a request literal —
//       and it is the ONE door the typed codec does not range.
//
// THE COMMENT STRIPPER IS PART OF THE PREDICATE, and the idiom this repo has been using is blind.
// `// … could not touch \`daemon/**\` that wave` (daemon/host.ts:642) is a LINE comment containing
// `/*`; a stripper that removes block comments first and line comments second treats that `/*` as
// the start of a block and swallows every byte up to the next `*/` — 1,816 characters of
// `daemon/host.ts`, and 10,575 of `android/src/adapter.ts`. Measured: under the two-pass stripper
// E1 below returns SIX files and the daemon door is not one of them. Under the one-pass
// alternation it returns seven. A census cannot be more complete than its stripper.
describe('the door census — every way a caller can name a run id (CR-04)', () => {
  const PACKAGES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

  /**
   * ONE PASS, so neither comment form can begin inside the other.
   *
   * The residual limitation, stated rather than left to be discovered: a `/*` inside a STRING
   * literal still opens a phantom block. Nothing in the scanned set carries one today, and a
   * predicate that tokenised TypeScript to find out would be a parser rather than a census.
   */
  function stripComments(source: string): string {
    return source.replace(
      /\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm,
      (_match, kept?: string) => kept ?? '',
    )
  }

  function shippedSourceFiles(): string[] {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules'
            || entry.name === 'dist' || entry.name === 'coverage') continue
          walk(path)
          continue
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) continue
        found.push(path)
      }
    }
    for (const pkg of readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue
      const src = join(PACKAGES_ROOT, pkg.name, 'src')
      if (existsSync(src)) walk(src)
    }
    return found
  }

  const REQUEST_RUN_ID_RE = /runId:\s*(?:asRunId\(|opts\.runId|request\.runId\b)/
  const ENV_RUN_ID_RE = /AGENT_QA_RUN_ID/

  /** Files the census MUST range, named rather than read off the scan (the 399/400 scar). */
  const REQUIRED_MEMBERS = [
    join('cli', 'src', 'commands', 'run.ts'),
    join('cli', 'src', 'commands', 'dashboard.ts'),
    join('cli', 'src', 'daemon', 'host.ts'),
    join('cli', 'src', 'composition', 'in-process-run-execution.ts'),
    join('agent', 'src', 'functions', 'ops', 'runs-start.ts'),
    join('mcp', 'src', 'mapping.ts'),
  ] as const

  /**
   * THE ROLE TABLE — every E1 site, and what it is. `reaches` answers the only question that
   * matters: does an id named here arrive at the invocation core's identity step, and therefore
   * inherit BOTH refusals? A site that did not would have to be routed through them or recorded,
   * with evidence, as unable to collide — and recording it here is what makes that visible.
   */
  const E1_SITES: Readonly<Record<string, { role: string; reaches: boolean; verdict: string }>> = {
    'agent-local/src/composition/run-invocation-core.ts': {
      role: 'the identity step itself',
      reaches: true,
      verdict:
        'not a door — this is where the refusals live. It matches E1 because the collision test '
        + 'reads `request.runId`, which is exactly the value under judgement.',
    },
    'cli/src/commands/run.ts': {
      role: 'door: `agent-qa run`, both paths',
      reaches: true,
      verdict:
        'THE DOOR THE CODEC DOES NOT RANGE — the request literal is built in-process from '
        + '`AGENT_QA_RUN_ID ?? generateRunId()`, so no parse happens. It reaches the core, which is '
        + 'why the shape refusal lives there. Cells: `commands/__tests__/run-gate.e2e.test.ts`.',
    },
    'cli/src/commands/dashboard.ts': {
      role: 'door: the dashboard run button',
      reaches: true,
      verdict:
        "names the enqueued row's id on a `RunsStartInput` and goes through `invokeFunction` — "
        + 'deliberately, per D-10, so it cannot skip the op gate. Same parse, same core.',
    },
    'cli/src/daemon/host.ts': {
      role: 'door: the daemon RPC',
      reaches: true,
      verdict:
        'a different COMPOSITION of the same op: it binds a `RunExecutionPort` over the drive, so '
        + 'the request it forwards is already parsed and the drive composes the core. THE SITE THE '
        + 'TWO-PASS STRIPPER HID — see this describe block\'s header.',
    },
    'cli/src/composition/in-process-run-execution.ts': {
      role: 'the drive',
      reaches: true,
      verdict:
        "not a caller door — it is the core's one composition. It forwards `request.runId` and "
        + 'mints a fallback, so every id above passes through here on its way to the identity step.',
    },
    'dashboard-server/src/execution/in-process-backend.ts': {
      role: 'door origin: the enqueued row',
      reaches: true,
      verdict:
        'hands `opts.runId` to the `invokeRun` port, which `commands/dashboard.ts` implements by '
        + 'invoking the op. The id is minted by the queue; the parse and the core are the row above.',
    },
    'cli/src/curation/post-run-tail.ts': {
      role: 'not a run-start site',
      reaches: false,
      verdict:
        'UNABLE TO COLLIDE, with evidence: it names the id of a run that has already FINISHED, to '
        + 'enqueue and drain that run\'s own post-run chain. It calls nothing that starts a run — '
        + '`run-door-invocation-census.test.ts` makes the complete-set claim that no file in this '
        + 'package acquires `startRun`, and the STARTRUN_PIN now build-enforces it repo-wide.',
    },
  }

  it('the scanned set ranges the files the claim is about — the discovery self-check', () => {
    const scanned = shippedSourceFiles().map((path) => relative(PACKAGES_ROOT, path))
    expect(scanned.length).toBeGreaterThan(500)
    for (const member of REQUIRED_MEMBERS) {
      expect(scanned, `the census is not ranging ${member}`).toContain(member)
    }
  })

  it('the stripper sees a line comment that contains a block-comment opener', () => {
    // The exact shape that hid the daemon door. Under the two-pass idiom the `const` below
    // disappears with everything after it up to the next `*/`.
    const source = ['// could not touch `daemon/**` that wave', 'const x = 1', '/** doc */'].join('\n')
    expect(stripComments(source)).toContain('const x = 1')
    // …and it still removes what it is supposed to remove.
    expect(stripComments('const y = 2 // startRun used to be here')).not.toContain('used to be here')
    expect(stripComments('/* runId: asRunId(x) */\nconst z = 3')).not.toContain('asRunId')
    // The protocol-relative-URL trap.
    expect(stripComments("const u = 'https://example.com' // t")).toContain('https://example.com')
  })

  it('E1 — every production site naming a runId on a run request carries a role', () => {
    // Self-check first: the predicate can see the forms the doors actually use.
    expect(REQUEST_RUN_ID_RE.test('        runId: asRunId(runId),')).toBe(true)
    expect(REQUEST_RUN_ID_RE.test("  runId: opts.runId as RunsStartInput['runId'],")).toBe(true)
    expect(REQUEST_RUN_ID_RE.test('runDirFor({ configDir, runId: request.runId })')).toBe(true)
    expect(REQUEST_RUN_ID_RE.test('  runId: someOtherThing,')).toBe(false)

    const found = shippedSourceFiles()
      .filter((path) => REQUEST_RUN_ID_RE.test(stripComments(readFileSync(path, 'utf8'))))
      .map((path) => relative(PACKAGES_ROOT, path).replaceAll(sep, '/'))

    expect(found.sort()).toEqual(Object.keys(E1_SITES).sort())
    for (const site of Object.values(E1_SITES)) {
      expect(site.verdict.trim()).not.toEqual('')
      expect(site.role.trim()).not.toEqual('')
    }
  })

  it('E2 — the environment door has exactly one production origin, and it is a listed site', () => {
    const found = shippedSourceFiles()
      .filter((path) => ENV_RUN_ID_RE.test(stripComments(readFileSync(path, 'utf8'))))
      .map((path) => relative(PACKAGES_ROOT, path).replaceAll(sep, '/'))

    expect(found).toEqual(['cli/src/commands/run.ts'])
    expect(Object.hasOwn(E1_SITES, found[0]!)).toBe(true)
    // …and that door does NOT parse, which is the whole reason the core carries the shape refusal.
    // Stated as a property of the file rather than as prose: the request it builds is a literal,
    // and `RunsStartInputSchema` is not named on the road from the environment read to the drive.
    const source = stripComments(readFileSync(join(PACKAGES_ROOT, ...found[0]!.split('/')), 'utf8'))
    expect(source).toContain('process.env.AGENT_QA_RUN_ID')
    expect(source).not.toContain('RunsStartInputSchema')
  })

  it('every E1 site either reaches the identity step or is recorded as unable to collide', () => {
    const bypassing = Object.entries(E1_SITES).filter(([, site]) => !site.reaches)
    // Exactly one, and its verdict is what carries the evidence.
    expect(bypassing.map(([file]) => file)).toEqual(['cli/src/curation/post-run-tail.ts'])
    expect(bypassing[0]![1].verdict).toContain('already FINISHED')
  })
})
