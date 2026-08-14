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
//                         anyway. The proposal's own detail is what the turn reports.
//   (R9) unbound        — a host that binds no vocabulary. The route must not run at all, so the
//                         shipped dispatch is byte-for-byte what it was before this seam existed.
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
} = {}): Harness {
  const ordering: string[] = []
  const inputs: { functionId: string; input: unknown }[] = []
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

  const deps: TurnEngineDeps = {
    table: CHAT_RESOLVER_TABLE,
    split: splitClauses,
    reconcile: deterministicOverrideStrategy,
    sessionLog: memoryLog(),
    mint: {
      forStage: (_stage: ChatBindingStage, sessionId: string): FunctionCaller =>
        ({ ...PLANNER_CALLER, sessionId }),
    },
    invoke: (functionId, input) => {
      ordering.push(functionId)
      inputs.push({ functionId, input })
      if (functionId === options.denyApply) {
        return Promise.reject(new FunctionDeniedError(
          'Denied config.proposal.apply: fail-closed: this project has no agent-qa configuration '
          + 'and there is nobody to ask',
        ))
      }
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
    },
    planner,
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
  return { ordering, inputs, runTurn: (input) => engine.runTurn(input) }
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
    const test = harness({ targets: ['other-site'], denyApply: CONFIG_PROPOSAL_APPLY_FUNCTION_ID })
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
    const test = harness({
      targets: ['other-site'],
      scaffoldAnswer: {
        outcome: 'refused',
        reason: 'already-configured',
        detail: 'this project already has agent-qa.config.yaml',
      },
    })
    const result = await test.runTurn({ message: 'write a test for booking.com checkout' })

    expect(result.status).toBe('fail_closed')
    expect(test.ordering).toEqual([CONFIG_PROJECT_SCAFFOLD_FUNCTION_ID])
    expect(result.unhandled?.reason).toBe('this project already has agent-qa.config.yaml')
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
