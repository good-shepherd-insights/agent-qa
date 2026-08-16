import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AGENT_QA_TOOL_PROJECTIONS } from '@vostride/agent-qa-mcp'
import {
  AgentQaAnalyticsEventSchema,
  ANALYTICS_EVENT_MEMBERS,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_SCHEMA_BY_NAME,
  ANALYTICS_MCP_TOOL_NAMES,
  assertNoUnconstrainedStrings,
  RETIRED_V33_EVENT_NAMES,
} from '../events.js'
import { sourceModulesContaining, withoutComments } from './source-scan.js'

describe('the closed event union — membership is the D-18 list, exactly (ANLY-01)', () => {
  it('is the D-18 membership and nothing else, pinned by equality', () => {
    expect([...ANALYTICS_EVENT_NAMES]).toEqual([
      'agent-qa.test_run.completed',
      'agent-qa.suite_run.completed',
      'agent-qa.chat.session.completed',
      'agent-qa.chat.turn.completed',
      'agent-qa.daemon.job.completed',
      'agent-qa.mcp.server.lifecycle',
      'agent-qa.mcp.tool.invoked',
      'agent-qa.init.completed',
      'agent-qa.explain.answered',
      'agent-qa.explain.abstained',
    ])
  })

  // The dropped v33 names are named rather than merely absent. An event that "is not a member"
  // because nobody remembered it looks identical to one that was ruled out, and the second is the
  // only one a later phase can re-add on purpose (M5 owns the three dashboard rows).
  it('carries the retired v33 names as a closed constant, disjoint from membership', () => {
    expect([...RETIRED_V33_EVENT_NAMES]).toEqual([
      'agent-qa.analytics.initialized',
      'agent-qa.analytics.test_event',
      'agent-qa.dashboard.opened',
      'agent-qa.dashboard.live_mode.started',
      'agent-qa.dashboard.entity.created',
    ])

    for (const retired of RETIRED_V33_EVENT_NAMES) {
      expect(ANALYTICS_EVENT_NAMES as readonly string[]).not.toContain(retired)
    }
  })

  it('the schema table covers the membership in BOTH directions', () => {
    expect(Object.keys(ANALYTICS_EVENT_SCHEMA_BY_NAME).sort()).toEqual([...ANALYTICS_EVENT_NAMES].sort())
    expect(ANALYTICS_EVENT_MEMBERS.length).toBe(ANALYTICS_EVENT_NAMES.length)
  })

  // PRODUCED, NOT RETYPED. The tool-name vocabulary is the one `mapping.ts` declares; a hand-copied
  // list here would be a second catalogue of tool names, drifting the moment one is renamed.
  it('the tool-invocation vocabulary is the mapping table, both directions', () => {
    expect([...ANALYTICS_MCP_TOOL_NAMES].sort()).toEqual(
      AGENT_QA_TOOL_PROJECTIONS.map((projection) => projection.name).sort(),
    )
    expect(ANALYTICS_MCP_TOOL_NAMES.length).toBe(12)
  })
})

describe('no free text is representable (D-18 / T-398-06)', () => {
  // THE CLEAN SIDE. On its own this proves nothing — a checker that returns unconditionally passes
  // it too — which is why it is stated beside the planted legs rather than as the claim.
  it('the shipped union passes the range checker', () => {
    expect(() => assertNoUnconstrainedStrings(ANALYTICS_EVENT_MEMBERS)).not.toThrow()
  })

  // THE VIOLATION SIDE, and the bar this checker has to clear. The planted member is the exact
  // thing D-11 forbids reaching analytics: the abstained query's text.
  it('REDs on a planted plain string field, naming the member and the field', () => {
    const planted = z.strictObject({
      name: z.literal('agent-qa.planted.free_text'),
      properties: z.strictObject({ query_text: z.string() }),
    })

    expect(() => assertNoUnconstrainedStrings([...ANALYTICS_EVENT_MEMBERS, planted])).toThrowError(
      /agent-qa\.planted\.free_text[\s\S]*properties\.query_text/,
    )
  })

  // The tag is not a password. A string carrying the known-id marker but NO refinement admits
  // anything, so tagging alone must not buy passage — otherwise the escape from the rule is one
  // `.meta()` call away and the rule is advisory.
  it('REDs on a string tagged as a known id that constrains nothing', () => {
    const planted = z.strictObject({
      name: z.literal('agent-qa.planted.tagged'),
      properties: z.strictObject({
        pretend_id: z.string().meta({ analyticsVocabulary: 'known-id', analyticsCodec: 'nothing' }),
      }),
    })

    expect(() => assertNoUnconstrainedStrings([...ANALYTICS_EVENT_MEMBERS, planted])).toThrowError(
      /agent-qa\.planted\.tagged[\s\S]*properties\.pretend_id/,
    )
  })

  it('REDs on a free string hidden inside an optional, a record value and an array', () => {
    const optionalPlant = z.strictObject({
      name: z.literal('agent-qa.planted.optional'),
      properties: z.strictObject({ note: z.string().optional() }),
    })
    expect(() => assertNoUnconstrainedStrings([optionalPlant])).toThrowError(
      /agent-qa\.planted\.optional[\s\S]*properties\.note/,
    )

    const recordPlant = z.strictObject({
      name: z.literal('agent-qa.planted.record'),
      properties: z.strictObject({ bag: z.record(z.string(), z.string()) }),
    })
    expect(() => assertNoUnconstrainedStrings([recordPlant])).toThrowError(
      /agent-qa\.planted\.record[\s\S]*properties\.bag/,
    )

    const arrayPlant = z.strictObject({
      name: z.literal('agent-qa.planted.array'),
      properties: z.strictObject({ tags: z.array(z.string()) }),
    })
    expect(() => assertNoUnconstrainedStrings([arrayPlant])).toThrowError(
      /agent-qa\.planted\.array[\s\S]*properties\.tags/,
    )
  })

  it('accepts enums, string literals, refined known-id codecs, numbers and booleans', () => {
    const clean = z.strictObject({
      name: z.literal('agent-qa.planted.clean'),
      properties: z.strictObject({
        kind: z.enum(['a', 'b']),
        fixed: z.literal('constant'),
        run_id: z.string().regex(/^r_/u).meta({ analyticsVocabulary: 'known-id', analyticsCodec: 'run' }),
        count: z.number().int(),
        flag: z.boolean(),
      }),
    })

    expect(() => assertNoUnconstrainedStrings([clean])).not.toThrow()
  })
})

describe('every member REFUSES an unknown key (.strict, never .strip)', () => {
  it('a valid payload plus one unknown key fails to parse', () => {
    const valid = {
      name: 'agent-qa.explain.answered' as const,
      properties: { agent_qa_version: '0.1.21', surface: 'chat' as const, cited_row_count: 2 },
    }

    expect(AgentQaAnalyticsEventSchema.safeParse(valid).success).toBe(true)
    expect(
      AgentQaAnalyticsEventSchema.safeParse({
        ...valid,
        properties: { ...valid.properties, query_text: 'how do I run a suite' },
      }).success,
    ).toBe(false)
  })

  it('every member schema refuses an unknown key, not just the one above', () => {
    for (const [name, schema] of Object.entries(ANALYTICS_EVENT_SCHEMA_BY_NAME)) {
      const result = schema.safeParse({
        name,
        properties: { agent_qa_version: '0.1.21', __smuggled: 'secret' },
      })
      expect(result.success, `${name} accepted an unknown property key`).toBe(false)
    }
  })

  // Prose about `.strip()` is not a call to it — four comments in this package explain why the v1
  // schemas used it and this one does not, and a raw substring search reported every one of them.
  // The scanner reads code.
  it('no module in this package calls .strip()', () => {
    expect(sourceModulesContaining('.strip(')).toEqual([])
  })

  // The scanner is itself a detector, so it gets the same treatment as the rules that use it: a
  // token in a comment is invisible, a token in a string literal is a hit, and a `//` inside a URL
  // does not start a comment. Without this, a scanner that returned '' would satisfy every cell
  // above by finding nothing anywhere.
  it('the source scanner drops comments, keeps string literals, and survives a URL', () => {
    const stripped = withoutComments(
      [
        '// a comment naming .strip( and DO_NOT_TRACK',
        '/* a block comment naming .strip( too */',
        'const host = "https://us.i.posthog.com" // trailing',
        "const literal = 'DO_NOT_TRACK'",
        'const call = schema.strip()',
      ].join('\n'),
    )

    expect(stripped).not.toContain('a comment naming')
    expect(stripped).not.toContain('a block comment')
    expect(stripped).toContain('https://us.i.posthog.com')
    expect(stripped).toContain("'DO_NOT_TRACK'")
    expect(stripped).toContain('schema.strip()')
  })
})
