// The D-16 CLI door: `agent-qa run` denies fail-closed, on the binary a person actually runs.
//
// SINCE 432-13 (D-01/D-14/D-18) the only thing this door refuses is a production target the config
// has not opted into. The run gate, its `run:start` row, its remedies and `--trust-session` are gone;
// the cells below that measured them were re-spelled onto the production refusal, which keeps the
// same no-effects-before-refusal artifacts (b)–(d). The history below is kept as written.
//
// Phase 401 plan 03, Task 2 — INVK-02 criterion 3's CLI leg. Criterion 3 says a run against a
// shared or undeclared environment, started with no trust from a context with nobody at it, must
// NOT HAPPEN — and that the denial is what the caller sees. Both halves are measured here, and
// they are measured through `dist/cli.js` rather than through an imported function, because "what
// the caller sees" is a property of the process a person starts.
//
// WHAT MAKES THESE CELLS RED, and it is deliberately not an exit code (the 399/400 scar: a
// `status === 3` a not-implemented stub already satisfied; row text already present in stdout).
// Four independent artifacts, each of which a wrong implementation breaks differently:
//
//   (a) the execution-audit ROW the gate writes on every decision, asserted on its `outcome`
//       field — `fail-closed-denied` — never on a message substring;
//   (b) NO run events. `runStarted` is seq 1 of any run that began at all, so an absent
//       events.jsonl is the run not happening rather than a run that happened quietly;
//   (c) NO `build-ordinals.json`. This is the durable ASSEMBLY side effect: `resolveRunBuildOrdinal`
//       advances a per-product counter, and it now lives behind the gate. A denial that still
//       bumped the counter would mean assembly ran — the probe with it — and the ordering claim
//       would be false while (a) and (b) still passed;
//   (d) the stderr a person reads carries THE ROW'S OWN REASON plus the CLI-renderable remedies.
//       The expected text is not typed into this file: (d) reads the reason back off artifact (a)
//       and asserts the terminal showed it, which is what pins the door to rendering the gate's
//       decision rather than composing a sentence of its own (400 D-15 / 399's measured defect).
//
// THE ALLOW CONTROL IS THE SAME DOOR WITH ONE BYTE CHANGED: the target's `environment`. Same
// binary, same piped stdio, same absence of trust — and the run starts. Without it, a `run` command
// that denied EVERYTHING would pass every denial cell above.
//
// THE RED BASELINE, measured against the pre-core build (submodule ef9f5f80 rebuilt into dist)
// before this file was allowed to go green. The same no-tty invocation against the same
// shared-declared target:
//
//   probeHits:      ["/shared-thing"]      ← it knocked on the target it had no authority to drive
//   runDirFiles:    artifact.json, events.jsonl, handoff.json   ← the run ran
//   buildOrdinals:  {"shared-thing":1}     ← and consumed a build ordinal
//   auditRows:      []                     ← with no gate decision recorded anywhere
//   exit 2, stderr: 'Framework error: Provider "anthropic-subscription" requires an auth plugin.'
//
// All four cells red there, and red on artifact (a): `expected [] to have a length of 1` — the
// `run:start` row does not exist, which is the RIGHT reason. Not a different exit code (the
// pre-core build exits 2 as well, for a reason that has nothing to do with authorization).

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHash } from 'node:crypto'

import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * The SHIPPED binary, resolved from this file's own location.
 *
 * `packages/cli/src/commands/__tests__` → three levels up is `packages/cli`. The plan's verify line
 * runs `pnpm build` before every run of this file: a reading taken on a stale dist compares two
 * copies of the previous build and calls the result a measurement.
 */
const CLI_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'dist', 'cli.js')

interface AuditRow {
  action: string
  riskTier: string
  verdict: string
  outcome: string
  reason: string
  runId: string
  executionContext: string
}

let project: string

/**
 * THE TARGET, as a loopback server that counts who knocked.
 *
 * This is the fifth artifact, and the one that measures the ordering claim DIRECTLY rather than by
 * proxy: "the gate decides before any network touch of the target, including the run-start baseline
 * probe". Every target below points at this server, so a request recorded here is `agent-qa`
 * touching the environment it was about to drive. A denied run must leave the counter at zero — and
 * the allow control must move it, or the zero would be a server nobody was ever going to call.
 */
let probeServer: Server
let probeHits: string[] = []
let probeOrigin: string

beforeAll(async () => {
  probeServer = createServer((request, response) => {
    probeHits.push(request.url ?? '')
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Example</title><p>Example</p>')
  })
  await new Promise<void>((ready) => probeServer.listen(0, '127.0.0.1', ready))
  probeOrigin = `http://127.0.0.1:${(probeServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((closed) => probeServer.close(() => closed()))
})

beforeEach(() => {
  probeHits = []
  project = mkdtempSync(join(tmpdir(), 'run-gate-e2e-'))
  mkdirSync(join(project, 'tests'), { recursive: true })

  // A config this cell owns end to end. THREE targets, differing ONLY in their `environment`
  // declaration — that is the axis under test, so nothing else may vary between them, the URL
  // included: all three point at the same counting loopback server.
  writeFileSync(
    join(project, 'agent-qa.config.yaml'),
    [
      'workspace:',
      '  testMatch:',
      "    - 'tests/**/*.yaml'",
      '  suiteMatch:',
      "    - 'suites/**/*.suite.yaml'",
      '  hooksFile: hooks.yaml',
      '  envFile: .env',
      '  secretsFile: .env.secrets.local',
      'registry:',
      '  targets:',
      '    shared-thing:',
      '      platform: web',
      `      url: ${probeOrigin}/shared-thing`,
      '      environment: shared',
      '    undeclared-thing:',
      '      platform: web',
      `      url: ${probeOrigin}/undeclared-thing`,
      '    local-thing:',
      '      platform: web',
      `      url: ${probeOrigin}/local-thing`,
      '      environment: local',
      // THE MULTI-MEMBER SET (401-12, CR-01). Three more targets that differ from each other ONLY
      // in `environment` — same axis as above — and that differ from the three above in exactly one
      // further respect: they all declare the SAME EXPLICIT `product`.
      //
      // The explicit product is NOT decoration. `resolveTarget` defaults `product` to the target's
      // own NAME (targets.ts:45), so any two arbitrary targets carry two different products, and
      // `requireSingleInvocationProduct` (run.ts:106) refuses a mixed-product invocation BEFORE the
      // gate is ever consulted. A multi-member cell built on the three targets above would measure
      // that refusal and read green under a completely broken gate. The shared product is what lets
      // the invocation REACH the classification under test.
      '    multi-local-a:',
      '      platform: web',
      `      url: ${probeOrigin}/multi-local-a`,
      '      environment: local',
      '      product: one-product',
      '    multi-local-b:',
      '      platform: web',
      `      url: ${probeOrigin}/multi-local-b`,
      '      environment: local',
      '      product: one-product',
      '    multi-shared:',
      '      platform: web',
      `      url: ${probeOrigin}/multi-shared`,
      '      environment: shared',
      '      product: one-product',
      // 432-13: the production targets, the one class this door still refuses without the opt-in.
      '    prod-thing:',
      '      platform: web',
      `      url: ${probeOrigin}/prod-thing`,
      '      environment: production',
      '    multi-prod:',
      '      platform: web',
      `      url: ${probeOrigin}/multi-prod`,
      '      environment: production',
      '      product: one-product',
      'use:',
      '  mobile:',
      '    appState: preserve',
      '',
    ].join('\n'),
  )
  writeFileSync(join(project, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(project, '.env'), '')
  writeFileSync(join(project, '.env.secrets.local'), '')

  for (const target of [
    'shared-thing', 'undeclared-thing', 'local-thing',
    'multi-local-a', 'multi-local-b', 'multi-shared',
    'prod-thing', 'multi-prod',
  ]) {
    writeFileSync(
      join(project, 'tests', `${target}.yaml`),
      [
        `test-id: ${generateTestId()}`,
        `name: a run against ${target}`,
        `target: ${target}`,
        'steps:',
        '  - Verify the page says "Example"',
        '',
      ].join('\n'),
    )
  }
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

/**
 * Run the shipped binary with PIPED stdio — no tty on either end, which is what makes the context
 * non-interactive and the fail-closed arm reachable. That is the same shape a CI job, a cron entry
 * or a redirected shell gives the process.
 *
 * ASYNCHRONOUS, AND THAT IS LOAD-BEARING RATHER THAN STYLE. The first version of this helper used
 * `spawnSync`, which blocks this process's event loop until the child exits — including the
 * loopback server above. The child's baseline probe then connected, waited for a response nobody
 * could send, and aborted on its own 4s timeout, so the counter read empty on EVERY leg. The deny
 * cells passed on a measurement that could not have failed; the allow control is what caught it.
 */
async function runCli(...args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return await runCliWithEnv({}, ...args)
}

/**
 * The same shipped binary, with named environment variables set (401-20).
 *
 * `AGENT_QA_RUN_ID` IS A DOOR ONTO A RUN'S IDENTITY, and it is a door the typed contract does not
 * range: `run.ts` builds its `RunsStartInput` literal in-process, so an id arriving this way never
 * passes `RunsStartInputSchema` at all. That is precisely why the shape and collision refusals live
 * in the invocation core and not only in the codec — and why they have to be measured HERE, on the
 * process a person starts, rather than at the typed door where a different refusal would answer.
 */
async function runCliWithEnv(
  overrides: Record<string, string>,
  ...args: string[]
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', DO_NOT_TRACK: '1' }
  // A run id inherited from this process would attach the child's run to another run's directory —
  // and an EMPTY string is not the same as absent: `?? generateRunId()` keeps `''`, which slugs to
  // a run directory called `default`. Deleted, not blanked.
  delete env.AGENT_QA_RUN_ID
  for (const [key, value] of Object.entries(overrides)) env[key] = value

  const child = spawn(process.execPath, [CLI_DIST, 'run', ...args], { cwd: project, env })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })

  const status = await new Promise<number | null>((settle, fail) => {
    child.on('error', fail)
    child.on('close', (code) => settle(code))
  })
  return { status, stdout, stderr }
}

/** Every run directory the invocation left behind under the project's own `.agent-qa`. */
function runDirs(): string[] {
  const runs = join(project, '.agent-qa', 'runs')
  if (!existsSync(runs)) return []
  return readdirSync(runs).map((entry) => join(runs, entry))
}

function auditRows(): AuditRow[] {
  return runDirs().flatMap((dir) => {
    const path = join(dir, 'execution_audit.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as AuditRow)
  })
}

/** Every recorded run event, across every run dir — an empty array means no run began. */
function eventTypes(): string[] {
  return runDirs().flatMap((dir) => {
    const path = join(dir, 'events.jsonl')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => (JSON.parse(line) as { type: string }).type)
  })
}

/** A sha of every file in a directory — "untouched" has to be a statement about bytes. */
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

/** Did assembly run? The build-ordinal ledger is its durable trace, written behind the gate. */
function buildOrdinalsExist(): boolean {
  return existsSync(join(project, '.agent-qa', 'build-ordinals.json'))
}

/** The approval wording a retired prompt or refusal would print. None of it may reach a person. */
const RETIRED_APPROVAL_TEXT = /\[y\/N\]|\[y\/a\/N\]|needs your approval|Proceed\?|--trust-session|fail-closed/

// 432-13 (D-01/D-14/D-18): `agent-qa run` asks nobody. A CI job with stdin that is not a terminal
// starts a run against any non-production target; the piped stdin below is held open and never
// written, so a run that waited on an answer would never exit.
describe('C432-HEADLESS-START — CI with a non-TTY stdin starts the run (432-13)', () => {
  it.each(['undeclared-thing', 'shared-thing'])(
    'C432-HEADLESS-START: CI=true against a %s target starts, with no refusal, no prompt and no gate row',
    async (target) => {
      const result = await runCliWithEnv({ CI: 'true' }, `tests/${target}.yaml`)

      expect(eventTypes()[0]).toBe('runStarted')
      expect(buildOrdinalsExist()).toBe(true)
      expect(probeHits).toContain(`/${target}`)
      expect(auditRows().filter((row) => row.action === 'run:start')).toEqual([])
      expect(result.stderr).not.toContain('Run denied')
      expect(`${result.stdout}\n${result.stderr}`).not.toMatch(RETIRED_APPROVAL_TEXT)
    },
    180_000,
  )
})

// RE-SPELLED 2026-09-30 (432-13). This describe was the run gate's fail-closed denial of a shared or
// undeclared target (now C432-HEADLESS-START above), its allow control, and `--trust-session` as the
// way through. The denial moves to the one class still refused; the gate row it read is gone, so
// the reason the person sees is asserted against the refusal's own wording instead.
describe('the CLI door refuses an un-opted-in production run and it never starts (D-16, D-18)', () => {
  it('a no-tty run against a production target with no opt-in is refused before anything happens', async () => {
    const result = await runCli('tests/prod-thing.yaml')

    // (a) no decision row: the production refusal is not a gate decision
    expect(auditRows()).toEqual([])
    // (b) no run began
    expect(eventTypes()).toEqual([])
    // (c) no assembly
    expect(buildOrdinalsExist()).toBe(false)
    // (c2) and nobody knocked
    expect(probeHits).toEqual([])
    // (d) the person saw the refusal, naming the target and the opt-in
    expect(result.stderr).toContain('Run denied')
    expect(result.stderr).toContain('"prod-thing"')
    expect(result.stderr).toContain('allowProduction: true')
    expect(`${result.stdout}\n${result.stderr}`).not.toMatch(RETIRED_APPROVAL_TEXT)
    expect(result.status).not.toBe(0)
  }, 180_000)

  it('the allow control: the same door, the same no-tty invocation, one byte of config different', async () => {
    const result = await runCli('tests/local-thing.yaml')

    expect(auditRows().filter((row) => row.action === 'run:start')).toEqual([])
    expect(eventTypes()[0]).toBe('runStarted')
    expect(buildOrdinalsExist()).toBe(true)
    expect(probeHits).toContain('/local-thing')
    expect(result.stderr).not.toContain('Run denied')
  }, 180_000)

  it('--trust-session is no longer an option: Commander refuses it and no run starts', async () => {
    const result = await runCli('tests/shared-thing.yaml', '--trust-session')

    expect(result.stderr).toContain("unknown option '--trust-session'")
    expect(runDirs()).toEqual([])
    expect(probeHits).toEqual([])
    expect(result.status).not.toBe(0)
  }, 180_000)
})

/**
 * The refusal surface of a multi-member arm — the same artifacts the single-member cell uses,
 * asserted identically, so the ONLY thing that varies between the two order arms below is the order
 * of two filenames on a command line. 432-13: the gate row and its reach guard are gone; the
 * production refusal names the member, which is what proves the fold saw it.
 */
async function expectMultiMemberDenial(...args: string[]): Promise<void> {
  const result = await runCli(...args)

  expect(result.stderr).toContain('Run denied')
  expect(result.stderr).toContain('"multi-prod"')
  expect(auditRows()).toEqual([])
  expect(eventTypes()).toEqual([])
  expect(buildOrdinalsExist()).toBe(false)
  expect(probeHits).toEqual([])
  expect(result.status).not.toBe(0)
}

/**
 * 401-12 (CR-01): THE DIRECT DOOR CLASSIFIES THE WHOLE INVOCATION, NOT ITS FIRST ARGUMENT.
 *
 * The direct path once derived its class from `filtered[0]` alone, so argument order decided
 * authorization (red baseline on submodule `553f179b`: `expected 'mutating-local' to be
 * 'mutating-shared'`). RE-SPELLED 2026-09-30 (432-13): a shared member no longer refuses anything,
 * so the member that makes the whole invocation refused is a PRODUCTION one, in both orders.
 */
describe('a multi-member direct invocation is classified as a whole (401-12, CR-01, D-05/D-06)', () => {
  it('a no-tty two-member run is refused when the production member is LAST', async () => {
    await expectMultiMemberDenial('tests/multi-local-a.yaml', 'tests/multi-prod.yaml')
  }, 180_000)

  it('a no-tty two-member run is refused when the production member is FIRST', async () => {
    await expectMultiMemberDenial('tests/multi-prod.yaml', 'tests/multi-local-a.yaml')
  }, 180_000)

  it('the multi-member allow control: a local and a shared member together still proceed', async () => {
    const result = await runCli('tests/multi-local-a.yaml', 'tests/multi-shared.yaml')

    expect(auditRows().filter((row) => row.action === 'run:start')).toEqual([])
    expect(eventTypes()[0]).toBe('runStarted')
    expect(buildOrdinalsExist()).toBe(true)
    expect(result.stderr).not.toContain('Run denied')
  }, 180_000)
})

// ---------------------------------------------------------------------------------------------
// THE ENVIRONMENT DOOR (2026-08-23, plan 20 · CR-04).
//
// WHY THIS DOOR NEEDS ITS OWN CELLS. Hardening `RunsStartInputSchema` covers the fn, chat, MCP,
// daemon and dashboard doors, all of which parse. It covers this one not at all: `run.ts` reads
// `process.env.AGENT_QA_RUN_ID`, mints a fallback, and hands the value to the drive as a request
// literal — no codec is consulted anywhere on that road. A fix measured only at the typed door
// would be one-sided hardening on exactly the shape this phase has shipped repeatedly.
//
// WHY AN ABSENT RUN DIRECTORY IS THE CORRECT EVIDENCE HERE, and not the never-got-there failure
// mode. Every denial cell above asserted a `run:start` row EXISTS before believing its verdict (until 432-13),
// because a deny and a run that never reached the gate are otherwise the same empty directory.
// These refusals land ABOVE the gate by design, so there is no row and the absence IS the claim.
// What discriminates them from a broken invocation is the paired control: the same binary, the
// same target, the same piped stdio, one environment variable different — and the run starts,
// writes `runStarted`, bumps the ordinal and knocks on the target.
describe('the environment door cannot name a malformed or colliding run id (CR-04)', () => {
  it('a MALFORMED AGENT_QA_RUN_ID is refused, and no run directory is created at all', async () => {
    const result = await runCliWithEnv(
      { AGENT_QA_RUN_ID: 'not-a-minted-id' },
      'tests/local-thing.yaml',
    )

    // The person sees a decision about the id, named. Not a framework error, and not a stack:
    // 401-18 shipped "a refusal is carried as a fact and described as one", and a refusal rendered
    // as a crash would undo it at a new door.
    expect(result.stderr).toContain('not-a-minted-id')
    expect(result.stderr).toContain('run id')
    expect(result.stderr).not.toContain('Framework error')
    // Nothing happened: no run directory, so no audit row and no events; no assembly; no knock.
    expect(runDirs()).toEqual([])
    expect(auditRows()).toEqual([])
    expect(buildOrdinalsExist()).toBe(false)
    expect(probeHits).toEqual([])
    expect(result.status).not.toBe(0)
  }, 180_000)

  it('a PATH-SHAPED AGENT_QA_RUN_ID is refused — the traversal never reaches a path join', async () => {
    const result = await runCliWithEnv(
      { AGENT_QA_RUN_ID: '../../escape' },
      'tests/local-thing.yaml',
    )

    expect(result.stderr).toContain('run id')
    // Pre-fix this exact invocation ran a whole run and left `.agent-qa/runs/escape/` behind —
    // `slugBranch` neutered the traversal, and nothing refused the id.
    expect(runDirs()).toEqual([])
    expect(existsSync(join(project, '.agent-qa', 'runs', 'escape'))).toBe(false)
    expect(probeHits).toEqual([])
    expect(result.status).not.toBe(0)
  }, 180_000)

  it('an EMPTY AGENT_QA_RUN_ID no longer runs into the shared runs/default/ directory', async () => {
    const result = await runCliWithEnv({ AGENT_QA_RUN_ID: '' }, 'tests/local-thing.yaml')

    // `?? generateRunId()` keeps `''`, and `slugBranch('')` is `'default'` — so before this plan
    // every run started with a blank id shared one directory, and each one appended to the last.
    expect(existsSync(join(project, '.agent-qa', 'runs', 'default'))).toBe(false)
    expect(runDirs()).toEqual([])
    expect(result.status).not.toBe(0)
  }, 180_000)

  it('a COLLIDING AGENT_QA_RUN_ID is refused and the victim run is byte-identical after', async () => {
    const victimId = generateRunId()

    const first = await runCliWithEnv({ AGENT_QA_RUN_ID: victimId }, 'tests/local-thing.yaml')
    expect(first.stderr).not.toContain('run id')
    const victimDir = join(project, '.agent-qa', 'runs', victimId)
    expect(existsSync(victimDir)).toBe(true)
    const before = digestsUnder(victimDir)
    // Non-vacuity: the victim really holds the artifacts a collision would tamper with.
    expect(Object.keys(before)).toContain('events.jsonl')
    // 432-13: `execution_audit.jsonl` was the gate row's file; the start writes none now.
    expect(Object.keys(before)).toContain('handoff.json')
    const hitsAfterFirst = [...probeHits]

    const second = await runCliWithEnv({ AGENT_QA_RUN_ID: victimId }, 'tests/local-thing.yaml')

    expect(second.stderr).toContain(victimId)
    expect(second.stderr).toContain('already names a run')
    expect(second.status).not.toBe(0)
    // THE WHOLE CLAIM, at bytes. Pre-fix this appended seven envelopes to `events.jsonl`
    // (2111 → 4221 bytes) and overwrote `handoff.json`.
    expect(digestsUnder(victimDir)).toEqual(before)
    // …and the refusal cost the target nothing, so it landed above assembly here too.
    expect(probeHits).toEqual(hitsAfterFirst)
  }, 240_000)

  it('THE CONTROL — a freshly minted AGENT_QA_RUN_ID runs, under exactly that id', async () => {
    const mintedId = generateRunId()

    const result = await runCliWithEnv({ AGENT_QA_RUN_ID: mintedId }, 'tests/local-thing.yaml')

    // The run the refusal cells say never happened is this run: same door, same target, same
    // stdio, one environment value different.
    expect(runDirs().map((dir) => dir.split('/').pop())).toEqual([mintedId])
    expect(eventTypes()[0]).toBe('runStarted')
    expect(buildOrdinalsExist()).toBe(true)
    expect(probeHits).toEqual(['/local-thing'])
    expect(result.stderr).not.toContain('already names a run')
  }, 180_000)
})
