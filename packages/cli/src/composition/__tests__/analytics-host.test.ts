// The CLI's analytics binding (Phase 398 plan 10, D-17 / D-19 · ANLY-01).
//
// TWO CLAIMS ARE MEASURED HERE THAT NOTHING ELSE MEASURES.
//
//   1. THE ONE DECISION SITE SURVIVED THE REWIRE. `composeAnalytics` is called from exactly one
//      shipped file in this package, and `DO_NOT_TRACK` is read from none of them. The package's
//      own cells prove the decision is made once INSIDE `compose.ts`; these prove that six hosts
//      binding it did not quietly open a second door (T-398-07).
//   2. OPTING OUT LEAVES NO TRACE ON DISK. `resolveAnalyticsIdentity` mints and writes
//      `~/.agent-qa/analytics.json`. The port has no early return, so an opted-out host would
//      resolve an identity — and persist one — on its way to a transport that sends nothing. The
//      zero-network differential cannot see this, because nothing goes near a socket.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { getAgentQaVersion } from '@vostride/agent-qa-core'

import {
  analyticsEvent,
  CLI_ANALYTICS_AGENT_QA_VERSION,
  composeAnalyticsHost,
} from '../analytics-host.js'
import { createPosthogTransport } from '@vostride/agent-qa-analytics'
import type { AnalyticsCapturePayload, AnalyticsTransport } from '@vostride/agent-qa-analytics'

function recordingTransport(): AnalyticsTransport & { readonly sent: AnalyticsCapturePayload[] } {
  const sent: AnalyticsCapturePayload[] = []
  return {
    sent,
    capture(payload) {
      sent.push(payload)
    },
    flush() {},
    shutdown() {},
  }
}

/** The shipped source of this package, comments and all — the call-site censuses read it. */
function shippedSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue
      shippedSourceFiles(path, out)
      continue
    }
    if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

const CLI_SRC = new URL('../../', import.meta.url).pathname

describe('composeAnalyticsHost', () => {
  it('is the ONLY shipped call site of composeAnalytics in this package', () => {
    const callers = shippedSourceFiles(CLI_SRC)
      .filter((file) => /\bcomposeAnalytics\s*[<(]/u.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(CLI_SRC.length))
      .sort()

    expect(callers).toEqual(['composition/analytics-host.ts'])
  })

  it('reads DO_NOT_TRACK nowhere in this package — the decision belongs to compose.ts', () => {
    const readers = shippedSourceFiles(CLI_SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('DO_NOT_TRACK'))
      .map((file) => file.slice(CLI_SRC.length))
      .sort()

    // `analytics-host.ts` names the variable in its own header prose; the census is over shipped
    // source including comments, so the file that explains the rule is allowed to mention it and
    // nothing else may. A read would be `env.DO_NOT_TRACK`, which this pattern also catches.
    expect(readers.filter((file) => file !== 'composition/analytics-host.ts')).toEqual([])
  })

  it('reads the same version --version prints — the second reader cannot drift', () => {
    // `analytics-host.ts` reads this package's own manifest rather than calling core's reader,
    // because the surface firewall does not admit core and the barrel that does is too heavy to
    // pull into every command (both reasons are written out at the constant). A second reader is a
    // real cost, and this is what pays it down: the day the two disagree, this reds instead of a
    // version field quietly disagreeing with what `agent-qa --version` prints.
    expect(CLI_ANALYTICS_AGENT_QA_VERSION).toBe(getAgentQaVersion())
  })

  it('opts out on DO_NOT_TRACK and reports the reason without re-reading the variable', async () => {
    const host = await composeAnalyticsHost({
      surface: 'cli',
      env: { DO_NOT_TRACK: '1' },
      resolveIdentity: async () => {
        throw new Error('identity must not be resolved on the opted-out arm')
      },
    })

    expect(host.optedOut).toBe(true)
    expect(host.optOutReasons).toEqual(['do-not-track'])
    expect(host.transportKind).toBe('noop')
  })

  it('mints NO identity file while opted out (the v1 early return, preserved)', async () => {
    const resolveIdentity = vi.fn(async () => ({
      distinctId: 'u_should-never-be-resolved',
      runtimeContext: 'user' as const,
    }))

    const host = await composeAnalyticsHost({
      surface: 'chat',
      env: {},
      config: { analytics: { privacy: true } },
      resolveIdentity,
    })
    host.port.capture(analyticsEvent(host, 'agent-qa.explain.answered', { cited_row_count: 2 }))
    await host.flush()

    expect(resolveIdentity).not.toHaveBeenCalled()
    expect(host.optOutReasons).toEqual(['config-privacy'])
    // The properties still describe the process; what is absent is everything derived from the
    // identity store, because the store was never consulted.
    expect(host.properties.runtime_context).toBeUndefined()
    expect(host.properties.agent_product).toBeUndefined()
  })

  it('mints NO identity file on a blank-key checkout either — the v1 `disabled` set included it', async () => {
    // Not an opt-out (`optedOut` is false and must stay false: a developer who never configured
    // PostHog did not decline tracking). But nothing sends, so nothing needs an identity, and the
    // v1 module wrote none in this state. A rewire gated on `optedOut` alone would start writing
    // `~/.agent-qa/analytics.json` on every checkout that runs a test.
    const resolveIdentity = vi.fn(async () => ({
      distinctId: 'u_should-never-be-resolved',
      runtimeContext: 'user' as const,
    }))

    const host = await composeAnalyticsHost({
      surface: 'cli',
      env: {},
      projectKey: '   ',
      resolveIdentity,
    })
    host.port.capture(analyticsEvent(host, 'agent-qa.explain.answered', { cited_row_count: 1 }))
    await host.flush()

    expect(host.optedOut).toBe(false)
    expect(host.transportKind).toBe('noop')
    expect(resolveIdentity).not.toHaveBeenCalled()
  })

  it('resolves the identity ONCE on the opted-in arm and stamps it on every event', async () => {
    const transport = recordingTransport()
    const resolveIdentity = vi.fn(async () => ({
      distinctId: 'u_test-identity',
      runtimeContext: 'agent' as const,
      agentProduct: 'claude_code' as const,
      isInternal: true,
    }))

    const host = await composeAnalyticsHost({
      surface: 'mcp',
      env: {},
      transportOverride: transport,
      resolveIdentity,
    })

    host.port.capture(analyticsEvent(host, 'agent-qa.explain.answered', { cited_row_count: 1 }))
    host.port.capture(analyticsEvent(host, 'agent-qa.explain.abstained', {
      suggested_row_count: 0,
      catalog_empty: false,
    }))
    await host.flush()

    expect(resolveIdentity).toHaveBeenCalledTimes(1)
    expect(transport.sent.map((payload) => payload.distinctId)).toEqual([
      'u_test-identity',
      'u_test-identity',
    ])
    expect(transport.sent.every((payload) => payload.isInternal === true)).toBe(true)
    expect(host.properties.runtime_context).toBe('agent')
    expect(host.properties.agent_product).toBe('claude_code')
    expect(host.properties.surface).toBe('mcp')
    expect(host.properties.$process_person_profile).toBe(false)
  })

  it('masks through the context bound AFTER composition — the run masker does not exist yet at the root', async () => {
    // THE SHIPPED TRANSPORT, over a fake PostHog client. `transportOverride` would replace the very
    // seam under measurement, so this cell constructs the real `PosthogTransport` instead — the
    // masking call it makes is the one a user's events cross.
    const sent: { distinctId: string; event: string }[] = []
    const host = await composeAnalyticsHost({
      surface: 'cli',
      env: {},
      projectKey: 'phc_test_key',
      posthogTransportFactory: (options) => createPosthogTransport({
        ...options,
        client: {
          capture: (input) => sent.push({ distinctId: input.distinctId, event: input.event }),
          shutdown: () => {},
        },
      }),
      resolveIdentity: async () => ({
        distinctId: 'hunter2-the-secret',
        runtimeContext: 'user' as const,
      }),
    })
    const transport = { sent }

    // Before the bind: nothing is seeded, so nothing is masked. This is the honest state, not a
    // gap — a host that has not built its run masking context knows no secrets to hide.
    host.port.capture(analyticsEvent(host, 'agent-qa.explain.answered', { cited_row_count: 1 }))
    await host.flush()
    expect(transport.sent[0]?.distinctId).toBe('hunter2-the-secret')

    host.bindMaskingContext({
      mask: (text) => text.replaceAll('hunter2-the-secret', '***'),
    })
    host.port.capture(analyticsEvent(host, 'agent-qa.explain.answered', { cited_row_count: 1 }))
    await host.flush()

    expect(transport.sent[1]?.distinctId).toBe('***')
  })

  it('builds events that carry the standard properties beside the member fields', async () => {
    const transport = recordingTransport()
    const host = await composeAnalyticsHost({
      surface: 'daemon',
      env: {},
      transportOverride: transport,
      resolveIdentity: async () => ({ distinctId: 'u_x', runtimeContext: 'user' as const }),
    })

    const event = analyticsEvent(host, 'agent-qa.daemon.job.completed', {
      job_kind: 'run',
      outcome: 'completed',
    })

    expect(event).toEqual({
      name: 'agent-qa.daemon.job.completed',
      properties: {
        agent_qa_version: host.properties.agent_qa_version,
        surface: 'daemon',
        runtime_context: 'user',
        $process_person_profile: false,
        job_kind: 'run',
        outcome: 'completed',
      },
    })
  })
})
