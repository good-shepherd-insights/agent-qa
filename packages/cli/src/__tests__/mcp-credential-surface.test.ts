// THE CREDENTIAL SURFACE OF THE NEW MCP WIRE (396-06 · Pitfall 9 · T-395-R5-10's class).
//
// THE DEBT THIS PAYS. Phase 396 deleted the v1 MCP server and, with it, two suites that were the
// product's only pins on credential disclosure through an MCP channel:
// `agent-qa-server-masking.test.ts` and `credential-surface-parity.test.ts`. Both were written
// against `agent_qa_get_config`, a tool this surface no longer has. Deleting a test because the
// thing it tested was rewritten is how a closed defect reopens, so every assertion those two files
// made is accounted for below — re-derived against the new wire, or RETIRED WITH A REASON.
//
// ASSERTED ON THE SURFACE A CALLER READS. Every absence cell reads the RECORDED RESPONSE BODIES —
// the bytes the transport actually received — and not an internal object. 395 round 5 is the reason
// that sentence is in this header: ten cells passed while two shipped commands leaked a planted
// credential, because the corpus asserted on `error.message` while the live channel was the error's
// serialization. The frames are the only thing here that cannot lie about what left the process.
//
// ABSENCE IS WINDOWED AT EIGHT CHARACTERS. A cell that asks only whether the WHOLE credential is
// present is satisfied by a partial mask, which is a disclosure budget nobody set — v1's own suite
// had learned that and pinned a four-character tail sentinel. Windowing generalises it: no eight
// consecutive characters of any planted value may appear anywhere.
//
// AND EVERY ABSENCE IS PAIRED. An absence over a dead channel is the trap this project keeps
// recording, so each cell below travels with one of two companions:
//   · an INTEGRITY half — a fingerprint computed with `node:crypto`, OUTSIDE this codebase's own
//     hashing, matched against the fingerprint the pipeline itself published. The pipeline
//     demonstrably held those exact bytes and disclosed none of them.
//   · a HOSTILE CONTROL — the same channel, the same helper, an UNSEEDED value: it arrives
//     verbatim, and the helper finds it. That is what proves these cells can fail.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE RE-DERIVATION LEDGER — every assertion of the two deleted v1 suites, one row each.
// Recovered with:
//   git show $(git log --diff-filter=D --format=%H -1 -- <path>)^:<path>
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// FROM agent-qa-server-masking.test.ts (395-25):
//
// | v1 assertion                                          | here                                  |
// |-------------------------------------------------------|---------------------------------------|
// | (M1) a scalar `apiToken` never returned by             | RETIRED WITH THE DATA PATH. `config.  |
// |      `agent_qa_get_config`                             | get` is in `UNPROJECTED_OPS` — no     |
// |                                                        | whole-config render exists on this    |
// |                                                        | surface at all. The residual config-  |
// |                                                        | bytes channel is the propose diff,    |
// |                                                        | re-derived in group E.                |
// | (M1) a URL-userinfo credential never returned          | RE-DERIVED as E1/E3: a credential-    |
// |                                                        | shaped value anywhere in the file     |
// |                                                        | blocks the proposal, so no diff of    |
// |                                                        | that file reaches the wire.           |
// | (M1) a `providerHeaders` credential never returned     | RE-DERIVED as E3 for a credential-    |
// |                                                        | SHAPED value (v1's own plant), and    |
// |                                                        | its BOUND measured in F2 for an       |
// |                                                        | opaque one — see the bound note.      |
// | (M1) the partial-mask tail is gone, not shortened      | RE-DERIVED as the windowing rule      |
// |                                                        | itself: groups B, C, D, E.            |
// | (M1) `<redacted>` occurs three times — something WAS   | RE-DERIVED as A2 + B1's integrity     |
// |      redacted                                          | halves (the marker is present where   |
// |                                                        | the plant was).                       |
// | (M2) credential-free members of the same container     | RE-DERIVED as group G.                |
// |      survive verbatim                                  |                                       |
//
// FROM credential-surface-parity.test.ts (395-26):
//
// | v1 assertion                                          | here                                  |
// |-------------------------------------------------------|---------------------------------------|
// | (P0) every plant is really in the fixture              | RE-DERIVED as A1.                     |
// | (P0) the ancestor plants are NOT credential-shaped, so | RE-DERIVED IN A NEW VOCABULARY as A2: |
// |      the name arm is what carries the cell             | the new surface's arms are the run    |
// | (P0) the auth-mix plant IS credential-shaped           | masker's SEED set and the scan's      |
// | (P0) the auth redactor's early return really fires     | DETECTOR families, and A2/E1/E2 pin   |
// |                                                        | each arm by name. The v1 arms belong  |
// |                                                        | to `maskSensitive`, deleted with the  |
// |                                                        | v1 server.                            |
// | (P1) every plant counts ZERO on BOTH shipped artefacts | HALF RE-DERIVED, HALF RETIRED, said   |
// |      (`config show` AND `agent_qa_get_config`)         | plainly: the MCP half is groups B-E;  |
// |                                                        | the CLI half lives in `packages/cli/  |
// |                                                        | src/composition/__tests__/masked-     |
// |                                                        | config.test.ts`. The cross-surface    |
// |                                                        | RELATION retires because the second   |
// |                                                        | channel does — a relation needs two   |
// |                                                        | renders of the same bytes and there   |
// |                                                        | is now one.                           |
// | (P1) the leak is measured at the exit code a person    | RETIRED WITH THE CLI ARM (this file   |
// |      actually gets                                     | drives no command).                   |
// | (P2) a sibling OUTSIDE the credential container, and   | RE-DERIVED as group G.                |
// |      the credential-free members, survive              |                                       |
// | (P2) the rows are MARKED, not dropped                  | RETIRED WITH `config show` (no row-   |
// |                                                        | oriented render on this surface).     |
// | (P2) the tool response is not wholesale opaque         | RE-DERIVED as G1.                     |
// | (P3) a non-credential sibling INSIDE a credential-     | RETIRED WITH THE RENDER. The new      |
// |      named container is redacted on both surfaces      | surface has no container-walking      |
// |                                                        | config render; the containment rule   |
// |                                                        | still governs `config show`, whose    |
// |                                                        | own suite owns it.                    |
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE BOUND, STATED BECAUSE IT IS MEASURED (F2) — the door-enumeration bound every detector road
// has. The seeded arm knows the values it was TOLD about; the shape arm knows the families it can
// recognise; the name arm knows the key names it enumerates. A value that is none of those three is
// missed, and F2 drives exactly such a value all the way to the wire rather than describing it.
// The mitigation is the PAIRING, not any one arm: a credential a person would actually hold is
// either declared to this host (seeded — B, D), or shaped like one (E1), or written into a config
// file, where the construction scan refuses the whole proposal (E3). Widening the shared credential
// NAME census is not done here: it is 395's predicate, it decides what `config show` prints, and it
// is pinned leaf-by-leaf by another suite. 397 adjudicates it; this file files the measurement.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE FOUND — the defect RESEARCH Pitfall 9 named before anyone had driven the channel.
//
// Cell (B1b) was written because the mutation harness measured that no cell in this file exercised
// the generic handler's SUCCESS-path masking at all: every echoing channel here was a refusal, so
// severing the success-path `maskText` left the whole suite green. A corpus whose absence cells all
// live on one channel has measured one channel. The cell added to close that hole then failed, and
// what it failed on was the shipped implementation (2026-08-16, before the fix):
//
//   AssertionError: structuredContent carried the plant — the machine channel a person never
//   reads: expected 'prop_qxr' to be undefined
//
// `catalog.ts` masked `content` and set `structuredContent` from the RAW op output, so a credential
// this host had itself DECLARED reached the wire verbatim in the object a model reads while the text
// beside it read `<SECRET_0>`. Both handlers now answer both channels from ONE masked serialization
// (`packages/mcp/src/masked-result.ts`), which is also why they can no longer disagree.
//
// OBSERVED REDS — 2026-08-16, `SHOW_REDS=1 bash scripts/396-06-credential-mutation.sh`:
//
//   C1 (1) the success path stops masking       → (B1b) `the text channel carried the plant`
//   C2 (1) THE SHIPPED DEFECT restored — the    → (B1b) `structuredContent carried the plant — the
//          object channel parsed from the             machine channel a person never reads`
//          UNMASKED document
//   C3 (2) the error path stops masking         → (B1), (C1)
//   C4 (1) the apply refusal's teach unmasked   → (D1)
//   C5 (3) declared credentials stop reaching   → (A2) `the declared-token arm did not seed the
//          the masker; environment arm intact          masker`, (B1), (D1) — and the environment
//                                                      arm's cells GREEN in the same run
//
// C5's cross-arm green is the measurement that makes A2 a claim about two mechanisms: tearing the
// declared-token seeding reds only the declared-token cells, and the config-write group — which the
// ENVIRONMENT seed carries — stays green beside it.
//
// `CREDENTIAL_MUTATION_SELFTEST=neutered bash scripts/396-06-credential-mutation.sh` exits 1 with
// `C1: the suite stayed green under the mutation`, which is what proves the harness can fail.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { buildAgentQaMcpServer } from '@vostride/agent-qa-mcp'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeMcpMasking, mcpFunctionCaller } from '../commands/mcp.js'
import { composeCliLocalAgent } from '../composition/local-agent-host.js'
import { resolveMcpTokens, resolveStdioScopes } from '../composition/mcp-token-resolution.js'

// ── THE PLANTS ────────────────────────────────────────────────────────────────────────────────
//
// Each one exercises a DIFFERENT arm, and the file says which. Two share no arm with each other,
// which is what stops a single mechanism from carrying every cell.

/** Seeded by NAME SUFFIX through `sensitiveEnvSlice` — the run masker's environment arm. */
const ENV_VAR = 'AGENT_QA_396_06_FIXTURE_TOKEN'
const ENV_PLANT = 'qeb4t7zmv1x8s3d0g5j2n9'

/**
 * The credential this host DEFINITIONALLY holds: a declared MCP bearer token. Its variable name
 * ends in no suffix `sensitiveEnvSlice` recognises, deliberately — this plant is masked only
 * because 396-05 seeded the masker from the DECLARED entries, and a cell that let the suffix rule
 * catch it would be measuring the wrong arm.
 */
const TOKEN_VAR = 'AGENT_QA_396_06_FIXTURE_CRED'
const TOKEN_PLANT = 'wnk9j2p6r4y7c1f8h3l5b0'

/** Credential-SHAPED, so the construction scan's pattern arm can recognise it with no seed. */
const CONFIG_PLANT = 'sk-ant-api03-396zzsixCONFIGFIXTUREONLYnotarealkeyPP'

/**
 * A credential whose value happens to be a VALID PROPOSAL ID, so it survives the SDK's input
 * validation and reaches an op that ECHOES it in a SUCCESS payload (`proposals.show` answers
 * `{kind:'not-found', proposalId}`). Seeded through the environment arm.
 *
 * It exists because the mutation harness measured that no other cell in this file exercised the
 * generic handler's SUCCESS-path masking at all: every echoing channel here is a refusal, so
 * severing the success-path `maskText` left the whole suite green. A corpus whose absence cells all
 * live on one channel is a corpus that has measured one channel.
 */
const ECHO_VAR = 'AGENT_QA_396_06_FIXTURE_ECHO_TOKEN'
const ECHO_PLANT = 'prop_qxr7t2mv9s4d1g8j5n3b6'

/** Declared to nothing and shaped like nothing. The hostile control's value (F1). */
const UNSEEDED_PLANT = 'hzp5r8u2i7o4a9e6k3m1v8'

/** Opaque, under a credential-NAMED key the shipped census does not enumerate. The bound (F2). */
const OPAQUE_HEADER_PLANT = 'tealwood7412delta5510sierra'

/**
 * Fingerprints computed with `node:crypto`, OUTSIDE this repository's own hashing.
 *
 * The product publishes a `redactedFingerprint` for every scan finding precisely so a value can be
 * discussed without being repeated. Matching it against a hash this file computes for itself is the
 * integrity half of every absence claim below: the pipeline held these exact bytes.
 */
function fingerprintOutsideTheCodebase(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

const CONFIG_FILE = 'agent-qa.config.yaml'

function seededConfig(extraLlmLines = ''): string {
  return `# agent-qa Configuration

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
${extraLlmLines}  targets:
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
}

/** The same file with a second entry whose header carries an opaque value under a credential name. */
function configWithOpaqueHeaderCredential(): string {
  return seededConfig(
    `    - name: headers
      provider: anthropic-compatible
      model: claude-4.7-sonnet
      baseURL: https://api.example.com
      providerHeaders:
        X-Client-Auth: ${OPAQUE_HEADER_PLANT}
`,
  )
}

/** The same file with a CREDENTIAL-SHAPED value in the URL userinfo — v1's own plant, verbatim. */
function configWithShapedCredential(): string {
  return seededConfig(
    `    - name: headers
      provider: anthropic-compatible
      model: claude-4.7-sonnet
      baseURL: https://user:${CONFIG_PLANT}@api.example.com
`,
  )
}

let root: string
let configPath: string
let agentQaRoot: string
let host: ReturnType<typeof composeCliLocalAgent> | undefined
let masking: ReturnType<typeof composeMcpMasking> | undefined
let frames: string[]
let client: Client | undefined
let handler: ReturnType<typeof createMcpHandler> | undefined

function git(...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} exited ${String(result.status)}: ${result.stderr}`)
  }
  return result.stdout
}

/**
 * The first eight-character window of `plant` that occurs in `haystack`, or `undefined`.
 *
 * WINDOWED, not whole-string. A mask that disclosed a prefix, a suffix, or any run of eight
 * characters would satisfy a whole-string check and would still be a disclosure. This helper is
 * also the one the hostile control (F1) requires to FIND something, which is what proves the cells
 * that require `undefined` are capable of failing.
 */
function leakedWindow(haystack: string, plant: string, size = 8): string | undefined {
  for (let at = 0; at + size <= plant.length; at += 1) {
    const window = plant.slice(at, at + size)
    if (haystack.includes(window)) return window
  }
  return undefined
}

/** Every byte this session's transport received, in order — the only honest haystack. */
function wire(): string {
  return frames.join('\n')
}

interface ToolResult {
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly structuredContent?: Record<string, unknown>
  readonly isError?: boolean
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client!.callTool({ name, arguments: args })) as ToolResult
}

function rendered(result: ToolResult): string {
  return (result.content ?? []).map((block) => block.text ?? '').join('\n')
}

/** Build the fixture project, the shipped composition, and a connected client over it. */
async function openWorkspace(configBody: string): Promise<void> {
  root = mkdtempSync(join(tmpdir(), 'agent-qa-396-06-cred-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  writeFileSync(configPath, configBody)

  git('init', '--quiet')
  git('config', 'user.name', 'agent-qa 396-06 credential surface')
  git('config', 'user.email', 'credential-surface@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), '.agent-qa/\nagent-qa-knowledge/\n')
  git('add', '--', '.gitignore', CONFIG_FILE)
  git('commit', '--quiet', '-m', 'seed')

  // THE ENVIRONMENT ARM IS PLANTED ON THE REAL `process.env`, because that is what the shipped host
  // reads: `configScanSeeds: () => ({ env: sensitiveEnvSlice(process.env) })`. A stubbed object
  // would have measured a seam this composition does not have.
  process.env[ENV_VAR] = ENV_PLANT
  process.env[ECHO_VAR] = ECHO_PLANT

  host = composeCliLocalAgent({ agentQaRoot, configPath, confirm: undefined })

  // PRODUCED THROUGH THE SHIPPED RESOLVER, not typed: what the masker is seeded with is what a real
  // start would have produced from a real config and a real environment.
  const tokens = resolveMcpTokens(
    [{ name: 'fixture', tokenEnvVar: TOKEN_VAR, scopes: ['read'] }],
    { [TOKEN_VAR]: TOKEN_PLANT },
  )
  // THE PRODUCTION MASKER — the function the `mcp` command itself calls. A suite that built its own
  // masker here would be asserting that ITS masker works, which is true and worthless.
  masking = composeMcpMasking({ tokens, env: process.env })

  frames = []
  handler = createMcpHandler(() =>
    buildAgentQaMcpServer({
      registry: host!.registry,
      caller: mcpFunctionCaller(resolveStdioScopes(true)),
      maskText: (text: string) => masking!.mask(text),
    }),
  )
  const recordingFetch = (async (url: URL | string, init?: RequestInit) => {
    const res = await handler!.fetch(new Request(url as string, init))
    frames.push(await res.clone().text())
    return res
  }) as typeof fetch

  client = new Client({ name: 'agent-qa-396-06-credential', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://cred.local/mcp'), { fetch: recordingFetch }),
  )
}

beforeEach(async () => {
  await openWorkspace(seededConfig())
})

afterEach(async () => {
  await client?.close().catch(() => {})
  await handler?.close().catch(() => {})
  await host?.close().catch(() => {})
  masking?.dispose()
  client = undefined
  handler = undefined
  host = undefined
  masking = undefined
  delete process.env[ENV_VAR]
  delete process.env[ECHO_VAR]
  rmSync(root, { recursive: true, force: true })
})

function headless<T>(fn: () => Promise<T>): Promise<T> {
  return runSafetyScope({ executionContext: 'local-headless' }, fn)
}

// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('A · the plants are what the ledger says they are (the non-vacuity gate)', () => {
  it('(A1) every plant is really where the fixture put it, and the bytes are the pinned bytes',
    () => {
      expect(process.env[ENV_VAR], 'the environment arm was not planted').toBe(ENV_PLANT)

      // The fingerprints are computed here with `node:crypto` and pinned as literals. A plant edited
      // without its fingerprint being re-derived fails HERE, before any absence cell can pass for
      // the wrong reason.
      expect(fingerprintOutsideTheCodebase(CONFIG_PLANT)).toBe('936e79cc3223137d')
      expect(fingerprintOutsideTheCodebase(ENV_PLANT)).toBe('db3186baa5885bf6')

      // And the plants are pairwise distinct in every eight-character window, so no cell below can
      // pass or fail on another plant's bytes.
      const plants = [ENV_PLANT, TOKEN_PLANT, CONFIG_PLANT, UNSEEDED_PLANT, OPAQUE_HEADER_PLANT]
      for (const [at, plant] of plants.entries()) {
        for (const [other, second] of plants.entries()) {
          if (at === other) continue
          expect(leakedWindow(second, plant), `${plant} shares a window with ${second}`)
            .toBeUndefined()
        }
      }
    })

  it('(A2) the masker recognises exactly the two SEEDED plants, and nothing else', () => {
    // Each arm asserted separately. If both plants were caught by one arm, every cell in groups B
    // and D would be one measurement wearing two names.
    expect(masking!.mask(ENV_PLANT), 'the environment arm did not seed the masker')
      .not.toContain(ENV_PLANT)
    expect(masking!.mask(TOKEN_PLANT), 'the declared-token arm did not seed the masker')
      .not.toContain(TOKEN_PLANT)

    // The discrimination that makes F1 a control rather than a coincidence: this value is NOT
    // masked, so a channel that returns it verbatim is returning what it was given.
    expect(masking!.mask(UNSEEDED_PLANT)).toBe(UNSEEDED_PLANT)
    expect(masking!.mask(OPAQUE_HEADER_PLANT)).toBe(OPAQUE_HEADER_PLANT)
  })
})

describe('B · no seeded credential reaches the wire through a read tool', () => {
  it('(B1) the echoing read path masks both seeded plants, in the result AND in the frames',
    async () => {
      await headless(async () => {
        for (const plant of [ENV_PLANT, TOKEN_PLANT]) {
          const answer = await call('agent_qa_get_run_digest', { runId: plant })

          // THE INTEGRITY HALF FIRST. `runs.digest` composes its refusal from the caller's own
          // string, so this cell only means something if the echo really happened; a path that
          // stopped echoing would satisfy the absence assertion for free.
          expect(rendered(answer), 'the echo path stopped echoing — the cell measures nothing')
            .toContain('No completed run recorded for id')

          expect(leakedWindow(rendered(answer), plant), `the tool result carried ${plant}`)
            .toBeUndefined()
          expect(leakedWindow(wire(), plant), `a recorded frame carried ${plant}`).toBeUndefined()
        }
      })
    })

  it('(B1b) the SUCCESS payload of a read tool that echoes the caller\'s own string is masked on '
    + 'BOTH channels — text and structuredContent', async () => {
    await headless(async () => {
      const answer = await call('agent_qa_show_proposal', { proposalId: ECHO_PLANT })

      // The integrity half: this really is the echoing SUCCESS arm, not a refusal.
      expect(answer.isError ?? false, rendered(answer)).toBe(false)
      expect((answer.structuredContent as { kind?: string }).kind).toBe('not-found')

      expect(leakedWindow(rendered(answer), ECHO_PLANT), 'the text channel carried the plant')
        .toBeUndefined()
      expect(
        leakedWindow(JSON.stringify(answer.structuredContent), ECHO_PLANT),
        'structuredContent carried the plant — the machine channel a person never reads',
      ).toBeUndefined()
      expect(leakedWindow(wire(), ECHO_PLANT), 'a recorded frame carried the plant').toBeUndefined()
    })
  })

  it('(B2) the other read doors carry no window of either seeded plant either', async () => {
    await headless(async () => {
      for (const plant of [ENV_PLANT, TOKEN_PLANT]) {
        await call('agent_qa_get_entity', { ref: plant })
        await call('agent_qa_list_proposals', {})
        await call('agent_qa_list_runs', {})
      }
      for (const plant of [ENV_PLANT, TOKEN_PLANT]) {
        expect(leakedWindow(wire(), plant), `a read door leaked ${plant}`).toBeUndefined()
      }
    })
  })
})

describe('C · the error channels', () => {
  it('(C1) an op-side refusal composed from the caller\'s own string is masked', async () => {
    await headless(async () => {
      const answer = await call('agent_qa_get_run_digest', { runId: ENV_PLANT })
      expect(answer.isError, 'this cell needs the refusal path, not the success path').toBe(true)
      expect(leakedWindow(wire(), ENV_PLANT)).toBeUndefined()
    })
  })

  it('(C2) the SDK-composed input-validation error is a channel this host does NOT mask, and it '
    + 'is measured empty', async () => {
    await headless(async () => {
      // NAMED RATHER THAN ASSUMED. The SDK validates a call against the advertised `inputSchema`
      // and composes the refusal ITSELF, before any handler runs — so `maskText` is not on this
      // path and could not be. Measured on 2.0.0 (2026-08-16): the message names the field and the
      // rule and never quotes the rejected value. This cell reds the day that changes, which is the
      // only way a channel outside our masker can be watched at all.
      const answer = await call('agent_qa_show_proposal', { proposalId: ENV_PLANT })

      expect(answer.isError).toBe(true)
      expect(rendered(answer), 'the SDK stopped naming the tool — re-read this channel')
        .toContain('Input validation error')
      expect(leakedWindow(wire(), ENV_PLANT), 'the SDK now quotes rejected arguments, and this '
        + 'host does not mask that channel').toBeUndefined()
    })
  })
})

describe('D · the apply refusal payload renders envelope content, and masks it', () => {
  it('(D1) neither the prose nor the structured refusal carries a window of a seeded plant',
    async () => {
      await headless(async () => {
        for (const plant of [ENV_PLANT, TOKEN_PLANT]) {
          const refusal = await call('agent_qa_apply_config_proposal', { proposal_id: plant })

          // The integrity half: this really is the teach payload, composed from the id the caller
          // sent, on both the prose channel and the data channel.
          expect(rendered(refusal)).toContain('To apply it, call this tool again')
          const structured = refusal.structuredContent as Record<string, unknown>
          expect(structured['status']).toBe('confirmation-required')

          expect(leakedWindow(rendered(refusal), plant)).toBeUndefined()
          expect(leakedWindow(JSON.stringify(structured), plant)).toBeUndefined()
          expect(leakedWindow(wire(), plant), `the apply refusal leaked ${plant}`).toBeUndefined()
        }
      })
    })
})

describe('E · the config-write channel refuses to carry a credential at all', () => {
  it('(E1) a credential-SHAPED value is blocked by the pattern arm, and the wire carries a '
    + 'fingerprint instead of the value', async () => {
    await headless(async () => {
      const answer = await call('agent_qa_propose_config_change', {
        action: 'config.field.set',
        path: 'workspace.hooksFile',
        value: CONFIG_PLANT,
      })

      const outcome = answer.structuredContent as {
        outcome?: string
        blockedReason?: string
        scanFindings?: readonly { detector?: string; redactedFingerprint?: string }[]
      }
      expect(outcome.outcome, rendered(answer)).toBe('blocked')
      expect(outcome.blockedReason).toBe('guardrail-hit')
      // BY NAME. Asserting the arm rather than the verdict is what stops E1 and E2 from being one
      // measurement: they must be caught by DIFFERENT mechanisms or the pairing proves nothing.
      expect(outcome.scanFindings?.map((finding) => finding.detector)).toEqual(['apiKey'])

      // THE INTEGRITY CELL. The fingerprint the pipeline published equals the one this file
      // computes with `node:crypto` — so the pipeline held exactly these bytes, and published none
      // of them.
      expect(outcome.scanFindings?.[0]?.redactedFingerprint)
        .toBe(fingerprintOutsideTheCodebase(CONFIG_PLANT))
      expect(leakedWindow(wire(), CONFIG_PLANT), 'the blocked payload carried the value')
        .toBeUndefined()
    })
  })

  it('(E2) a value the environment SEEDED is blocked by the seed arm — a different mechanism',
    async () => {
      await headless(async () => {
        const answer = await call('agent_qa_propose_config_change', {
          action: 'config.field.set',
          path: 'workspace.hooksFile',
          value: ENV_PLANT,
        })

        const outcome = answer.structuredContent as {
          outcome?: string
          scanFindings?: readonly { detector?: string; redactedFingerprint?: string }[]
        }
        expect(outcome.outcome, rendered(answer)).toBe('blocked')
        expect(outcome.scanFindings?.map((finding) => finding.detector)).toEqual(['seeded-secret'])
        expect(outcome.scanFindings?.[0]?.redactedFingerprint)
          .toBe(fingerprintOutsideTheCodebase(ENV_PLANT))
        expect(leakedWindow(wire(), ENV_PLANT)).toBeUndefined()
      })
    })

  it('(E3) a config that ALREADY carries a credential-shaped value yields no diff at all — v1\'s '
    + 'URL-userinfo plant, re-derived', async () => {
    // Re-opened over a different fixture: the credential is in the file BEFORE the caller asks for
    // anything, which is the arrangement v1's masking suite had.
    await client?.close().catch(() => {})
    await handler?.close().catch(() => {})
    await host?.close().catch(() => {})
    masking?.dispose()
    rmSync(root, { recursive: true, force: true })
    await openWorkspace(configWithShapedCredential())

    await headless(async () => {
      expect(readFileSync(configPath, 'utf8'), 'the fixture lost its plant')
        .toContain(CONFIG_PLANT)

      const answer = await call('agent_qa_propose_config_change', {
        action: 'config.field.set',
        path: 'registry.llms.0.model',
        value: 'gpt-5.7-terra',
      })

      const outcome = answer.structuredContent as {
        outcome?: string
        shownDiff?: string
        scanFindings?: readonly { detector?: string; redactedFingerprint?: string }[]
      }
      // NO PROPOSAL, THEREFORE NO DIFF. The v1 suite asserted that the whole-config render did not
      // print this value; the new surface has no whole-config render, and the one place config
      // bytes could still reach a caller is a diff — which is never produced.
      expect(outcome.outcome, rendered(answer)).toBe('blocked')
      expect(outcome.shownDiff).toBeUndefined()
      expect(outcome.scanFindings?.[0]?.redactedFingerprint)
        .toBe(fingerprintOutsideTheCodebase(CONFIG_PLANT))
      expect(leakedWindow(wire(), CONFIG_PLANT)).toBeUndefined()
    })
  })
})

describe('F · the controls, and the bound they measure', () => {
  it('(F1) HOSTILE CONTROL: an UNSEEDED value travels the same channel verbatim, and the helper '
    + 'finds it', async () => {
    await headless(async () => {
      const answer = await call('agent_qa_get_run_digest', { runId: UNSEEDED_PLANT })

      // The whole point. If this cell did not find the value, every `toBeUndefined()` above would
      // be an assertion over a dead channel — which is how an absence corpus passes while a
      // credential leaks (T-395-R5-10's own shape).
      expect(leakedWindow(rendered(answer), UNSEEDED_PLANT), 'the echo channel is DEAD: the '
        + 'absence cells above prove nothing').toBeDefined()
      expect(leakedWindow(wire(), UNSEEDED_PLANT)).toBeDefined()
      expect(rendered(answer)).toContain(UNSEEDED_PLANT)
    })
  })

  it('(F2) THE BOUND, MEASURED: an opaque value under a credential-NAMED key the census does not '
    + 'enumerate reaches the wire inside a proposal diff', async () => {
    await client?.close().catch(() => {})
    await handler?.close().catch(() => {})
    await host?.close().catch(() => {})
    masking?.dispose()
    rmSync(root, { recursive: true, force: true })
    await openWorkspace(configWithOpaqueHeaderCredential())

    await headless(async () => {
      const answer = await call('agent_qa_propose_config_change', {
        action: 'config.field.set',
        // THE SECOND ENTRY, which is the one carrying the header. A change three lines away would
        // put the credential outside the diff's context window and the cell would then be about
        // hunk arithmetic rather than about the census.
        path: 'registry.llms.1.model',
        value: 'claude-4.8-sonnet',
      })
      const outcome = answer.structuredContent as { outcome?: string; shownDiff?: string }

      // WRITTEN AS IT IS, NOT AS IT SHOULD BE. The proposal is produced; the diff's context lines
      // carry a neighbouring `providerHeaders.X-Client-Auth` value; and the value is neither
      // seeded, nor credential-shaped, nor under a key the shipped census enumerates — so nothing
      // on this road recognises it.
      expect(outcome.outcome, rendered(answer)).toBe('proposed')
      expect(leakedWindow(outcome.shownDiff ?? '', OPAQUE_HEADER_PLANT), 'the bound closed — '
        + 'update this cell and the ledger, and tell 397').toBeDefined()

      // AND THE PAIRING THAT BOUNDS THE BOUND. The same key with a value any arm recognises does
      // not get here: E1/E2/E3 are that measurement, and this line names the relation rather than
      // leaving it to prose. A credential a person actually holds is declared, or shaped, or
      // written into a file the scan reads.
      expect(masking!.mask(OPAQUE_HEADER_PLANT)).toBe(OPAQUE_HEADER_PLANT)
    })
  })
})

describe('G · redaction lands on credentials, not on the config (v1 M2 / P2 re-derived)', () => {
  it('(G1) the credential-free members of the same payloads survive verbatim', async () => {
    await headless(async () => {
      const listed = await client!.listTools()
      // The catalogue is readable: a masker that blackened everything would take from the model the
      // very surface it was asked to use. Over-redaction is a real cost, not a safe default.
      expect(listed.tools.map((tool) => tool.name)).toContain('agent_qa_apply_config_proposal')

      const answer = await call('agent_qa_propose_config_change', {
        action: 'config.field.set',
        path: 'use.timeout.step',
        value: '45s',
      })
      const outcome = answer.structuredContent as { outcome?: string; shownDiff?: string }
      expect(outcome.outcome, rendered(answer)).toBe('proposed')

      // An ordinary config change renders its ordinary bytes: the diff is a diff, not a marker.
      expect(outcome.shownDiff).toContain('step: 30s')
      expect(outcome.shownDiff).toContain('step: 45s')
      expect(outcome.shownDiff).toContain(CONFIG_FILE)

      // And the response is not wholesale opaque — v1's (P2) last assertion, re-derived.
      expect(JSON.stringify(outcome).length).toBeGreaterThan(200)
    })
  })
})

describe('H · nothing persisted carries a planted byte', () => {
  it('(H1) no proposal record on disk contains a window of any plant', async () => {
    await headless(async () => {
      await call('agent_qa_propose_config_change', {
        action: 'config.field.set',
        path: 'workspace.hooksFile',
        value: CONFIG_PLANT,
      })
      await call('agent_qa_propose_config_change', {
        action: 'config.field.set',
        path: 'workspace.hooksFile',
        value: ENV_PLANT,
      })

      const dir = join(agentQaRoot, 'proposals')
      const records = readdirSync(dir)
      // The integrity half: records really were written, so an empty directory cannot pass this.
      expect(records.length, 'no record was persisted — this cell measures nothing')
        .toBeGreaterThanOrEqual(2)

      for (const name of records) {
        const body = readFileSync(join(dir, name), 'utf8')
        for (const plant of [ENV_PLANT, TOKEN_PLANT, CONFIG_PLANT]) {
          expect(leakedWindow(body, plant), `${name} persisted ${plant}`).toBeUndefined()
        }
      }
    })
  })
})
