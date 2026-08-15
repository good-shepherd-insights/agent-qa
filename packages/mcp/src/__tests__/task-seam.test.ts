// The dormant JobView -> Task projection, driven directly (Phase 396 plan 03, D-12 · MCPS-06).
//
// WHY THIS FILE EXISTS. `task-seam.ts` is registered nowhere and called by nothing in the server
// build — that is its whole design — so a cell here is the ONLY thing that can observe it at all.
// A dormant module with no fixtures is indistinguishable from a module that does not work, which is
// exactly the state MCPS-06's "seam exists without coupling" would otherwise decay into.
//
// Each cell names the mutation it is the bar for. A cell that no plausible wrong implementation
// reds is decoration, and this project has measured that lesson more than once.
//
// FIXTURES ARE PRODUCED, NEVER TYPED. Every job below comes out of `jobSchema.parse`, so a fixture
// this system could not actually store cannot be pinned here (the produced-not-literal law: a
// corpus built as a type literal can pin an impossible input, and the mutation differential then
// reds only the impossible rows).
//
// MUTATION LEGS MEASURED AGAINST THIS FILE (2026-08-16) — each applied to `../task-seam.ts`, the
// suite re-run, and the subject restored byte-identically afterwards. Verbatim REDs are recorded in
// `396-03-SUMMARY.md`; the leg each cell is barred by is named on the cell.
//
//   M1  `cancelled` mapped to 'failed' (the plausible "a cancel is a kind of failure" collapse)
//         RED: 2 failed | 13 passed — `expected 'failed' to be 'cancelled'`, and the distinctness
//         cell at `expected 2 to be 3`
//   M2  `committing` mapped to 'completed' (the plausible "committing means basically done")
//         RED: 2 failed | 13 passed — `expected 'completed' to be 'working'`, and the collapse cell
//   M3  `attempts` added to the projection (the plausible "a poller would want the retry count")
//         RED: 2 failed | 13 passed — `expected [ 'attempts', 'createdAt', …(4) ] to deeply equal
//         [ 'createdAt', 'lastUpdatedAt', …(3) ]`
//   M4  `statusMessage` dropped from the projection
//         RED: 2 failed | 13 passed — the exact-key cell and the verbatim-fields cell
//   MC  a member deleted from the status table — a COMPILE-time leg, measured with `tsc --noEmit`
//         RED: `TS1360 … Property 'bundling' is missing … but required in type
//         'Record<JobStatus, McpTaskState>'`
//   MC2 an EIGHTH member (`paused`) added to `JobStatus` in the schema package, schema rebuilt so
//       the change actually reaches this package's type resolution (the stale-dist trap: `mcp`
//       resolves `@vostride/agent-qa-schema` through its BUILT `.d.ts`, so an unrebuilt leg
//       measures nothing) — the compile-time direction the exhaustiveness claim is actually about
//         RED: `TS1360 … Property 'paused' is missing … but required in type
//         'Record<JobStatus, McpTaskState>'`

import { jobSchema } from '@vostride/agent-qa-schema'
import type { Job, JobStatus } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { JOB_STATUS_TO_MCP_TASK_STATE, projectJobAsTask } from '../task-seam.js'
import type { McpTaskState } from '../task-seam.js'

/**
 * The seven members, spelled out ONCE here as the test's own second recipe.
 *
 * The implementation derives nothing from this list and this list derives nothing from the
 * implementation: it is the literal half of a two-recipe pair, so a member quietly dropped from the
 * module's table reds the coverage cell below even though the module still compiles against
 * whatever remains.
 */
const JOB_STATUSES = [
  'queued',
  'authored',
  'bundling',
  'committing',
  'done',
  'failed',
  'cancelled',
] as const satisfies readonly JobStatus[]

/** A job as the store would actually hand one back — parsed, never assembled. */
function job(overrides: Record<string, unknown> = {}): Job {
  return jobSchema.parse({
    id: 'job_01HQ8Z9K',
    kind: 'analyze-run',
    status: 'queued',
    summary: 'Analyse run RUN-014 for flake causes',
    attempts: 0,
    createdAt: '2026-08-16T09:00:00.000Z',
    updatedAt: '2026-08-16T09:30:00.000Z',
    ...overrides,
  })
}

describe('projectJobAsTask — the lossy state mapping (D-12 · MCPS-06)', () => {
  // THE PINNED TABLE. Four agent-qa statuses collapse into one MCP state, and the collapse is the
  // reconciliation rather than an accident of implementation: `queued`/`authored`/`bundling`/
  // `committing` are CHECKPOINT BOUNDARIES chosen so a resumed job never re-invokes the LLM, and a
  // remote poller has no use for that distinction — it is asking "may I stop polling yet?".
  //
  // Asserted through the PROJECTION and not against the table, because the table is an internal
  // field and the mapped state is the surface a remote caller sees.
  const rows: readonly (readonly [JobStatus, McpTaskState])[] = [
    ['queued', 'working'],
    ['authored', 'working'],
    ['bundling', 'working'],
    ['committing', 'working'], // THE BAR: M2
    ['done', 'completed'],
    ['failed', 'failed'],
    ['cancelled', 'cancelled'], // THE BAR: M1
  ]

  for (const [status, expected] of rows) {
    it(`maps ${status} to ${expected}`, () => {
      expect(projectJobAsTask(job({ status })).status).toBe(expected)
    })
  }

  // The four-into-one collapse said once as a claim about the SET rather than row by row, so an
  // implementation that mapped three of the four and left the fourth alone reds here as well.
  it('collapses every non-terminal status onto exactly one working state', () => {
    const working = JOB_STATUSES.filter(
      (status) => projectJobAsTask(job({ status })).status === 'working',
    )
    expect(working).toEqual(['queued', 'authored', 'bundling', 'committing'])
  })

  // The three terminal statuses stay DISTINCT. A projection that folded them together would tell a
  // poller a cancelled job failed, which is the one thing the collapse must not do — it is the
  // difference between "someone stopped this" and "this is broken".
  it('keeps the three terminal statuses distinct', () => {
    const terminal = ['done', 'failed', 'cancelled'] as const
    const mapped = terminal.map((status) => projectJobAsTask(job({ status })).status)
    expect(new Set(mapped).size).toBe(3)
  })
})

describe('projectJobAsTask — what the projection carries (D-12)', () => {
  // THE BAR: M3 and M4 both. An EXACT key set, not a containment check: `toContain`-style
  // assertions are green for a projection that also leaks `attempts`, `kind` or `conclusionKind` —
  // and `conclusionKind` in particular is internal vocabulary (`knowledge_skipped_draft`,
  // `insufficient_model_output`) that no MCP caller has any way to read.
  it('carries exactly five fields, and they are the MCP task vocabulary', () => {
    expect(Object.keys(projectJobAsTask(job())).sort()).toEqual([
      'createdAt',
      'lastUpdatedAt',
      'status',
      'statusMessage',
      'taskId',
    ])
  })

  it('carries the job id, the summary as statusMessage, and both timestamps verbatim', () => {
    const source = job({
      status: 'done',
      summary: 'Analysed run RUN-014; two flakes attributed to a race',
      createdAt: '2026-08-16T09:00:00.000Z',
      updatedAt: '2026-08-16T11:45:12.000Z',
    })

    expect(projectJobAsTask(source)).toEqual({
      taskId: 'job_01HQ8Z9K',
      status: 'completed',
      statusMessage: 'Analysed run RUN-014; two flakes attributed to a race',
      createdAt: '2026-08-16T09:00:00.000Z',
      lastUpdatedAt: '2026-08-16T11:45:12.000Z',
    })
  })

  // Pure and total: the same job projects to the same value, and nothing on the input is touched.
  // A projection that mutated its argument would corrupt the queue's own record of the job.
  it('is pure — the source job is unchanged and two calls agree', () => {
    const source = job({ status: 'bundling' })
    const before = JSON.stringify(source)

    expect(projectJobAsTask(source)).toEqual(projectJobAsTask(source))
    expect(JSON.stringify(source)).toBe(before)
  })
})

describe('the status table is exhaustive over JobStatus (the compile-time cell)', () => {
  // THE BAR: MC, which is a COMPILE-time leg rather than a runtime one. `as const satisfies
  // Record<JobStatus, McpTaskState>` in the module makes a deleted or misspelled member a type
  // error, so the mutation is measured with `tsc --noEmit` and not by this suite.
  //
  // This cell is the runtime half of the same claim, and it exists because the compile check alone
  // cannot see a table that grew a member the union never had (an object literal with an EXTRA key
  // still satisfies the Record when the key is a `JobStatus`-typed string... and a stray key is
  // exactly what a copy-paste produces).
  it('maps every one of the seven members, and nothing else', () => {
    expect(Object.keys(JOB_STATUS_TO_MCP_TASK_STATE).sort()).toEqual([...JOB_STATUSES].sort())
  })

  it('produces a defined state for every member, driven through the projection', () => {
    for (const status of JOB_STATUSES) {
      expect(projectJobAsTask(job({ status })).status).toBeDefined()
    }
  })

  // The mapping is TOTAL but not surjective, and that is stated rather than left to be discovered:
  // MCP's own task vocabulary has an `input_required` state, and no agent-qa job status means it.
  // A future status that DID mean it would have to add the row deliberately.
  it('never produces input_required — no job status means it', () => {
    const produced = JOB_STATUSES.map((status) => projectJobAsTask(job({ status })).status)
    expect(produced).not.toContain('input_required')
  })
})
