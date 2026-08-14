// The write_test → scaffold → confirm → author handoff, in ONE turn (395-08, D-14/D-15 · CFGM-05).
//
// THE SEAM THE PLAN NAMED DOES NOT EXIST, AND THIS FILE IS WHERE THAT WAS RESOLVED. The plan says
// to branch "where the chat turn resolves a write_test request's target against
// configuredTargetNames". `AuthoringDraftWriteInputSchema` carries `intent` and an optional
// `scope`; there is no target on the request at all, and the one that ends up in a draft is
// decided INSIDE the loop by a model, at `loop.ts:583`/`:647`, after an LLM call. So the branch
// asks the question that IS answerable before dispatch — given this project's vocabulary and the
// words a person typed, is there anything to author against — and the loop's own backstop is
// untouched (RESEARCH Pitfall 6).
//
// WHAT MAKES EACH CELL RED:
//
//   (R1) passthrough    — a route that intercepted ordinary requests. A configured project asked
//                         for "the login flow" must dispatch authoring and NOTHING else; the spy
//                         records every invocation, so a stray scaffold fails by count.
//   (R2) configured     — a route that scaffolded a target the project already declares. The
//                         utterance names `booking.com`, the project declares `booking-com`, and
//                         the only invocation must be the authoring one.
//   (R3) scaffold+apply — a chain that authored without configuring, or one that configured
//                         without authoring. Asserted as an ORDERED list of invocations, so a
//                         turn that did the right things in the wrong order fails too.
//   (R4) the confirm    — D-14's pause, proven REACHED. The apply seat is a spy and the cell
//                         asserts it was CALLED, because a turn that never reached a confirm also
//                         completes. Its integrity half: the authoring dispatch is asserted to
//                         come AFTER it in the same `ordering` array.
//   (R5) reject         — a chain that authored anyway after the person declined. The apply seat
//                         throws the gate's own refusal name, and the cell asserts ZERO authoring
//                         invocations and a `fail_closed` turn.
//   (R6) non-TTY        — the same shape as (R5) with the gate's fail-closed refusal, and the
//                         answer must name the missing configuration rather than the tier.
//   (R7) refusal        — a route that guessed. An unconfigured project asked for "the checkout
//                         flow" invokes NOTHING at all — not even the scaffold — and the refusal
//                         names both continuations without echoing the words back as an origin.
//   (R8) blocked/refused— a scaffold that answered `refused` and a chain that dispatched authoring
//                         anyway. The proposal's own detail is what the turn reports. Its fixture's
//                         refusal is one the REAL op can produce in this project class (395-12): a
//                         canned `already-configured` would be a refusal a zero-target project can
//                         no longer earn, which is the vacuity (R3/R4) was just repaired for.
//   (R9) unbound        — a host that binds no vocabulary. The route must not run at all, so the
//                         shipped dispatch is byte-for-byte what it was before this seam existed.
//  (R10) WR-05          — a scaffold arm with no from-zero precondition. `readme.md` PARSES as a
//                         hostname, so in a project that declares targets the pre-395-12 route
//                         resolved `scaffold` and the turn ended in `already-configured` for
//                         `readme-md` — a site nobody named, traded for a working dispatch. The
//                         cell asserts the authoring dispatch is EXACTLY what 394 ships.
//  (R11) both classes   — a route that decided on the WORDING. ONE utterance, TWO project classes,
//                         in one cell: zero targets scaffolds and one configured target passes
//                         through. Neither half can be satisfied by a constant.
//
// THE ROUTE RESOLVER IS ALSO MEASURED DIRECTLY, with a rejection corpus, because a refusal rule
// needs corpus cases it REJECTS or every cell is drawn from inside the rule's own assumption.

import { isMap, isScalar, isSeq, parseDocument } from 'yaml'
import { describe, expect, it } from 'vitest'

import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { utf8Decode, utf8Encode } from '@vostride/agent-qa-schema'
import type {
  AgentAskInput,
  AgentAskResult,
  ChatSessionEvent,
  ChatSessionHandle,
  ChatSessionHeader,
  FunctionCaller,
  SessionLogPort,
} from '@vostride/agent-qa-schema'

import type {
  ConfigFilesPortLike,
  ConfigPathFacts,
  ConfigProposalsWritePortLike,
  ConfigScaffoldContentPortLike,
  ConfigValidatePortLike,
} from '../../config-mutation/ports.js'
import { AUTHORING_DRAFT_WRITE_FUNCTION_ID } from '../../functions/ops/authoring-draft-write.js'
import {
  CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
  configProjectScaffoldSpec,
} from '../../functions/ops/config-project-scaffold.js'
import { CONFIG_PROPOSAL_APPLY_FUNCTION_ID } from '../../functions/ops/config-proposal-apply.js'
import {
  WRITE_TEST_UNCONFIGURED_DETAIL,
  resolveWriteTestRoute,
} from '../../config-mutation/write-test-route.js'
import { CHAT_RESOLVER_TABLE } from '../resolver-table.js'
import { deterministicOverrideStrategy } from '../reconcile.js'
import { splitClauses } from '../clause-split.js'
import { createTurnEngine } from '../turn-engine.js'
import type { TurnEngineDeps } from '../turn-engine.js'
import { toToolName } from '../tool-names.js'
import type { ChatBindingStage, PlannerStagePort } from '../ports.js'

const PLANNER_CALLER: FunctionCaller = {
  surface: 'chat',
  grantedScopes: ['read', 'run', 'config-write', 'test-write'],
  safeMode: false,
  origin: 'agent',
}

/** The gate's own refusal name, so a scripted denial is the shape production raises. */
class FunctionDeniedError extends Error {
  override readonly name = 'FunctionDeniedError'
}

function memoryLog(): SessionLogPort & { readonly events: ChatSessionEvent[] } {
  const events: ChatSessionEvent[] = []
  const header: ChatSessionHeader = {
    schemaVersion: 1,
    sessionId: 'scaffold-route-session',
    createdAt: '1970-01-01T00:00:00.000Z',
    model: 'unbound',
    toolsetHash: 'hash-0',
  }
  return {
    events,
    open(): Promise<ChatSessionHandle> {
      return Promise.resolve({
        header,
        events: [...events],
        refusedLines: [],
        append(event: ChatSessionEvent): Promise<void> {
          events.push(event)
          return Promise.resolve()
        },
        turnBoundary: () => Promise.resolve(),
        close: () => Promise.resolve(),
      })
    },
  }
}

interface Harness {
  readonly ordering: string[]
  readonly inputs: { functionId: string; input: unknown }[]
  /**
   * Every mid-turn render, each carrying a SNAPSHOT of `ordering` taken at the moment it happened
   * (395-13).
   *
   * The snapshot rather than a marker pushed into `ordering` itself, and that is deliberate:
   * `ordering` keeps recording INVOCATIONS ONLY, so every expected array in the cells below is the
   * array it always was and a render's position is read off a copy instead of by widening the thing
   * six other cells assert on.
   */
  readonly presented: { text: string; orderingAtRender: string[] }[]
  /**
   * What each invocation RESOLVED to.
   *
   * So a cell can compare a rendered surface against the op's OWN answer rather than against a copy
   * of the fixture — the difference between measuring that this proposal was shown and measuring
   * that something with the right shape was.
   */
  readonly answers: { functionId: string; answer: unknown }[]
  /**
   * The session events THIS run wrote, live (395-17).
   *
   * Exposed because the display-only claim has a second half nothing measured: D-14 says a
   * presentation port shows and never decides, and "never decides" includes the log. The harness
   * pins a fixed turn id and a counting clock, so two runs of the same road write byte-identical
   * streams and a cell can compare them whole rather than asserting on a chosen field.
   */
  readonly events: ChatSessionEvent[]
  runTurn(input: AgentAskInput): Promise<AgentAskResult>
}

// -----------------------------------------------------------------------------------------------
// THE REAL SCAFFOLD OP, BEHIND THE CHAIN (395-12 · the R3/R4 vacuity closed IN PLACE, not siblinged)
//
// WHAT WAS WRONG WITH THE OLD FIXTURE, stated because the repair is only legible against it. The
// happy-path cell drove a scaffold DOUBLE that answered `proposed` in a project whose configured
// set was `['other-site']` — a project in which the REAL op answered `refused / already-configured`,
// which cell (R8) in this same file shows converts into a whole-turn refusal. The chain's ORDER was
// therefore pinned against an answer no shipped build could produce: the ordering held while the
// capability did not, and 395-VERIFICATION reproduced both halves live and scored SC-5 failed.
//
// THE REPAIR IS THE REAL REGISTERED SPEC, never a second double that answers differently.
// `configProjectScaffoldSpec.invoke` runs here over in-memory ports, so `parseHostnameToken`, the
// declared-target predicate, the candidate assembly, the cross-boundary classifier, the guardrail
// scan and the filing are all production's. Two of the five ports are doubles for a BOUNDARY reason
// rather than a convenience one: `configValidate` is `core`'s `AgentQaConfigSchema` and
// `scaffoldContent` is the shared content module beside `agent-qa init`, and `packages/agent` may
// import neither. Both are measured against their real implementations in
// `cli/src/composition/__tests__/config-scaffold.test.ts`, over a real git repository.
//
// `configFiles.inspect` IS FAITHFUL, and it is the one that carries this cell's claim. It is the
// shipped host's own `parseDocument` → `getIn` → `keys` read, spelled over the same `yaml` API — a
// DEV dependency of this package, so a test may parse what this package's source may not.
// -----------------------------------------------------------------------------------------------

const SCAFFOLD_CONFIG_FILE = 'agent-qa.config.yaml'
const SCAFFOLD_HOOKS_FILE = 'hooks.yaml'
const SCAFFOLD_GITIGNORE = '.gitignore'

/**
 * A project that CAN chat — it declares a model — and has nothing to write a test against.
 *
 * THIS IS SC-5's SERVING CLASS, and it is not a hypothetical: `resolveCliChatCapabilities` reads
 * the chat model out of `registry.llms`, which lives in the config file, so a project able to hold
 * a conversation at all is a project that HAS one. The pre-fix predicate refused exactly those.
 */
const ZERO_TARGET_CONFIG = `# this project's own configuration

workspace:
  hooksFile: hooks.yaml

registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra

use:
  llm: judge
`

const SEEDED_GITIGNORE = '# the project\'s own rules\ndist/\n'

/**
 * The document's SHAPE at each path, spelled as `createConfigFilesPort` spells it.
 *
 * NAMES AND NEVER VALUES, which is `ConfigPathFacts`' own contract: a port that answered what is AT
 * a path would be the unmasked config reader reached through the back door of a mutation helper.
 */
function inspectFacts(configText: string, paths: readonly string[]): readonly ConfigPathFacts[] {
  const document = parseDocument(configText)
  return paths.map((path) => {
    const node = document.getIn(path.split('.'), true)
    if (node === undefined || node === null) return { path, present: false }
    if (isSeq(node)) {
      return { path, present: true, kind: 'sequence' as const, length: node.items.length }
    }
    if (isMap(node)) {
      return {
        path,
        present: true,
        kind: 'map' as const,
        keys: node.items.map((item) => String(isScalar(item.key) ? item.key.value : item.key)),
      }
    }
    return { path, present: true, kind: 'scalar' as const }
  })
}

interface FiledProposal {
  readonly summaryLine: string
  readonly paths: readonly string[]
}

interface ScaffoldOpFixture {
  readonly deps: Parameters<typeof configProjectScaffoldSpec.invoke>[1]
  /** Every proposal the REAL op filed, so a cell reads what it actually proposed. */
  readonly filed: FiledProposal[]
}

function scaffoldOpFixture(options: {
  /** The committed configuration, or absent for a project that has none at all. */
  readonly configText?: string
  /** The committed hooks file, or absent when the project has none. */
  readonly hooksText?: string
} = {}): ScaffoldOpFixture {
  const filed: FiledProposal[] = []

  const configFiles: ConfigFilesPortLike = {
    read: () => Promise.resolve({
      configFile: SCAFFOLD_CONFIG_FILE,
      hooksFile: SCAFFOLD_HOOKS_FILE,
      files: [
        { path: SCAFFOLD_GITIGNORE, bytes: utf8Encode(SEEDED_GITIGNORE) },
        options.configText === undefined
          ? { path: SCAFFOLD_CONFIG_FILE }
          : { path: SCAFFOLD_CONFIG_FILE, bytes: utf8Encode(options.configText) },
        options.hooksText === undefined
          ? { path: SCAFFOLD_HOOKS_FILE }
          : { path: SCAFFOLD_HOOKS_FILE, bytes: utf8Encode(options.hooksText) },
      ],
    }),
    inspect: ({ bytes, paths }) => Promise.resolve(
      inspectFacts(bytes === undefined ? '' : utf8Decode(bytes), paths),
    ),
    setField: () => Promise.reject(new Error('the scaffold performs no field edit')),
    mintHookId: () => 'h_aster-bloom-cloud-drift-ember-field-glade-hollow-ivory-jasper',
  }

  const configValidate: ConfigValidatePortLike = {
    validate: () => Promise.resolve({ ok: true }),
  }

  // FAITHFUL TO THE TWO MODES THE ONE PRODUCER HAS: a whole configuration when the project has
  // none, and the person's own bytes with exactly one target entry inserted when it has one that
  // declares no targets. A hooks file that already exists is left out of the answer entirely.
  const scaffoldContent: ConfigScaffoldContentPortLike = {
    render: (input) => {
      const merged = input.existingConfig === undefined
        ? `registry:\n  targets:\n    ${input.targetName}:\n`
          + `      platform: web\n      url: ${input.baseUrl}\n`
        : (() => {
            const document = parseDocument(utf8Decode(input.existingConfig.bytes))
            document.setIn(
              ['registry', 'targets', input.targetName],
              { platform: 'web', url: input.baseUrl },
            )
            return document.toString()
          })()
      const hooksPresent = input.existingConfig?.hooksPresent ?? false
      return Promise.resolve([
        {
          path: input.existingConfig?.path ?? SCAFFOLD_CONFIG_FILE,
          bytes: utf8Encode(merged),
        },
        ...(hooksPresent
          ? []
          : [{
            path: input.existingConfig?.hooksPath ?? SCAFFOLD_HOOKS_FILE,
            bytes: utf8Encode('hooks: []\n'),
          }]),
        {
          path: SCAFFOLD_GITIGNORE,
          bytes: utf8Encode(
            `${input.existingGitignore === undefined ? '' : utf8Decode(input.existingGitignore)}`
            + '# agent-qa init:start\n# agent-qa init:end\n',
          ),
        },
      ])
    },
  }

  const configProposals: ConfigProposalsWritePortLike = {
    put: (record) => {
      filed.push({
        summaryLine: record.payload.summaryLine,
        paths: record.payload.payloadKind === 'applyable'
          ? record.payload.files.map((file) => file.path)
          : [...record.payload.paths],
      })
      return Promise.resolve({ proposalId: 'prop-scaffold' })
    },
  }

  return {
    deps: {
      configFiles,
      configValidate,
      configProposals,
      // THE REAL SCAN with an EMPTY seed set, on `config-apply.test.ts`'s stated reasoning: the
      // function is production's, the seeds are not, because a cell whose verdict depended on the
      // developer's exported variables would be measuring the machine.
      configScan: { scan: (parts) => scanConstructedArtifact(parts, {}) },
      scaffoldContent,
    } as Parameters<typeof configProjectScaffoldSpec.invoke>[1],
    filed,
  }
}

function harness(options: {
  /** Absent ⇒ the dep is not bound at all, which is cell (R9)'s whole subject. */
  readonly targets?: readonly string[]
  readonly scaffoldAnswer?: unknown
  /**
   * Drive the REAL registered `config.project.scaffold` spec instead of a canned answer (395-12).
   *
   * The cell that pins the chain's ORDER is the one cell in this file whose claim depends on what
   * the scaffold actually answers, so it is the one cell that may not be told the answer.
   */
  readonly realScaffold?: ScaffoldOpFixture
  readonly denyApply?: string
  /**
   * Bind NO presentation port, which is every headless host (395-13).
   *
   * Present by default, because the surface under test is the one production binds; this flag is
   * the absent-safe half, and it is a flag rather than a second harness so both hosts run the same
   * assembly.
   */
  readonly noPresent?: boolean
  /**
   * Bind a present that FAILS, in whichever of the port type's two arms is named (395-17).
   *
   * `(text) => void | Promise<void>` can fail synchronously or by rejecting, and a host binding a
   * real stream can do either — so the third state of this port (bound, and broken) gets a double
   * per arm. Both RECORD first: the render was attempted, and that observation must survive the
   * failure or a cell could not tell a broken surface from one that was never reached.
   */
  readonly presentFailure?: 'throws' | 'rejects'
} = {}): Harness {
  const ordering: string[] = []
  const inputs: { functionId: string; input: unknown }[] = []
  const presented: { text: string; orderingAtRender: string[] }[] = []
  const answers: { functionId: string; answer: unknown }[] = []
  let clock = 0

  // The planner is what turns a free-text utterance into an `authoring.draft.write` call — the same
  // path production takes, because `write_test` is not in the deterministic resolver table.
  const planner: PlannerStagePort = {
    plan: ({ clauses }) => Promise.resolve({
      toolCalls: clauses.map((clause) => ({
        toolName: toToolName(AUTHORING_DRAFT_WRITE_FUNCTION_ID),
        input: { intent: clause.text },
      })),
    }),
  }

  // What each seat answers, hoisted out of the recorder below so that recorder stays ONE shape:
  // record the call, resolve the answer, record the answer.
  const answerFor = (functionId: string, input: unknown): Promise<unknown> => {
    if (functionId === CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID) {
      if (options.realScaffold !== undefined) {
        return configProjectScaffoldSpec.invoke(
          input as { readonly domain: string },
          options.realScaffold.deps,
        ) as Promise<unknown>
      }
      return Promise.resolve(options.scaffoldAnswer ?? {
        outcome: 'proposed',
        proposalId: 'prop-scaffold',
        summaryLine: 'configure this project for https://booking.com as target booking-com',
        crossBoundary: true,
        crossBoundaryReasons: ['new-origin'],
        files: ['.gitignore', 'agent-qa.config.yaml', 'hooks.yaml'],
        shownDiff: '--- /dev/null\n+++ b/agent-qa.config.yaml\n',
      })
    }
    return Promise.resolve({ ok: true })
  }

  // CAPTURED rather than constructed inline, so the stream this run wrote can be read back off the
  // Harness. Nothing about the binding changes: the same instance is handed to the same dep.
  const sessionLog = memoryLog()

  const PRESENT_FAILURE_ERROR = 'the pipe closed'

  const deps: TurnEngineDeps = {
    table: CHAT_RESOLVER_TABLE,
    split: splitClauses,
    reconcile: deterministicOverrideStrategy,
    sessionLog,
    mint: {
      forStage: (_stage: ChatBindingStage, sessionId: string): FunctionCaller =>
        ({ ...PLANNER_CALLER, sessionId }),
    },
    invoke: async (functionId, input) => {
      ordering.push(functionId)
      inputs.push({ functionId, input })
      if (functionId === options.denyApply) {
        throw new FunctionDeniedError(
          'Denied config.proposal.apply: fail-closed: this project has no agent-qa configuration '
          + 'and there is nobody to ask',
        )
      }
      const answer = await answerFor(functionId, input)
      answers.push({ functionId, answer })
      return answer
    },
    planner,
    // 395-13 D-14: the surface a person reads mid-turn. BOUND BY DEFAULT, because the host under
    // test is the one production composes; `noPresent` is the absent-safe half.
    ...(options.noPresent === true
      ? {}
      : {
        present: (text: string) => {
          presented.push({ text, orderingAtRender: [...ordering] })
          // RECORD, THEN FAIL. The attempt is the thing a cell needs to see; a double that failed
          // before recording would make "bound and broken" indistinguishable from "never reached".
          if (options.presentFailure === 'throws') throw new Error(PRESENT_FAILURE_ERROR)
          if (options.presentFailure === 'rejects') {
            return Promise.reject(new Error(PRESENT_FAILURE_ERROR))
          }
          return undefined
        },
      }),
    ...(options.targets === undefined
      ? {}
      : { configuredTargets: () => Promise.resolve(options.targets as readonly string[]) }),
    now: () => {
      clock += 1
      return `1970-01-01T00:00:0${String(clock % 10)}.000Z`
    },
    mintTurnId: () => 'turn-fixed',
  }

  const engine = createTurnEngine(deps)
  return {
    ordering,
    inputs,
    presented,
    answers,
    events: sessionLog.events,
    runTurn: (input) => engine.runTurn(input),
  }
}

describe('the write_test route is deterministic and narrow (D-15)', () => {
  it('routes a configured target name, a hostname, and neither — by TOKEN, never by substring', () => {
    expect(resolveWriteTestRoute({
      intent: 'write a test for the checkout on shop',
      configuredTargetNames: ['shop', 'admin'],
    })).toEqual({ kind: 'configured', name: 'shop' })

    // `workshop` CONTAINS `shop`. A substring match would configure the wrong project.
    expect(resolveWriteTestRoute({
      intent: 'write a test for the workshop booking page',
      configuredTargetNames: ['shop'],
    })).toEqual({ kind: 'passthrough' })

    expect(resolveWriteTestRoute({
      intent: 'write a test for booking.com',
      configuredTargetNames: [],
    })).toEqual({ kind: 'scaffold', domain: 'booking.com', targetName: 'booking-com' })

    // The hostname's DERIVED name is already configured — that is the target they have, spelled as
    // a domain, and routing it to a scaffold would send them to `already-configured` for nothing.
    expect(resolveWriteTestRoute({
      intent: 'write a test for booking.com',
      configuredTargetNames: ['booking-com'],
    })).toEqual({ kind: 'configured', name: 'booking-com' })
  })

  it('(WR-05) never offers the scaffold in a project that already declares targets', () => {
    // A HOSTNAME-SHAPED TOKEN THAT IS NOT A SITE. `readme.md` and `index.html` both satisfy
    // `parseHostnameToken` — a dot, legal labels, an alphabetic final label — so before 395-12 the
    // scaffold arm fired on them in ANY project, and a configured project's turn ended in
    // `already-configured` for `readme-md`. The precondition is the project, in both arms.
    for (const intent of [
      'write a test that checks the readme.md rendering',
      'write a test for the index.html landing page',
      'write a test for booking.com checkout',
    ]) {
      expect(resolveWriteTestRoute({ intent, configuredTargetNames: ['shop'] }), intent)
        .toEqual({ kind: 'passthrough' })
    }

    // THE OTHER SIDE IN THE SAME CELL, so neither half can be a constant: the identical tokens in a
    // project that declares NOTHING still reach the scaffold, which is the road SC-5 needs open.
    expect(resolveWriteTestRoute({
      intent: 'write a test that checks the readme.md rendering',
      configuredTargetNames: [],
    })).toEqual({ kind: 'scaffold', domain: 'readme.md', targetName: 'readme-md' })
  })

  it('REFUSES only a project with no targets and an utterance with no hostname', () => {
    // The rejection corpus. Every row is a real write_test request; the only ones that refuse are
    // the ones with nothing at all to author against.
    for (const intent of [
      'write a test for the checkout flow',
      'write a test that logs in and buys something',
      'write a test for not_a_domain.x',
      'write a test for the shop',
    ]) {
      expect(resolveWriteTestRoute({ intent, configuredTargetNames: [] }), intent)
        .toEqual({ kind: 'refuse' })
    }

    // THE SAME UTTERANCES IN A CONFIGURED PROJECT PASS THROUGH. This is the half that stops the
    // refusal from being a rule about wording: the precondition is the PROJECT.
    for (const intent of [
      'write a test for the checkout flow',
      'write a test that logs in and buys something',
    ]) {
      expect(resolveWriteTestRoute({ intent, configuredTargetNames: ['shop'] }), intent)
        .toEqual({ kind: 'passthrough' })
    }
  })
})

describe('one turn: detect, scaffold, confirm, apply, author (D-14 · CFGM-05)', () => {
  it('(R1) dispatches authoring untouched for an ordinary request in a configured project', async () => {
    const test = harness({ targets: ['shop'] })
    const result = await test.runTurn({ message: 'write a test for the login flow' })

    expect(result.status).toBe('completed')
    // EXACTLY ONE invocation, and it is the authoring one. A route that intercepted here would add
    // a scaffold to this list and fail by count rather than by message.
    expect(test.ordering).toEqual([AUTHORING_DRAFT_WRITE_FUNCTION_ID])
  })

  it('(R2) does not scaffold a target the project already declares', async () => {
    const test = harness({ targets: ['booking-com'] })
    await test.runTurn({ message: 'write a test for booking.com checkout' })

    expect(test.ordering).toEqual([AUTHORING_DRAFT_WRITE_FUNCTION_ID])
  })

  it('(R3/R4) scaffolds through the REAL op, reaches the confirm, and authors AFTER it', async () => {
    // THE FIXTURE IS THE FIX (395-12). An EMPTY configured set, and a committed configuration that
    // declares a model and ZERO targets — the class that can reach a chat turn at all, and the
    // class the scaffold used to refuse. The invocation reaches `configProjectScaffoldSpec` and
    // `constructConfigProjectScaffoldProposal` for real; nothing here tells it what to answer.
    //
    // RED ON PRE-FIX HEAD, BY THE MEASURED MECHANISM: the real op answered `refused` /
    // `already-configured` for the config file's mere EXISTENCE, and `routeWriteTest` converted
    // that into a whole-turn refusal — cell (R8)'s shape, arriving on the happy path.
    const scaffoldOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
    const test = harness({ targets: [], realScaffold: scaffoldOp })
    const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

    expect(result.status).toBe('completed')
    // The op really PROPOSED, and what it filed is the merge: the person's configuration modified
    // beside the two files this project does not have. Read off the filed record rather than off
    // the turn, so a chain that completed on some other answer cannot satisfy it.
    expect(scaffoldOp.filed).toHaveLength(1)
    expect(scaffoldOp.filed[0]?.summaryLine)
      .toBe('configure this project for https://booking.com as target booking-com')
    expect([...(scaffoldOp.filed[0]?.paths ?? [])].sort())
      .toEqual(['.gitignore', 'agent-qa.config.yaml', 'hooks.yaml'])
    // THE ORDER IS THE CLAIM. Scaffold, then the gated apply — which is where the shipped v48/392
    // inline confirm pauses this chain — and only then the authoring dispatch. A turn that did all
    // three in a different order fails here.
    expect(test.ordering).toEqual([
      CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
      CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
      AUTHORING_DRAFT_WRITE_FUNCTION_ID,
    ])
    // (R4) THE CONFIRM WAS REACHED, as a fact about the apply having been INVOKED rather than as an
    // inference from the turn completing. `config.proposal.apply` is the gated verb; a chain that
    // wrote the configuration without crossing it would show no such invocation here.
    expect(test.inputs.map((call) => call.functionId))
      .toContain(CONFIG_PROPOSAL_APPLY_FUNCTION_ID)
    // The domain handed to the scaffold is the one the gate derived from the utterance, and the
    // apply names the proposal the scaffold answered with — not an id this engine invented.
    expect(test.inputs[0]?.input).toEqual({ domain: 'booking.com' })
    expect(test.inputs[1]?.input).toEqual({ proposalId: 'prop-scaffold' })
  })

  it('(R5/R6) authors NOTHING when the confirm is declined or the host is non-TTY', async () => {
    // TARGETS EMPTY SINCE 395-12 (WR-05): a project that declares targets now PASSES THROUGH a
    // hostname token, so `['other-site']` would route authoring and this cell would measure
    // nothing. The from-zero class is the one in which a scaffold is offered at all.
    const test = harness({ targets: [], denyApply: CONFIG_PROPOSAL_APPLY_FUNCTION_ID })
    const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

    expect(result.status).toBe('fail_closed')
    // The scaffold was proposed and the apply refused. NOTHING was authored — a person who declined
    // a configuration change is not left with a draft against a project that still has none.
    expect(test.ordering).toEqual([
      CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
      CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
    ])
    expect(test.ordering).not.toContain(AUTHORING_DRAFT_WRITE_FUNCTION_ID)
    // The answer names the missing configuration, which is the v48 posture's own sentence carried
    // through rather than re-worded here.
    expect(result.unhandled?.reason).toContain('no agent-qa configuration')
    // 395-13: THE RENDER HAPPENED AND THE REFUSAL STILL STANDS. Showing a person what they are
    // being asked about is not a step toward doing it — the proposal reached the surface exactly
    // once, then the apply was refused and nothing was authored. A render that suppressed itself on
    // the declined road would hide the one thing a person needs in order to decline for a reason.
    expect(test.presented).toHaveLength(1)
    expect(test.presented[0]?.orderingAtRender)
      .not.toContain(CONFIG_PROPOSAL_APPLY_FUNCTION_ID)
  })

  it('(R7) refuses an unconfigured project with no hostname, and invokes nothing at all', async () => {
    const test = harness({ targets: [] })
    const result = await test.runTurn({ message: 'write a test for the checkout flow' })

    expect(result.status).toBe('fail_closed')
    // NOT EVEN A SCAFFOLD. D-15's refusal is above every effect, so a guess costs nothing and
    // leaves nothing behind.
    expect(test.ordering).toEqual([])
    expect(result.unhandled?.reason).toBe(WRITE_TEST_UNCONFIGURED_DETAIL)
    // It asks for the two things a person can supply, and does NOT hand their own words back as a
    // candidate origin. The presence halves above are what make this absence non-vacuous.
    expect(result.unhandled?.reason).toContain('write a test for example.com')
    expect(result.unhandled?.reason).not.toContain('checkout')
  })

  it('(R8) reports the scaffold\'s own refusal and dispatches nothing', async () => {
    // TARGETS EMPTY, AND THE REFUSAL IS ONE THE REAL OP CAN PRODUCE HERE (395-12). Two fixture
    // moves, one reason: WR-05 means a target-declaring project passes a hostname through, and
    // `already-configured` is a refusal a ZERO-target project can no longer earn — a canned answer
    // no shipped build could produce is exactly the vacuity (R3/R4) was repaired for. 395-02's
    // `unrenderable-diff` is reachable from zero: it is what the op answers when the project's own
    // `.gitignore` holds bytes that are not valid UTF-8.
    const test = harness({
      targets: [],
      scaffoldAnswer: {
        outcome: 'refused',
        reason: 'unrenderable-diff',
        detail: '.gitignore holds bytes that are not valid UTF-8',
      },
    })
    const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

    expect(result.status).toBe('fail_closed')
    expect(test.ordering).toEqual([CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID])
    expect(result.unhandled?.reason).toBe('.gitignore holds bytes that are not valid UTF-8')
  })

  it('(R10 · WR-05) passes a hostname-shaped NON-SITE token through in a configured project',
    async () => {
      // RED, MEASURED BY MUTATION rather than quoted from history: with WR-05's precondition
      // removed, `readme.md` parses as a hostname and this turn's ordering becomes
      // `[config.project.scaffold, config.proposal.apply, authoring.draft.write]` — it scaffolds
      // and COMMITS a target for `readme-md`, a site nobody named. Before 395-12 narrowed
      // `already-configured` the same route ended that turn in a refusal instead; either way what
      // is lost is 394's plain authoring dispatch, which is what this cell pins.
      const scaffoldOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const test = harness({ targets: ['shop'], realScaffold: scaffoldOp })
      const message = 'write a test that checks the readme.md rendering'
      const result = await test.runTurn({ message })

      expect(result.status).toBe('completed')
      // EXACTLY WHAT 394 SHIPS — and the reference is PRODUCED rather than typed. The same message
      // is driven through a host that binds no vocabulary at all (cell (R9)'s class), where the
      // route provably does not run, and the two dispatches are compared whole. A literal here
      // would have to re-spell the engine's own `sessionRef` stamp, and would then agree with
      // itself the day that stamp changed; this comparison cannot.
      const unrouted = harness()
      await unrouted.runTurn({ message })
      expect(test.ordering).toEqual([AUTHORING_DRAFT_WRITE_FUNCTION_ID])
      expect(test.inputs).toEqual(unrouted.inputs)
      expect(test.inputs).toHaveLength(1)
      expect((test.inputs[0]?.input as { intent?: string }).intent).toBe(message)
      // And the scaffold op was never reached at all, so nothing was filed on the way past.
      expect(scaffoldOp.filed).toHaveLength(0)
    })

  it('(R11) ONE utterance, TWO project classes: zero targets scaffolds, one target passes through',
    async () => {
      // THE CORPUS DISCIPLINE R7 established, applied to the scaffold arm: the same words against
      // both classes in one cell, so the route's decision is measured as a property of the PROJECT.
      // A route keyed on the wording makes both halves agree; a constant fails one of them.
      const message = 'write a test for booking.com checkout'

      const fromZero = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const zero = harness({ targets: [], realScaffold: fromZero })
      const zeroResult = await zero.runTurn({ message })
      expect(zeroResult.status).toBe('completed')
      expect(zero.ordering).toEqual([
        CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
        CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      ])
      expect(fromZero.filed).toHaveLength(1)

      const configuredOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const configured = harness({ targets: ['shop'], realScaffold: configuredOp })
      const configuredResult = await configured.runTurn({ message })
      expect(configuredResult.status).toBe('completed')
      expect(configured.ordering).toEqual([AUTHORING_DRAFT_WRITE_FUNCTION_ID])
      expect(configuredOp.filed).toHaveLength(0)
    })

  it('(R12) renders THIS proposal — summary, files, true diff — AFTER the scaffold and BEFORE the apply',
    async () => {
      // SC-5's FIRST CLAUSE, AS AN ORDERING CLAIM (395-13, D-14 · CFGM-05). 395-VERIFICATION drove
      // this exact road under a real pty and found the person answering `fn:config.proposal.apply
      // needs your approval` with zero diff markers, zero mention of the config file, the target
      // name or the summary line anywhere they could read. "Reviewable" was ruled to bind AT
      // APPROVAL TIME, so the claim is not that the bytes eventually appear — it is that they are
      // on the surface BEFORE the verb that commits them is invoked.
      //
      // TWO NAMED RED DIRECTIONS, both measured by mutation rather than argued:
      //   M-R1 render-absent      — the `engine.present` call deleted. Reds on the empty recorder.
      //   M-R2 render-after-apply — the same call moved below the apply invoke. Reds on the
      //                             snapshot, which then carries `config.proposal.apply`.
      //
      // THE REAL OP ANSWERS IT. Nothing here tells the scaffold what to say, so what is compared is
      // the proposal this chain actually produced.
      const scaffoldOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const test = harness({ targets: [], realScaffold: scaffoldOp })
      const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

      expect(result.status).toBe('completed')
      expect(test.ordering).toEqual([
        CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
        CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      ])

      // EXACTLY ONE render. A turn that rendered twice would be a person shown the same proposal in
      // two places, either of which could be the stale one.
      expect(test.presented).toHaveLength(1)
      const render = test.presented[0]

      // THE ORDERING, read off the snapshot taken AT RENDER TIME rather than inferred from the
      // finished turn: at the moment these bytes reached the surface the scaffold had run and the
      // apply had NOT. A render that arrived after the commit satisfies neither half.
      expect(render?.orderingAtRender).toContain(CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID)
      expect(render?.orderingAtRender).not.toContain(CONFIG_PROPOSAL_APPLY_FUNCTION_ID)

      // THE CONTENT IS THIS PROPOSAL'S, taken from the op's OWN resolved answer. A literal here
      // would agree with itself the day the derivation changed; this comparison cannot.
      const answer = test.answers.find(
        (row) => row.functionId === CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
      )?.answer as {
        readonly outcome: string
        readonly summaryLine: string
        readonly files: readonly string[]
        readonly shownDiff: string
      }
      expect(answer.outcome).toBe('proposed')
      expect(render?.text).toContain(answer.summaryLine)
      expect(answer.files.length).toBeGreaterThan(0)
      for (const path of answer.files) expect(render?.text, path).toContain(path)

      // THE TRUE `shownDiff`, BYTE FOR BYTE AND UNTRUNCATED — never a re-derivation (F-02's
      // compounding). These are the same bytes the record stores and D-19 byte-compares at apply,
      // so what a person reads here cannot drift from what an accept commits. `endsWith` is the
      // untruncated half: the diff is the tail of the render verbatim, not a reflowed excerpt.
      expect(answer.shownDiff).toContain(SCAFFOLD_CONFIG_FILE)
      expect(answer.shownDiff.split('\n').length).toBeGreaterThan(3)
      expect(render?.text).toContain(answer.shownDiff)
      expect(render?.text.endsWith(answer.shownDiff)).toBe(true)

      // AND THE RENDER IS EXACTLY THE THREE PARTS, in order — summary, file list, diff — with no
      // fourth thing invented on the way to the person.
      expect(render?.text)
        .toBe([answer.summaryLine, ...answer.files, answer.shownDiff].join('\n'))
    })

  it('(R13) renders NOTHING on a host that binds no presentation port, and the chain is unchanged',
    async () => {
      // THE ABSENT-SAFE HALF. A headless host — every `agent.ask` caller, the daemon, the MCP
      // projection — binds no surface, and this seam must leave it byte-for-byte as it was: same
      // chain, same status, nothing rendered. The gate's own posture is untouched either way, which
      // is what makes the port display-only rather than a second authorization input.
      const scaffoldOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const test = harness({ targets: [], realScaffold: scaffoldOp, noPresent: true })
      const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

      expect(result.status).toBe('completed')
      expect(test.presented).toEqual([])
      expect(test.ordering).toEqual([
        CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
        CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      ])
      expect(scaffoldOp.filed).toHaveLength(1)
    })

  it('(R14) a present that THROWS decides nothing: the turn completes and the session log is unchanged',
    async () => {
      // THE PORT'S THIRD STATE (395-17 · RULING 2 · CR-03). (R12) pins bound-and-healthy, (R13)
      // pins absent — and nothing measured bound-and-BROKEN, which is the state a real host reaches
      // the moment its stream is closed under it. 395-VERIFICATION reproduced what happened there:
      // the exception escaped `routeWriteTest`, whose call site sits in an `else if` CONDITION
      // outside the dispatch try, so `runTurn` threw — after the proposal was already durable and
      // before the apply gate was ever offered. A display surface had decided a turn's fate.
      //
      // THE CLAIM IS AN EQUALITY, not a survival check: a broken surface must leave the turn
      // BYTE-IDENTICAL to a healthy one. Two runs of the same road over the same fixture class,
      // compared on all four families — the result, the invocation ordering, what was filed, and
      // the session event stream. The events half is the one D-14 asserted and nobody measured
      // (F-08): the harness pins a fixed turn id and a counting clock, so the two streams are
      // comparable byte for byte and a swallowed failure that still cost the log a `turn_complete`
      // would fail right here.
      const message = 'write a test for booking.com checkout'

      const healthyOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const healthy = harness({ targets: [], realScaffold: healthyOp })
      const healthyResult = await healthy.runTurn({ message })
      expect(healthyResult.status).toBe('completed')

      const brokenOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const broken = harness({
        targets: [], realScaffold: brokenOp, presentFailure: 'throws',
      })
      // AWAITED PLAINLY, and that is the assertion. Pre-guard this line is where the cell died:
      // `runTurn` rejected with `the pipe closed`, and everything below was unreachable.
      const brokenResult = await broken.runTurn({ message })

      // COMPLETION — the same answer, not merely an answer.
      expect(brokenResult.status).toBe('completed')
      expect(brokenResult).toEqual(healthyResult)

      // ORDERING — the apply gate the filed proposal is entitled to, AFTER the scaffold that filed
      // it. Pre-guard this array stopped at the scaffold id.
      expect(broken.ordering).toEqual([
        CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
        CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      ])
      expect(broken.ordering.indexOf(CONFIG_PROPOSAL_APPLY_FUNCTION_ID))
        .toBeGreaterThan(broken.ordering.indexOf(CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID))

      // FILED ONCE, AND RENDERED ONCE. The render was ATTEMPTED — between the scaffold and the
      // apply, exactly where (R12) puts it — and it failed. A guard that skipped the call instead
      // of swallowing its failure would show zero attempts here.
      expect(brokenOp.filed).toHaveLength(1)
      expect(broken.presented).toHaveLength(1)
      expect(broken.presented[0]?.orderingAtRender)
        .toEqual([CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID])

      // EVENTS EQUAL, BYTE FOR BYTE — D-14's other half, finally an assertion. Same clauses, same
      // receipts, same turn completion, same order.
      expect(broken.events).toHaveLength(healthy.events.length)
      expect(JSON.stringify(broken.events)).toBe(JSON.stringify(healthy.events))
    })

  it('(R15) a present that REJECTS decides nothing either — the port type\'s other arm',
    async () => {
      // THE TWIN, over `Promise<void>` (395-17). The port is `(text) => void | Promise<void>`, and
      // a guard covering only the synchronous throw would be a half-fix whose hole is exactly the
      // arm a real async writer takes. One await covers both, and this cell is what says so.
      //
      // ITS ADMISSION TICKET IS THE MUTATION, NOT HEAD. (R15) lands after the guard, so it never
      // saw the pre-guard build; its red is measured under leg M-P1 — the guard removed, this cell
      // and (R14) red on the turn rejecting, every neighbour green.
      const message = 'write a test for booking.com checkout'

      const healthyOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const healthy = harness({ targets: [], realScaffold: healthyOp })
      const healthyResult = await healthy.runTurn({ message })
      expect(healthyResult.status).toBe('completed')

      const brokenOp = scaffoldOpFixture({ configText: ZERO_TARGET_CONFIG })
      const broken = harness({
        targets: [], realScaffold: brokenOp, presentFailure: 'rejects',
      })
      const brokenResult = await broken.runTurn({ message })

      expect(brokenResult.status).toBe('completed')
      expect(brokenResult).toEqual(healthyResult)

      expect(broken.ordering).toEqual([
        CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID,
        CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
        AUTHORING_DRAFT_WRITE_FUNCTION_ID,
      ])
      expect(broken.ordering.indexOf(CONFIG_PROPOSAL_APPLY_FUNCTION_ID))
        .toBeGreaterThan(broken.ordering.indexOf(CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID))

      expect(brokenOp.filed).toHaveLength(1)
      expect(broken.presented).toHaveLength(1)
      expect(broken.presented[0]?.orderingAtRender)
        .toEqual([CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID])

      expect(broken.events).toHaveLength(healthy.events.length)
      expect(JSON.stringify(broken.events)).toBe(JSON.stringify(healthy.events))
    })

  it('(R9) does not run at all on a host that binds no vocabulary', async () => {
    // The dep is ABSENT. The shipped dispatch is exactly what it was before this seam existed —
    // including for the from-zero case, whose only guard on such a host is the authoring loop's own
    // backstop, which this plan did not touch.
    const test = harness()
    const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

    expect(result.status).toBe('completed')
    expect(test.ordering).toEqual([AUTHORING_DRAFT_WRITE_FUNCTION_ID])
  })
})
