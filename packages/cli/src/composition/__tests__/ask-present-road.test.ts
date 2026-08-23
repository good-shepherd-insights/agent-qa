// `agent-qa ask` at a terminal: what a person is SHOWN before they are asked (395-22 · CFGM-05 ·
// SC-5 · the owner's 2026-08-15 CR-04 ruling, completed on the UNBOUND-present arm).
//
// THIS FILE IS 395-VERIFICATION's SCRATCH CELL MADE PERMANENT. Gap round 4 wrote one acceptance
// cell, drove `agent.ask` through the PRODUCTION composition — `composeCliLocalAgent` plus the
// shipped confirm, only the streams substituted — over a real git repository holding a config with
// ZERO targets, and measured the complete set of bytes reaching the person's terminal before the
// decision:
//
//   ["agent-qa: fn:config.proposal.apply needs your approval. Proceed? [y/N] "]
//
// No summary line, no file list, no diff. Then it DELETED the cell. A measurement that falsifies a
// success criterion and leaves nothing behind is a measurement the next round has to re-take, and
// this phase has now been caught five consecutive times hardening a two-armed condition on the arm
// somebody happened to drive. So the drive lives here.
//
// TWO CELLS, TWO INDEPENDENT MECHANISMS:
//
//   (A2) NO presentation port bound, a real confirm bound — the shipped pre-fix `ask` shape. The
//        route must REFUSE at the displayability precondition: the confirm spy is never called, the
//        turn fails closed carrying the fixed refusal sentence, and the proposal stays filed
//        exactly once so nothing a person asked for is lost. This is Task 1's mechanism
//        (`turn-engine.ts`'s precondition) measured through the production composition.
//
//   (A1) The presentation port BOUND to a recorder, the confirm answering yes — the guard-ACCEPTS
//        control. The render must reach the surface BEFORE the confirm's first call and the turn
//        must proceed. This is Task 2's mechanism (`ask.ts`'s `chatPresent` binding) plus the proof
//        that Task 1's precondition does not OVER-REFUSE a bound, healthy present.
//
// WHY BOTH IN ONE FILE. They are the two halves of one sentence — "present, then confirm, then
// apply" — and a reader who finds only the refusal cannot tell a route that refuses correctly from
// a route that refuses always. The control is what makes the refusal a divergence this file
// produced rather than a road nobody travels.
//
// THE PLANNER IS SCRIPTED AND THE REST IS PRODUCTION'S. Everything between the utterance and the
// terminal is the shipped composition; what is substituted is the LLM's willingness to emit the
// `write_test` clause, which is the same nondeterminism SC-5's own live lane lives with. Nothing
// here asserts what a model WOULD emit — the claim is about what the route does with a clause.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  AGENT_ASK_FUNCTION_ID,
  AUTHORING_DRAFT_WRITE_FUNCTION_ID,
  invokeFunction,
} from '@vostride/agent-qa-agent'
import type { AgentAskResult } from '@vostride/agent-qa-schema'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'
import type { ConfirmPort } from '@vostride/agent-qa-safety'

const CONFIG_FILE = 'agent-qa.config.yaml'

/** The utterance the round-4 verification drove, verbatim. */
const UTTERANCE = 'write a test for booking.com checkout'

/**
 * The fixed sentence every displayability refusal carries (`WRITE_TEST_UNDISPLAYABLE_DETAIL`).
 *
 * A FRAGMENT AND NOT THE WHOLE LITERAL, and not the imported constant either: `packages/agent`'s
 * barrel does not publish it, and a CLI cell that reached around the barrel would be asserting
 * through a door no shipped surface has. What this file owns is the PROPERTY a person reads — that
 * they were told they are never asked to accept a change they were not shown. The wording beyond
 * this clause is the source's to choose, and `write-test-scaffold-route.test.ts` pins it exactly.
 */
const NEVER_ASKED = 'never asked to accept a change you were not shown'

/**
 * A configuration that declares an LLM and NO TARGETS — SC-5's serving class (395-12).
 *
 * A project able to hold a conversation at all is a project that HAS a config file, because
 * `resolveCliChatCapabilities` reads the chat model out of `registry.llms`. Zero targets is what
 * puts the utterance on the from-zero road.
 */
const ZERO_TARGET_CONFIG = `# my own agent-qa configuration

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

use:
  llm: judge
  mobile:
    appState: preserve
  parallel: false
`

const SEEDED_GITIGNORE = '# the project\'s own rules\ndist/\n.agent-qa/\n'

let root: string
let configPath: string
let agentQaRoot: string

function git(...args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

/**
 * A model that emits exactly one `authoring.draft.write` tool call (the `scriptedPlanner` idiom
 * from `agent-local`'s hermetic chat lane).
 *
 * THE TOOL NAME IS DERIVED FROM THE IMPORTED ID rather than typed, so an op renamed at its
 * declaration reds here instead of leaving this cell agreeing with a string nothing dispatches.
 */
function scriptedWriteTestPlanner(): { model: unknown; calls: () => number } {
  let reached = 0
  const model = {
    specificationVersion: 'v3',
    provider: 'fixture',
    modelId: 'fixture:ask-present-road',
    supportedUrls: {},
    doGenerate: () => {
      reached += 1
      return Promise.resolve({
        content: [{
          type: 'tool-call' as const,
          toolCallId: 'scripted-0',
          toolName: AUTHORING_DRAFT_WRITE_FUNCTION_ID.replaceAll('.', '_'),
          input: JSON.stringify({ intent: UTTERANCE }),
        }],
        finishReason: { unified: 'tool-calls', raw: 'tool_use' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      })
    },
    doStream: (): never => {
      throw new Error('this lane never streams')
    },
  }
  return { model, calls: () => reached }
}

/** Every proposal record the composition durably filed, read the way a person's inbox reads them. */
function filedProposals(): string[] {
  const dir = join(agentQaRoot, 'proposals')
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  } catch {
    return []
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ask-present-road-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })

  git('init', '--quiet')
  git('config', 'user.name', 'agent-qa ask-present-road test')
  git('config', 'user.email', 'ask-present-road@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), SEEDED_GITIGNORE)
  writeFileSync(join(root, 'README.md'), 'a project with a model and no targets\n')
  // COMMITTED, never merely written: the scaffold re-reads the committed set at proposal time
  // (CFGM-04), so a dirty fixture would measure D-05's two-commit road instead of this one.
  writeFileSync(configPath, ZERO_TARGET_CONFIG)
  git('add', '--', '.gitignore', 'README.md', CONFIG_FILE)
  git('commit', '--quiet', '-m', 'the project configures a model and no targets')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('agent-qa ask, at a terminal, over a project with nothing to test against', () => {
  it('(A2) with NO presentation port bound the route REFUSES — the confirm is never reached',
    async () => {
      // THE SHIPPED PRE-FIX SHAPE, EXACTLY. `ask.ts` bound no `chatPresent` and passed no confirm,
      // so `composeCliLocalAgent` supplied `createTtyConfirmPort()` — a real prompt a person can
      // answer. Here the confirm is a SPY standing in for that prompt and nothing else is
      // substituted: the same registry, the same route, the same op, the same durable store.
      const planner = scriptedWriteTestPlanner()
      const ask = vi.fn(() => true)
      const confirm: ConfirmPort = { surface: 'tty-prompt', ask }
      const host = composeCliLocalAgent({
        agentQaRoot,
        configPath,
        confirm,
        chatModel: planner.model as never,
      })

      let result: AgentAskResult
      try {
        result = await runSafetyScope(
          { executionContext: 'local-interactive' },
          async () => await invokeFunction(
            host.registry, AGENT_ASK_FUNCTION_ID, { message: UTTERANCE }, CLI_FUNCTION_CALLER,
          ) as AgentAskResult,
        )
      } finally {
        await host.close()
      }

      // NON-VACUITY FIRST: the clause really did reach the planner and really did route. A cell
      // whose confirm count is zero because nothing happened would prove nothing at all.
      expect(planner.calls()).toBeGreaterThanOrEqual(1)

      // THE WHOLE RULING, AS A CALL COUNT. `config.proposal.apply` is the gated verb whose
      // invocation IS the prompt, so zero calls is the fact that nobody was asked to approve a
      // configuration change they had been shown nothing of.
      expect(ask.mock.calls.length).toBe(0)

      // AND THE TURN SAYS SO. `fail_closed` carrying the refusal's own sentence — not the route's
      // generic unconfigured detail, which would tell a person to name a site they already named.
      expect(result.status).toBe('fail_closed')
      expect(result.unhandled?.reason ?? '').toContain(NEVER_ASKED)

      // NOTHING IS LOST: the route refuses the TURN, not the PROPOSAL. Exactly one record is filed
      // and it is on disk under the id the refusal points a person at.
      expect(filedProposals()).toHaveLength(1)
    })

  it('(A1) with the port bound the proposal is RENDERED before the confirm is asked',
    async () => {
      // THE GUARD-ACCEPTS CONTROL, and it carries two claims at once.
      //
      // FIRST, TASK 1's PRECONDITION DOES NOT OVER-REFUSE. A route that refused always would satisfy
      // (A2) perfectly and destroy the feature; this cell is what makes (A2)'s refusal a divergence
      // rather than a constant. Same composition, same utterance, same op — one binding different.
      //
      // SECOND, TASK 2's BINDING PUTS THE RENDER IN THE RIGHT PLACE. `ask.ts` now hands
      // `composeCliLocalAgent` a `chatPresent` writing to `process.stdout`, which is the stream
      // `createTtyConfirmPort` prompts on; here that writer is a recorder and the prompt is a spy,
      // and BOTH APPEND TO ONE ORDERED LIST. The ordering claim is read off that shared list rather
      // than inferred from two independent counters — a render that arrived after the commit would
      // satisfy neither half of "reviewable binds at approval time".
      const planner = scriptedWriteTestPlanner()
      const events: string[] = []
      const rendered: string[] = []
      const ask = vi.fn(() => {
        events.push('confirm')
        return true
      })
      const confirm: ConfirmPort = { surface: 'tty-prompt', ask }
      const host = composeCliLocalAgent({
        agentQaRoot,
        configPath,
        confirm,
        chatPresent: (text: string) => {
          events.push('present')
          rendered.push(text)
        },
        chatModel: planner.model as never,
      })

      let result: AgentAskResult
      try {
        result = await runSafetyScope(
          { executionContext: 'local-interactive' },
          async () => await invokeFunction(
            host.registry, AGENT_ASK_FUNCTION_ID, { message: UTTERANCE }, CLI_FUNCTION_CALLER,
          ) as AgentAskResult,
        )
      } finally {
        await host.close()
      }

      // THE RENDER HAPPENED, EXACTLY ONCE, AND THE PROMPT CAME AFTER IT. Index comparison over the
      // one list: a turn that rendered after asking would put `confirm` first, and a turn that never
      // rendered would have no `present` at all.
      expect(rendered).toHaveLength(1)
      expect(events.indexOf('present')).toBe(0)
      expect(events.indexOf('confirm')).toBeGreaterThan(events.indexOf('present'))
      expect(ask.mock.calls.length).toBeGreaterThanOrEqual(1)

      // AND WHAT WAS RENDERED IS THIS PROPOSAL: its summary line, the config file it touches, and a
      // true unified diff. Asserted as properties of the real op's own answer rather than as a
      // literal, so a re-derived or truncated render reds here.
      const text = rendered[0] ?? ''
      expect(text).toContain('booking.com')
      expect(text).toContain(CONFIG_FILE)
      expect(text).toContain('@@')
      expect(text.split('\n').length).toBeGreaterThan(3)

      // AND THE TURN PROCEEDED: the far end of SC-5's sentence — authoring runs against the project
      // the person just configured, and the configuration really is on disk.
      expect(result.status).not.toBe('fail_closed')
      expect(filedProposals()).toHaveLength(1)
    })
})
