// End-to-end tracer for the 384 function layer (Plan 01, D-05/D-06/D-11).
//
// `agent-qa fn runs.list` must resolve through the WHOLE path — composition-built
// registry → invokeFunction → evaluate() → injected run-dir reader → RunSummary[] —
// against a real on-disk fixture. Nothing here stubs the gate or the registry.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The unfenced compatibility composition is test-only and intentionally absent from the
// knowledge-local package barrel. This fixture imports its internal test seam directly.
import { publishBundleForTest as publishBundle } from '@vostride/agent-qa-knowledge-local'
import { EVENTS_FILE, RUNS_SUBDIR } from '@vostride/agent-qa-runner-local'
import {
  CONFIG_MASK_PLACEHOLDER,
  CURRENT_HANDOFF_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  KnowledgeBundleSummary,
  MaskedResolvedConfig,
  RunEventEnvelope,
  RunEventType,
} from '@vostride/agent-qa-schema'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFnCommand } from '../commands/fn.js'

/** A secret-shaped value the fixture config carries so masking has something to hide. */
const FIXTURE_API_KEY = 'sk-live-DO-NOT-LEAK-4242'

/**
 * Credentials planted where NO key name marks them as secret (Plan 08 / CR-01).
 *
 * `providerHeaders` and `registry.providers.<name>` are free-form records whose keys the
 * operator chooses, so these four are reached only by the opaque-subtree rule; the fifth
 * hides inside a URL's userinfo, where there is no key at all.
 */
const FIXTURE_HEADER_KEY = 'sk-live-HEADER-KEY-DO-NOT-LEAK-1111'
const FIXTURE_HEADER_CRED = 'sk-live-HEADER-CRED-DO-NOT-LEAK-2222'
const FIXTURE_HEADER_PWD = 'sk-live-HEADER-PWD-DO-NOT-LEAK-3333'
const FIXTURE_PROVIDER_KEY = 'sk-live-PROVIDER-KEY-DO-NOT-LEAK-5555'
const FIXTURE_URL_PASSWORD = 'hunter2-URL-DO-NOT-LEAK'

/**
 * Credentials planted in the parts of a URL no configuration key reaches (round-3 CR-01).
 *
 * `registry.llms.<n>.baseURL` and `registry.targets.<name>.url` are the complete remaining
 * credential-bearing residue of the schema's visible surface — the round-3 verifier
 * enumerated all 32 visible string leaves and found exactly these two. They are visible BY
 * DESIGN, so what has to hold is a property of the RENDER.
 *
 * The parameter names are drawn from outside the masker's vocabulary: `ticket`, `assertion`
 * and `sso` each read 0 in `masked-config.ts` (positive control `SECRET_KEY_TERMS` = 2 in
 * the same read). A parameter-name regex was falsified by the verifier's own `?session=`
 * repro; only a rule over the value's structure survives the next name nobody thought of.
 */
const FIXTURE_URL_QUERY_SECRET = 'sk-live-TICKET-DO-NOT-LEAK-7001'
const FIXTURE_URL_FRAGMENT_SECRET = 'sk-live-FRAGMENT-DO-NOT-LEAK-7002'
const FIXTURE_TARGET_URL_SECRET = 'sk-live-SSO-DO-NOT-LEAK-7003'

/**
 * Credentials planted in URL forms the render rule's PRECONDITION rejects (round-4 CR-01).
 *
 * The round-3 corpus above is disciplined on the parameter-NAME axis and blind on the VALUE
 * axis: every URL it plants is an absolute `https://` one, which is exactly the shape
 * `new URL(value)` with no base accepts. Six sentinels rode out verbatim with `masked: false`
 * through the unmodified production CLI on the forms below — an operator writes all four
 * without thinking, and both fields are plain `z.string()` with no URL-format validation.
 *
 * The forms are taken from 384-VERIFICATION.md's gap entry rather than from the fix, and the
 * parameter names (`waybill`, `hallmark`, `emblem`, `lanyard`) each read 0 in
 * `masked-config.ts`'s bytes, measured with a positive control (`SECRET_KEY_TERMS` = 2) in
 * the same read. `masked-config.test.ts` carries the characterisation proving the four are
 * precondition-rejected, asserted against Node's `URL` rather than against our own branches.
 */
const FIXTURE_PROTOREL_USERINFO_SECRET = 'sk-live-USERINFO-DO-NOT-LEAK-7101'
const FIXTURE_PROTOREL_QUERY_SECRET = 'sk-live-WAYBILL-DO-NOT-LEAK-7102'
const FIXTURE_PROTOREL_FRAGMENT_SECRET = 'sk-live-HALLMARK-DO-NOT-LEAK-7103'
const FIXTURE_HOST_RELATIVE_SECRET = 'sk-live-EMBLEM-DO-NOT-LEAK-7104'
const FIXTURE_PATH_RELATIVE_SECRET = 'sk-live-LANYARD-DO-NOT-LEAK-7105'
const FIXTURE_OPAQUE_SCHEME_SECRET = 'sk-live-OPAQUE-DO-NOT-LEAK-7106'

/**
 * Credentials planted in the URL component every previous round's rule KEPT (round-5 CR-03).
 *
 * Rounds 3 and 4 cleared userinfo, query and fragment and re-rendered
 * `scheme://host[:port]/path`, so a credential written into the PATH survived a rule that ran
 * and reported success — published verbatim with `masked: false` through the unmodified
 * production CLI. Slack/Discord webhooks, presigned URLs and `/v1/keys/<token>` bases are all
 * exactly this shape, on exactly the two fields the whole rule exists for.
 *
 * The carrier names (`cartouche`, `trellis`, `obelisk`) each read 0 in `masked-config.ts`'s
 * bytes, measured with a positive control (`isMaskedConfigPath` >= 1) in the same read.
 */
const FIXTURE_PATH_BORNE_TARGET_SECRET = 'sk-live-CARTOUCHE-DO-NOT-LEAK-7201'
const FIXTURE_PROTOREL_PATH_SECRET = 'sk-live-TRELLIS-DO-NOT-LEAK-7202'
const FIXTURE_KEY_IN_PATH_SECRET = 'sk-live-OBELISK-DO-NOT-LEAK-7203'

/**
 * The OVER-MASK corpus (round-5 CR-02), on the real fields whose semantics require them.
 *
 * `workspace.testMatch` is `z.array(z.string().min(1)).min(1)` — REQUIRED on every config —
 * and `?` is the standard single-character glob wildcard. `services.accessibility.exclude`
 * takes CSS selectors, where `#id` is the commonest form there is. Round 5 rendered all three
 * as `[masked]` to the one capability whose stated purpose is configuration triage.
 */
const FIXTURE_GLOB_WILDCARD = 'tests/**/case-?.yaml'
const FIXTURE_IGNORE_GLOB = 'tests/legacy#old/**'
const FIXTURE_CSS_SELECTOR = '#cookie-banner'

/** A registered URL field whose value already IS its origin: the reduction's own floor. */
const FIXTURE_CLEAN_TARGET_URL = 'https://clean.acme.test'

/**
 * Ten credentials planted under `registry.devices.<name>.match` (Plan 10 / BL-02).
 *
 * The key names are drawn from OUTSIDE the masker's own constant lists — none of the ten
 * appears anywhere in `masked-config.ts`, and the name census misses every one. They are
 * masked because the SCHEMA declares this record free-form, which is the only reason that
 * survives the next credential nobody thought of. A distinct sentinel per key means a
 * partial fix cannot pass by masking one of them.
 *
 * The record is real: with a non-`local` transport the schema leaves the keys unrestricted,
 * and the device farm forwards every entry verbatim as an `appium:<key>` capability — which
 * is exactly where a device-farm credential lives.
 */
const FIXTURE_DEVICE_MATCH_CREDENTIALS: Record<string, string> = {
  jwt: 'sk-live-JWT-DO-NOT-LEAK-0001',
  pem: 'sk-live-PEM-DO-NOT-LEAK-0002',
  pfx: 'sk-live-PFX-DO-NOT-LEAK-0003',
  dsn: 'sk-live-DSN-DO-NOT-LEAK-0004',
  otp: 'sk-live-OTP-DO-NOT-LEAK-0005',
  mnemonic: 'sk-live-MNEMONIC-DO-NOT-LEAK-0006',
  seedPhrase: 'sk-live-SEEDPHRASE-DO-NOT-LEAK-0007',
  connectionString: 'sk-live-CONNSTR-DO-NOT-LEAK-0008',
  signingKey: 'sk-live-SIGNINGKEY-DO-NOT-LEAK-0009',
  hmacKey: 'sk-live-HMACKEY-DO-NOT-LEAK-0010',
}

/**
 * Two plugin package names, which are the opposite claim (Plan 10 / M-01).
 *
 * Both name packages that load in-process with full Node access, so both belong in the
 * output of the one capability whose purpose is configuration triage. Round 2 hid the first
 * and showed the second, purely because the word `auth` appeared in one path.
 */
const FIXTURE_AUTH_PLUGIN_PACKAGE = '@acme/auth-plugin-SHOW-ME-1234'
const FIXTURE_PROVIDER_PLUGIN_PACKAGE = '@acme/provider-plugin-SHOW-ME-5678'

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: typeof process.exitCode
}

interface FixtureWorkspace {
  root: string
  configPath: string
  runtimeRoot: string
  knowledgeRoot: string
}

function fixtureWorkspace(roots: string[]): FixtureWorkspace {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-fn-command-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        // A required field whose value carries the standard glob wildcard, and an ignore
        // glob carrying a '#'. Round 5 masked both (CR-02).
        testMatch: [FIXTURE_GLOB_WILDCARD],
        testPathIgnore: [FIXTURE_IGNORE_GLOB],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      // A CSS selector on the field that takes CSS selectors — the third CR-02 value.
      services: {
        accessibility: { enabled: false, exclude: [FIXTURE_CSS_SELECTOR] },
      },
      registry: {
        llms: [
          {
            name: 'judge',
            // `anthropic-compatible` is the one provider family allowed to carry
            // providerHeaders, and a compatible provider requires a baseURL — so this is
            // the schema-legal shape a real operator credential arrives in.
            provider: 'anthropic-compatible',
            model: 'claude-fixture',
            // Userinfo, a query string AND a fragment, all on one schema-visible field:
            // the three parts of a URL that belong to no key, so no name-based rule can
            // ever reach them.
            baseURL: `https://ops:${FIXTURE_URL_PASSWORD}@llm.acme.test/v1?ticket=${FIXTURE_URL_QUERY_SECRET}#assertion=${FIXTURE_URL_FRAGMENT_SECRET}`,
            providerHeaders: {
              'x-key': FIXTURE_HEADER_KEY,
              'x-cred': FIXTURE_HEADER_CRED,
              'x-pwd': FIXTURE_HEADER_PWD,
            },
          },
          // Two more schema-legal entries carrying baseURLs the URL parser will NOT resolve
          // absolutely (round-4 CR-01). `anthropic-compatible` requires a baseURL and the
          // schema puts no URL format on it, so these are shapes a real config file holds.
          {
            name: 'host-relative-judge',
            provider: 'anthropic-compatible',
            model: 'claude-fixture',
            baseURL: `llm.acme.test/v1?emblem=${FIXTURE_HOST_RELATIVE_SECRET}`,
          },
          {
            // The form that PARSES: scheme `ops:` with an opaque path, so the credential
            // before the first '@' rides in `pathname` where a userinfo check cannot see it.
            name: 'opaque-scheme-judge',
            provider: 'anthropic-compatible',
            model: 'claude-fixture',
            baseURL: `ops:${FIXTURE_OPAQUE_SCHEME_SECRET}@llm.acme.test/v1`,
          },
          {
            // A key written into the PATH of an absolute base — the component rounds 3 and 4
            // both KEPT. Appended last so the round-4 indices above stay stable.
            name: 'key-in-path-judge',
            provider: 'anthropic-compatible',
            model: 'claude-fixture',
            baseURL: `https://ops.acme.test/v1/keys/${FIXTURE_KEY_IN_PATH_SECRET}`,
          },
        ],
        providers: {
          acme: {
            apiKey: FIXTURE_API_KEY,
            key: FIXTURE_PROVIDER_KEY,
            baseURL: 'https://acme.test',
          },
        },
        // A web target requires a url, so this is the schema-legal shape the SECOND
        // credential-bearing visible field arrives in.
        targets: {
          web: {
            platform: 'web',
            url: `https://x.test/checkout?sso=${FIXTURE_TARGET_URL_SECRET}`,
          },
          // A protocol-relative url carrying all three no-key parts at once, and a
          // path-relative one carrying a query — neither resolves without a base, so round
          // 3's rule never looked at either (round-4 CR-01).
          'protocol-relative': {
            platform: 'web',
            url: `//opsx:${FIXTURE_PROTOREL_USERINFO_SECRET}@x.test/checkout`
              + `?waybill=${FIXTURE_PROTOREL_QUERY_SECRET}`
              + `#hallmark=${FIXTURE_PROTOREL_FRAGMENT_SECRET}`,
          },
          'path-relative': {
            platform: 'web',
            url: `/checkout?lanyard=${FIXTURE_PATH_RELATIVE_SECRET}`,
          },
          // A webhook token in the PATH of an absolute url, and the same in a
          // protocol-relative one — the round-5 CR-03 pair.
          hook: {
            platform: 'web',
            url: `https://hooks.acme.test/services/T00/B00/${FIXTURE_PATH_BORNE_TARGET_SECRET}`,
          },
          relhook: {
            platform: 'web',
            url: `//hooks.acme.test/services/${FIXTURE_PROTOREL_PATH_SECRET}`,
          },
          // A registered url that already IS its origin: the positive control for the
          // reduction, and proof it is not a normalisation.
          clean: { platform: 'web', url: FIXTURE_CLEAN_TARGET_URL },
        },
        devices: {
          pixel: {
            platform: 'android',
            // A non-'local' transport is what leaves the `match` keys unrestricted, so
            // this is the schema-legal shape a device-farm credential arrives in.
            transport: 'browserstack',
            match: FIXTURE_DEVICE_MATCH_CREDENTIALS,
          },
        },
      },
      plugins: {
        auth: [{ package: FIXTURE_AUTH_PLUGIN_PACKAGE }],
        providers: [{ package: FIXTURE_PROVIDER_PLUGIN_PACKAGE }],
      },
      // The config schema's superRefine requires this leaf, so a resolvable fixture
      // must carry it before `config.get` can read anything at all.
      use: { mobile: { appState: 'preserve' } },
    }, null, 2)}\n`,
    'utf8',
  )
  return {
    root,
    configPath,
    runtimeRoot: join(root, '.agent-qa'),
    // `knowledge.dir` defaults to the repo-relative `agent-qa-knowledge` beside the config.
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
  }
}

/** Commit one real bundle so the knowledge listing has a row that came off disk. */
function seedKnowledgeBundle(workspace: FixtureWorkspace): string {
  const outcome = publishBundle(
    {
      knowledgeRoot: workspace.knowledgeRoot,
      productKey: 'shop',
      auditBaseDir: workspace.runtimeRoot,
      commitArtifacts: 'none',
    },
    {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [
          { t: 'el', role: 'Button', name: 'Checkout Now' },
          { t: 'page', route: '/cart' },
        ],
        scope: { tier: 'product', key: 'checkout' },
        summary: 'Checkout control on the cart page',
        body: 'Selecting Checkout Now advances the cart to the payment step.',
        distilledEvidenceRef: {
          id: 'fn-command-fixture',
          sha: 'd9113d37fe29084657c462ac5628ddd56519aeafad8883092a2596075878cbee',
        },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Checkout Now' },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 5,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: {
        mode: 'run-linked',
        runId: 'fn-command-fixture',
        testId: 'fn-command',
        stepIndex: 0,
      },
      artifacts: [],
    },
  )

  expect(outcome.kind).toBe('published')
  if (outcome.kind !== 'published') throw new Error('fixture bundle did not publish')
  return outcome.id
}

function handoff(input: {
  runId: string
  buildOrdinal: number
  aggregateVerdict: CompletedRunHandoff['aggregateVerdict']
  tests?: CompletedRunHandoff['tests']
  gateRun?: true
}): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: input.runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: input.buildOrdinal,
    ...(input.gateRun === undefined ? {} : { gateRun: input.gateRun }),
    executionContext: 'local-headless',
    aggregateVerdict: input.aggregateVerdict,
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1_000 + input.buildOrdinal,
    endedAt: 2_000 + input.buildOrdinal,
    tests: input.tests ?? [],
  }
}

function seedRuns(workspace: FixtureWorkspace, handoffs: readonly CompletedRunHandoff[]): void {
  for (const document of handoffs) {
    const dir = join(workspace.runtimeRoot, RUNS_SUBDIR, document.runId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'handoff.json'), `${JSON.stringify(document)}\n`, 'utf8')
  }
}

function envelope(runId: string, seq: number, type: RunEventType): RunEventEnvelope {
  return { seq, ts: 1_700_000_000_000 + seq, runId, type, payload: {} }
}

/**
 * Write a real `events.jsonl` in the exact layout the v49 `FsEventLog` appends — one JSON
 * envelope per line, seq-ordered and gap-free at 1. The stream op reads it back through the
 * same concrete store the runner writes it with, so the CLI leg is a genuine replay.
 */
function seedEvents(
  workspace: FixtureWorkspace,
  runId: string,
  events: readonly RunEventEnvelope[],
): void {
  const dir = join(workspace.runtimeRoot, RUNS_SUBDIR, runId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, EVENTS_FILE),
    events.map((event) => `${JSON.stringify(event)}\n`).join(''),
    'utf8',
  )
}

/** Five gap-free envelopes for `run-alpha`, the shape a completed run leaves behind. */
function fiveEvents(runId = 'run-alpha'): RunEventEnvelope[] {
  return [
    envelope(runId, 1, 'runStarted'),
    envelope(runId, 2, 'testStarted'),
    envelope(runId, 3, 'stepStarted'),
    envelope(runId, 4, 'testFinished'),
    envelope(runId, 5, 'runFinished'),
  ]
}

async function invoke(
  workspace: FixtureWorkspace,
  args: readonly string[],
): Promise<InvocationResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  process.exitCode = undefined

  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createFnCommand())
    program.exitOverride()
    await program.parseAsync([
      'node',
      'agent-qa',
      '--config',
      workspace.configPath,
      'fn',
      ...args,
    ])
    return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode: process.exitCode }
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
}

describe('agent-qa fn (generic function invoker)', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves runs.list end-to-end against two on-disk handoffs', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-beta', buildOrdinal: 12, aggregateVerdict: 'failed' }),
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
    ])

    const result = await invoke(workspace, ['runs.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const summaries = JSON.parse(result.stdout) as {
      runId: string
      buildOrdinal: number
      aggregateVerdict: string
      testCount: number
    }[]
    expect(summaries.map((summary) => summary.runId)).toEqual(['run-alpha', 'run-beta'])
    expect(summaries[0]).toMatchObject({
      runId: 'run-alpha',
      buildOrdinal: 11,
      aggregateVerdict: 'passed',
      testCount: 0,
    })
    expect(summaries[1]).toMatchObject({ runId: 'run-beta', aggregateVerdict: 'failed' })
  })

  it('emits a deterministic listing for a fixed fixture', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-beta', buildOrdinal: 12, aggregateVerdict: 'failed' }),
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
    ])

    const first = await invoke(workspace, ['runs.list', '--json'])
    const second = await invoke(workspace, ['runs.list', '--json'])

    expect(first).toEqual(second)
  })

  it('lists every registered function id with its scopes, result kind and binding', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['--list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const declarations = JSON.parse(result.stdout) as {
      id: string
      requiredScopes: string[]
      resultKind: string
      bindingStatus: string
    }[]
    // The registered capability set verbatim: the four D-06 seed reads, the D-08 stream op,
    // 387-01's two `entities.` reads, and 387-06's three `knowledge.` review reads.
    // `resultKind` and `bindingStatus` are part of the
    // published contract, so the listing is asserted as an exact table rather than a shape
    // check — a contains check would let an op join the catalogue unnoticed, which is the one
    // drift direction this case exists to catch. Every phase that adds an op repins it here on
    // purpose; 387-06 and 387-08 each add more and will each have to.
    expect(Object.fromEntries(declarations.map((declaration) => [declaration.id, {
      requiredScopes: declaration.requiredScopes,
      resultKind: declaration.resultKind,
      bindingStatus: declaration.bindingStatus,
    }]))).toEqual({
      // 392 D-24: the chat turn entry, BOUND on this host because `composeLocalAgent` assembles a
      // turn engine in every local composition. Its presence in the CLI's own catalog is the L10
      // claim made observable: `agent-qa ask` reaches the turn through the same registry listing
      // this test reads, so the REPL holds no capability the catalogue does not declare.
      'agent.ask': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      // 389 D-11: THE analysis read — verdicts + sentences + clusters. BOUND since plan 06:
      // the composition root binds the artifact reader over `agentQaRoot` in every local
      // composition, so an artifact-less run answers the floor rather than a refusal.
      'analysis.get': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      // 393 D-01: the keep-gate evaluator. BOUND on this host, and — like `runs.start` below — not
      // because a literal was flipped: this composition supplies BOTH halves the binding needs, a
      // run executor and the draft-authoring port over `parseTestFile`, and `bindingStatus` reports
      // what THIS host can do. The same capability still lists `unbound` from a composition missing
      // either, which is what agent's `parity-coverage.test.ts` and 393-07's e2e both assert.
      //
      // It declares BOTH `run` and `read` because the evaluation starts gate-runs and reads their
      // records back through the sibling ops (D-02, op-calls-op), which also makes it non-read and
      // therefore filtered out of safe mode with `runs.start`.
      'authoring.draft.verify': {
        requiredScopes: ['run', 'read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 394 D-01: the authoring loop's one public entry, BOUND on this host for the reason its
      // sibling above is — the CLI supplies the draft-authoring port and a run executor, which is
      // the same condition both halves of the loop bind under. It declares a THIRD scope,
      // `test-write`, because it writes a file where its sibling only starts runs; 394-01 minted
      // that scope for exactly this declaration, and it is what a listing shows a person who asks
      // what authoring a test costs them.
      'authoring.draft.write': {
        requiredScopes: ['test-write', 'run', 'read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 394-09 D-21 · WTST-07: the user-facing edit. BOUND on this host for its siblings' reason —
      // the CLI supplies the draft-authoring port and the draft evaluation, which are the two
      // halves this op checks. It declares TWO scopes and NOT `run`: it edits a committed test and
      // starts nothing, so a listing shows a person that letting the agent edit their tests does
      // not also buy it the power to spend their machine on runs.
      'authoring.draft.edit': {
        requiredScopes: ['test-write', 'read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 394-07 D-12/D-13 · WTST-05: the honesty funnel read. BOUND on this host and — unlike its
      // two authoring siblings above — bound UNCONDITIONALLY, because it is a read over records
      // this composition owns by owning the agent-qa runtime root rather than a capability that
      // needs a model and a run executor. It declares `read` ALONE, which is what a listing shows
      // a person who asks what reading their own authoring history costs them; the exposure it
      // implies is stated in the op's own header so a reviewer can object to the tier.
      'authoring.funnel.get': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 395-01 D-01/D-03 · CFGM-01/03: both BOUND on this composition — the CLI host binds the
      // config-file, validation and apply ports unconditionally, because a CLI always has a config
      // path and therefore a checkout root. Both declare `config-write` and NOT `read`, which is
      // what a listing shows a person who asks what editing their configuration costs them: the
      // propose op carries the write scope because the scope describes what the CAPABILITY is
      // about, not what one call happens to reach.
      'config.field.set': {
        requiredScopes: ['config-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'config.get': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'config.proposal.apply': {
        requiredScopes: ['config-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 395-05 D-01: the rest of the closed action class, BOUND on this composition for the reason
      // above — the CLI host binds the config ports unconditionally. Both carry `config-write` and
      // nothing else, which is what a listing shows a person who asks what letting the agent edit
      // their configuration costs them.
      'config.target.create': {
        requiredScopes: ['config-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'config.target.edit': {
        requiredScopes: ['config-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // BOUND because `entities` is a REQUIRED FunctionDeps port (387-01 D-4): this
      // composition supplies an entity directory, so both read at the `read` tier.
      'entities.get': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'entities.resolve': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 391 PROP-01 / D-03: both BOUND, because `composeLocalAgent` binds the standing-grants
      // port on every local host — the CLI owns the committed knowledge root the ledger lives at.
      // `revoke` is the second shipped `requiresHumanOrigin` verb and takes `approval-write`; the
      // CLI's caller record mints both the scope and the human origin, which is why the person at
      // this terminal is the only one who can reach it.
      'grants.list': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'grants.revoke': {
        requiredScopes: ['approval-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.bundles.list': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 387-06 KREV-01: the read half of the review-verb family. BOUND for the same reason
      // the entity pair is — they dispatch through the REQUIRED `knowledge` port, so no
      // composition lists them and then refuses. 387-08's mutating verbs go through the
      // OPTIONAL `knowledgeReview` dep and are the first rows here that can read `unbound`.
      'knowledge.brief.why': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.record.show': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.records.diff': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.records.inspect': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 387-08 KREV-01 D-17: the MUTATING half — `knowledge-write` tier, and BOUND here because
      // the CLI composes a local host that owns the knowledge root it serves from. They are the
      // first rows in this table whose binding is a statement about the HOST rather than about
      // the required-port set: a read-only composition lists these same four `unbound`, which is
      // asserted directly in agent-local's `review-verbs.test.ts`.
      'knowledge.accept.propose': {
        requiredScopes: ['knowledge-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.forget.propose': {
        requiredScopes: ['knowledge-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.proposal.apply': {
        requiredScopes: ['knowledge-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'knowledge.reject.propose': {
        requiredScopes: ['knowledge-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 391 PROP-03: the three inbox verbs, BOUND here because `composeLocalAgent` binds the
      // proposals-inbox port over this host's agent-qa runtime root — and the row is a statement
      // about THIS host, exactly like its neighbours: a composition supplying no port lists all
      // three `unbound` and refuses them by name (agent's `parity-coverage.test.ts` asserts it).
      // `reject` is the phase's first shipped `requiresHumanOrigin` op; the origin requirement is
      // not part of this projection's three fields, and the declaration-level pin for it lives in
      // agent, where the enforcement does.
      // 391 PROP-01: the DECISION verb, BOUND on this host — and the only entry in this catalogue
      // carrying two write scopes, because one call can commit knowledge AND change what the
      // system may do without asking.
      'proposals.accept': {
        requiredScopes: ['knowledge-write', 'approval-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'proposals.list': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'proposals.reject': {
        requiredScopes: ['approval-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'proposals.show': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 390 D-12/D-13: the three quarantine verbs, FLIPPED to bound by plan 06 (plan 04
      // registered the specs and left this row saying so). BOUND here for the same reason the
      // knowledge-write rows above are — the CLI composes a local host that owns the committed
      // knowledge root the ledger lives at — and the binding is a statement about THIS host: a
      // composition supplying no quarantine port still lists all three `unbound` and refuses
      // them by name, which is what agent's `parity-coverage.test.ts` asserts.
      'quarantine.add': {
        requiredScopes: ['knowledge-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'quarantine.list': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      'quarantine.release': {
        requiredScopes: ['knowledge-write'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // 391 D-16: BOUND on every local host, through the same proposals-inbox dep the four
      // `proposals.` verbs use. Read-tier, so it survives safe mode.
      'runs.digest': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'runs.events': { requiredScopes: ['read'], resultKind: 'stream', bindingStatus: 'bound' },
      'runs.get': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      'runs.list': { requiredScopes: ['read'], resultKind: 'unary', bindingStatus: 'bound' },
      // 388 D-14: BOUND on every local host, and NOT gated on whether this one drains the
      // chain — the two are different questions, and a host that only ever reads is exactly
      // the caller that most needs durable chip truth. Read-tier, so it survives safe mode.
      'runs.postprocessing': {
        requiredScopes: ['read'],
        resultKind: 'unary',
        bindingStatus: 'bound',
      },
      // BOUND since 385 plan 10 (D-16). Not because a literal was flipped — because this
      // composition supplies a run executor, and `bindingStatus` reports what THIS host can
      // do. The same capability still lists `unbound` from a composition without one, which
      // is what compose-local-agent.test.ts and the agent-layer suites assert.
      'runs.start': { requiredScopes: ['run'], resultKind: 'unary', bindingStatus: 'bound' },
    })
    // Sorted lexicographically by id, so a catalog projection is deterministic.
    expect(declarations.map((declaration) => declaration.id)).toEqual(
      [...declarations.map((declaration) => declaration.id)].sort(),
    )
  })

  it('renders a human listing naming each registered function', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['--list'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(result.stdout).toContain('runs.list')
  })

  it('returns an empty list for a root with no runs directory', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['runs.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toEqual([])
  })

  it('no longer refuses runs.start by binding — the refusal is now the HOST executor speaking', async () => {
    // The 384 version of this case asserted `FunctionNotBoundError` from this exact command.
    // It cannot be asserted here any more, and its replacement has to prove the same two
    // things it did: that the refusal is distinguishable from an unknown id, and that the
    // capability is reached rather than short-circuited.
    //
    // `scope` is a field the run command has no way to carry, so the host's executor refuses it
    // BEFORE launching anything — which makes this a zero-child-process proof that the invocation
    // crossed the gate, cleared the binding check, and reached the port the composition bound. A
    // composition that still refused by binding would report `FunctionNotBoundError` here instead,
    // and it is asserted absent.
    //
    // IT USED TO BE `gateRun`, and 393 moved it. Both durable markers left the unsupported list
    // when the run command grew `--gate-run` / `--excluded-from-outcomes`, so asking for one is now
    // an ordinary accepted request and would have launched a child. `scope` and `executionContext`
    // are what remain, and they belong to the run-invocation work rather than to this phase.
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(
      workspace,
      ['runs.start', '--input', '{"scope":{"tier":"product","key":"shop"}}', '--json'],
    )

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('UnsupportedRunRequestError')
    expect(result.stderr).toContain('scope')
    expect(result.stderr).not.toContain('FunctionNotBoundError')
    expect(result.stderr).not.toContain('Unknown function')
  })

  it('reports an unknown function id without throwing out of the action', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['runs.nope', '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('runs.nope')
  })

  it('resolves runs.get end-to-end for a run recorded on disk', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
      handoff({
        runId: 'run-beta',
        buildOrdinal: 12,
        aggregateVerdict: 'failed',
        gateRun: true,
        tests: [{
          testId: 'test-1',
          testName: 'checks out',
          filePath: 'tests/checkout.yaml',
          testIndex: 0,
          outcome: 'failed',
          steps: [],
        }],
      }),
    ])

    const result = await invoke(workspace, [
      'runs.get',
      '--input',
      JSON.stringify({ runId: 'run-beta' }),
      '--json',
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toMatchObject({
      runId: 'run-beta',
      buildOrdinal: 12,
      aggregateVerdict: 'failed',
      gateRun: true,
      configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
      tests: [{
        testId: 'test-1',
        testName: 'checks out',
        filePath: 'tests/checkout.yaml',
        testIndex: 0,
        outcome: 'failed',
        stepCount: 0,
      }],
    })
  })

  it('fails runs.get with the typed not-found error for an unknown runId', async () => {
    const workspace = fixtureWorkspace(roots)
    seedRuns(workspace, [
      handoff({ runId: 'run-alpha', buildOrdinal: 11, aggregateVerdict: 'passed' }),
    ])

    const result = await invoke(workspace, [
      'runs.get',
      '--input',
      JSON.stringify({ runId: 'run-missing' }),
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('RunNotFoundError')
    expect(result.stderr).toContain('run-missing')
  })

  it('resolves knowledge.bundles.list end-to-end against a committed bundle', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundleId = seedKnowledgeBundle(workspace)

    const result = await invoke(workspace, ['knowledge.bundles.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const rows = JSON.parse(result.stdout) as KnowledgeBundleSummary[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      bundleId,
      product: 'shop',
      kind: 'fact',
      subtype: 'selector',
      scope: { tier: 'product', key: 'checkout' },
      dir: `memory/shop/bundles/${bundleId}`,
      summary: 'Checkout control on the cart page',
    })
  })

  it('returns an empty knowledge listing for a workspace with no committed bundles', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['knowledge.bundles.list', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toEqual([])
  })

  it('resolves config.get and never renders the raw secret (T-384-07)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The security claim, asserted against the bytes a caller actually sees.
    expect(result.stdout).not.toContain(FIXTURE_API_KEY)
    expect(result.stdout).toContain(CONFIG_MASK_PLACEHOLDER)

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    expect(config.configPath).toBe(workspace.configPath)
    const apiKey = config.entries.find(
      (entry) => entry.key === 'registry.providers.acme.apiKey',
    )
    expect(apiKey).toEqual({
      key: 'registry.providers.acme.apiKey',
      value: CONFIG_MASK_PLACEHOLDER,
      source: 'config-file',
      masked: true,
    })
    // A neighbouring leaf under the SAME opaque subtree is masked too: under a free-form
    // credential record the key name never decides. Deliberate over-masking, visibly flagged.
    expect(config.entries).toContainEqual({
      key: 'registry.providers.acme.baseURL',
      value: CONFIG_MASK_PLACEHOLDER,
      source: 'config-file',
      masked: true,
    })
    // Schema defaults the file never mentioned are attributed to the default layer.
    expect(config.entries.find((entry) => entry.key === 'knowledge.dir')).toEqual({
      key: 'knowledge.dir',
      value: 'agent-qa-knowledge',
      source: 'default',
      masked: false,
    })
  })

  it('masks operator-named credentials no key name marks as secret (CR-01)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The claim, asserted against the bytes a caller actually sees.
    for (const planted of [
      FIXTURE_HEADER_KEY,
      FIXTURE_HEADER_CRED,
      FIXTURE_HEADER_PWD,
      FIXTURE_PROVIDER_KEY,
      FIXTURE_URL_PASSWORD,
    ]) {
      expect(result.stdout).not.toContain(planted)
    }

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    for (const key of [
      'registry.llms.0.providerHeaders.x-key',
      'registry.llms.0.providerHeaders.x-cred',
      'registry.llms.0.providerHeaders.x-pwd',
      'registry.providers.acme.key',
    ]) {
      expect(byKey[key], key).toEqual({
        key,
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      })
    }

    // The schema-constrained baseURL stays visible at PATH level — the schema means it to
    // be readable — but the value a caller reads is the reduced render.
    // FLIP (round 3): `masked` was `false` here and is now `true`, because a render that
    // dropped part of what the operator wrote is not the operator's raw value.
    // FLIP (round 5): the render is now the ORIGIN — `/v1` goes with the rest. `baseURL` is
    // a registered address name, and a reduction that keeps a path keeps somewhere for a
    // credential to ride.
    expect(byKey['registry.llms.0.baseURL']).toEqual({
      key: 'registry.llms.0.baseURL',
      value: 'https://llm.acme.test',
      source: 'config-file',
      masked: true,
    })
  })

  it('drops URL query strings and fragments from every visible value (CR-01, round 3)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The claim, asserted against the bytes a caller actually sees. These three rode out
    // verbatim through the unmodified production CLI at round 3, on the two fields the
    // schema's whole visible surface leaves credential-bearing.
    for (const planted of [
      FIXTURE_URL_QUERY_SECRET,
      FIXTURE_URL_FRAGMENT_SECRET,
      FIXTURE_TARGET_URL_SECRET,
      FIXTURE_URL_PASSWORD,
    ]) {
      expect(result.stdout, planted).not.toContain(planted)
    }
    // The POSITIVE CONTROL, from the SAME stdout: this read can see a value, so the four
    // absences above are facts about the render rather than about an empty output.
    expect(result.stdout).toContain('browserstack')

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    // FLIP (round 5): both expectations lose their path. The property asserted below — no
    // no-key URL component survives — is unchanged and is now stronger, because the path is
    // a component too.
    for (const [key, expected] of [
      ['registry.llms.0.baseURL', 'https://llm.acme.test'],
      ['registry.targets.web.url', 'https://x.test'],
    ] as const) {
      expect(byKey[key], key).toEqual({
        key,
        value: expected,
        source: 'config-file',
        masked: true,
      })
      // Stated as a property of the rendered string rather than as a literal, so a future
      // fixture cannot satisfy this by matching one hardcoded value.
      expect(byKey[key]?.value, key).not.toContain('?')
      expect(byKey[key]?.value, key).not.toContain('#')
      expect(byKey[key]?.value, key).not.toContain('@')
    }
    // …and a neighbouring constrained leaf under the same new target is untouched, so the
    // leg cannot pass by masking the whole subtree.
    expect(byKey['registry.targets.web.platform']).toEqual({
      key: 'registry.targets.web.platform',
      value: 'web',
      source: 'config-file',
      masked: false,
    })
  })

  it('DROPS visible URL values the parser cannot vouch for (CR-01, round 4)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The claim, asserted against the bytes a caller actually sees. All six of these rode
    // out verbatim with `masked: false` through the unmodified production CLI at round 4:
    // the rule was total across URL PARTS and silent about which VALUE FORMS it would look
    // at, and three of these four forms never reached it at all.
    for (const planted of [
      FIXTURE_PROTOREL_USERINFO_SECRET,
      FIXTURE_PROTOREL_QUERY_SECRET,
      FIXTURE_PROTOREL_FRAGMENT_SECRET,
      FIXTURE_HOST_RELATIVE_SECRET,
      FIXTURE_PATH_RELATIVE_SECRET,
      FIXTURE_OPAQUE_SCHEME_SECRET,
    ]) {
      expect(result.stdout, planted).not.toContain(planted)
    }
    // The POSITIVE CONTROL, from the SAME stdout: this read can see a value, so the six
    // absences above are facts about the render rather than about an empty output.
    expect(result.stdout).toContain('browserstack')

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    for (const key of [
      'registry.llms.1.baseURL',
      'registry.llms.2.baseURL',
      'registry.targets.protocol-relative.url',
      'registry.targets.path-relative.url',
    ]) {
      expect(byKey[key], key).toEqual({
        key,
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      })
    }

    // …and neighbouring constrained leaves under the SAME grown entries stay visible, so the
    // leg cannot pass by masking a subtree.
    expect(byKey['registry.llms.1.model']).toEqual({
      key: 'registry.llms.1.model',
      value: 'claude-fixture',
      source: 'config-file',
      masked: false,
    })
    expect(byKey['registry.targets.protocol-relative.platform']).toEqual({
      key: 'registry.targets.protocol-relative.platform',
      value: 'web',
      source: 'config-file',
      masked: false,
    })
    // The round-3 absolute axis is unchanged by the drop rule: a value that DOES yield an
    // origin is reduced rather than dropped (FLIP round 5 — to the origin, not to the path).
    expect(byKey['registry.targets.web.url']).toEqual({
      key: 'registry.targets.web.url',
      value: 'https://x.test',
      source: 'config-file',
      masked: true,
    })
    // …and the '@'-carrying plugin package names stay readable: an in-process package is
    // the identity of code with full Node access, so the one capability whose purpose is
    // configuration triage must print it (plan-10 SHOW-ME).
    expect(byKey['plugins.auth.0.package']?.value).toBe(FIXTURE_AUTH_PLUGIN_PACKAGE)
    expect(byKey['plugins.providers.0.package']?.value).toBe(FIXTURE_PROVIDER_PLUGIN_PACKAGE)
  })

  it('closes BOTH round-5 directions from ONE stdout (CR-02 + CR-03)', async () => {
    // The single-read leg the verifier's own probe reproduces. Round 5's two failures are
    // opposite errors of the same mechanism — a rule that inspects values over-masks the
    // ordinary ones and under-masks the ones whose secret rides in a component it keeps — so
    // they are asserted TOGETHER, against one production invocation, with positive controls
    // in the same bytes. A fix that trades one direction for the other reddens here.
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // DIRECTION A — no under-masking. Every sentinel rides in a component some previous
    // round's rule KEPT.
    for (const planted of [
      FIXTURE_PATH_BORNE_TARGET_SECRET,
      FIXTURE_PROTOREL_PATH_SECRET,
      FIXTURE_KEY_IN_PATH_SECRET,
      FIXTURE_URL_PASSWORD,
      FIXTURE_OPAQUE_SCHEME_SECRET,
      FIXTURE_URL_QUERY_SECRET,
    ]) {
      expect(result.stdout, planted).not.toContain(planted)
    }

    // DIRECTION B — no over-masking. Each value is the ordinary content of its own field.
    for (const visible of [FIXTURE_GLOB_WILDCARD, FIXTURE_IGNORE_GLOB, FIXTURE_CSS_SELECTOR]) {
      expect(result.stdout, visible).toContain(visible)
    }

    // POSITIVE CONTROLS, from the SAME stdout: a visible platform leaf, a visible model leaf,
    // and a clean URL's host. The six absences above are therefore facts about the render.
    expect(result.stdout).toContain('browserstack')
    expect(result.stdout).toContain('claude-fixture')
    expect(result.stdout).toContain('clean.acme.test')

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))

    // Each carrier shows its ORIGIN or the placeholder, and says so.
    for (const [key, expected] of [
      ['registry.targets.hook.url', 'https://hooks.acme.test'],
      ['registry.targets.relhook.url', CONFIG_MASK_PLACEHOLDER],
      ['registry.llms.3.baseURL', 'https://ops.acme.test'],
      ['registry.llms.0.baseURL', 'https://llm.acme.test'],
    ] as const) {
      expect(byKey[key], key).toEqual({
        key,
        value: expected,
        source: 'config-file',
        masked: true,
      })
    }

    // The ordinary values come back BYTE-IDENTICAL and unflagged, not merely present.
    for (const [key, expected] of [
      ['workspace.testMatch.0', FIXTURE_GLOB_WILDCARD],
      ['workspace.testPathIgnore.0', FIXTURE_IGNORE_GLOB],
      ['services.accessibility.exclude.0', FIXTURE_CSS_SELECTOR],
      // …and a registered field whose value already IS its origin: reduction is not
      // normalisation, so nothing an operator wrote is silently rewritten.
      ['registry.targets.clean.url', FIXTURE_CLEAN_TARGET_URL],
    ] as const) {
      expect(byKey[key], key).toEqual({
        key,
        value: expected,
        source: 'config-file',
        masked: false,
      })
    }
  })

  it('masks a free-form record the masker was never told about (BL-02)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The claim, asserted against the bytes a caller actually sees. Not one of these ten
    // key names appears in the masker's constant lists — the schema is what covered them.
    for (const planted of Object.values(FIXTURE_DEVICE_MATCH_CREDENTIALS)) {
      expect(result.stdout).not.toContain(planted)
    }

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    for (const name of Object.keys(FIXTURE_DEVICE_MATCH_CREDENTIALS)) {
      const key = `registry.devices.pixel.match.${name}`
      expect(byKey[key], key).toEqual({
        key,
        value: CONFIG_MASK_PLACEHOLDER,
        source: 'config-file',
        masked: true,
      })
    }

    // The POSITIVE CONTROL, read from the same stdout: a constrained sibling INSIDE the
    // same device profile is still visible. Without it, an output that was empty or
    // wholly masked for the wrong reason would pass every assertion above — which is the
    // exact failure mode a schema-derived rule can produce if the walk is wrong.
    expect(result.stdout).toContain('browserstack')
    expect(byKey['registry.devices.pixel.platform']).toEqual({
      key: 'registry.devices.pixel.platform',
      value: 'android',
      source: 'config-file',
      masked: false,
    })
  })

  it('shows which packages load in-process, for BOTH plugin kinds (M-01)', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, ['config.get', '--json'])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()

    // The round-2 asymmetry: one of these was hidden and the other shown, because the word
    // `auth` appeared in one path. Both are schema-constrained package names identifying
    // code that runs with full Node access, and `config.get` exists to show them.
    expect(result.stdout).toContain(FIXTURE_AUTH_PLUGIN_PACKAGE)
    expect(result.stdout).toContain(FIXTURE_PROVIDER_PLUGIN_PACKAGE)

    const config = JSON.parse(result.stdout) as MaskedResolvedConfig
    const byKey = Object.fromEntries(config.entries.map((entry) => [entry.key, entry]))
    expect(byKey['plugins.auth.0.package']).toEqual({
      key: 'plugins.auth.0.package',
      value: FIXTURE_AUTH_PLUGIN_PACKAGE,
      source: 'config-file',
      masked: false,
    })
    expect(byKey['plugins.providers.0.package']).toEqual({
      key: 'plugins.providers.0.package',
      value: FIXTURE_PROVIDER_PLUGIN_PACKAGE,
      source: 'config-file',
      masked: false,
    })
  })
})

describe('agent-qa fn runs.events (the D-08 stream kind)', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode

  beforeEach(() => {
    originalExitCode = process.exitCode
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('emits one NDJSON line per envelope against a real events.jsonl', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
      '--json',
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const lines = result.stdout.split('\n').filter((line) => line.length > 0)
    expect(lines).toHaveLength(5)
    // NDJSON, not a JSON array: every line parses on its own, which is what makes the
    // rendering identical for a live attach that has no end.
    const envelopes = lines.map((line) => JSON.parse(line) as RunEventEnvelope)
    expect(envelopes.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(envelopes.map((event) => event.type)).toEqual([
      'runStarted',
      'testStarted',
      'stepStarted',
      'testFinished',
      'runFinished',
    ])
  })

  it('resumes after --from <lastEventId>, yielding lastEventId + 1 onward', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
      '--from',
      '2',
      '--json',
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const envelopes = result.stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as RunEventEnvelope)
    expect(envelopes.map((event) => event.seq)).toEqual([3, 4, 5])
  })

  it('ends human output with the final seq so the next --from is readable', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
    ])

    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    const lines = result.stdout.split('\n').filter((line) => line.length > 0)
    // One line per event, then a summary naming the last seq observed.
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain('runStarted')
    expect(lines[4]).toContain('runFinished')
    expect(lines[5]).toContain('5 events')
    expect(lines[5]).toContain('last seq 5')
  })

  it('rejects a non-numeric --from without touching the event log', async () => {
    const workspace = fixtureWorkspace(roots)
    seedEvents(workspace, 'run-alpha', fiveEvents())

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-alpha' }),
      '--from',
      'later',
      '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--from')
  })

  it('yields an empty stream for a run that recorded no events', async () => {
    const workspace = fixtureWorkspace(roots)

    const result = await invoke(workspace, [
      'runs.events',
      '--input',
      JSON.stringify({ runId: 'run-never-ran' }),
      '--json',
    ])

    // An absent log is an ordinary empty replay, never an error (the v49 read contract).
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBeUndefined()
    expect(result.stdout).toBe('')
  })
})
