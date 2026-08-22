// The D-16 CLI door: `agent-qa run` denies fail-closed, on the binary a person actually runs.
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateTestId } from '@vostride/agent-qa-ids'
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
      'use:',
      '  mobile:',
      '    appState: preserve',
      '',
    ].join('\n'),
  )
  writeFileSync(join(project, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(project, '.env'), '')
  writeFileSync(join(project, '.env.secrets.local'), '')

  for (const target of ['shared-thing', 'undeclared-thing', 'local-thing']) {
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
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', DO_NOT_TRACK: '1' }
  // A run id inherited from this process would attach the child's run to another run's directory —
  // and an EMPTY string is not the same as absent: `?? generateRunId()` keeps `''`, which slugs to
  // a run directory called `default`. Deleted, not blanked.
  delete env.AGENT_QA_RUN_ID

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

/** Did assembly run? The build-ordinal ledger is its durable trace, written behind the gate. */
function buildOrdinalsExist(): boolean {
  return existsSync(join(project, '.agent-qa', 'build-ordinals.json'))
}

describe('the CLI door denies fail-closed and the run never starts (D-16, INVK-02 criterion 3)', () => {
  it.each(['shared-thing', 'undeclared-thing'])(
    'a no-tty run against a %s target with no trust is refused before anything happens',
    async (target) => {
      const result = await runCli(`tests/${target}.yaml`)

      // (a) the gate's own record, asserted on the field rather than on prose.
      const gateRows = auditRows().filter((row) => row.action === 'run:start')
      expect(gateRows).toHaveLength(1)
      expect(gateRows[0].outcome).toBe('fail-closed-denied')
      expect(gateRows[0].verdict).toBe('deny')
      // An UNDECLARED target reaches the same tier as a declared shared one — D-06, at the door.
      expect(gateRows[0].riskTier).toBe('mutating-shared')

      // (b) no run began. `runStarted` is seq 1 of every run that exists.
      expect(eventTypes()).toEqual([])

      // (c) no assembly. The build-ordinal advance is assembly's durable trace.
      expect(buildOrdinalsExist()).toBe(false)

      // (c2) AND NOBODY KNOCKED. The run-start baseline probe fetches the target's URL, and it now
      // lives inside assembly — so an unauthorized run costs the environment not one request. This
      // is the ordering claim measured on the target's own side rather than inferred from ours.
      expect(probeHits).toEqual([])

      // (d) the person saw the decision, and saw it in the gate's own words.
      expect(result.stderr).toContain(gateRows[0].reason)
      // The remedies a CLI reader can act on, rendered from the structured vocabulary rather than
      // from a sentence this door wrote. Both `answer-confirm` and `trust-session-flag` are minted
      // for a fail-closed decision, and the flag arm names the command it is declared on.
      expect(result.stderr).toContain('re-run on an interactive terminal')
      expect(result.stderr).toContain('agent-qa run --trust-session')

      // …and a non-zero exit, listed LAST because on its own it proves nothing: this command exits
      // non-zero for a failing suite too. It is here so a denial can never be mistaken for success.
      expect(result.status).not.toBe(0)
    },
  )

  it('the allow control: the same door, the same no-tty invocation, one byte of config different', async () => {
    const result = await runCli('tests/local-thing.yaml')

    const gateRows = auditRows().filter((row) => row.action === 'run:start')
    expect(gateRows).toHaveLength(1)
    expect(gateRows[0].verdict).toBe('allow')
    expect(gateRows[0].outcome).toBe('proceeded')
    // D-05's CI guarantee: `mutating-local` allows in EVERY context, with no credential at all.
    expect(gateRows[0].riskTier).toBe('mutating-local')

    // The run really started — the artifacts the denial legs proved absent are present here.
    expect(eventTypes()[0]).toBe('runStarted')
    expect(buildOrdinalsExist()).toBe(true)
    // …including the knock. An allowed run DOES probe its target, which is what makes the denial
    // legs' empty counter a measurement rather than a server nobody would have called anyway.
    expect(probeHits).toContain('/local-thing')

    // And nothing rendered a denial. (This run ends in an unrelated downstream failure — no model
    // provider is configured in the fixture — which is exactly why the gate half is asserted on the
    // gate's own artifacts rather than on the exit code.)
    expect(result.stderr).not.toContain('Run denied')
  }, 180_000)

  it('--trust-session is the way through on the SAME shared target (the second allow control)', async () => {
    const result = await runCli('tests/shared-thing.yaml', '--trust-session')

    const gateRows = auditRows().filter((row) => row.action === 'run:start')
    expect(gateRows).toHaveLength(1)
    expect(gateRows[0].verdict).toBe('allow')
    expect(gateRows[0].outcome).toBe('proceeded')
    // The tier did NOT move — trust satisfies the ask, it does not reclassify the action.
    expect(gateRows[0].riskTier).toBe('mutating-shared')
    expect(eventTypes()[0]).toBe('runStarted')
    expect(result.stderr).not.toContain('Run denied')
  }, 180_000)
})
