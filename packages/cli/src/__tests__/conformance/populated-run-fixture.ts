// THE POPULATED-RUN PRODUCER (Phase 405 plan 09 · DETL-01 / DETL-02, CONTEXT D-04 and D-11).
//
// WHAT THIS FILE IS FOR. Every 405 cell that measures the run-detail PAGE needs a run whose wire
// actually carries the three things the page renders: a decision-screenshot `artifactRefs[0].sha`,
// a `stepFinalized.tokenUsage`, and masked placeholders in a sub-action's `plan` text. The
// fixtures this repository already had cannot produce any of them. `drainableSuiteFixtureProject`
// says so in its own words — "THE RUN IS EXPECTED TO FAIL, and that is fine" — because its whole
// subject is wire SHAPE; its member never opens a page, never takes a screenshot and never calls a
// model, so nothing downstream of "the run reached a verdict" exists to look at. RESEARCH Pitfall 6
// names exactly this gap and 405-01's coverage item D6 records the consequence: every leg of the
// shipped binding is proven separately and NO cell drives the shipped `agent-qa dashboard` binary
// against a populated run. This module is that producer.
//
// WHY A WIRE STUB AND NOT A CASSETTE. RESEARCH A2 offered the eval package's replay as a
// model-free producer. Measured this session, the replay emits no bus events at all — it
// reconstitutes a recorded run's artifacts without ever starting a `RunSession` — so a cell built
// on it would be asserting against a shape the shipped subscriber never sees. The honest
// model-free producer is therefore one level lower: a local HTTP server that speaks the
// OpenAI chat-completions wire the `openai-compatible` provider consumes, so the request leaves
// the shipped runner, crosses a real socket and comes back as a real provider response. Everything
// between the planner call and the bus is the product's own code.
//
// NO CREDENTIAL, NO NETWORK, NO PROVIDER. The declared model is `openai-compatible` pointed at
// this fixture's own loopback server; that provider is credential-optional, so auth resolves
// `unauthenticated` and the run proceeds with `{ kind: 'none' }`. The target is this fixture's own
// loopback page. A machine with no keys and no internet runs this exactly as CI does.
//
// RED, NEVER SKIP. This module asserts nothing and skips nothing — the instrument law
// `spawned-chat.ts` states for itself, unchanged. It returns data; the cell that imports it
// decides what a missing browser, a stale build or an unfinished run means, in its own words.
//
// THE STOP RULE, STATED HERE SO NOBODY QUIETLY WEAKENS IT. If the shipped planner cannot be
// satisfied by the canned responses below — a refused request shape, an ungroundable action, a
// turn that never terminates — the honest move is to STOP and report the exact request shape that
// was refused. It is NOT to downgrade the cell to "provider-gated, skipped in CI". That downgrade
// is RESEARCH A2's fallback and it is a decision for a human, because it costs CI the only
// end-to-end proof of the run-detail page that exists.
//
// WHY TWO SECRET CHANNELS, AND WHY THAT IS NOT BELT-AND-BRACES. The two are different mechanisms
// producing different observable outcomes, and the fixture needs BOTH:
//
//   (1) A DECLARED secret in the project's secrets file, referenced from the step text with the
//       runner's own `{{secret:NAME}}` syntax. The runner builds a `SecretRedactor` from that
//       store and rewrites the value to a generic `[secret]` marker BEFORE anything is recorded.
//       So a declared secret proves the at-rest claim (it is never in clear) and can never
//       produce a `<SECRET_n>` placeholder — the redactor consumes it first. Measured, not
//       assumed: the redaction happens in the loop, the masking happens at bus projection, and
//       the loop runs first.
//
//   (2) An ambient CREDENTIAL-SHAPED environment variable handed to the spawned dashboard. The
//       run's masking context seeds from `sensitiveEnvSlice(process.env)`, which selects by NAME
//       suffix — `_SECRET` here — and never by value. That value is NOT in the runner's secret
//       store, so no redactor touches it; it survives into the planner's reasoning text and is
//       masked at projection into `<SECRET_0>`. This is the channel that mints the placeholder
//       the page renders, and the display-unmask seam re-derives it from the same env slice at
//       read time, which is what makes 405-12's unmasked-side cell possible at all.
//
// The email needs no declaration: `<EMAIL_n>` is minted lazily inside `mask()` by the email
// detector over whatever text passes through, so an address in the planner's reasoning becomes a
// placeholder without any host source declaring it.

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateSuiteId, generateTestId } from '@vostride/agent-qa-ids'
import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

import { RUN_SERVICE_ANCHORED_BUILDS, trackTempRoot } from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'

// ---- The declared vocabulary --------------------------------------------------------------------

/**
 * The ambient credential-shaped value the masking context registers, and therefore the ONE value
 * that becomes a `<SECRET_n>` placeholder on the wire.
 *
 * A THROWAWAY THIS REPOSITORY OWNS, on `RUN_SERVICE_FIXTURE_TOKEN`'s argument: it names nothing,
 * opens nothing, and exists only inside a temp project's child environment. It is deliberately
 * distinctive so a scan of `events.jsonl` or the SQLite bytes for it cannot match by accident.
 */
export const POPULATED_SECRET_VALUE = 'zz-405-populated-secret-7f3a91c2'

/**
 * The environment variable name the spawned dashboard carries it under.
 *
 * THE `_SECRET` SUFFIX IS LOAD-BEARING. `sensitiveEnvSlice` selects the run's masking seed by name
 * suffix family and never by value, so a variable called `AGENT_QA_405_09_POPULATED_VALUE` would
 * be handed to the child, ignored by the seed, and printed in clear by the first diagnostic that
 * happened to echo it. The suffix is what puts the value in the masking context.
 */
export const POPULATED_SECRET_ENV_VAR = 'AGENT_QA_405_09_POPULATED_SECRET'

/** The name the project's secrets file declares — the handle the step text addresses. */
export const POPULATED_SECRET_NAME = 'POPULATED_STEP_SECRET'

/**
 * The DECLARED secret's value: the runner's own redaction lane, distinct from the masking lane.
 *
 * A SECOND VALUE RATHER THAN THE SAME ONE, and the header states why: a value in the runner's
 * secret store is rewritten to `[secret]` before it is recorded, so sharing one value between the
 * two channels would silently delete the `<SECRET_n>` the page exists to render.
 */
export const POPULATED_DECLARED_SECRET_VALUE = 'zz-405-declared-secret-3c8e1f60'

/** The address planted in the page and in the planner's reasoning; masked to `<EMAIL_n>`. */
export const POPULATED_EMAIL = 'qa-person@example.com'

/**
 * The accessible name of the page's one button.
 *
 * ONE WORD, NO PUNCTUATION, DELIBERATELY. The stub resolves this label against the rendered
 * screen tree to emit a real `ref`, and a label carrying quotes or trailing punctuation would make
 * that resolution a string-normalisation puzzle rather than a lookup.
 */
export const POPULATED_BUTTON_LABEL = 'Acknowledge'

/** The named LLM entry the project declares and `use.llm` selects. */
export const POPULATED_MODEL_NAME = 'populated-stub'

/**
 * The model id the declared entry carries.
 *
 * IT CONTAINS `vision` FOR A REASON THE CAPABILITY TABLE OWNS. `resolveCapabilities` matches a
 * model id against family tokens at word boundaries and falls back to an UNKNOWN floor whose
 * `vision` is false. The run's vision gate is resolved from the CONFIG (`vision` defaults true),
 * so the image is attached either way — but the accounting ceilings come from the family, and the
 * unknown floor's 8192-token window would put the clamp into a degrade pass on every turn for no
 * reason anybody reading this file could have guessed. `stub-vision` resolves to the vision family
 * (128k window) and says out loud what it is.
 */
export const POPULATED_MODEL_ID = 'stub-vision'

/** The registry target name the test and suite address. */
export const POPULATED_TARGET_NAME = 'populated'

/** The suite file a populated run is triggered against, relative to the project root. */
export const POPULATED_SUITE_PATH = 'suites/populated.suite.yaml'

/** The test file the suite addresses, relative to the project root. */
export const POPULATED_TEST_PATH = 'tests/populated.test.yaml'

/**
 * How long ONE populated run has to reach `runFinished` on the local run-stream door.
 *
 * Longer than the drainable fixture's 90s because this run actually launches Chromium, loads a
 * page, screenshots it and crosses two loopback sockets per planning turn. A timeout is a RED
 * naming the last envelope seen, never a skip.
 */
export const RUN_BUDGET_MS = 120_000

/**
 * The built artifacts a populated-run cell executes.
 *
 * WIDER THAN `RUN_SERVICE_ANCHORED_BUILDS`, and the addition is the whole reason this run differs
 * from that one: a populated run drives a real browser through the `web` adapter's dist and writes
 * its evidence blobs through `runner-local`'s, both resolved as external workspace dependencies by
 * the spawned binary. `model` and `safety` are listed for the same reason one level down — the
 * provider handle and the masking context this fixture's two claims rest on are built there, and a
 * cell run against a stale dist of either would certify the previous revision of the exact code it
 * is measuring.
 */
export const POPULATED_RUN_ANCHORED_BUILDS: readonly {
  readonly pkg: string
  readonly artifact: string
}[] = Object.freeze([
  ...RUN_SERVICE_ANCHORED_BUILDS,
  Object.freeze({ pkg: 'web', artifact: join('dist', 'index.js') }),
  Object.freeze({ pkg: 'runner-local', artifact: join('dist', 'index.js') }),
  Object.freeze({ pkg: 'model', artifact: join('dist', 'index.js') }),
  Object.freeze({ pkg: 'safety', artifact: join('dist', 'index.js') }),
])

/**
 * The extra environment the spawned dashboard is handed.
 *
 * A FUNCTION RATHER THAN A CONSTANT so a caller cannot mutate the map every cell shares, and so
 * the one place that decides which variables the child inherits stays here rather than being
 * spelled out in each cell that spawns one.
 */
export function populatedRunSpawnEnv(): Record<string, string> {
  return { [POPULATED_SECRET_ENV_VAR]: POPULATED_SECRET_VALUE }
}

// ---- The target page ----------------------------------------------------------------------------

const TARGET_PAGE_HTML = [
  '<!doctype html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Populated run target</title></head>',
  '<body>',
  '<h1>Populated run target</h1>',
  `<p id="notice">Support contact: ${POPULATED_EMAIL}</p>`,
  `<button type="button" id="ack">${POPULATED_BUTTON_LABEL}</button>`,
  '<p id="ack-state">Notice pending</p>',
  '<script>',
  "document.getElementById('ack').addEventListener('click', function () {",
  "  document.getElementById('ack-state').textContent = 'Notice acknowledged'",
  '})',
  '</script>',
  '</body>',
  '</html>',
  '',
].join('\n')

/** A started loopback server, as the cells that drive it consume it. */
export interface FixtureServer {
  /** The origin a client is pointed at, with no trailing slash. */
  readonly url: string
  readonly port: number
  /** Idempotent: safe to call from a cell body and from an `afterAll`. */
  close(): Promise<void>
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise<number>((settle, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        fail(new TypeError('the fixture server bound no port'))
        return
      }
      settle(address.port)
    })
  })
}

function closer(server: Server): () => Promise<void> {
  let closed: Promise<void> | undefined
  return async (): Promise<void> => {
    closed ??= new Promise<void>((settle) => {
      server.closeAllConnections?.()
      server.close(() => { settle() })
    })
    await closed
  }
}

/**
 * Serve ONE static page a browser can load, click and screenshot.
 *
 * EVERY PATH ANSWERS THE SAME DOCUMENT, deliberately: a favicon request or a stray navigation is
 * not a failure of anything this fixture is about, and a 404 in the browser's console is noise a
 * later reader would spend time on.
 */
export async function startTargetPageServer(): Promise<FixtureServer> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(TARGET_PAGE_HTML)
  })
  const port = await listenOnLoopback(server)
  return { url: `http://127.0.0.1:${String(port)}`, port, close: closer(server) }
}

// ---- The stub model server ----------------------------------------------------------------------

/** What one request to the stub was, as the cell that reports a refusal consumes it. */
export interface RecordedStubRequest {
  readonly at: number
  readonly method: string
  readonly path: string
  /** Which arm answered it — the dispatch decision, recorded rather than re-derived. */
  readonly kind: 'planner' | 'structured' | 'text' | 'unknown'
  readonly status: number
  /** Whether the planner arm resolved a live `ref` out of the observation, or fell back. */
  readonly grounding?: 'ref' | 'descriptor'
  /**
   * The request body, bounded.
   *
   * BOUNDED BECAUSE A PLANNING TURN CARRIES A BASE64 SCREENSHOT, and an unbounded echo of one into
   * a failure message is megabytes of noise around the sentence that matters.
   */
  readonly body: string
}

const MAX_RECORDED_BODY_CHARS = 4_000

/** A started stub model server plus the trail it recorded. */
export interface StubModelServer extends FixtureServer {
  /** The `baseURL` the declared model entry points at — includes the `/v1` prefix. */
  readonly baseUrl: string
  /** Every request this server answered, in arrival order. */
  readonly requests: readonly RecordedStubRequest[]
}

interface ChatCompletionsBody {
  readonly model?: unknown
  readonly messages?: unknown
  readonly tools?: unknown
  readonly tool_choice?: unknown
  readonly response_format?: unknown
}

/** Collect every text part of every message, in order, as one string. */
function promptTextOf(body: ChatCompletionsBody): string {
  if (!Array.isArray(body.messages)) return ''
  const parts: string[] = []
  for (const message of body.messages) {
    const content = (message as { content?: unknown } | null)?.content
    if (typeof content === 'string') {
      parts.push(content)
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const text = (part as { type?: unknown; text?: unknown } | null)
      if (text?.type === 'text' && typeof text.text === 'string') parts.push(text.text)
    }
  }
  return parts.join('\n')
}

/**
 * Find the live `ref` the shipped screen renderer minted for a labelled element.
 *
 * WHY THE STUB READS THE OBSERVATION AT ALL. A canned `target` descriptor would make every run
 * depend on the grounding matcher resolving a role/name pair, and a matcher miss returns a
 * structured `ungroundable_action` failure that records NO sub-action — which is precisely the
 * fact this whole fixture exists to produce. Reading the ref out of the tree the planner was just
 * shown is what a model does, so the stub does it too. The descriptor remains the fallback, so a
 * renderer change that moves the ref out of the prompt degrades to the matcher rather than to a
 * dead run.
 *
 * The line shape is `renderScreenTree`'s own: `- <role> "<name>" [ref=<ref>] @(...)`.
 */
function refForLabel(prompt: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`- \\w+ "${escaped}"[^\\n]*?\\[ref=([A-Za-z0-9_-]+)\\]`, 'u')
  return pattern.exec(prompt)?.[1]
}

/** The action tool the planner arm calls, as the provider named it on this request. */
function clickToolName(body: ChatCompletionsBody): string | undefined {
  if (!Array.isArray(body.tools)) return undefined
  for (const entry of body.tools) {
    const name = (entry as { function?: { name?: unknown } } | null)?.function?.name
    if (typeof name === 'string' && name === 'web_click') return name
  }
  return undefined
}

/**
 * The planner's reasoning text — the ONE string this fixture plants both categories in.
 *
 * IT IS THE PLANNER'S, NOT THE PAGE'S, AND THAT IS THE POINT. `plan` on a `subActionRecorded`
 * payload is the planner's reasoning, redacted by the runner and then masked at projection. Text
 * that only ever lived on the page would reach the wire as a screen-state HASH and prove nothing
 * about either masking category.
 */
function plannerReasoning(): string {
  return (
    `Clicking the "${POPULATED_BUTTON_LABEL}" button on the notice page. `
    + `The operator credential for this environment is ${POPULATED_SECRET_VALUE} and the `
    + `notice names ${POPULATED_EMAIL} as the contact; the declared step credential resolves to `
    + `${POPULATED_DECLARED_SECRET_VALUE}. None of the three may ever be recorded in clear.`
  )
}

function chatCompletion(
  model: string,
  message: Record<string, unknown>,
  finishReason: string,
  usage: { prompt: number; completion: number },
): Record<string, unknown> {
  return {
    id: 'chatcmpl-405-09-populated',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason, logprobs: null }],
    // NON-ZERO INTEGERS ON EVERY ARM. `tokenUsage` on `stepFinalized` is summed from the usage the
    // provider reports, and a zero triple is indistinguishable from an unmeasured step under the
    // absent-is-not-zero rule 405-01 established — so a stub that reported zeros would make the
    // token cell vacuous while looking like it passed.
    usage: {
      prompt_tokens: usage.prompt,
      completion_tokens: usage.completion,
      total_tokens: usage.prompt + usage.completion,
    },
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Answer the three request shapes the shipped run makes, from canned responses.
 *
 * THE DISPATCH IS ON THE REQUEST BODY, never on a call counter. A counter would encode the order
 * this fixture happened to observe once and would answer the wrong thing the day the loop replans
 * or the tail authors a summary. The three shapes are the product's three model call sites:
 *
 *   - `tools` present  ⇒ the PLANNER turn (`toolChoice: 'required'` over the action slice). One
 *     `tool_calls[]` entry naming `web_click`, with the plan-field envelope every action tool
 *     carries and `stepComplete: true` so one turn finishes the step.
 *   - `response_format` present ⇒ a STRUCTURED-OUTPUT call (the verifier's `Output.object`). The
 *     assistant content is the JSON the verification schema parses.
 *   - neither ⇒ a plain TEXT completion (the post-run analysis author's `generate`). Answered
 *     with a short sentence, because a 400 here would turn a perfectly ordinary tail call into a
 *     fixture failure that reads like a product defect.
 *
 * ANYTHING ELSE IS A 400 CARRYING THE BODY, never a silent 200: a shape this stub does not
 * understand is a fact the cell must be able to read, and a fabricated success would be the stub
 * inventing product behaviour.
 */
export async function startStubModelServer(): Promise<StubModelServer> {
  const requests: RecordedStubRequest[] = []

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const raw = await readBody(req)
      const path = req.url ?? ''
      const method = req.method ?? 'GET'
      const record = (
        kind: RecordedStubRequest['kind'],
        status: number,
        grounding?: 'ref' | 'descriptor',
      ): void => {
        requests.push({
          at: Date.now(),
          method,
          path,
          kind,
          status,
          ...(grounding === undefined ? {} : { grounding }),
          body: raw.slice(0, MAX_RECORDED_BODY_CHARS),
        })
      }
      const refuse = (why: string): void => {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: why, type: 'invalid_request_error' } }))
      }

      if (method !== 'POST' || !path.startsWith('/v1/chat/completions')) {
        record('unknown', 400)
        refuse(`the populated-run stub serves POST /v1/chat/completions only; got ${method} ${path}`)
        return
      }

      let body: ChatCompletionsBody
      try {
        body = JSON.parse(raw) as ChatCompletionsBody
      } catch {
        record('unknown', 400)
        refuse('the populated-run stub could not parse the request body as JSON')
        return
      }

      const model = typeof body.model === 'string' ? body.model : POPULATED_MODEL_ID
      const prompt = promptTextOf(body)
      const respond = (payload: Record<string, unknown>): void => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }

      if (Array.isArray(body.tools) && body.tools.length > 0) {
        const toolName = clickToolName(body)
        if (toolName === undefined) {
          record('unknown', 400)
          refuse(
            'the populated-run stub found no `web_click` entry in the bound tool surface; the '
            + 'action slice this fixture drives has moved and the fixture must be re-measured '
            + 'rather than downgraded to a provider-gated cell',
          )
          return
        }
        const ref = refForLabel(prompt, POPULATED_BUTTON_LABEL)
        const targeting = ref === undefined
          ? { target: { role: 'button', name: POPULATED_BUTTON_LABEL } }
          : { ref }
        const args = {
          ...targeting,
          elementDescription: POPULATED_BUTTON_LABEL,
          reasoning: plannerReasoning(),
          confidence: 0.95,
          stepComplete: true,
          doesActionAdvanceUsTowardsGoal: true,
        }
        record('planner', 200, ref === undefined ? 'descriptor' : 'ref')
        respond(chatCompletion(
          model,
          {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_405_09_click',
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(args) },
            }],
          },
          'tool_calls',
          { prompt: 1_311, completion: 87 },
        ))
        return
      }

      if (body.response_format !== undefined && body.response_format !== null) {
        record('structured', 200)
        respond(chatCompletion(
          model,
          {
            role: 'assistant',
            content: JSON.stringify({
              success: true,
              reasoning: `The "${POPULATED_BUTTON_LABEL}" button was clicked and the notice state changed.`,
              isAppError: false,
              // The judge/extractor lanes share this arm; their schemas are supersets of the
              // verification one and ignore members they do not declare, so one canned object
              // answers all three without the stub having to know which lane called it.
              verdict: true,
              rationale: 'The notice acknowledges on the observed screen.',
            }),
          },
          'stop',
          { prompt: 742, completion: 41 },
        ))
        return
      }

      record('text', 200)
      respond(chatCompletion(
        model,
        { role: 'assistant', content: 'The populated conformance run acknowledged one notice.' },
        'stop',
        { prompt: 208, completion: 12 },
      ))
    })().catch(() => {
      // A stub that threw mid-response would hang the run rather than fail it. The refusal is the
      // honest answer and the recorded trail carries the shape that produced it.
      if (!res.headersSent) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
      }
      res.end(JSON.stringify({ error: { message: 'the populated-run stub failed mid-response' } }))
    })
  })

  const port = await listenOnLoopback(server)
  const origin = `http://127.0.0.1:${String(port)}`
  return {
    url: origin,
    baseUrl: `${origin}/v1`,
    port,
    requests,
    close: closer(server),
  }
}

// ---- The project recipe -------------------------------------------------------------------------

/** The paths a populated-run cell reads back off the project it built. */
export interface PopulatedRunProject {
  readonly root: string
  readonly configPath: string
  /** `<root>/.agent-qa` — the runtime root the run directory and the SQLite file live under. */
  readonly agentQaRoot: string
  readonly suitePath: string
  readonly testPath: string
  readonly testId: string
}

/**
 * A project whose dashboard-triggered SUITE run executes one live planning turn against a page.
 *
 * A FIFTH RECIPE RATHER THAN A FLAG ON THE FOURTH, on `drainableSuiteFixtureProject`'s own
 * argument for being a fourth. Both of that recipe's fixed points are wrong here: its target is
 * `https://conformance.invalid` and its model base URL is a port nothing serves, and BOTH of this
 * fixture's addresses are ephemeral ports learned at runtime. A recipe whose two defining values
 * are arguments is not the same recipe with an option; it is a different answer to "what did the
 * door open", and this module's law is that each such answer is written once.
 *
 * `environment: 'local'` ON THE TARGET IS LOAD-BEARING for the reason `runServiceFixtureProject`
 * records in full: the run gate folds the most restrictive declared target class, and only an
 * all-local invocation is decided `mutating-local` — the tier allowed in this door's fail-closed
 * `local-headless` context. An undeclared target classifies the run `mutating-shared`, which is a
 * DENIAL, and a denied run never starts.
 *
 * `hooks: []` AND NOT `hooks: {}`, measured by 404-08 rather than copied: a run VALIDATES the
 * hooks document and the mapping form fails that validation, which this door flattens into a
 * `500 run_start_failed` carrying no diagnosis at all.
 */
export function populatedRunFixtureProject(
  label: string,
  addresses: { readonly modelBaseUrl: string; readonly targetUrl: string },
): PopulatedRunProject {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `agent-qa-405-09-${label}-`)))
  const configPath = join(root, 'agent-qa.config.yaml')

  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        workspace: {
          testMatch: ['tests/**/*.test.yaml'],
          testPathIgnore: [],
          suiteMatch: ['suites/**/*.suite.yaml'],
          hooksFile: 'hooks.yaml',
          envFile: '.env',
          secretsFile: '.env.secrets.local',
        },
        knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none' },
        use: { mobile: { appState: 'preserve' }, llm: POPULATED_MODEL_NAME },
        registry: {
          targets: {
            [POPULATED_TARGET_NAME]: {
              platform: 'web',
              url: addresses.targetUrl,
              environment: 'local',
            },
          },
          llms: [
            {
              name: POPULATED_MODEL_NAME,
              provider: 'openai-compatible',
              model: POPULATED_MODEL_ID,
              baseURL: addresses.modelBaseUrl,
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  // The three files `requireExistingFiles: true` refuses a project without.
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  writeFileSync(join(root, '.env'), '', 'utf8')
  // THE ONE FILE IN THIS FIXTURE THAT HOLDS A VALUE, and it is a throwaway this repository owns.
  // Every other fixture in `spawned-chat.ts` writes this file EMPTY on the argument that a value
  // which does not exist cannot be printed by a diagnostic nobody anticipated. That argument does
  // not reach here: the claim this fixture makes is that a DECLARED secret never lands in clear,
  // and nothing can measure that without one being declared.
  writeFileSync(
    join(root, '.env.secrets.local'),
    `${POPULATED_SECRET_NAME}=${POPULATED_DECLARED_SECRET_VALUE}\n`,
    'utf8',
  )
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  // Created rather than left to the first writer, on the drainable recipe's reasoning: a real
  // post-run daemon acquires its writer lease over this directory before it serves anything.
  mkdirSync(join(root, 'agent-qa-knowledge'), { recursive: true })

  const testId = generateTestId()
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(
    join(root, POPULATED_TEST_PATH),
    'name: The populated run conformance probe\n'
    // MINTED rather than hand-written: canonical ids come from the ID helpers by house rule.
    + `test-id: ${testId}\n`
    + `target: ${POPULATED_TARGET_NAME}\n`
    + 'steps:\n'
    + `  - Click the ${POPULATED_BUTTON_LABEL} button on the notice page. The operator credential `
    + `for this environment is {{secret:${POPULATED_SECRET_NAME}}}.\n`,
    'utf8',
  )

  mkdirSync(join(root, 'suites'), { recursive: true })
  writeFileSync(
    join(root, POPULATED_SUITE_PATH),
    'name: The populated run conformance suite\n'
    + `suite-id: ${generateSuiteId()}\n`
    + `target: ${POPULATED_TARGET_NAME}\n`
    + 'tests:\n'
    + `  - test: ${POPULATED_TEST_PATH}\n    id: ${testId}\n`,
    'utf8',
  )

  return {
    root,
    configPath,
    agentQaRoot: join(root, '.agent-qa'),
    suitePath: POPULATED_SUITE_PATH,
    testPath: POPULATED_TEST_PATH,
    testId,
  }
}

// ---- Driving one populated run ------------------------------------------------------------------

/** Everything one populated run left behind, as data. */
export interface PopulatedRunDrive {
  readonly runId: string
  /** Every envelope the local run-stream door served, in seq order. */
  readonly envelopes: readonly RunEventEnvelope[]
  /** Whether a `runFinished` frame arrived inside the budget. */
  readonly finished: boolean
  /** The last envelope type seen — what a timeout names instead of "it did not finish". */
  readonly lastType?: string
  /** Wall time from the trigger ack to the last read, in milliseconds. */
  readonly elapsedMs: number
}

/** Trigger one populated suite run and hand back the id the door acked. */
async function triggerPopulatedRun(origin: string, suitePath: string): Promise<string> {
  const response = await fetch(`${origin}/api/runs/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: suitePath }),
  })
  const body = await response.text()
  if (response.status !== 202) throw new Error(`the trigger route refused: ${body}`)
  const runId = (JSON.parse(body) as { runId?: string }).runId
  if (typeof runId !== 'string') throw new Error(`the trigger ack named no run: ${body}`)
  return runId
}

/**
 * Peel every COMPLETE line off a stream buffer and hand back the partial remainder.
 *
 * WRITTEN AS AN INDEX WALK RATHER THAN THE OBVIOUS ONE-LINER, and the reason is a grep. This
 * module's contract is that it asserts nothing, and the census that holds that contract counts
 * occurrences of the test-declaration tokens by substring — a call to the string method that
 * divides on a separator contains one of those tokens inside its own name, so the obvious spelling
 * would report this instrument as a cell that asserts. The walk below is the same operation with a
 * name the census can tell apart.
 */
function peelLines(buffered: string): { lines: string[]; rest: string } {
  const lines: string[] = []
  let rest = buffered
  for (;;) {
    const at = rest.indexOf('\n')
    if (at === -1) break
    lines.push(rest.slice(0, at))
    rest = rest.slice(at + 1)
  }
  return { lines, rest }
}

function parseEnvelope(line: string): RunEventEnvelope | undefined {
  if (!line.startsWith('data: ')) return undefined
  try {
    const parsed = JSON.parse(line.slice('data: '.length)) as RunEventEnvelope
    return typeof (parsed as { type?: unknown }).type === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Trigger one run and collect its whole envelope log off the LOCAL run-stream door.
 *
 * THE RE-ATTACH LOOP IS `post-processing-dom.test.ts`'s, for its reason: the trigger route acks
 * BEFORE the session is registered, and the registry keeps a finished run attachable for its
 * retention window — so an attach that arrives early is refused and an attach that arrives late
 * still replays the whole log. Each attach therefore collects from scratch and the longest
 * complete reading wins, rather than concatenating two partial replays into a log with duplicates.
 *
 * IT RETURNS DATA AND NEVER ASSERTS, on this module's own law. A run that never finished comes
 * back with `finished: false` and the last type it saw, and the cell decides what that means.
 */
export async function drivePopulatedRun(
  dashboard: Pick<SpawnedDashboard, 'origin'>,
  project: Pick<PopulatedRunProject, 'suitePath'>,
  budgetMs: number = RUN_BUDGET_MS,
): Promise<PopulatedRunDrive> {
  const startedAt = Date.now()
  const runId = await triggerPopulatedRun(dashboard.origin, project.suitePath)
  const url = `${dashboard.origin}/api/run-stream/${encodeURIComponent(runId)}`
  const deadline = startedAt + budgetMs

  let best: RunEventEnvelope[] = []
  let finished = false

  while (!finished && Date.now() < deadline) {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, Math.max(1_000, deadline - Date.now()))
    const attempt: RunEventEnvelope[] = []
    let sawFinish = false
    try {
      const response = await fetch(url, { signal: controller.signal })
      const contentType = response.headers.get('content-type') ?? ''
      if (response.body !== null && contentType.includes('text/event-stream')) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffered = ''
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          buffered += decoder.decode(chunk.value, { stream: true })
          const peeled = peelLines(buffered)
          buffered = peeled.rest
          for (const line of peeled.lines) {
            const envelope = parseEnvelope(line)
            if (envelope === undefined) continue
            attempt.push(envelope)
            if (envelope.type === 'runFinished') sawFinish = true
          }
          if (sawFinish) break
        }
        await reader.cancel().catch(() => undefined)
      }
    } catch {
      // An aborted or refused attach is retried below, within the same budget.
    } finally {
      clearTimeout(timer)
    }
    if (sawFinish || attempt.length > best.length) best = attempt
    finished = sawFinish
    if (finished) break
    await new Promise<void>((tick) => { setTimeout(tick, 150) })
  }

  const lastType = best.at(-1)?.type
  return {
    runId,
    envelopes: best,
    finished,
    ...(lastType === undefined ? {} : { lastType }),
    elapsedMs: Date.now() - startedAt,
  }
}
