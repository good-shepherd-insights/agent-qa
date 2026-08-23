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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { RunDeniedError } from '@vostride/agent-qa-agent-local'
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
          confirm: () => { confirmCalls += 1; return true },
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
          confirm: () => { confirmCalls += 1; return true },
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
